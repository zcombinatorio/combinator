/*
 * Combinator - Futarchy infrastructure for your project.
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
 *
 * Questions or feature requests? Reach out:
 * - Telegram Group: https://t.me/+Ao05jBnpEE0yZGVh
 * - Direct: https://t.me/handsdiff
 */

/**
 * Migrate historical DAOs from the old system to the new on-chain system
 *
 * Creates on-chain DAO and Moderator accounts for DAOs that were previously
 * managed off-chain in the os-percent system.
 *
 * This script:
 * 1. Creates on-chain DAO and Moderator accounts (version=0 for historical)
 * 2. Registers the DAO in cmb_daos table (required for API access)
 * 3. Adds initial proposers to cmb_dao_proposers whitelist
 *
 * Usage:
 *   # Migrate test DAOs first
 *   DAO_NAMES="SURFTEST,TESTSURF" pnpm tsx scripts/migrate-historical-daos.ts
 *
 *   # Migrate production DAOs
 *   DAO_NAMES="ZC,SURF" pnpm tsx scripts/migrate-historical-daos.ts
 *
 * Required environment variables:
 *   - PRIVATE_KEY: Base58-encoded admin private key
 *   - RPC_URL: Solana RPC URL
 *   - DB_URL: PostgreSQL connection string (same as API server)
 *
 * Optional:
 *   - DAO_NAMES: Comma-separated list of DAOs to migrate (default: all)
 *   - DRY_RUN: Set to "true" to simulate without sending transactions
 */

import 'dotenv/config';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { FutarchyClient } from '@zcomb/programs-sdk';
import { Pool } from 'pg';
import { getPool } from '../lib/db';
import {
  createDao,
  getDaoByName,
  addProposer,
  getNextKeyIndex,
  registerKey,
  updateKeyDaoId,
} from '../lib/db/daos';

// =============================================================================
// CONFIGURATION - Fill in these values before running
// =============================================================================

/**
 * DAO configurations for migration
 *
 * IMPORTANT: Fill in the multisig addresses before running!
 * Run `pnpm tsx scripts/fetch-migration-data.ts` to get proposal counters.
 */
interface DaoConfig {
  name: string;
  baseMint: string;      // Token mint (the DAO token)
  quoteMint: string;     // Quote mint (SOL)
  pool: string;          // Meteora pool address
  poolType: 'damm' | 'dlmm';
  proposalIdCounter: number;  // From os-percent moderator_state
  // Fill these in manually after creating multisigs:
  treasuryMultisig: string;   // Vault address (not multisig account)
  mintAuthMultisig: string;   // Vault address (not multisig account)
  cosigner: string;
  // Database fields
  adminWallet: string;        // Managed wallet for signing (from MANAGER_WALLET_*)
  ownerWallet: string;        // DAO owner (can manage settings, add proposers)
  initialProposers: string[]; // Wallets to add to proposer whitelist
  withdrawalPercentage?: number; // LP withdrawal % for proposals (default: 12)
}

