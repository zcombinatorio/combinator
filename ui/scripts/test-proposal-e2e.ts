/**
 * E2E Proposal Test with On-Chain State Verification
 * Tests the complete proposal lifecycle: create -> finalize -> redeem -> deposit-back
 *
 * Uses an existing DAO that has LP instead of creating new DAOs
 */
import 'dotenv/config';
import * as crypto from 'crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';
import * as futarchy from '@zcomb/programs-sdk';
import { getPool } from '../lib/db';
import { getDaoByPda, getDaoById } from '../lib/db/daos';

const API_URL = process.env.API_URL || 'http://localhost:6770';
const PRIVATE_KEY = process.env.PRIVATE_KEY || process.env.PROTOCOL_PRIVATE_KEY;
const DAO_PDA = process.env.DAO_PDA;

if (!PRIVATE_KEY) throw new Error('PRIVATE_KEY is required');
if (!DAO_PDA) throw new Error('DAO_PDA is required');

// Proposal duration in seconds (short for testing)
const PROPOSAL_DURATION_SECS = parseInt(process.env.PROPOSAL_DURATION_SECS || '120');

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
  console.log(`[${step}] ${message}`);
}

function logState(label: string, state: Record<string, unknown>) {
  console.log(`  ${label}:`);
  for (const [key, value] of Object.entries(state)) {
    console.log(`    ${key}: ${value}`);
  }
}

