/*
 * Test script for proposer whitelist management endpoints
 *
 * Usage:
 *   API_URL=http://localhost:6770 \
 *   PRIVATE_KEY="..." \
 *   DAO_PDA="..." \
 *   pnpm tsx scripts/test-proposer-endpoints.ts
 */

import { Keypair, PublicKey } from '@solana/web3.js';
import * as nacl from 'tweetnacl';
import bs58 from 'bs58';
import * as crypto from 'crypto';

const API_URL = process.env.API_URL || 'http://localhost:3001';
const PRIVATE_KEY = process.env.PRIVATE_KEY || process.env.DAO_PRIVATE_KEY;
const DAO_PDA = process.env.DAO_PDA;

if (!PRIVATE_KEY) {
  console.error('Missing PRIVATE_KEY environment variable');
  process.exit(1);
}

if (!DAO_PDA) {
  console.error('Missing DAO_PDA environment variable');
  process.exit(1);
}

// Load test wallet
const testWallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
console.log('Test wallet:', testWallet.publicKey.toBase58());
console.log('DAO PDA:', DAO_PDA);
console.log('API URL:', API_URL);

// Generate a random wallet to use as test proposer
const testProposerWallet = Keypair.generate();
console.log('Test proposer wallet:', testProposerWallet.publicKey.toBase58());

function signRequest(body: Record<string, unknown>, keypair: typeof testWallet): string {
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

async function testAddProposer() {
  console.log('\n=== Test POST /dao/:daoPda/proposers ===\n');

  const payload = {
    wallet: testWallet.publicKey.toBase58(),
    proposer_wallet: testProposerWallet.publicKey.toBase58(),
  };

  const signedHash = signRequest(payload, testWallet);

  const response = await fetch(`${API_URL}/dao/${DAO_PDA}/proposers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, signed_hash: signedHash }),
  });

  const result = await response.json();
  console.log('Status:', response.status);
  console.log('Response:', JSON.stringify(result, null, 2));

  if (!response.ok) {
    throw new Error(`Failed to add proposer: ${result.error}`);
  }

  console.log('\n✅ Successfully added proposer!');
  return result;
}

async function testUpdateThreshold() {
  console.log('\n=== Test PUT /dao/:daoPda/proposer-config ===\n');

  // Set threshold to 1000000000 (1 token with 9 decimals)
  const threshold = '1000000000';

  const payload = {
    wallet: testWallet.publicKey.toBase58(),
    threshold,
  };

  const signedHash = signRequest(payload, testWallet);

  const response = await fetch(`${API_URL}/dao/${DAO_PDA}/proposer-config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, signed_hash: signedHash }),
  });

  const result = await response.json();
  console.log('Status:', response.status);
  console.log('Response:', JSON.stringify(result, null, 2));

  if (!response.ok) {
    throw new Error(`Failed to update threshold: ${result.error}`);
  }

  console.log('\n✅ Successfully updated threshold!');
  return result;
}

async function testRemoveProposer() {
  console.log('\n=== Test DELETE /dao/:daoPda/proposers/:wallet ===\n');

  const payload = {
    wallet: testWallet.publicKey.toBase58(),
  };

  const signedHash = signRequest(payload, testWallet);

  const proposerWallet = testProposerWallet.publicKey.toBase58();

  const response = await fetch(`${API_URL}/dao/${DAO_PDA}/proposers/${proposerWallet}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, signed_hash: signedHash }),
  });

  const result = await response.json();
  console.log('Status:', response.status);
  console.log('Response:', JSON.stringify(result, null, 2));

  if (!response.ok) {
    throw new Error(`Failed to remove proposer: ${result.error}`);
  }

  console.log('\n✅ Successfully removed proposer!');
  return result;
}

async function testClearThreshold() {
  console.log('\n=== Test clearing threshold (set to null) ===\n');

  const payload = {
    wallet: testWallet.publicKey.toBase58(),
    threshold: null,
  };

  const signedHash = signRequest(payload, testWallet);

  const response = await fetch(`${API_URL}/dao/${DAO_PDA}/proposer-config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, signed_hash: signedHash }),
  });

  const result = await response.json();
  console.log('Status:', response.status);
  console.log('Response:', JSON.stringify(result, null, 2));

  if (!response.ok) {
    throw new Error(`Failed to clear threshold: ${result.error}`);
  }

  console.log('\n✅ Successfully cleared threshold!');
  return result;
}

async function main() {
  try {
    // Test 1: Add a proposer
    await testAddProposer();

    // Test 2: Update token threshold
    await testUpdateThreshold();

    // Test 3: Remove the proposer
    await testRemoveProposer();

    // Test 4: Clear the threshold
    await testClearThreshold();

    console.log('\n========================================');
    console.log('All proposer endpoint tests passed! ✅');
    console.log('========================================\n');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

main();