const DAO_CONFIGS: Record<string, DaoConfig> = {
  // ==========================================================================
  // TEST DAOs - Migrate these first for testing
  // ==========================================================================
  SURFTEST: {
    name: 'SURFTEST',
    baseMint: 'E7xktmaFNM6vd4GKa8FrXwX7sA7hrLzToxc64foGq3iW',
    quoteMint: 'So11111111111111111111111111111111111111112',
    pool: 'PS3rPSb49GnAkmh3tec1RQizgNSb1hUwPsYHGGuAy5r',
    poolType: 'damm',
    // Start at 0 - after migrating 23 proposals, counter will be 23
    // Legacy system had 31 as max ID but with gaps
    proposalIdCounter: 0,
    treasuryMultisig: 'CcNLEfshWM7EPcEUxtJkRWd5BCrjvFqJCexz5oU3SyFz',
    mintAuthMultisig: 'Ed8gTWnKvEVz17ucjJPm7nxPtE1uRBghbv8nRnGGnJHS',
    cosigner: 'Dobm8QnaCPQoc6koxC3wqBQqPTfDwspATb2u6EcWC9Aw',
    // Database config
    adminWallet: 'ESMiG5ppoVMtYq3EG8aKx3XzEtKPfiGQuAx2S4jhw3zf',
    ownerWallet: '83PbZortE6imDzJcZrd5eGS42zbSAskJw7eP26GaJbqE',
    initialProposers: [
      'FtV94i2JvmaqsE1rBT72C9YR58wYJXt1ZjRmPb4tDvMK',
      '4GctbRKwsQjECaY1nL8HiqkgvEUAi8EyhU1ezNmhB3hg',
    ],
    withdrawalPercentage: 12,
  },
  TESTSURF: {
    name: 'TESTSURF',
    baseMint: 'E7xktmaFNM6vd4GKa8FrXwX7sA7hrLzToxc64foGq3iW',
    quoteMint: 'So11111111111111111111111111111111111111112',
    pool: 'EC7MUufEpZcRZyXTFt16MMNLjJVnj9Vkku4UwdZ713Hx',
    poolType: 'dlmm',
    // Start at 0 - after migrating 13 proposals, counter will be 13
    // Legacy system had 19 as max ID but with gaps
    proposalIdCounter: 0,
    treasuryMultisig: '2YFLK2DMnkJzSLstZP2LZxD282LazBAVdWqKo4ypHnrG',
    mintAuthMultisig: 'DF4VNShA6GgSVmqtMCyFmMxypQEMRtuqdw93LSPxQWPp',
    cosigner: 'Dobm8QnaCPQoc6koxC3wqBQqPTfDwspATb2u6EcWC9Aw',
    // Database config
    adminWallet: 'BnzxLbNmM63RxhHDdfeWa7BmV2YM4q7KxDJ3w75kDZo',
    ownerWallet: '83PbZortE6imDzJcZrd5eGS42zbSAskJw7eP26GaJbqE',
    initialProposers: [
      '79TLv4oneDA1tDUSNXBxNCnemzNmLToBHYXnfZWDQNeP',
      'BXc9g3zxbQhhfkLjxXbtSHrfd6MSFRdJo8pDQhW95QUw',
      'FgACAue3FuWPrL7xSqXWtUdHLne52dvVsKyKxjwqPYtr',
      'FtV94i2JvmaqsE1rBT72C9YR58wYJXt1ZjRmPb4tDvMK',
    ],
    withdrawalPercentage: 12,
  },

  // ==========================================================================
  // PRODUCTION DAOs - Migrate after testing
  // ==========================================================================
  ZC: {
    name: 'ZC',
    baseMint: 'GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC',
    quoteMint: 'So11111111111111111111111111111111111111112',
    pool: '7jbhVZcYqCRmciBcZzK8L5B96Pyw7i1SpXQFKBkzD3G2',
    poolType: 'dlmm',
    // Start at 0 - after migrating 36 proposals, counter will be 36
    // Legacy system had 43 as max ID but with gaps (missing: 10, 26, 29, 30, 34, 35, 41, 42)
    proposalIdCounter: 0,
    treasuryMultisig: '4Ckm4JKxJr6qZJHhoPnTkeVdV1qEPmt53hfVcFPCb5fU',
    mintAuthMultisig: 'DkbYcMeoMxk2qnUqYGtKhDGqmc1MDvw7H8a1Tcf7qotL',
    cosigner: '6MT2poUCxMNgFczNqmBVJ4D4ZSTidzwnNUdY4FivtSHU',
    // Database config
    adminWallet: '54A1ki4t5K9sB6oqLBVxVkUbkkCEAGeRACphsZuNPU5R',
    ownerWallet: '83PbZortE6imDzJcZrd5eGS42zbSAskJw7eP26GaJbqE',
    initialProposers: [
      '79TLv4oneDA1tDUSNXBxNCnemzNmLToBHYXnfZWDQNeP',
      'BXc9g3zxbQhhfkLjxXbtSHrfd6MSFRdJo8pDQhW95QUw',
      'FgACAue3FuWPrL7xSqXWtUdHLne52dvVsKyKxjwqPYtr',
      'FtV94i2JvmaqsE1rBT72C9YR58wYJXt1ZjRmPb4tDvMK',
    ],
    withdrawalPercentage: 50, // ZC uses 50% withdrawal
  },
  SURF: {
    name: 'SURF',
    baseMint: 'SurfwRjQQFV6P7JdhxSptf4CjWU8sb88rUiaLCystar',
    quoteMint: 'So11111111111111111111111111111111111111112',
    pool: 'Ez1QYeC95xJRwPA9SR7YWC1H1Tj43exJr91QqKf8Puu1',
    poolType: 'damm',
    // Start at 0 - after migrating 2 proposals, counter will be 2
    // Legacy system had 10 as max ID but only 2 finalized proposals (IDs 9, 10)
    proposalIdCounter: 0,
    treasuryMultisig: 'BmfaxQCRqf4xZFmQa5GswShBZhRBf4bED7hadFkpgBC3',
    mintAuthMultisig: 'CwHv7RjFnJX39GygjoANeCpo1XER6MFUy2ezBm3ScKJd',
    cosigner: '4GctbRKwsQjECaY1nL8HiqkgvEUAi8EyhU1ezNmhB3hg',
    // Database config
    adminWallet: 'etBt7Ki2Gr2rhidNmXtHyxiGHkokKPayNhG787SusMj',
    ownerWallet: '83PbZortE6imDzJcZrd5eGS42zbSAskJw7eP26GaJbqE',
    initialProposers: [
      '4GctbRKwsQjECaY1nL8HiqkgvEUAi8EyhU1ezNmhB3hg',
      'BV9MxX2veiQwLeWqwzPcMWPEhzV9r47G63b3W3qcDH7X',
    ],
    withdrawalPercentage: 12,
  },
};

