/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2026 Spice Finance Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Transfer admin for a DAO from one wallet to another
 *
 * This script is used to fix the admin mismatch caused by the original
 * addHistoricalParentDAO instruction setting admin to the signer instead
 * of the intended admin wallet.
 *
 * Usage:
 *   # Transfer SURFTEST admin
 *   DAO_NAME=SURFTEST pnpm tsx scripts/transfer-admin.ts
 *
 * Required environment variables:
 *   - DAO_PRIVATE_KEY: Current admin private key (the signer who created the DAO)
 *   - RPC_URL: Solana RPC URL
 *   - DAO_NAME: Name of the DAO to transfer admin for
 *
 * Optional:
 *   - NEW_ADMIN: Override new admin pubkey (default: from HISTORICAL_ADMIN_KEY_<DAO_NAME>)
 *   - DRY_RUN: Set to "true" to simulate without sending transactions
 */

import 'dotenv/config';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { FutarchyClient } from '@zcomb/programs-sdk';

// Admin wallet mappings (same as in migrate-historical-daos.ts)
const ADMIN_WALLETS: Record<string, string> = {
  SURFTEST: 'ESMiG5ppoVMtYq3EG8aKx3XzEtKPfiGQuAx2S4jhw3zf',
  TESTSURF: 'BnzxLbNmM63RxhHDdfeWa7BmV2YM4q7KxDJ3w75kDZo',
  ZC: '54A1ki4t5K9sB6oqLBVxVkUbkkCEAGeRACphsZuNPU5R',
  SURF: 'etBt7Ki2Gr2rhidNmXtHyxiGHkokKPayNhG787SusMj',
};

const DRY_RUN = process.env.DRY_RUN === 'true';

function loadKeypair(privateKey: string): Keypair {
  return Keypair.fromSecretKey(bs58.decode(privateKey));
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                    Transfer DAO Admin                             ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) {
    throw new Error('RPC_URL environment variable is required');
  }

  const daoName = process.env.DAO_NAME;
  if (!daoName) {
    throw new Error('DAO_NAME environment variable is required');
  }

  if (DRY_RUN) {
    console.log('🔵 DRY RUN MODE - No transactions will be sent\n');
  }

  // Load current admin keypair (the one who signed the original migration)
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('PRIVATE_KEY environment variable is required (current admin key)');
  }
  const currentAdminKeypair = loadKeypair(privateKey);
  console.log(`Current admin: ${currentAdminKeypair.publicKey.toBase58()}`);

  // Determine new admin
  const newAdminStr = process.env.NEW_ADMIN || ADMIN_WALLETS[daoName];
  if (!newAdminStr) {
    throw new Error(
      `No new admin specified. Either set NEW_ADMIN env var or add ${daoName} to ADMIN_WALLETS`
    );
  }
  const newAdmin = new PublicKey(newAdminStr);
  console.log(`New admin: ${newAdmin.toBase58()}`);
  console.log(`DAO: ${daoName}`);
  console.log(`RPC URL: ${rpcUrl}\n`);

  // Setup client
  const connection = new Connection(rpcUrl, 'confirmed');
  const wallet = new Wallet(currentAdminKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });
  const client = new FutarchyClient(provider);

  // Derive PDAs
  const [daoPda] = client.deriveDAOPDA(daoName);
  const [moderatorPda] = client.deriveModeratorPDA(daoName);

  console.log(`DAO PDA: ${daoPda.toBase58()}`);
  console.log(`Moderator PDA: ${moderatorPda.toBase58()}`);

  // Fetch current state
  console.log(`\nFetching current on-chain state...`);
  try {
    const daoAccount = await client.fetchDAO(daoPda);
    const moderatorAccount = await client.fetchModerator(moderatorPda);

    console.log(`  Current DAO admin: ${daoAccount.admin.toBase58()}`);
    console.log(`  Current Moderator admin: ${moderatorAccount.admin.toBase58()}`);

    // Verify current admin matches signer
    if (!daoAccount.admin.equals(currentAdminKeypair.publicKey)) {
      throw new Error(
        `Current admin mismatch!\n` +
        `  On-chain admin: ${daoAccount.admin.toBase58()}\n` +
        `  Signer: ${currentAdminKeypair.publicKey.toBase58()}\n` +
        `You need to use the private key for the on-chain admin.`
      );
    }

    // Check if already correct
    if (daoAccount.admin.equals(newAdmin)) {
      console.log(`\n✅ Admin is already set to ${newAdmin.toBase58()}`);
      console.log(`No transfer needed.`);
      return;
    }
  } catch (error) {
    throw new Error(`Failed to fetch DAO accounts: ${(error as Error).message}`);
  }

  if (DRY_RUN) {
    console.log(`\n[DRY RUN] Would transfer admin from:`);
    console.log(`  ${currentAdminKeypair.publicKey.toBase58()}`);
    console.log(`to:`);
    console.log(`  ${newAdmin.toBase58()}`);
    return;
  }

  // Build and send transaction
  console.log(`\nBuilding transfer admin transaction...`);
  const { builder } = await client.transferAdmin(
    currentAdminKeypair.publicKey,
    daoName,
    newAdmin
  );

  console.log(`Sending transaction...`);
  const signature = await builder.rpc();

  console.log(`\n✅ Admin transfer complete!`);
  console.log(`  Transaction: ${signature}`);

  // Verify new state
  console.log(`\nVerifying new on-chain state...`);
  const daoAccount = await client.fetchDAO(daoPda);
  const moderatorAccount = await client.fetchModerator(moderatorPda);

  console.log(`  New DAO admin: ${daoAccount.admin.toBase58()}`);
  console.log(`  New Moderator admin: ${moderatorAccount.admin.toBase58()}`);

  if (daoAccount.admin.equals(newAdmin) && moderatorAccount.admin.equals(newAdmin)) {
    console.log(`\n✅ Verification successful! Admin has been transferred.`);
  } else {
    console.error(`\n❌ Verification failed! Admin mismatch after transfer.`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
