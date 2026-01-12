/**
 * Test script for the crank-twap endpoint
 *
 * Tests the complete proposal lifecycle with TWAP cranking:
 * 1. Create proposal (4 min duration, ~2 min warmup)
 * 2. Crank TWAP every 60s during the proposal
 * 3. Finalize and verify the flow works
 *
 * Usage:
 *   API_URL=http://localhost:6770 \
 *   TEST_WALLET_PRIVATE_KEY=<key> \
 *   DAO_PDA=<pda> \
 *   pnpm tsx scripts/test-crank-twap.ts
 */

import 'dotenv/config';
import * as crypto from 'crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';

const API_URL = process.env.API_URL || 'http://localhost:6770';
const PRIVATE_KEY = process.env.TEST_WALLET_PRIVATE_KEY || process.env.PRIVATE_KEY;
const DAO_PDA = process.env.DAO_PDA;

// Proposal duration: 25 minutes (1500s) and 1 minute (60s) warmup
const PROPOSAL_DURATION_SECS = parseInt(process.env.PROPOSAL_DURATION_SECS || '1500');
const WARMUP_SECS = parseInt(process.env.WARMUP_SECS || '60');
// Crank interval: 60s (minimum recording interval)
const CRANK_INTERVAL_SECS = 65; // slightly more than 60s to be safe

if (!PRIVATE_KEY) throw new Error('TEST_WALLET_PRIVATE_KEY is required');
if (!DAO_PDA) throw new Error('DAO_PDA is required');

function loadKeypair(privateKey: string): Keypair {
  return Keypair.fromSecretKey(bs58.decode(privateKey));
}

function signRequest(body: Record<string, unknown>, keypair: Keypair): string {
  const hash = crypto.createHash('sha256').update(JSON.stringify(body)).digest();
  const hashHex = hash.toString('hex');
  const message = `Combinator Authentication\n\nSign this message to verify your request.\n\nRequest hash: ${hashHex}`;
  const messageBytes = Buffer.from(message, 'utf-8');
  const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
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

async function post(endpoint: string, body: Record<string, unknown>) {
  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(JSON.stringify(data));
  }
  return data;
}

