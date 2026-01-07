/**
 * Test script to verify 4-option proposals work with ALT
 *
 * This tests the fix for the "Transaction too large" error when creating
 * proposals with 3+ options by using Address Lookup Tables (ALTs).
 *
 * Usage:
 *   API_URL=http://localhost:6770 \
 *   DAO_PDA=<pda> \
 *   pnpm tsx scripts/test-4-options.ts
 */

import 'dotenv/config';
import * as crypto from 'crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';

const API_URL = process.env.API_URL || 'http://localhost:6770';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const DAO_PDA = process.env.DAO_PDA;

// Short proposal for testing (2 minutes)
const PROPOSAL_DURATION_SECS = 120;

if (!PRIVATE_KEY) throw new Error('PRIVATE_KEY is required');
if (!DAO_PDA) throw new Error('DAO_PDA is required');

function loadKeypair(privateKey: string): Keypair {
  return Keypair.fromSecretKey(bs58.decode(privateKey));
}

function signRequest(body: Record<string, unknown>, keypair: Keypair): string {
  const hash = crypto.createHash('sha256').update(JSON.stringify(body)).digest();
  const signature = nacl.sign.detached(hash, keypair.secretKey);
  return bs58.encode(signature);
}

async function signedPost(endpoint: string, body: Record<string, unknown>, keypair: Keypair) {
  const wallet = keypair.publicKey.toBase58();
  const requestBody = { ...body, wallet };
  const signed_hash = signRequest(requestBody, keypair);

  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...requestBody, signed_hash }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(JSON.stringify(data));
  }
  return data;
}

async function main() {
  const testKeypair = loadKeypair(PRIVATE_KEY!);

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║        4-Option Proposal Test (ALT Verification)                 ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Config:');
  console.log(`  API URL: ${API_URL}`);
  console.log(`  DAO Owner: ${testKeypair.publicKey.toBase58()}`);
  console.log(`  DAO PDA: ${DAO_PDA}`);
  console.log(`  Proposal Duration: ${PROPOSAL_DURATION_SECS}s`);
  console.log('');

  console.log('Creating proposal with 4 options...');
  console.log('  (This previously failed with "Transaction too large: 1587 > 1232")');
  console.log('');

  try {
    const proposal = await signedPost('/dao/proposal', {
      dao_pda: DAO_PDA,
      title: 'Q1 2026 Strategic Initiative Selection',
      description: 'Vote on the primary strategic initiative for Q1 2026. This decision will determine resource allocation and team focus for the upcoming quarter.',
      options: [
        'Infrastructure Upgrade',
        'New Product Launch',
        'Community Expansion',
        'Research & Development',
      ],
      length_secs: PROPOSAL_DURATION_SECS,
    }, testKeypair);

    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║                    SUCCESS! 4-OPTION PROPOSAL CREATED           ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('Proposal Details:');
    console.log(`  PDA: ${proposal.proposal_pda}`);
    console.log(`  ID: ${proposal.proposal_id}`);
    console.log(`  Metadata CID: ${proposal.metadata_cid}`);
    console.log('');
    console.log('The ALT fix is working! Proposals with 3+ options now succeed.');
    console.log('');
  } catch (error) {
    console.error('');
    console.error('╔══════════════════════════════════════════════════════════════════╗');
    console.error('║                    FAILED - ALT FIX NOT WORKING                  ║');
    console.error('╚══════════════════════════════════════════════════════════════════╝');
    console.error('');
    console.error('Error:', error);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\n❌ Test Failed:', err.message || err);
  process.exit(1);
});
