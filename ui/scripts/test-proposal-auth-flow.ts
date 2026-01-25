/*
 * Test script for proposal authorization flow
 * Tests actual proposal creation with different auth scenarios
 *
 * Usage:
 *   API_URL=http://localhost:6770 \
 *   PRIVATE_KEY="..." \
 *   DAO_PDA="..." \
 *   pnpm tsx scripts/test-proposal-auth-flow.ts
 */

import * as crypto from 'crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';

const API_URL = process.env.API_URL || 'http://localhost:3001';
const PRIVATE_KEY = process.env.PRIVATE_KEY || process.env.DAO_PRIVATE_KEY;
const DAO_PDA = process.env.DAO_PDA;

if (!PRIVATE_KEY || !DAO_PDA) {
  console.error('Missing PRIVATE_KEY or DAO_PDA');
  process.exit(1);
}

const ownerWallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
const unauthorizedWallet = Keypair.generate();

console.log('=== Proposal Authorization Flow Test ===\n');
console.log('Owner wallet:', ownerWallet.publicKey.toBase58());
console.log('Unauthorized wallet:', unauthorizedWallet.publicKey.toBase58());
console.log('DAO PDA:', DAO_PDA);

function signRequest(body: Record<string, unknown>, keypair: Keypair): string {
  const hash = crypto.createHash('sha256').update(JSON.stringify(body)).digest();
  const hashHex = hash.toString('hex');
  const message = `Combinator Authentication\n\nSign this message to verify your request.\n\nRequest hash: ${hashHex}`;
  const messageBytes = Buffer.from(message, 'utf-8');
  const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
  return bs58.encode(signature);
}

// Management helpers (using owner wallet)
async function addProposer(proposerWallet: string) {
  const payload = { wallet: ownerWallet.publicKey.toBase58(), proposer_wallet: proposerWallet };
  const response = await fetch(`${API_URL}/dao/${DAO_PDA}/proposers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, signed_hash: signRequest(payload, ownerWallet) }),
  });
  return { status: response.status, data: await response.json() };
}

async function removeProposer(proposerWallet: string) {
  const payload = { wallet: ownerWallet.publicKey.toBase58() };
  const response = await fetch(`${API_URL}/dao/${DAO_PDA}/proposers/${proposerWallet}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, signed_hash: signRequest(payload, ownerWallet) }),
  });
  return { status: response.status, data: await response.json() };
}

async function setThreshold(threshold: string | null) {
  const payload = { wallet: ownerWallet.publicKey.toBase58(), threshold };
  const response = await fetch(`${API_URL}/dao/${DAO_PDA}/proposer-config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, signed_hash: signRequest(payload, ownerWallet) }),
  });
  return { status: response.status, data: await response.json() };
}

async function getProposers() {
  const response = await fetch(`${API_URL}/dao/${DAO_PDA}/proposers`);
  return response.json();
}

// Proposal creation helper - uses specified wallet
async function createProposal(keypair: Keypair) {
  const payload = {
    wallet: keypair.publicKey.toBase58(),
    dao_pda: DAO_PDA,
    title: 'Test Proposal',
    description: 'Testing authorization flow',
    length_secs: 3600,
    options: ['Option A', 'Option B'],
  };
  const response = await fetch(`${API_URL}/dao/proposal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, signed_hash: signRequest(payload, keypair) }),
  });
  return { status: response.status, data: await response.json() };
}

async function main() {
  let testsPassed = 0;
  let testsFailed = 0;

  try {
    // ========== SETUP: Clear whitelist and threshold ==========
    console.log('\n--- SETUP: Clearing whitelist and threshold ---');
    const proposers = await getProposers();
    for (const p of (proposers.proposers || [])) {
      await removeProposer(p.proposer_wallet);
    }
    await setThreshold(null);
    console.log('✅ Setup complete - DAO is in open state\n');

    // ========== TEST 1: Open state - anyone can propose ==========
    console.log('--- TEST 1: Open state (no whitelist, no threshold) ---');
    console.log('Expected: Proposal should proceed (may fail on other checks, but NOT on auth)');
    const test1 = await createProposal(unauthorizedWallet);
    console.log('Status:', test1.status);
    console.log('Response:', JSON.stringify(test1.data, null, 2));

    // In open state, auth should pass - may fail on other checks like treasury
    if (test1.data.check === 'proposer_authorization') {
      console.log('❌ FAILED: Should not fail on proposer_authorization in open state');
      testsFailed++;
    } else {
      console.log('✅ PASSED: Auth check passed (failed on different check or succeeded)');
      testsPassed++;
    }

    // ========== TEST 2: Add whitelist entry, test non-whitelisted wallet ==========
    console.log('\n--- TEST 2: Whitelist exists, wallet NOT on list ---');
    console.log('Adding owner to whitelist...');
    await addProposer(ownerWallet.publicKey.toBase58());
    console.log('Expected: Unauthorized wallet should be DENIED');

    const test2 = await createProposal(unauthorizedWallet);
    console.log('Status:', test2.status);
    console.log('Response:', JSON.stringify(test2.data, null, 2));

    if (test2.status === 403 && test2.data.check === 'proposer_authorization') {
      console.log('✅ PASSED: Correctly denied non-whitelisted wallet');
      testsPassed++;
    } else {
      console.log('❌ FAILED: Should have denied with proposer_authorization check');
      testsFailed++;
    }

    // ========== TEST 3: Whitelisted wallet can propose ==========
    console.log('\n--- TEST 3: Whitelisted wallet ---');
    console.log('Expected: Owner wallet (on whitelist) should pass auth');

    const test3 = await createProposal(ownerWallet);
    console.log('Status:', test3.status);
    console.log('Response:', JSON.stringify(test3.data, null, 2));

    if (test3.data.check === 'proposer_authorization') {
      console.log('❌ FAILED: Whitelisted wallet should not fail on auth');
      testsFailed++;
    } else {
      console.log('✅ PASSED: Whitelisted wallet passed auth (may fail on other checks)');
      testsPassed++;
    }

    // ========== TEST 4: Token threshold - wallet not on whitelist but threshold set ==========
    console.log('\n--- TEST 4: Token threshold without whitelist match ---');
    // Remove owner from whitelist, set threshold
    await removeProposer(ownerWallet.publicKey.toBase58());
    await setThreshold('1000000000000000'); // Very high threshold (1M tokens with 9 decimals)
    console.log('Whitelist cleared, threshold set to 1000000000000000 (very high)');
    console.log('Expected: Unauthorized wallet should be DENIED (no balance)');

    const test4 = await createProposal(unauthorizedWallet);
    console.log('Status:', test4.status);
    console.log('Response:', JSON.stringify(test4.data, null, 2));

    if (test4.status === 403 && test4.data.check === 'proposer_authorization') {
      console.log('✅ PASSED: Correctly denied wallet without sufficient balance');
      testsPassed++;
    } else {
      console.log('❌ FAILED: Should have denied due to insufficient token balance');
      testsFailed++;
    }

    // ========== CLEANUP ==========
    console.log('\n--- CLEANUP ---');
    await setThreshold(null);
    console.log('✅ Cleanup complete');

    // ========== SUMMARY ==========
    console.log('\n========================================');
    console.log(`Tests passed: ${testsPassed}`);
    console.log(`Tests failed: ${testsFailed}`);
    console.log('========================================\n');

    if (testsFailed > 0) {
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ Test error:', error);
    process.exit(1);
  }
}

main();
