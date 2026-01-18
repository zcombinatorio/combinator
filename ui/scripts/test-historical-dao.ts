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
 * Test script for adding a historical parent DAO
 *
 * Creates on-chain DAO and Moderator accounts for a DAO that was previously
 * set up on the old system. Does NOT create Squads multisigs (assumes they exist).
 *
 * Usage:
 *   pnpm tsx scripts/test-historical-dao.ts
 *
 * Required environment variables:
 *   - PRIVATE_KEY: Base58-encoded private key for signing (admin)
 *   - RPC_URL: Solana RPC URL
 *
 * Required arguments (via environment variables):
 *   - DAO_NAME: Name for the DAO (max 32 chars, used for PDA derivation)
 *   - BASE_MINT: Base token mint address (the DAO token)
 *   - QUOTE_MINT: Quote token mint address (e.g., USDC)
 *   - TREASURY_MULTISIG: Existing treasury multisig address
 *   - MINT_AUTH_MULTISIG: Existing mint authority multisig address
 *   - COSIGNER: Treasury cosigner wallet address
 *   - POOL_ADDRESS: Meteora DAMM/DLMM pool address
 *   - POOL_TYPE: Pool type ('damm' or 'dlmm')
 *   - PROPOSAL_ID_COUNTER: Starting proposal counter (for syncing with historical proposals)
 */

import 'dotenv/config';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { FutarchyClient } from '@zcomb/programs-sdk';

const RPC_URL = process.env.RPC_URL;

if (!RPC_URL) {
  throw new Error('RPC_URL environment variable is required');
}

function loadKeypair(privateKey: string): Keypair {
  const secretKey = bs58.decode(privateKey);
  return Keypair.fromSecretKey(secretKey);
}

function getPoolType(poolTypeStr: string): { damm: {} } | { dlmm: {} } {
  const normalized = poolTypeStr.toLowerCase();
  if (normalized === 'damm') {
    return { damm: {} };
  } else if (normalized === 'dlmm') {
    return { dlmm: {} };
  } else {
    throw new Error(`Invalid POOL_TYPE: ${poolTypeStr}. Must be 'damm' or 'dlmm'`);
  }
}

async function main() {
  console.log('=== Test Add Historical Parent DAO ===\n');

  // Load admin wallet
  const privateKey = process.env.PRIVATE_KEY || process.env.DAO_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('PRIVATE_KEY environment variable is required');
  }
  const adminKeypair = loadKeypair(privateKey);
  console.log(`Admin wallet: ${adminKeypair.publicKey.toBase58()}`);

  // Get required parameters
  const name = process.env.DAO_NAME;
  const baseMint = process.env.BASE_MINT;
  const quoteMint = process.env.QUOTE_MINT;
  const treasuryMultisig = process.env.TREASURY_MULTISIG;
  const mintAuthMultisig = process.env.MINT_AUTH_MULTISIG;
  const cosigner = process.env.COSIGNER || adminKeypair.publicKey.toBase58();
  const poolAddress = process.env.POOL_ADDRESS;
  const poolTypeStr = process.env.POOL_TYPE || 'damm';
  const proposalIdCounter = parseInt(process.env.PROPOSAL_ID_COUNTER || '0', 10);

  // Validate required params
  if (!name) throw new Error('DAO_NAME environment variable is required');
  if (!baseMint) throw new Error('BASE_MINT environment variable is required');
  if (!quoteMint) throw new Error('QUOTE_MINT environment variable is required');
  if (!treasuryMultisig) throw new Error('TREASURY_MULTISIG environment variable is required');
  if (!mintAuthMultisig) throw new Error('MINT_AUTH_MULTISIG environment variable is required');
  if (!poolAddress) throw new Error('POOL_ADDRESS environment variable is required');

  const poolType = getPoolType(poolTypeStr);

  console.log(`\nCreating historical parent DAO:`);
  console.log(`  Name: ${name}`);
  console.log(`  Base mint: ${baseMint}`);
  console.log(`  Quote mint: ${quoteMint}`);
  console.log(`  Treasury multisig: ${treasuryMultisig}`);
  console.log(`  Mint auth multisig: ${mintAuthMultisig}`);
  console.log(`  Cosigner: ${cosigner}`);
  console.log(`  Pool address: ${poolAddress}`);
  console.log(`  Pool type: ${poolTypeStr}`);
  console.log(`  Proposal ID counter: ${proposalIdCounter}`);
  console.log(`  RPC URL: ${RPC_URL}\n`);

  try {
    // Setup connection and provider
    const connection = new Connection(RPC_URL!, 'confirmed');
    const wallet = new Wallet(adminKeypair);
    const provider = new AnchorProvider(connection, wallet, {
      commitment: 'confirmed',
      preflightCommitment: 'confirmed',
    });

    // Initialize FutarchyClient
    const client = new FutarchyClient(provider);

    // Derive PDAs for display
    const [daoPda] = client.deriveDAOPDA(name);
    const [moderatorPda] = client.deriveModeratorPDA(name);

    console.log(`Derived PDAs:`);
    console.log(`  DAO PDA: ${daoPda.toBase58()}`);
    console.log(`  Moderator PDA: ${moderatorPda.toBase58()}\n`);

    // Build the transaction
    console.log('Building transaction...');
    const { builder } = await client.addHistoricalParentDAO(
      adminKeypair.publicKey,
      name,
      new PublicKey(baseMint),
      new PublicKey(quoteMint),
      new PublicKey(treasuryMultisig),
      new PublicKey(mintAuthMultisig),
      new PublicKey(cosigner),
      new PublicKey(poolAddress),
      poolType,
      proposalIdCounter
    );

    // Send and confirm
    console.log('Sending transaction...');
    const signature = await builder.rpc();

    console.log('\n✅ Historical parent DAO created successfully!\n');
    console.log('Result:');
    console.log(`  Transaction: ${signature}`);
    console.log(`  DAO PDA: ${daoPda.toBase58()}`);
    console.log(`  Moderator PDA: ${moderatorPda.toBase58()}`);

    // Verify on-chain
    console.log('\nVerifying on-chain state...');
    const daoAccount = await client.fetchDAO(daoPda);
    const moderatorAccount = await client.fetchModerator(moderatorPda);

    console.log('\nDAO Account:');
    console.log(`  Version: ${daoAccount.version} (0 = historical)`);
    console.log(`  Name: ${daoAccount.name}`);
    console.log(`  Admin: ${daoAccount.admin.toBase58()}`);
    console.log(`  Token mint: ${daoAccount.tokenMint.toBase58()}`);
    console.log(`  Treasury multisig: ${daoAccount.treasuryMultisig.toBase58()}`);
    console.log(`  Mint auth multisig: ${daoAccount.mintAuthMultisig.toBase58()}`);

    console.log('\nModerator Account:');
    console.log(`  Version: ${moderatorAccount.version} (0 = historical)`);
    console.log(`  Name: ${moderatorAccount.name}`);
    console.log(`  Admin: ${moderatorAccount.admin.toBase58()}`);
    console.log(`  Base mint: ${moderatorAccount.baseMint.toBase58()}`);
    console.log(`  Quote mint: ${moderatorAccount.quoteMint.toBase58()}`);
    console.log(`  Proposal ID counter: ${moderatorAccount.proposalIdCounter}`);

    console.log('\n=== Next Steps ===');
    console.log(`1. Add historical proposals using addHistoricalProposal (counter starts at ${proposalIdCounter})`);
    console.log(`2. Register DAO in the database for API access`);

  } catch (error) {
    console.error('❌ Error creating historical parent DAO:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
