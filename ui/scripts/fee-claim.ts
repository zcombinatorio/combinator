/*
 * Combinator - Futarchy infrastructure for your project.
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
 *
 * Questions or feature requests? Reach out:
 * - Telegram Group: https://t.me/+Ao05jBnpEE0yZGVh
 * - Direct: https://t.me/handsdiff
 */

/**
 * Fee Claiming Script
 *
 * Claims fees from all LP positions (legacy hardcoded pools + DAO pools from DB).
 * Does NOT perform any buyback/swap operations - just claims fees.
 *
 * Usage: npx tsx fee-claim.ts
 */

import 'dotenv/config';
import { Keypair, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';

import { getPool } from '../lib/db';
import { getAllDaos } from '../lib/db/daos';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Protocol fee wallet private key (base58 encoded)
  // This is the wallet that receives the protocol's share of LP fees (FEEnkcCNE2623LYCPtLf63LFzXpCFigBLTu4qZovRGZC)
  WALLET_PRIVATE_KEY: process.env.FEE_WALLET_PRIVATE_KEY || '',

  // Legacy DAMM pool addresses (hardcoded for backward compatibility)
  LEGACY_DAMM_POOLS: [
    'BTYhoRPEUXs8ESYFjKDXRYf5qjH4chzZoBokMEApKEfJ', // SolPay
    'Ez1QYeC95xJRwPA9SR7YWC1H1Tj43exJr91QqKf8Puu1', // SurfCash
  ] as string[],

  // Legacy DLMM pool addresses (hardcoded for backward compatibility)
  LEGACY_DLMM_POOLS: [
    '7jbhVZcYqCRmciBcZzK8L5B96Pyw7i1SpXQFKBkzD3G2', // ZC DLMM pool
  ] as string[],

  // API endpoint for fee claiming (combinator api-server)
  FEE_CLAIM_API_BASE: process.env.FEE_CLAIM_API_BASE || 'https://api.zcombinator.io',
};

// ============================================================================
// TYPES
// ============================================================================

interface FeeRecipient {
  address: string;
  percent: number;
}

interface FeeClaimPrepareResponse {
  success: boolean;
  transaction: string; // base58 encoded unsigned transaction
  requestId: string;
  poolAddress: string;
  tokenAMint: string;
  tokenBMint: string;
  isTokenBNativeSOL: boolean;
  feeRecipients: FeeRecipient[];
  estimatedFees: {
    tokenA: string;
    tokenB: string;
  };
}

interface FeeClaimConfirmResponse {
  success: boolean;
  signature: string;
  poolAddress: string;
  tokenAMint: string;
  tokenBMint: string;
  feeRecipients: FeeRecipient[];
  positionsCount: number;
  estimatedFees: {
    tokenA: string;
    tokenB: string;
  };
}

// DLMM API response types (handles multiple transactions)
interface DlmmFeeClaimPrepareResponse {
  success: boolean;
  transactions: string[]; // Array of base58 encoded unsigned transactions
  requestId: string;
  poolAddress: string;
  tokenXMint: string;
  tokenYMint: string;
  isTokenXNativeSOL: boolean;
  isTokenYNativeSOL: boolean;
  feeRecipients: FeeRecipient[];
  transactionCount: number;
  instructionsCount: number;
  positionAddress: string;
  totalPositions: number;
  estimatedFees: {
    tokenX: string;
    tokenY: string;
  };
}

interface DlmmFeeClaimConfirmResponse {
  success: boolean;
  signatures: string[];
  poolAddress: string;
  tokenXMint: string;
  tokenYMint: string;
  feeRecipients: FeeRecipient[];
  transactionCount: number;
  positionAddress: string;
  estimatedFees: {
    tokenX: string;
    tokenY: string;
  };
}

interface DaoPoolsResult {
  dammPools: string[];
  dlmmPools: string[];
  totalDaos: number;
}

