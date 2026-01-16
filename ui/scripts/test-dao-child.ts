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
 * Test script for POST /dao/child endpoint
 *
 * Usage:
 *   pnpm tsx scripts/test-dao-child.ts
 *
 * Required environment variables:
 *   - PRIVATE_KEY: Base58-encoded private key for signing (must be parent DAO owner)
 *   - API_URL: API base URL (defaults to http://localhost:3001)
 *   - RPC_URL: Solana RPC URL (defaults to mainnet)
 *
 * Required arguments (via environment variables):
 *   - CHILD_DAO_NAME: Name for the child DAO (max 32 chars)
 *   - PARENT_PDA: Parent DAO PDA address
 *   - TOKEN_MINT: SPL token mint address for the child DAO
 *   - TREASURY_COSIGNER: (optional) Wallet to co-sign treasury txs, defaults to test wallet
 */

import 'dotenv/config';
import * as crypto from 'crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {
  Keypair,
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

const API_URL = process.env.API_URL || 'http://localhost:3001';
const RPC_URL = process.env.RPC_URL;

if (!RPC_URL) {
  throw new Error('RPC_URL environment variable is required');
}

/**
 * DAO Public Key - the protocol wallet that receives funding payments.
 * Must match the value in lib/dao/funding.ts
 */
const DAO_PUBLIC_KEY = new PublicKey('83PbZortE6imDzJcZrd5eGS42zbSAskJw7eP26GaJbqE');

/**
 * Funding amount in SOL required to create a DAO.
 */
const FUNDING_AMOUNT_SOL = 0.11;

interface CreateChildDaoResponse {
  dao_pda: string;
  parent_dao_pda: string;
  treasury_vault: string;
  mint_vault: string;
  admin_wallet: string;
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
 * Sign a request body and return the signed_hash.
 * Signs a human-readable message containing the SHA-256 hash of the request body.
 */
function signRequest(body: Record<string, unknown>, keypair: Keypair): string {
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify(body))
    .digest();

  // Convert hash to hex for human-readable message
  const hashHex = hash.toString('hex');

  // Create human-readable message (must match frontend and backend)
  const message = `Combinator Authentication\n\nSign this message to verify your request.\n\nRequest hash: ${hashHex}`;
  const messageBytes = Buffer.from(message, 'utf-8');

  const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
  return bs58.encode(signature);
}

/**
 * Submit a funding transaction to the DAO public key
 * Returns the transaction signature
 */
async function submitFundingTransaction(
  connection: Connection,
  keypair: Keypair,
  amountSol: number = FUNDING_AMOUNT_SOL
): Promise<string> {
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: DAO_PUBLIC_KEY,
      lamports: Math.floor(amountSol * LAMPORTS_PER_SOL),
    })
  );

  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [keypair],
    { commitment: 'confirmed' }
  );

  return signature;
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
  console.log('=== Test POST /dao/child ===\n');

  // Load test wallet
  const privateKey = process.env.PRIVATE_KEY || process.env.DAO_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('PRIVATE_KEY environment variable is required');
  }
  const keypair = loadKeypair(privateKey);
  console.log(`Test wallet: ${keypair.publicKey.toBase58()}`);

  // Get required parameters
  const name = process.env.CHILD_DAO_NAME;
  const parent_pda = process.env.PARENT_PDA;
  const token_mint = process.env.TOKEN_MINT;
  const treasury_cosigner = process.env.TREASURY_COSIGNER || keypair.publicKey.toBase58();

  if (!name) {
    throw new Error('CHILD_DAO_NAME environment variable is required');
  }
  if (!parent_pda) {
    throw new Error('PARENT_PDA environment variable is required');
  }
  if (!token_mint) {
    throw new Error('TOKEN_MINT environment variable is required');
  }

  console.log(`\nCreating child DAO:`);
  console.log(`  Name: ${name}`);
  console.log(`  Parent PDA: ${parent_pda}`);
  console.log(`  Token mint: ${token_mint}`);
  console.log(`  Treasury cosigner: ${treasury_cosigner}`);
  console.log(`  API URL: ${API_URL}`);
  console.log(`  RPC URL: ${RPC_URL}\n`);

  try {
    // Step 1: Submit funding transaction
    console.log(`Submitting funding transaction (${FUNDING_AMOUNT_SOL} SOL to ${DAO_PUBLIC_KEY.toBase58()})...`);
    const connection = new Connection(RPC_URL!, 'confirmed');
    const funding_signature = await submitFundingTransaction(connection, keypair);
    console.log(`✅ Funding transaction confirmed: ${funding_signature}\n`);

    // Step 2: Create the child DAO with the funding signature
    console.log('Creating child DAO...');
    const response = await signedRequest<CreateChildDaoResponse>('/dao/child', {
      name,
      parent_pda,
      token_mint,
      treasury_cosigner,
      funding_signature,
    }, keypair);

    console.log('✅ Child DAO created successfully!\n');
    console.log('Response:');
    console.log(`  DAO PDA: ${response.dao_pda}`);
    console.log(`  Parent DAO PDA: ${response.parent_dao_pda}`);
    console.log(`  Treasury vault: ${response.treasury_vault}`);
    console.log(`  Mint vault: ${response.mint_vault}`);
    console.log(`  Admin wallet: ${response.admin_wallet}`);
    console.log(`  Transaction: ${response.transaction}`);

    console.log('\n=== Next Steps ===');
    console.log(`1. Transfer treasury funds to: ${response.treasury_vault}`);
    console.log('   (Child DAOs share the parent\'s liquidity pool)');
  } catch (error) {
    console.error('❌ Error creating child DAO:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
