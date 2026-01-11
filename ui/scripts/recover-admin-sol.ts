/**
 * Recover SOL from DAO admin wallets back to the protocol wallet
 *
 * This script iterates through all DAOs, fetches their admin keypairs from
 * the key service, and transfers their SOL balances back to the protocol wallet.
 *
 * Usage:
 *   pnpm tsx scripts/recover-admin-sol.ts
 *
 * Dry run (no transactions):
 *   DRY_RUN=true pnpm tsx scripts/recover-admin-sol.ts
 *
 * Leave minimum balance in wallets:
 *   MIN_LEAVE=0.01 pnpm tsx scripts/recover-admin-sol.ts
 *
 * Required ENV:
 *   - RPC_URL: Solana RPC endpoint
 *   - DB_URL: PostgreSQL connection string
 *   - KEY_SERVICE_URL: Key management service URL
 *   - SIV_KEY: Key service authentication
 *   - PROTOCOL_PRIVATE_KEY: Protocol wallet private key (destination)
 */
import 'dotenv/config';
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { getPool } from '../lib/db';
import { getAllDaos } from '../lib/db/daos';
import { fetchKeypair, getProtocolKeypair } from '../lib/keyService';
import type { Dao } from '../lib/db/types';

// Configuration
const DRY_RUN = true;
const MIN_LEAVE_SOL = parseFloat(process.env.MIN_LEAVE || '0.001'); // Leave this much for rent
const MIN_RECOVER_SOL = 0.002; // Don't bother recovering less than this
const TX_FEE_SOL = 0.000005; // ~5000 lamports

interface RecoveryResult {
  daoId: number;
  daoName: string;
  adminWallet: string;
  adminKeyIdx: number;
  balanceSol: number;
  recoveredSol: number;
  status: 'success' | 'skipped' | 'failed';
  signature?: string;
  error?: string;
}

async function main() {
  const RPC_URL = process.env.RPC_URL;
  if (!RPC_URL) throw new Error('RPC_URL is required');

  const connection = new Connection(RPC_URL, 'confirmed');
  const dbPool = getPool();
  const protocolKeypair = getProtocolKeypair();
  const protocolWallet = protocolKeypair.publicKey;

  console.log('=== Recover SOL from DAO Admin Wallets ===\n');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no transactions)' : 'LIVE'}`);
  console.log(`Destination: ${protocolWallet.toBase58()}`);
  console.log(`Min leave in wallets: ${MIN_LEAVE_SOL} SOL`);
  console.log(`Min to recover: ${MIN_RECOVER_SOL} SOL`);
  console.log('');

  // Get protocol wallet balance
  const protocolBalance = await connection.getBalance(protocolWallet);
  console.log(`Protocol wallet balance: ${(protocolBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL\n`);

  // Fetch all DAOs
  const daos = await getAllDaos(dbPool);
  console.log(`Found ${daos.length} DAOs\n`);

  const results: RecoveryResult[] = [];
  let totalRecovered = 0;
  let successCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const dao of daos) {
    const result = await recoverFromDao(connection, dao, protocolWallet);
    results.push(result);

    if (result.status === 'success') {
      totalRecovered += result.recoveredSol;
      successCount++;
      console.log(`✓ [${dao.id}] ${dao.dao_name}: recovered ${result.recoveredSol.toFixed(4)} SOL`);
      if (result.signature) {
        console.log(`  tx: ${result.signature}`);
      }
    } else if (result.status === 'skipped') {
      skippedCount++;
      console.log(`- [${dao.id}] ${dao.dao_name}: skipped (balance: ${result.balanceSol.toFixed(4)} SOL)`);
    } else {
      failedCount++;
      console.log(`✗ [${dao.id}] ${dao.dao_name}: FAILED - ${result.error}`);
    }
  }

  // Summary
  console.log('\n=== Summary ===');
  console.log(`Total DAOs processed: ${daos.length}`);
  console.log(`  Successful: ${successCount}`);
  console.log(`  Skipped: ${skippedCount}`);
  console.log(`  Failed: ${failedCount}`);
  console.log(`\nTotal SOL recovered: ${totalRecovered.toFixed(4)} SOL`);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No transactions were sent.');
    console.log('Run without DRY_RUN=true to execute transfers.');
  }

  // Final protocol wallet balance
  const finalBalance = await connection.getBalance(protocolWallet);
  console.log(`\nProtocol wallet final balance: ${(finalBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  await dbPool.end();
}

async function recoverFromDao(
  connection: Connection,
  dao: Dao,
  destination: PublicKey
): Promise<RecoveryResult> {
  const result: RecoveryResult = {
    daoId: dao.id!,
    daoName: dao.dao_name,
    adminWallet: dao.admin_wallet,
    adminKeyIdx: dao.admin_key_idx,
    balanceSol: 0,
    recoveredSol: 0,
    status: 'skipped',
  };

  try {
    // Fetch the admin keypair from key service
    const adminKeypair = await fetchKeypair(dao.admin_key_idx);

    // Verify the keypair matches the stored wallet address
    if (adminKeypair.publicKey.toBase58() !== dao.admin_wallet) {
      result.status = 'failed';
      result.error = `Keypair mismatch: expected ${dao.admin_wallet}, got ${adminKeypair.publicKey.toBase58()}`;
      return result;
    }

    // Get current balance
    const balance = await connection.getBalance(adminKeypair.publicKey);
    const balanceSol = balance / LAMPORTS_PER_SOL;
    result.balanceSol = balanceSol;

    // Calculate amount to recover
    const amountToRecover = balanceSol - MIN_LEAVE_SOL - TX_FEE_SOL;

    if (amountToRecover < MIN_RECOVER_SOL) {
      result.status = 'skipped';
      return result;
    }

    result.recoveredSol = amountToRecover;

    if (DRY_RUN) {
      result.status = 'success';
      return result;
    }

    // Create and send transaction
    const lamportsToSend = Math.floor(amountToRecover * LAMPORTS_PER_SOL);
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: adminKeypair.publicKey,
        toPubkey: destination,
        lamports: lamportsToSend,
      })
    );

    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [adminKeypair],
      { commitment: 'confirmed' }
    );

    result.status = 'success';
    result.signature = signature;
    return result;
  } catch (error) {
    result.status = 'failed';
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  }
}

main().catch(e => {
  console.error('Error:', e.message || e);
  process.exit(1);
});