interface ClaimResult {
  pool: string;
  type: 'damm' | 'dlmm';
  success: boolean;
  signatures: string[];
  error?: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function log(message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
}

function logError(message: string, error: unknown) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ERROR: ${message}`);
  if (error instanceof Error) {
    console.error(error.message);
    console.error(error.stack);
  } else {
    console.error(error);
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Delay between pool claims (ms)
const CLAIM_DELAY_MS = 3000;

// Retry config for rate limiting
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

// ============================================================================
// DAO POOL FETCHING (direct DB access)
// ============================================================================

/**
 * Fetch DAO pools directly from the database.
 * These are programmatically created DAOs that also need fee claiming.
 */
async function fetchDaoPools(): Promise<DaoPoolsResult> {
  try {
    const pool = getPool();
    const daos = await getAllDaos(pool, { daoType: 'parent' });

    const dammPools: string[] = [];
    const dlmmPools: string[] = [];

    for (const dao of daos) {
      if (dao.pool_address) {
        if (dao.pool_type === 'damm') {
          dammPools.push(dao.pool_address);
        } else if (dao.pool_type === 'dlmm') {
          dlmmPools.push(dao.pool_address);
        }
      }
    }

    return { dammPools, dlmmPools, totalDaos: daos.length };
  } catch (error) {
    logError('Error fetching DAO pools from database, continuing with legacy pools only', error);
    return { dammPools: [], dlmmPools: [], totalDaos: 0 };
  }
}

// ============================================================================
// DAMM FEE CLAIMING (via combinator api-server)
// ============================================================================

async function prepareFeeClaim(
  walletAddress: string,
  poolAddress: string
): Promise<FeeClaimPrepareResponse> {
  const response = await fetch(`${CONFIG.FEE_CLAIM_API_BASE}/fee-claim/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      payerPublicKey: walletAddress,
      poolAddress,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to prepare fee claim: ${response.statusText} - ${errorBody}`);
  }

  return response.json();
}

async function confirmFeeClaim(
  signedTransaction: string,
  requestId: string
): Promise<FeeClaimConfirmResponse> {
  const response = await fetch(`${CONFIG.FEE_CLAIM_API_BASE}/fee-claim/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      signedTransaction,
      requestId,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to confirm fee claim: ${response.statusText} - ${errorBody}`);
  }

  return response.json();
}

async function claimFeesFromDammPool(
  wallet: Keypair,
  poolAddress: string,
  retryCount = 0
): Promise<ClaimResult> {
  log(`Claiming fees from DAMM pool: ${poolAddress}`);

  try {
    // Step 1: Prepare the fee claim transaction
    const prepareResponse = await prepareFeeClaim(wallet.publicKey.toBase58(), poolAddress);

    if (!prepareResponse.success) {
      log(`No fees available to claim from DAMM pool ${poolAddress}`);
      return { pool: poolAddress, type: 'damm', success: true, signatures: [] };
    }

    log(`Fees claimable from DAMM pool ${prepareResponse.poolAddress}:`, prepareResponse.estimatedFees);

    // Check if there are fees to claim
    const tokenAFees = BigInt(prepareResponse.estimatedFees.tokenA);
    const tokenBFees = BigInt(prepareResponse.estimatedFees.tokenB);

    if (tokenAFees === BigInt(0) && tokenBFees === BigInt(0)) {
      log(`No fees to claim from DAMM pool ${poolAddress}`);
      return { pool: poolAddress, type: 'damm', success: true, signatures: [] };
    }

    // Step 2: Deserialize and sign the transaction (base58 encoded)
    const txBuffer = bs58.decode(prepareResponse.transaction);
    const transaction = Transaction.from(txBuffer);
    transaction.partialSign(wallet);

    // Step 3: Serialize the signed transaction (base58 for API)
    const signedTxBase58 = bs58.encode(transaction.serialize({ requireAllSignatures: false }));

    // Step 4: Submit to the confirm endpoint
    const confirmResponse = await confirmFeeClaim(signedTxBase58, prepareResponse.requestId);

    if (confirmResponse.success) {
      log(`Successfully claimed fees from DAMM ${poolAddress}. Signature: ${confirmResponse.signature}`);
      return { pool: poolAddress, type: 'damm', success: true, signatures: [confirmResponse.signature] };
    } else {
      logError(`Fee claim failed for DAMM pool ${poolAddress}`, confirmResponse);
      return { pool: poolAddress, type: 'damm', success: false, signatures: [], error: 'Confirm failed' };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Retry on rate limiting
    if (errorMsg.includes('Too Many Requests') && retryCount < MAX_RETRIES) {
      log(`Rate limited on DAMM pool ${poolAddress}, retrying in ${RETRY_DELAY_MS}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
      await sleep(RETRY_DELAY_MS);
      return claimFeesFromDammPool(wallet, poolAddress, retryCount + 1);
    }

    logError(`Error claiming fees from DAMM pool ${poolAddress}`, error);
    return { pool: poolAddress, type: 'damm', success: false, signatures: [], error: errorMsg };
  }
}

