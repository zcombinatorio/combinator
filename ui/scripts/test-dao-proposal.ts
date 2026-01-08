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
 * Test script for POST /dao/proposal endpoint
 *
 * Usage:
 *   pnpm tsx scripts/test-dao-proposal.ts
 *
 * Required environment variables:
 *   - PRIVATE_KEY: Base58-encoded private key for signing (must be DAO owner or proposer)
 *   - API_URL: API base URL (defaults to http://localhost:3001)
 *   - DAO_PDA: The DAO PDA to create a proposal for
 *
 *   - WARMUP_SECS: Warmup duration in seconds (must be <= 80% of length_secs)
 *
 * Optional environment variables:
 *   - PROPOSAL_TITLE: Proposal title (defaults to test title)
 *   - PROPOSAL_DESCRIPTION: Proposal description (defaults to test description)
 *   - PROPOSAL_LENGTH_SECS: Proposal duration in seconds (defaults to 86400 = 1 day)
 */

import 'dotenv/config';
import * as crypto from 'crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';

const API_URL = process.env.API_URL || 'http://localhost:3001';

interface CreateProposalResponse {
  proposal_pda: string;
  proposal_id: number;
  metadata_cid: string;
  dao_pda: string;
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
  console.log('=== Test POST /dao/proposal ===\n');

  // Load test wallet
  const privateKey = process.env.PRIVATE_KEY || process.env.PROTOCOL_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('PRIVATE_KEY environment variable is required');
  }
  const keypair = loadKeypair(privateKey);
  console.log(`Test wallet: ${keypair.publicKey.toBase58()}`);

  // Get required parameters
  const dao_pda = process.env.DAO_PDA;
  if (!dao_pda) {
    throw new Error('DAO_PDA environment variable is required');
  }

  const title = process.env.PROPOSAL_TITLE || `Test Proposal ${Date.now()}`;
  const description = process.env.PROPOSAL_DESCRIPTION ||
    'This is a test proposal created by the automated test script. It demonstrates the proposal creation flow.';
  const length_secs = parseInt(process.env.PROPOSAL_LENGTH_SECS || '86400', 10); // Default: 1 day

  if (!process.env.WARMUP_SECS) {
    throw new Error('WARMUP_SECS environment variable is required');
  }
  const warmup_secs = parseInt(process.env.WARMUP_SECS, 10);
  const options = process.env.PROPOSAL_OPTIONS
    ? process.env.PROPOSAL_OPTIONS.split(',').map(o => o.trim())
    : ['Approve', 'Reject'];

  console.log(`\nCreating proposal:`);
  console.log(`  DAO PDA: ${dao_pda}`);
  console.log(`  Title: ${title}`);
  console.log(`  Description: ${description.substring(0, 50)}...`);
  console.log(`  Duration: ${length_secs} seconds (${(length_secs / 60).toFixed(1)} minutes)`);
  console.log(`  Warmup: ${warmup_secs} seconds (${(warmup_secs / 60).toFixed(1)} minutes)`);
  console.log(`  Options: ${options.join(', ')}`);
  console.log(`  API URL: ${API_URL}\n`);

  try {
    const response = await signedRequest<CreateProposalResponse>('/dao/proposal', {
      dao_pda,
      title,
      description,
      length_secs,
      warmup_secs,
      options,
    }, keypair);

    console.log('✅ Proposal created successfully!\n');
    console.log('Response:');
    console.log(`  Proposal PDA: ${response.proposal_pda}`);
    console.log(`  Proposal ID: ${response.proposal_id}`);
    console.log(`  Metadata CID: ${response.metadata_cid}`);
    console.log(`  DAO PDA: ${response.dao_pda}`);

    console.log('\n=== Next Steps ===');
    console.log('1. Users can now vote on this proposal');
    console.log('2. After the duration expires, the proposal can be finalized');
  } catch (error) {
    console.error('❌ Error creating proposal:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