// =============================================================================
// MIGRATION SCRIPT
// =============================================================================

const RPC_URL = process.env.RPC_URL;
const DRY_RUN = process.env.DRY_RUN === 'true';

if (!RPC_URL) {
  throw new Error('RPC_URL environment variable is required');
}

// Note: Database connection uses DB_URL via shared getPool() from lib/db.ts

function loadKeypair(privateKey: string): Keypair {
  return Keypair.fromSecretKey(bs58.decode(privateKey));
}

function getPoolType(poolType: 'damm' | 'dlmm'): { damm: {} } | { dlmm: {} } {
  return poolType === 'damm' ? { damm: {} } : { dlmm: {} };
}

function validateConfig(config: DaoConfig): void {
  const missing: string[] = [];

  // On-chain fields
  if (!config.treasuryMultisig) missing.push('treasuryMultisig');
  if (!config.mintAuthMultisig) missing.push('mintAuthMultisig');
  if (!config.cosigner) missing.push('cosigner');

  // Database fields
  if (!config.adminWallet) missing.push('adminWallet');
  if (!config.ownerWallet) missing.push('ownerWallet');

  if (missing.length > 0) {
    throw new Error(
      `Missing required fields for ${config.name}: ${missing.join(', ')}\n` +
      `Please fill in all required fields in the DAO_CONFIGS section.`
    );
  }
}

async function checkExistingDao(
  client: FutarchyClient,
  name: string
): Promise<{ daoExists: boolean; moderatorExists: boolean }> {
  const [daoPda] = client.deriveDAOPDA(name);
  const [moderatorPda] = client.deriveModeratorPDA(name);

  let daoExists = false;
  let moderatorExists = false;

  try {
    await client.fetchDAO(daoPda);
    daoExists = true;
  } catch {
    // DAO doesn't exist
  }

  try {
    await client.fetchModerator(moderatorPda);
    moderatorExists = true;
  } catch {
    // Moderator doesn't exist
  }

  return { daoExists, moderatorExists };
}