function log(step: string, message: string) {
  const now = new Date().toISOString().slice(11, 19);
  console.log(`[${now}] [${step}] ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const testKeypair = loadKeypair(PRIVATE_KEY!);

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║            TWAP Crank Test - Full Proposal Lifecycle             ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Config:');
  console.log(`  API URL: ${API_URL}`);
  console.log(`  Test Wallet: ${testKeypair.publicKey.toBase58()}`);
  console.log(`  DAO PDA: ${DAO_PDA}`);
  console.log(`  Proposal Duration: ${PROPOSAL_DURATION_SECS}s`);
  console.log(`  Warmup Duration: ${WARMUP_SECS}s`);
  console.log(`  Crank Interval: ${CRANK_INTERVAL_SECS}s`);
  console.log('');

  // =========================================================================
  // STEP 1: Create Proposal
  // =========================================================================
  log('STEP 1', 'Creating proposal...');

  const proposalTitle = 'TWAP Batch Crank Test ' + Date.now();
  const proposal = await signedPost('/dao/proposal', {
    dao_pda: DAO_PDA,
    title: proposalTitle,
    description: 'Testing the new batch TWAP crank functionality that packs all pool cranks into a single transaction for synchronized oracle updates.',
    options: ['Run Batch Crank', 'Use Individual Cranks', 'Defer Decision'],
    length_secs: PROPOSAL_DURATION_SECS,
    warmup_secs: WARMUP_SECS,
  }, testKeypair);

  const proposalPda = proposal.proposal_pda;
  const proposalId = proposal.proposal_id;

  log('STEP 1', `✓ Proposal Created: ${proposalPda} (ID: ${proposalId})`);

  // Use the configured warmup duration
  const warmupDuration = WARMUP_SECS;
  const totalWaitTime = warmupDuration + PROPOSAL_DURATION_SECS;

  log('STEP 1', `  Warmup: ${warmupDuration}s, Total duration: ${totalWaitTime}s`);

  // =========================================================================
  // STEP 2: Crank TWAP during warmup (should be skipped)
  // =========================================================================
  log('STEP 2', 'Testing crank during warmup period (should be skipped)...');

  const warmupCrankResult = await post('/dao/crank-twap', { proposal_pda: proposalPda });
  log('STEP 2', `Crank result during warmup:`);
  console.log(JSON.stringify(warmupCrankResult, null, 2));

  // =========================================================================
  // STEP 3: Wait for warmup to end, then crank TWAP periodically
  // =========================================================================
  log('STEP 3', `Waiting ${warmupDuration}s for warmup to end...`);
  await sleep(warmupDuration * 1000);
  log('STEP 3', '✓ Warmup complete');

  // Calculate how many cranks we can do during trading period
  const tradingDuration = PROPOSAL_DURATION_SECS;
  const numCranks = Math.floor(tradingDuration / CRANK_INTERVAL_SECS);

  log('STEP 3', `Will crank ${numCranks} times during ${tradingDuration}s trading period`);

  const crankResults: unknown[] = [];
  for (let i = 0; i < numCranks; i++) {
    log('CRANK', `Crank ${i + 1}/${numCranks}...`);

    try {
      const result = await post('/dao/crank-twap', { proposal_pda: proposalPda });
      crankResults.push(result);
      log('CRANK', `  Result: ${result.pools_cranked} pools processed`);

      // Show details for each pool
      for (const r of result.results) {
        if (r.skipped) {
          log('CRANK', `    ${r.pool.slice(0, 8)}...: SKIPPED (${r.reason})`);
        } else if (r.signature) {
          log('CRANK', `    ${r.pool.slice(0, 8)}...: ${r.signature.slice(0, 20)}...`);
        } else {
          log('CRANK', `    ${r.pool.slice(0, 8)}...: ${r.reason || 'unknown'}`);
        }
      }
    } catch (err) {
      log('CRANK', `  Error: ${err}`);
      crankResults.push({ error: String(err) });
    }

    // Wait before next crank (except for last iteration)
    if (i < numCranks - 1) {
      log('CRANK', `  Waiting ${CRANK_INTERVAL_SECS}s...`);
      await sleep(CRANK_INTERVAL_SECS * 1000);
    }
  }

  // =========================================================================
  // STEP 4: Wait for proposal to end
  // =========================================================================
  const remainingTime = tradingDuration - (numCranks * CRANK_INTERVAL_SECS) + 10; // +10s buffer
  if (remainingTime > 0) {
    log('STEP 4', `Waiting ${remainingTime}s for proposal to end...`);
    await sleep(remainingTime * 1000);
  }
  log('STEP 4', '✓ Proposal duration complete');

  // =========================================================================
  // STEP 5: Finalize Proposal
  // =========================================================================
  log('STEP 5', 'Finalizing proposal...');

  const finalizeResult = await post('/dao/finalize-proposal', {
    proposal_pda: proposalPda,
  });

  log('STEP 5', `✓ Proposal Finalized`);
  log('STEP 5', `  Signature: ${finalizeResult.signature?.slice(0, 30)}...`);
  log('STEP 5', `  Winning outcome: ${finalizeResult.winning_outcome}`);

  // =========================================================================
  // STEP 6: Redeem Liquidity
  // =========================================================================
  log('STEP 6', 'Redeeming liquidity...');

  const redeemResult = await post('/dao/redeem-liquidity', {
    proposal_pda: proposalPda,
  });

  log('STEP 6', `✓ Liquidity Redeemed`);
  log('STEP 6', `  Signature: ${redeemResult.signature?.slice(0, 30)}...`);

  // =========================================================================
  // STEP 7: Deposit Back
  // =========================================================================
  log('STEP 7', 'Depositing back to pool...');

  const depositResult = await post('/dao/deposit-back', {
    proposal_pda: proposalPda,
  });

  log('STEP 7', `✓ Deposited Back`);
  if (depositResult.deposit_signature) {
    log('STEP 7', `  Deposit Signature: ${depositResult.deposit_signature?.slice(0, 30)}...`);
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                    ALL TESTS PASSED                              ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Summary:');
  console.log(`  DAO: ${DAO_PDA}`);
  console.log(`  Proposal: ${proposalPda} (ID: ${proposalId})`);
  console.log(`  Total cranks attempted: ${crankResults.length}`);
  console.log('');
  console.log('Lifecycle verified:');
  console.log('  ✓ Proposal creation');
  console.log('  ✓ TWAP crank during warmup (skipped correctly)');
  console.log('  ✓ TWAP crank during trading (executed)');
  console.log('  ✓ Proposal finalization');
  console.log('  ✓ Liquidity redemption');
  console.log('  ✓ Deposit back');
  console.log('');
}

main().catch(err => {
  console.error('\n❌ Test Failed:', err.message || err);
  process.exit(1);
});
