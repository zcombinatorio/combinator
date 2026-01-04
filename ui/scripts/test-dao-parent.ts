/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2025 Spice Finance Inc.
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
 * Test script for POST /dao/parent endpoint
 *
 * Usage:
 *   pnpm tsx scripts/test-dao-parent.ts
 *
 * Required environment variables:
 *   - PRIVATE_KEY: Base58-encoded private key for signing
 *   - API_URL: API base URL (defaults to http://localhost:3001)
 *
 * Required arguments (via environment variables):
 *   - DAO_NAME: Name for the DAO (max 32 chars)
 *   - TOKEN_MINT: SPL token mint address
 *   - POOL_ADDRESS: Meteora DAMM/DLMM pool address
 *   - TREASURY_COSIGNER: (optional) Wallet to co-sign treasury txs, defaults to test wallet
 */

import 'dotenv/config';
import * as crypto from 'crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';

const API_URL = process.env.API_URL || 'http://localhost:3001';

interface CreateParentDaoResponse {
  dao_pda: string;
  moderator_pda: string;
  treasury_multisig: string;
  mint_multisig: string;
  admin_wallet: string;
  pool_type: 'damm' | 'dlmm';
  quote_mint: string;
  transaction: string;
}

/**
 * Load keypair from base58-encoded private key
 */
function loadKeypair(privateKey: string): Keypair {
  const secretKey = bs58.decode(privateKey);
  return Keypair.fromSecretKey(secretKey);
}

/**
 * Sign a request body and return the signed_hash
 */
function signRequest(body: Record<string, unknown>, keypair: Keypair): string {
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify(body))
    .digest();

  const signature = nacl.sign.detached(hash, keypair.secretKey);
  return bs58.encode(signature);
}

/**
 * Make a signed request to the API
 */
async function signedRequest<T>(
  endpoint: string,
  body: Record<string, unknown>,
  keypair: Keypair
): Promise<T> {
  const wallet = keypair.publicKey.toBase58();
  const requestBody = { ...body, wallet };
  const signed_hash = signRequest(requestBody, keypair);

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...requestBody, signed_hash }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`API error: ${response.status} - ${JSON.stringify(data)}`);
  }

  return data as T;
}

async function main() {
  console.log('=== Test POST /dao/parent ===\n');

  // Load test wallet
  const privateKey = process.env.PRIVATE_KEY || process.env.PROTOCOL_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('PRIVATE_KEY environment variable is required');
  }
  const keypair = loadKeypair(privateKey);
  console.log(`Test wallet: ${keypair.publicKey.toBase58()}`);

  // Get required parameters
  const name = process.env.DAO_NAME;
  const token_mint = process.env.TOKEN_MINT;
  const pool_address = process.env.POOL_ADDRESS;
  const treasury_cosigner = process.env.TREASURY_COSIGNER || keypair.publicKey.toBase58();

  if (!name) {
    throw new Error('DAO_NAME environment variable is required');
  }
  if (!token_mint) {
    throw new Error('TOKEN_MINT environment variable is required');
  }
  if (!pool_address) {
    throw new Error('POOL_ADDRESS environment variable is required');
  }

  console.log(`\nCreating parent DAO:`);
  console.log(`  Name: ${name}`);
  console.log(`  Token mint: ${token_mint}`);
  console.log(`  Pool address: ${pool_address}`);
  console.log(`  Treasury cosigner: ${treasury_cosigner}`);
  console.log(`  API URL: ${API_URL}\n`);

  try {
    const response = await signedRequest<CreateParentDaoResponse>('/dao/parent', {
      name,
      token_mint,
      pool_address,
      treasury_cosigner,
    }, keypair);

    console.log('✅ Parent DAO created successfully!\n');
    console.log('Response:');
    console.log(`  DAO PDA: ${response.dao_pda}`);
    console.log(`  Moderator PDA: ${response.moderator_pda}`);
    console.log(`  Treasury multisig: ${response.treasury_multisig}`);
    console.log(`  Mint multisig: ${response.mint_multisig}`);
    console.log(`  Admin wallet: ${response.admin_wallet}`);
    console.log(`  Pool type (derived): ${response.pool_type}`);
    console.log(`  Quote mint (derived): ${response.quote_mint}`);
    console.log(`  Transaction: ${response.transaction}`);

    console.log('\n=== Next Steps ===');
    console.log(`1. Transfer LP tokens for pool ${pool_address} to admin wallet: ${response.admin_wallet}`);
    console.log(`2. Transfer treasury funds to: ${response.treasury_multisig}`);
    console.log(`3. Transfer mint authority to: ${response.mint_multisig}`);
  } catch (error) {
    console.error('❌ Error creating parent DAO:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