async function migrateDao(
  client: FutarchyClient,
  adminKeypair: Keypair,
  config: DaoConfig,
  pool: Pool
): Promise<{ daoPda: string; moderatorPda: string; signature: string; daoId: number }> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Migrating ${config.name}...`);
  console.log(`${'='.repeat(60)}`);

  // Validate config
  validateConfig(config);

  // Check if already exists in database
  const existingDbDao = await getDaoByName(pool, config.name);
  if (existingDbDao) {
    throw new Error(
      `DAO "${config.name}" already exists in database (id: ${existingDbDao.id})`
    );
  }

  // Check if already exists on-chain
  const { daoExists, moderatorExists } = await checkExistingDao(client, config.name);

  if (daoExists || moderatorExists) {
    throw new Error(
      `DAO or Moderator already exists for ${config.name}:\n` +
      `  DAO exists: ${daoExists}\n` +
      `  Moderator exists: ${moderatorExists}\n` +
      `Skipping to avoid duplicate creation.`
    );
  }

  console.log(`\nConfiguration:`);
  console.log(`  Name: ${config.name}`);
  console.log(`  Base mint: ${config.baseMint}`);
  console.log(`  Quote mint: ${config.quoteMint}`);
  console.log(`  Pool: ${config.pool}`);
  console.log(`  Pool type: ${config.poolType}`);
  console.log(`  Proposal ID counter: ${config.proposalIdCounter}`);
  console.log(`  Treasury multisig: ${config.treasuryMultisig}`);
  console.log(`  Mint auth multisig: ${config.mintAuthMultisig}`);
  console.log(`  Cosigner: ${config.cosigner}`);
  console.log(`  Admin wallet: ${config.adminWallet}`);
  console.log(`  Owner wallet: ${config.ownerWallet}`);

  // Derive PDAs
  const [daoPda] = client.deriveDAOPDA(config.name);
  const [moderatorPda] = client.deriveModeratorPDA(config.name);

  console.log(`\nDerived PDAs:`);
  console.log(`  DAO PDA: ${daoPda.toBase58()}`);
  console.log(`  Moderator PDA: ${moderatorPda.toBase58()}`);

  if (DRY_RUN) {
    console.log(`\n[DRY RUN] Would create historical parent DAO`);
    console.log(`[DRY RUN] Would write to cmb_daos table`);
    console.log(`[DRY RUN] Would add ${config.initialProposers.length} proposers`);
    return {
      daoPda: daoPda.toBase58(),
      moderatorPda: moderatorPda.toBase58(),
      signature: 'DRY_RUN',
      daoId: -1,
    };
  }

  // Build and send transaction
  console.log(`\nBuilding transaction...`);
  const { builder } = await client.addHistoricalParentDAO(
    adminKeypair.publicKey,
    config.name,
    new PublicKey(config.baseMint),
    new PublicKey(config.quoteMint),
    new PublicKey(config.treasuryMultisig),
    new PublicKey(config.mintAuthMultisig),
    new PublicKey(config.cosigner),
    new PublicKey(config.pool),
    getPoolType(config.poolType),
    config.proposalIdCounter,
    new PublicKey(config.adminWallet)  // Set admin to intended wallet, not signer
  );

  console.log(`Sending transaction...`);
  const signature = await builder.rpc();

  console.log(`\n✅ ${config.name} on-chain migration complete!`);
  console.log(`  Transaction: ${signature}`);
  console.log(`  DAO PDA: ${daoPda.toBase58()}`);
  console.log(`  Moderator PDA: ${moderatorPda.toBase58()}`);

  // Verify on-chain
  console.log(`\nVerifying on-chain state...`);
  const daoAccount = await client.fetchDAO(daoPda);
  const moderatorAccount = await client.fetchModerator(moderatorPda);

  console.log(`  DAO version: ${daoAccount.version} (0 = historical)`);
  console.log(`  Moderator version: ${moderatorAccount.version} (0 = historical)`);
  console.log(`  Moderator proposal counter: ${moderatorAccount.proposalIdCounter}`);

  // =========================================================================
  // DATABASE WRITES - Register DAO for API access
  // =========================================================================
  console.log(`\nWriting to database...`);

  // For historical DAOs, admin_key_idx is NULL (not from key service)
  // The API uses environment variables for historical DAO admin keys:
  //   HISTORICAL_ADMIN_KEY_<DAO_NAME>=<base58 private key>

  // Create DAO record in cmb_daos
  const dao = await createDao(pool, {
    dao_pda: daoPda.toBase58(),
    dao_name: config.name,
    moderator_pda: moderatorPda.toBase58(),
    owner_wallet: config.ownerWallet,
    admin_key_idx: null,  // NULL = historical DAO, uses env-based key
    admin_wallet: config.adminWallet,
    token_mint: config.baseMint,
    pool_address: config.pool,
    pool_type: config.poolType,
    quote_mint: config.quoteMint,
    treasury_multisig: config.treasuryMultisig,
    mint_auth_multisig: config.mintAuthMultisig,
    treasury_cosigner: config.cosigner,
    dao_type: 'parent',
    withdrawal_percentage: config.withdrawalPercentage || 12,
    // No funding_signature for historical DAOs
  });

  console.log(`  ✅ Created cmb_daos record (id: ${dao.id})`);

  // Add initial proposers (including owner)
  const proposersToAdd = [config.ownerWallet, ...config.initialProposers];
  const uniqueProposers = Array.from(new Set(proposersToAdd)); // Dedupe

  for (const proposerWallet of uniqueProposers) {
    await addProposer(pool, {
      dao_id: dao.id!,
      proposer_wallet: proposerWallet,
      added_by: config.ownerWallet,
    });
    console.log(`  ✅ Added proposer: ${proposerWallet}`);
  }

  console.log(`\n✅ ${config.name} database migration complete!`);

  return {
    daoPda: daoPda.toBase58(),
    moderatorPda: moderatorPda.toBase58(),
    signature,
    daoId: dao.id!,
  };
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║           Migrate Historical DAOs to On-Chain                    ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  if (DRY_RUN) {
    console.log('🔵 DRY RUN MODE - No transactions will be sent\n');
  }

  // Load admin wallet
  const privateKey = process.env.PRIVATE_KEY || process.env.DAO_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('PRIVATE_KEY environment variable is required');
  }
  const adminKeypair = loadKeypair(privateKey);
  console.log(`Admin wallet: ${adminKeypair.publicKey.toBase58()}`);
  console.log(`RPC URL: ${RPC_URL}\n`);

  // Setup client
  const connection = new Connection(RPC_URL!, 'confirmed');
  const wallet = new Wallet(adminKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });
  const client = new FutarchyClient(provider);

  // Determine which DAOs to migrate
  const daoNames = process.env.DAO_NAMES
    ? process.env.DAO_NAMES.split(',').map(s => s.trim())
    : Object.keys(DAO_CONFIGS);

  console.log(`DAOs to migrate: ${daoNames.join(', ')}`);

  // Validate all configs before starting
  console.log(`\nValidating configurations...`);
  for (const name of daoNames) {
    const config = DAO_CONFIGS[name];
    if (!config) {
      throw new Error(`Unknown DAO: ${name}. Available: ${Object.keys(DAO_CONFIGS).join(', ')}`);
    }
    try {
      validateConfig(config);
      console.log(`  ✓ ${name}`);
    } catch (error) {
      console.error(`  ✗ ${name}: ${(error as Error).message}`);
      process.exit(1);
    }
  }

  // Get database pool
  const pool = getPool();

  // Migrate each DAO
  const results: Array<{
    name: string;
    success: boolean;
    daoPda?: string;
    moderatorPda?: string;
    signature?: string;
    daoId?: number;
    error?: string;
  }> = [];

  try {
    for (const name of daoNames) {
      const config = DAO_CONFIGS[name];
      try {
        const result = await migrateDao(client, adminKeypair, config, pool);
        results.push({
          name,
          success: true,
          ...result,
        });
      } catch (error) {
        console.error(`\n❌ Failed to migrate ${name}:`, (error as Error).message);
        results.push({
          name,
          success: false,
          error: (error as Error).message,
        });
      }
    }
  } finally {
    // Clean up database pool
    await pool.end();
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('MIGRATION SUMMARY');
  console.log(`${'='.repeat(60)}\n`);

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`Successful: ${successful.length}/${results.length}`);
  for (const r of successful) {
    console.log(`  ✅ ${r.name}`);
    console.log(`     DAO PDA: ${r.daoPda}`);
    console.log(`     Moderator PDA: ${r.moderatorPda}`);
    console.log(`     Database ID: ${r.daoId}`);
    console.log(`     Tx: ${r.signature}`);
  }

  if (failed.length > 0) {
    console.log(`\nFailed: ${failed.length}/${results.length}`);
    for (const r of failed) {
      console.log(`  ❌ ${r.name}: ${r.error}`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('Next steps:');
  console.log('1. Run verify-migration.ts to verify the on-chain accounts');
  console.log('2. Run migrate-historical-proposals.ts to add proposal history');
  console.log(`${'='.repeat(60)}\n`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
