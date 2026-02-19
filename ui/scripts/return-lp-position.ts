/**
 * Return LP position from a DAO admin back to the client's wallet.
 *
 * Looks up the DAO in the database, fetches the admin keypair from the
 * key service, and transfers all LP position NFTs to DESTINATION_WALLET.
 *
 * Usage:
 *   pnpm tsx scripts/return-lp-position.ts
 *
 * Required ENV:
 *   - RPC_URL: Solana RPC endpoint
 *   - DB_URL: Database connection string
 *   - KEY_SERVICE_URL + SIV_KEY: For key service DAOs
 *   - HISTORICAL_ADMIN_KEY_<DAO_NAME>: For historical DAOs
 *
 * Before running, fill in DAO_PDA and DESTINATION_WALLET below.
 */
import 'dotenv/config';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { fetchAdminKeypair } from '../lib/keyService';
import { getPool } from '../lib/db';
import { getDaoByPda } from '../lib/db/daos';

// ============================================================================
// FILL THESE IN BEFORE RUNNING
// ============================================================================
const DAO_PDA = '';           // The DAO PDA whose admin holds the LP
const DESTINATION_WALLET = ''; // The client wallet to return the LP to
// ============================================================================

async function main() {
  if (!DAO_PDA) throw new Error('Fill in DAO_PDA before running');
  if (!DESTINATION_WALLET) throw new Error('Fill in DESTINATION_WALLET before running');

  const RPC_URL = process.env.RPC_URL;
  if (!RPC_URL) throw new Error('RPC_URL required');

  const connection = new Connection(RPC_URL, 'confirmed');
  const pool = getPool();

  const dao = await getDaoByPda(pool, DAO_PDA);
  if (!dao) throw new Error(`DAO not found for PDA: ${DAO_PDA}`);

  console.log('=== Return LP Position ===');
  console.log('DAO:', dao.dao_name);
  console.log('Pool:', dao.pool_address, `(${dao.pool_type})`);
  console.log('Admin:', dao.admin_wallet, '(key idx:', dao.admin_key_idx, ')');
  console.log('Destination:', DESTINATION_WALLET);

  const adminKeypair = await fetchAdminKeypair(dao.admin_key_idx, dao.dao_name);
  console.log('Fetched admin keypair');

  const cpAmm = new CpAmm(connection);
  const poolPubkey = new PublicKey(dao.pool_address);
  const adminPubkey = new PublicKey(dao.admin_wallet);
  const destination = new PublicKey(DESTINATION_WALLET);

  console.log('\nFetching LP positions...');
  const positions = await cpAmm.getUserPositionByPool(poolPubkey, adminPubkey);

  if (positions.length === 0) {
    console.log('No LP positions found for admin');
    return;
  }

  console.log('Found', positions.length, 'position(s)');

  if (positions.length > 1) {
    console.log('Admin holds multiple LP positions — aborting to avoid transferring the wrong one.');
    console.log('Manually verify which position to transfer before re-running.');
    return;
  }

  for (const pos of positions) {
    const nftMint = pos.positionState.nftMint;
    const liquidity = pos.positionState.unlockedLiquidity;

    console.log('Position:', nftMint.toBase58());
    console.log('  Liquidity:', liquidity.toString());

    if (liquidity.isZero()) {
      console.log('  Skipping - no liquidity');
      continue;
    }

    const adminAta = getAssociatedTokenAddressSync(nftMint, adminPubkey, false, TOKEN_2022_PROGRAM_ID);
    const destAta = getAssociatedTokenAddressSync(nftMint, destination, false, TOKEN_2022_PROGRAM_ID);

    const tx = new Transaction();

    const ataInfo = await connection.getAccountInfo(destAta);
    if (!ataInfo) {
      console.log('  Creating ATA for destination...');
      tx.add(createAssociatedTokenAccountInstruction(
        adminPubkey, destAta, destination, nftMint, TOKEN_2022_PROGRAM_ID
      ));
    }

    tx.add(createTransferInstruction(adminAta, destAta, adminPubkey, 1, [], TOKEN_2022_PROGRAM_ID));

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = adminPubkey;
    tx.sign(adminKeypair);

    // process.exit(0);

    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    console.log('  Transferred! Signature:', sig);
  }

  console.log('\n=== Transfer Complete ===');

  const destPositions = await cpAmm.getUserPositionByPool(poolPubkey, destination);
  console.log('Destination wallet now has', destPositions.length, 'position(s)');
}

main().catch(console.error);