// ============================================================================
// DLMM FEE CLAIMING (via combinator api-server)
// ============================================================================

async function prepareDlmmFeeClaim(
  walletAddress: string,
  poolAddress: string
): Promise<DlmmFeeClaimPrepareResponse> {
  const response = await fetch(`${CONFIG.FEE_CLAIM_API_BASE}/dlmm-fee-claim/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      payerPublicKey: walletAddress,
      poolAddress,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to prepare DLMM fee claim: ${response.statusText} - ${errorBody}`);
  }

  return response.json();
}

async function confirmDlmmFeeClaim(
  signedTransactions: string[],
  requestId: string
): Promise<DlmmFeeClaimConfirmResponse> {
  const response = await fetch(`${CONFIG.FEE_CLAIM_API_BASE}/dlmm-fee-claim/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      signedTransactions,
      requestId,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to confirm DLMM fee claim: ${response.statusText} - ${errorBody}`);
  }

  return response.json();
}

async function claimFeesFromDlmmPool(
  wallet: Keypair,
  poolAddress: string,
  retryCount = 0
): Promise<ClaimResult> {
  log(`Claiming fees from DLMM pool: ${poolAddress}`);

  try {
    // Step 1: Prepare the fee claim transactions
    const prepareResponse = await prepareDlmmFeeClaim(wallet.publicKey.toBase58(), poolAddress);

    if (!prepareResponse.success) {
      log(`No fees available to claim from DLMM pool ${poolAddress}`);
      return { pool: poolAddress, type: 'dlmm', success: true, signatures: [] };
    }

    log(`DLMM fees claimable from pool ${prepareResponse.poolAddress}:`, prepareResponse.estimatedFees);
    log(`Transaction count: ${prepareResponse.transactionCount}`);

    // Check if there are fees to claim
    const tokenXFees = BigInt(prepareResponse.estimatedFees.tokenX);
    const tokenYFees = BigInt(prepareResponse.estimatedFees.tokenY);

    if (tokenXFees === BigInt(0) && tokenYFees === BigInt(0)) {
      log(`No fees to claim from DLMM pool ${poolAddress}`);
      return { pool: poolAddress, type: 'dlmm', success: true, signatures: [] };
    }

    // Step 2: Sign all transactions
    const signedTransactions: string[] = [];

    for (let i = 0; i < prepareResponse.transactions.length; i++) {
      const txBuffer = bs58.decode(prepareResponse.transactions[i]);
      const transaction = Transaction.from(txBuffer);
      transaction.partialSign(wallet);
      signedTransactions.push(bs58.encode(transaction.serialize({ requireAllSignatures: false })));
      log(`Signed DLMM transaction ${i + 1}/${prepareResponse.transactions.length}`);
    }

    // Step 3: Submit all signed transactions to the confirm endpoint
    const confirmResponse = await confirmDlmmFeeClaim(signedTransactions, prepareResponse.requestId);

    if (confirmResponse.success) {
      log(`Successfully claimed fees from DLMM ${poolAddress}. Signatures:`, confirmResponse.signatures);
      return { pool: poolAddress, type: 'dlmm', success: true, signatures: confirmResponse.signatures };
    } else {
      logError(`DLMM fee claim failed for pool ${poolAddress}`, confirmResponse);
      return { pool: poolAddress, type: 'dlmm', success: false, signatures: [], error: 'Confirm failed' };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Retry on rate limiting
    if (errorMsg.includes('Too Many Requests') && retryCount < MAX_RETRIES) {
      log(`Rate limited on DLMM pool ${poolAddress}, retrying in ${RETRY_DELAY_MS}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
      await sleep(RETRY_DELAY_MS);
      return claimFeesFromDlmmPool(wallet, poolAddress, retryCount + 1);
    }

    logError(`Error claiming fees from DLMM pool ${poolAddress}`, error);
    return { pool: poolAddress, type: 'dlmm', success: false, signatures: [], error: errorMsg };
  }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  log('='.repeat(60));
  log('Starting Fee Claim Script');
  log('='.repeat(60));

  // Validate configuration
  if (!CONFIG.WALLET_PRIVATE_KEY) {
    throw new Error('FEE_WALLET_PRIVATE_KEY environment variable is required');
  }

  // Initialize wallet
  const wallet = Keypair.fromSecretKey(bs58.decode(CONFIG.WALLET_PRIVATE_KEY));
  log(`Wallet address: ${wallet.publicKey.toBase58()}`);

  // Fetch DAO pools from database and merge with legacy pools
  log('\nFetching DAO pools from database...');
  const daoPools = await fetchDaoPools();
  log(`Found ${daoPools.totalDaos} DAO(s) with ${daoPools.dammPools.length} DAMM and ${daoPools.dlmmPools.length} DLMM pools`);

  // Merge and deduplicate pools (legacy + DAO)
  const allDammPools = [...new Set([...CONFIG.LEGACY_DAMM_POOLS, ...daoPools.dammPools])];
  const allDlmmPools = [...new Set([...CONFIG.LEGACY_DLMM_POOLS, ...daoPools.dlmmPools])];

  log(`Total pools to claim: ${allDammPools.length} DAMM, ${allDlmmPools.length} DLMM`);

  // Track all results
  const results: ClaimResult[] = [];

  // Claim from DAMM pools
  if (allDammPools.length === 0) {
    log('\nNo DAMM pools configured.');
  } else {
    log(`\n--- Claiming from ${allDammPools.length} DAMM pool(s) ---`);
    for (const poolAddress of allDammPools) {
      const result = await claimFeesFromDammPool(wallet, poolAddress);
      results.push(result);
      // Small delay between claims to avoid rate limiting
      await sleep(CLAIM_DELAY_MS);
    }
  }

  // Claim from DLMM pools
  if (allDlmmPools.length === 0) {
    log('\nNo DLMM pools configured.');
  } else {
    log(`\n--- Claiming from ${allDlmmPools.length} DLMM pool(s) ---`);
    for (const poolAddress of allDlmmPools) {
      const result = await claimFeesFromDlmmPool(wallet, poolAddress);
      results.push(result);
      // Small delay between claims to avoid rate limiting
      await sleep(CLAIM_DELAY_MS);
    }
  }

  // ========================================================================
  // SUMMARY
  // ========================================================================
  log('\n' + '='.repeat(60));
  log('Fee Claim Summary');
  log('='.repeat(60));

  const successful = results.filter(r => r.success && r.signatures.length > 0);
  const noFees = results.filter(r => r.success && r.signatures.length === 0);
  const failed = results.filter(r => !r.success);

  log(`\nSuccessful claims: ${successful.length}`);
  for (const r of successful) {
    log(`  ${r.type.toUpperCase()} ${r.pool}: ${r.signatures.length} tx(s)`);
  }

  log(`\nNo fees available: ${noFees.length}`);
  for (const r of noFees) {
    log(`  ${r.type.toUpperCase()} ${r.pool}`);
  }

  if (failed.length > 0) {
    log(`\nFailed claims: ${failed.length}`);
    for (const r of failed) {
      log(`  ${r.type.toUpperCase()} ${r.pool}: ${r.error}`);
    }
  }

  log('\n' + '='.repeat(60));
}

// Run the script
main()
  .then(() => {
    log('Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    logError('Script failed', error);
    process.exit(1);
  });