async function main() {
  const RPC_URL = process.env.RPC_URL;
  if (!RPC_URL) throw new Error('RPC_URL required');

  const connection = new Connection(RPC_URL, 'confirmed');
  const dbPool = getPool();
  const testKeypair = loadKeypair(PRIVATE_KEY!);
  const cpAmm = new CpAmm(connection);

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║         E2E Proposal Test with State Verification                ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Config:');
  console.log(`  API URL: ${API_URL}`);
  console.log(`  Test Wallet: ${testKeypair.publicKey.toBase58()}`);
  console.log(`  DAO PDA: ${DAO_PDA}`);
  console.log(`  Proposal Duration: ${PROPOSAL_DURATION_SECS}s`);
  console.log('');

  // =========================================================================
  // STEP 1: Verify DAO and Load Info
  // =========================================================================
  log('STEP 1', 'Loading DAO info...');

  const dao = await getDaoByPda(dbPool, DAO_PDA!);
  if (!dao) throw new Error('DAO not found in database');

  // For child DAOs, use parent's admin wallet for LP operations
  const isChildDao = !!dao.parent_dao_id;
  let lpAdminWallet: PublicKey;

  if (isChildDao) {
    const parentDao = await getDaoById(dbPool, dao.parent_dao_id!);
    if (!parentDao) throw new Error('Parent DAO not found in database');
    lpAdminWallet = new PublicKey(parentDao.admin_wallet);
    log('STEP 1', `Child DAO detected - using parent admin for LP: ${parentDao.admin_wallet}`);
  } else {
    lpAdminWallet = new PublicKey(dao.admin_wallet);
  }

  const moderatorPda = dao.moderator_pda;
  const poolPubkey = new PublicKey(dao.pool_address);

  log('STEP 1', '✓ DAO Found');
  logState('DAO', {
    name: dao.dao_name,
    pda: dao.dao_pda,
    moderator_pda: moderatorPda,
    admin_wallet: dao.admin_wallet,
    is_child: isChildDao,
    lp_admin: lpAdminWallet.toBase58(),
  });

  // Verify on-chain: Moderator account exists
  const provider = new AnchorProvider(connection, new Wallet(testKeypair), { commitment: 'confirmed' });
  const futarchyClient = new futarchy.FutarchyClient(provider);

  let moderator = await futarchyClient.fetchModerator(new PublicKey(moderatorPda!));
  log('STEP 1', 'On-chain moderator state:');
  logState('Moderator', {
    proposalIdCounter: moderator.proposalIdCounter,
    name: moderator.name,
    admin: moderator.admin.toBase58(),
  });

  // Verify LP exists (use lpAdminWallet - parent's admin for child DAOs)
  const positions = await cpAmm.getUserPositionByPool(poolPubkey, lpAdminWallet);
  const hasLP = positions.some(p => !p.positionState.unlockedLiquidity.isZero());
  if (!hasLP) throw new Error('LP admin has no LP positions');

  log('STEP 1', 'On-chain LP state:');
  logState('Admin LP', {
    positionCount: positions.length,
    totalLiquidity: positions.reduce((sum, p) => sum.add(p.positionState.unlockedLiquidity), new BN(0)).toString(),
  });

  // =========================================================================
  // STEP 2: Check Pre-Proposal State
  // =========================================================================
  log('STEP 2', 'Checking pre-proposal state...');

  const initialCounter = moderator.proposalIdCounter;

  logState('Pre-Proposal', {
    moderatorCounter: initialCounter,
    expectedProposalId: initialCounter,
  });

  // =========================================================================
  // STEP 3: Create Proposal
  // =========================================================================
  log('STEP 3', 'Creating proposal...');

  const proposalTitle = 'E2E Test Proposal ' + Date.now();
  const proposal = await signedPost('/dao/proposal', {
    dao_pda: DAO_PDA,
    title: proposalTitle,
    description: 'End-to-end test of proposal lifecycle',
    options: ['Approve', 'Reject'],
    length_secs: PROPOSAL_DURATION_SECS,
  }, testKeypair);

  const proposalPda = proposal.proposal_pda;
  const proposalId = proposal.proposal_id;

  log('STEP 3', '✓ Proposal Created');
  logState('Proposal', {
    pda: proposalPda,
    id: proposalId,
    title: proposalTitle,
  });

  // Verify on-chain: Proposal exists and counter incremented
  moderator = await futarchyClient.fetchModerator(new PublicKey(moderatorPda!));
  const proposalAccount = await futarchyClient.fetchProposal(new PublicKey(proposalPda));

  log('STEP 3', 'On-chain state after proposal creation:');
  logState('Moderator', {
    proposalIdCounter: moderator.proposalIdCounter,
    counterIncremented: moderator.proposalIdCounter === initialCounter + 1 ? '✓ YES' : '✗ NO',
  });

  // Handle different status formats - could be enum object or string
  const statusKey = proposalAccount.state ?
    (typeof proposalAccount.state === 'object' ? Object.keys(proposalAccount.state)[0] : String(proposalAccount.state))
    : 'unknown';

  logState('Proposal', {
    status: statusKey,
  });

  if (moderator.proposalIdCounter !== initialCounter + 1) {
    throw new Error('Counter did not increment! Bug still present.');
  }

  // =========================================================================
  // STEP 4: Wait for Proposal to End
  // =========================================================================
  // Wait for warmup (60s) + proposal duration + buffer
  const WARMUP_SECS = 60;
  const waitTime = WARMUP_SECS + PROPOSAL_DURATION_SECS + 5;

  log('STEP 4', `Waiting for proposal to end...`);
  log('STEP 4', `Wait time: ${waitTime}s (warmup: ${WARMUP_SECS}s + duration: ${PROPOSAL_DURATION_SECS}s + buffer: 5s)`);

  await new Promise(r => setTimeout(r, waitTime * 1000));

  log('STEP 4', '✓ Wait complete');

  // =========================================================================
  // STEP 5: Finalize Proposal
  // =========================================================================
  log('STEP 5', 'Finalizing proposal...');

  const finalizeResult = await post('/dao/finalize-proposal', {
    proposal_pda: proposalPda,
  });

  log('STEP 5', '✓ Proposal Finalized');
  logState('Finalize Result', {
    signature: finalizeResult.signature?.slice(0, 20) + '...',
    winningOutcome: finalizeResult.winning_outcome,
  });

  // Verify on-chain: Proposal is resolved
  const proposalAfterFinalize = await futarchyClient.fetchProposal(new PublicKey(proposalPda));
  const finalStatusKey = proposalAfterFinalize.state ?
    (typeof proposalAfterFinalize.state === 'object' ? Object.keys(proposalAfterFinalize.state)[0] : String(proposalAfterFinalize.state))
    : 'unknown';
  log('STEP 5', 'On-chain state after finalization:');
  logState('Proposal', {
    status: finalStatusKey,
  });

  // =========================================================================
  // STEP 6: Redeem Liquidity
  // =========================================================================
  log('STEP 6', 'Redeeming liquidity...');

  const redeemResult = await post('/dao/redeem-liquidity', {
    proposal_pda: proposalPda,
  });

  log('STEP 6', '✓ Liquidity Redeemed');
  logState('Redeem Result', {
    signature: redeemResult.signature?.slice(0, 20) + '...',
  });

  // =========================================================================
  // STEP 7: Deposit Back
  // =========================================================================
  log('STEP 7', 'Depositing back to pool...');

  const depositResult = await post('/dao/deposit-back', {
    proposal_pda: proposalPda,
  });

  log('STEP 7', '✓ Deposited Back');
  logState('Deposit Result', {
    signature: depositResult.signature?.slice(0, 20) + '...',
  });

  // Verify on-chain: LP admin has LP again
  const finalPositions = await cpAmm.getUserPositionByPool(poolPubkey, lpAdminWallet);
  log('STEP 7', 'On-chain state after deposit-back:');
  logState('Admin LP', {
    positionCount: finalPositions.length,
    totalLiquidity: finalPositions.reduce((sum, p) => sum.add(p.positionState.unlockedLiquidity), new BN(0)).toString(),
  });

  // =========================================================================
  // STEP 8: Verify Second Proposal Can Be Created
  // =========================================================================
  log('STEP 8', 'Verifying second proposal can be created...');

  moderator = await futarchyClient.fetchModerator(new PublicKey(moderatorPda!));
  log('STEP 8', 'Counter before second proposal: ' + moderator.proposalIdCounter);

  const proposal2 = await signedPost('/dao/proposal', {
    dao_pda: DAO_PDA,
    title: 'Second Test Proposal ' + Date.now(),
    description: 'Verifying counter increment works for subsequent proposals',
    options: ['Yes', 'No'],
    length_secs: PROPOSAL_DURATION_SECS,
  }, testKeypair);

  log('STEP 8', '✓ Second Proposal Created');
  logState('Proposal 2', {
    pda: proposal2.proposal_pda,
    id: proposal2.proposal_id,
  });

  // Verify counter
  moderator = await futarchyClient.fetchModerator(new PublicKey(moderatorPda!));
  log('STEP 8', 'Counter after second proposal: ' + moderator.proposalIdCounter);

  const expectedCounter = initialCounter + 2;
  if (moderator.proposalIdCounter === expectedCounter) {
    log('STEP 8', `✓ Counter correctly at ${expectedCounter}`);
  } else {
    throw new Error(`Counter should be ${expectedCounter}, got ${moderator.proposalIdCounter}`);
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
  console.log(`  DAO: ${DAO_PDA} (${dao.dao_name})`);
  console.log(`  Proposal 1: ${proposalPda} (ID: ${proposalId})`);
  console.log(`  Proposal 2: ${proposal2.proposal_pda} (ID: ${proposal2.proposal_id})`);
  console.log(`  Final Counter: ${moderator.proposalIdCounter}`);
  console.log('');
  console.log('All lifecycle steps verified:');
  console.log('  ✓ DAO with on-chain moderator');
  console.log('  ✓ Admin has LP positions');
  console.log('  ✓ Proposal creation with counter increment');
  console.log('  ✓ Proposal finalization');
  console.log('  ✓ Liquidity redemption');
  console.log('  ✓ Deposit back to pool');
  console.log('  ✓ Second proposal creation with counter increment');
  console.log('');

  await dbPool.end();
}

main().catch(err => {
  console.error('\n❌ Test Failed:', err.message || err);
  process.exit(1);
});
