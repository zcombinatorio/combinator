/*
 * Test script for proposer authorization flow
 * Tests both wallet whitelist and token threshold checks
 *
 * Usage:
 *   API_URL=http://localhost:6770 \
 *   PRIVATE_KEY="..." \
 *   DAO_PDA="..." \
 *   pnpm tsx scripts/test-proposer-auth.ts
 */

import * as crypto from 'crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';

const API_URL = process.env.API_URL || 'http://localhost:3001';
const PRIVATE_KEY = process.env.PRIVATE_KEY || process.env.PROTOCOL_PRIVATE_KEY;
const DAO_PDA = process.env.DAO_PDA;

if (!PRIVATE_KEY || !DAO_PDA) {
  console.error('Missing PRIVATE_KEY or DAO_PDA');
  process.exit(1);
}

const ownerWallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
const randomWallet = Keypair.generate();

console.log('=== Proposer Authorization Test ===\n');
console.log('Owner wallet:', ownerWallet.publicKey.toBase58());
console.log('Random wallet:', randomWallet.publicKey.toBase58());
console.log('DAO PDA:', DAO_PDA);
console.log('API URL:', API_URL);

function signRequest(body: Record<string, unknown>, keypair: Keypair): string {
  const hash = crypto.createHash('sha256').update(JSON.stringify(body)).digest();
  const signature = nacl.sign.detached(hash, keypair.secretKey);
  return bs58.encode(signature);
}

async function addProposer(proposerWallet: string) {
  const payload = { wallet: ownerWallet.publicKey.toBase58(), proposer_wallet: proposerWallet };
  const response = await fetch(`${API_URL}/dao/${DAO_PDA}/proposers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, signed_hash: signRequest(payload, ownerWallet) }),
  });
  return response.json();
}

async function removeProposer(proposerWallet: string) {
  const payload = { wallet: ownerWallet.publicKey.toBase58() };
  const response = await fetch(`${API_URL}/dao/${DAO_PDA}/proposers/${proposerWallet}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, signed_hash: signRequest(payload, ownerWallet) }),
  });
  return response.json();
}

async function setThreshold(threshold: string | null) {
  const payload = { wallet: ownerWallet.publicKey.toBase58(), threshold };
  const response = await fetch(`${API_URL}/dao/${DAO_PDA}/proposer-threshold`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, signed_hash: signRequest(payload, ownerWallet) }),
  });
  return response.json();
}

async function getDao() {
  const response = await fetch(`${API_URL}/dao/${DAO_PDA}`);
  return response.json();
}

async function getProposers() {
  const response = await fetch(`${API_URL}/dao/${DAO_PDA}/proposers`);
  return response.json();
}

async function main() {
  try {
    // Step 0: Get current DAO state
    console.log('\n--- Step 0: Current DAO state ---');
    const dao = await getDao();
    console.log('DAO Name:', dao.dao_name);
    console.log('Token Mint:', dao.token_mint);
    console.log('Current threshold:', dao.proposer_token_threshold || 'null (open)');

    const proposers = await getProposers();
    console.log('Current proposers:', proposers.proposers?.map((p: {proposer_wallet: string}) => p.proposer_wallet) || []);

    // Step 1: Clear any existing whitelist and threshold (reset to open)
    console.log('\n--- Step 1: Reset to open state ---');
    // Remove all existing proposers
    for (const p of (proposers.proposers || [])) {
      console.log('Removing:', p.proposer_wallet);
      await removeProposer(p.proposer_wallet);
    }
    // Clear threshold
    await setThreshold(null);
    console.log('✅ Reset complete - DAO should now be open to anyone');

    // Step 2: Add a proposer to whitelist
    console.log('\n--- Step 2: Add proposer to whitelist ---');
    const addResult = await addProposer(randomWallet.publicKey.toBase58());
    console.log('Add result:', addResult.success ? '✅ Success' : `❌ ${addResult.error}`);

    // Step 3: Verify proposer list
    console.log('\n--- Step 3: Check proposer list ---');
    const updatedProposers = await getProposers();
    const isOnList = updatedProposers.proposers?.some(
      (p: {proposer_wallet: string}) => p.proposer_wallet === randomWallet.publicKey.toBase58()
    );
    console.log('Random wallet on whitelist:', isOnList ? '✅ Yes' : '❌ No');

    // Step 4: Set token threshold
    console.log('\n--- Step 4: Set token threshold ---');
    const thresholdResult = await setThreshold('1000000000'); // 1 token with 9 decimals
    console.log('Threshold set:', thresholdResult.proposer_token_threshold);

    // Step 5: Check DAO state
    console.log('\n--- Step 5: Final DAO state ---');
    const finalDao = await getDao();
    console.log('Threshold:', finalDao.proposer_token_threshold);
    const finalProposers = await getProposers();
    console.log('Whitelist:', finalProposers.proposers?.map((p: {proposer_wallet: string}) => p.proposer_wallet) || []);

    // Step 6: Cleanup - remove test proposer and clear threshold
    console.log('\n--- Step 6: Cleanup ---');
    await removeProposer(randomWallet.publicKey.toBase58());
    await setThreshold(null);
    console.log('✅ Cleanup complete');

    console.log('\n========================================');
    console.log('Proposer authorization test complete! ✅');
    console.log('========================================\n');

    console.log('Authorization flow summary:');
    console.log('1. If wallet is on DB whitelist → Authorized (whitelist)');
    console.log('2. If not on whitelist + threshold set + sufficient balance → Authorized (token_balance)');
    console.log('3. If whitelist exists but wallet not on it → Denied');
    console.log('4. If no whitelist + no threshold → Open (anyone can propose)');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

main();
