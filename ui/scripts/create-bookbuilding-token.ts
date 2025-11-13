#!/usr/bin/env tsx
/*
 * Z Combinator - Token Creation Script for Bookbuilding
 * Copyright (C) 2025 Z Combinator
 *
 * This script creates a new token and mints the supply to the protocol wallet.
 * Should be run BEFORE creating a bookbuilding.
 *
 * Usage:
 *   Edit the TOKEN_CONFIG below, then run:
 *   tsx scripts/create-bookbuilding-token.ts
 */

import {
  Connection,
  Keypair,
} from '@solana/web3.js';
import {
  createMint,
  mintTo,
  getOrCreateAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// CONFIGURATION - Edit these values
// ============================================================================

const TOKEN_CONFIG = {
  name: 'MyToken',
  symbol: 'MTK',
  supply: 1_000_000_000,  // 1 billion
  decimals: 6,
  caEnding: undefined,     // Optional: 'ABC' for vanity address
};

// ============================================================================
// Environment Setup
// ============================================================================

const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const PROTOCOL_MINT_AUTHORITY_KEY = process.env.PROTOCOL_MINT_AUTHORITY_PRIVATE_KEY;

if (!PROTOCOL_MINT_AUTHORITY_KEY) {
  console.error('Error: PROTOCOL_MINT_AUTHORITY_PRIVATE_KEY not set in environment');
  process.exit(1);
}

// ============================================================================
// Helper Functions
// ============================================================================

async function generateTokenKeypair(caEnding?: string): Promise<Keypair> {
  if (!caEnding) {
    return Keypair.generate();
  }

  console.log(`Generating keypair with ending: ${caEnding}`);
  let keypair: Keypair;
  let attempts = 0;
  const maxAttempts = 10_000_000;

  do {
    keypair = Keypair.generate();
    attempts++;

    if (attempts % 100000 === 0) {
      console.log(`  Attempts: ${attempts.toLocaleString()}`);
    }

    if (attempts % 10000 === 0) {
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  } while (!keypair.publicKey.toString().endsWith(caEnding) && attempts < maxAttempts);

  if (!keypair.publicKey.toString().endsWith(caEnding)) {
    throw new Error(`Could not generate keypair ending with ${caEnding} after ${maxAttempts} attempts`);
  }

  console.log(`  Found after ${attempts.toLocaleString()} attempts`);
  return keypair;
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  console.log('\n=== Z Combinator Token Creation ===\n');
  console.log('Configuration:');
  console.log(`  Name: ${TOKEN_CONFIG.name}`);
  console.log(`  Symbol: ${TOKEN_CONFIG.symbol}`);
  console.log(`  Supply: ${TOKEN_CONFIG.supply.toLocaleString()}`);
  console.log(`  Decimals: ${TOKEN_CONFIG.decimals}`);
  if (TOKEN_CONFIG.caEnding) {
    console.log(`  CA Ending: ${TOKEN_CONFIG.caEnding}`);
  }
  console.log(`  RPC: ${RPC_URL}\n`);

  // Initialize connection
  const connection = new Connection(RPC_URL, 'confirmed');

  // Load protocol mint authority
  const mintAuthorityKeypair = Keypair.fromSecretKey(
    bs58.decode(PROTOCOL_MINT_AUTHORITY_KEY)
  );
  const protocolWallet = mintAuthorityKeypair.publicKey;

  console.log(`Protocol wallet: ${protocolWallet.toString()}\n`);

  // Check protocol wallet balance
  const balance = await connection.getBalance(protocolWallet);
  console.log(`Protocol SOL balance: ${(balance / 1e9).toFixed(4)} SOL`);

  if (balance < 0.01e9) {
    console.error('Error: Protocol wallet needs at least 0.01 SOL for rent and fees');
    process.exit(1);
  }

  // Generate token keypair
  console.log('\nGenerating token keypair...');
  const tokenKeypair = await generateTokenKeypair(TOKEN_CONFIG.caEnding);
  const tokenAddress = tokenKeypair.publicKey.toString();

  console.log(`Token address: ${tokenAddress}`);

  // Create mint
  console.log('\nCreating mint account...');
  const mint = await createMint(
    connection,
    mintAuthorityKeypair,  // Payer
    protocolWallet,        // Mint authority
    protocolWallet,        // Freeze authority (optional, can be null)
    TOKEN_CONFIG.decimals, // Decimals
    tokenKeypair,          // Mint keypair
    undefined,             // Confirm options
    TOKEN_PROGRAM_ID       // Token program
  );

  console.log(`✓ Mint created: ${mint.toString()}`);

  // Get or create protocol's token account
  console.log('\nCreating protocol token account...');
  const protocolTokenAccount = await getOrCreateAssociatedTokenAddress(
    mint,
    protocolWallet,
    false,
    TOKEN_PROGRAM_ID
  );

  console.log(`✓ Protocol token account: ${protocolTokenAccount.toString()}`);

  // Mint entire supply to protocol wallet
  console.log(`\nMinting ${TOKEN_CONFIG.supply.toLocaleString()} tokens to protocol wallet...`);

  const mintAmount = BigInt(TOKEN_CONFIG.supply) * BigInt(10 ** TOKEN_CONFIG.decimals);

  const mintSignature = await mintTo(
    connection,
    mintAuthorityKeypair,
    mint,
    protocolTokenAccount,
    mintAuthorityKeypair,
    mintAmount,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID
  );

  console.log(`✓ Minted ${TOKEN_CONFIG.supply.toLocaleString()} tokens`);
  console.log(`  Signature: ${mintSignature}`);

  // Save token info to file
  const outputDir = path.join(process.cwd(), 'scripts', 'tokens');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputFile = path.join(outputDir, `token-${TOKEN_CONFIG.symbol}-${timestamp}.json`);

  const tokenInfo = {
    name: TOKEN_CONFIG.name,
    symbol: TOKEN_CONFIG.symbol,
    address: tokenAddress,
    decimals: TOKEN_CONFIG.decimals,
    supply: TOKEN_CONFIG.supply,
    mintAuthority: protocolWallet.toString(),
    protocolTokenAccount: protocolTokenAccount.toString(),
    secretKey: bs58.encode(tokenKeypair.secretKey),
    mintSignature,
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(outputFile, JSON.stringify(tokenInfo, null, 2));

  console.log('\n=== Token Created Successfully ===\n');
  console.log('Token Information:');
  console.log(`  Address: ${tokenAddress}`);
  console.log(`  Supply: ${TOKEN_CONFIG.supply.toLocaleString()} tokens`);
  console.log(`  Protocol Account: ${protocolTokenAccount.toString()}`);
  console.log(`  Mint Authority: ${protocolWallet.toString()}`);
  console.log(`\nSaved to: ${outputFile}`);
  console.log('\n⚠️  IMPORTANT: Save the secret key securely!');
  console.log(`Secret Key: ${bs58.encode(tokenKeypair.secretKey)}`);
  console.log('\nYou can now create a bookbuilding with this token address.');
}

main().catch((error) => {
  console.error('\n❌ Error:', error);
  process.exit(1);
});
