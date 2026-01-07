/**
 * Test script to see the EXACT error when creating a proposal on a bricked DAO
 *
 * This will show us precisely where the failure occurs in the stack.
 */

import 'dotenv/config';
import * as crypto from 'crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';

const API_URL = process.env.API_URL || 'http://localhost:6770';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

// ClientTestDAO - bricked with 4 options stuck in Setup state
const BRICKED_DAO_PDA = '5zCh177HuRax44KZivnsycq8fwTcTf1cb3KGCjRoaEN3';

if (!PRIVATE_KEY) throw new Error('PRIVATE_KEY is required');

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

  console.log(`\nPOST ${API_URL}${endpoint}`);
  console.log('Request body:', JSON.stringify(requestBody, null, 2));

  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...requestBody, signed_hash }),
  });

  const data = await res.json();
  console.log(`\nResponse status: ${res.status}`);
  console.log('Response body:', JSON.stringify(data, null, 2));

  return { ok: res.ok, status: res.status, data };
}

async function main() {
  const testKeypair = loadKeypair(PRIVATE_KEY!);

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  Testing proposal creation on BRICKED DAO (ClientTestDAO)');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('This DAO has a proposal stuck in Setup state with 4 options.');
  console.log('We want to see the EXACT error when trying to create a new proposal.');
  console.log('');
  console.log(`DAO PDA: ${BRICKED_DAO_PDA}`);
  console.log(`Wallet: ${testKeypair.publicKey.toBase58()}`);
  console.log('');

  // Try to create a proposal with 4 options
  const result = await signedPost('/dao/proposal', {
    dao_pda: BRICKED_DAO_PDA,
    title: 'Test Proposal on Bricked DAO',
    description: 'Testing what error we get when creating a proposal on a DAO with a stuck proposal.',
    options: [
      'Option A',
      'Option B',
      'Option C',
      'Option D',
    ],
    length_secs: 120,
  }, testKeypair);

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
  if (result.ok) {
    console.log('  UNEXPECTED SUCCESS - proposal was created!');
  } else {
    console.log('  EXPECTED FAILURE - see error details above');
  }
  console.log('═══════════════════════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('\n❌ Script error:', err);
  process.exit(1);
});
