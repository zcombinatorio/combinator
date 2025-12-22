/*
 * Z Combinator - Meteora DLMM API Test Script
 *
 * This script tests the DLMM liquidity withdraw and deposit API endpoints
 * by calling them in succession to verify the full flow works correctly.
 *
 * Flow:
 * 1. Call /dlmm/withdraw/build to get unsigned withdrawal transaction
 * 2. Sign the full transaction with manager wallet
 * 3. Call /dlmm/withdraw/confirm to execute withdrawal
 * 4. Call /dlmm/deposit/build to get unsigned deposit transaction
 * 5. Sign the full transaction with manager wallet
 * 6. Call /dlmm/deposit/confirm to execute deposit
 *
 * Required ENV variables:
 * - API_BASE_URL: Base URL of the API server (e.g., http://localhost:3000)
 * - DLMM_POOL_ADDRESS: Meteora DLMM pool address
 * - MANAGER_PRIVATE_KEY: Private key of the manager wallet for signing
 */

import dotenv from 'dotenv';
import { Keypair, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';

dotenv.config();

// Configuration
const API_BASE_URL = 'http://localhost:6770';
const DLMM_POOL_ADDRESS = process.env.DLMM_POOL_ADDRESS;
const MANAGER_PRIVATE_KEY = process.env.MANAGER_PRIVATE_KEY;

// Test parameters
const WITHDRAWAL_PERCENTAGE = 10; // Withdraw 10% of liquidity
const DEPOSIT_SOL_PERCENTAGE = 90; // Only deposit 80% of the withdrawn SOL (to test ratio mismatch)

interface WithdrawBuildResponse {
  success: boolean;
  transactions: string[];
  transactionCount: number;
  requestId: string;
  poolAddress: string;
  tokenXMint: string;
  tokenYMint: string;
  tokenXDecimals: number;
  tokenYDecimals: number;
  lpOwnerAddress: string;
  destinationAddress: string;
  withdrawalPercentage: number;
  estimatedAmounts: {
    tokenX: string;
    tokenY: string;
  };
  message: string;
}

interface WithdrawConfirmResponse {
  success: boolean;
  signatures: string[];
  poolAddress: string;
  tokenXMint: string;
  tokenYMint: string;
  withdrawalPercentage: number;
  estimatedAmounts: {
    tokenX: string;
    tokenY: string;
  };
  message: string;
}

interface DepositBuildResponse {
  success: boolean;
  transaction: string;
  requestId: string;
  poolAddress: string;
  tokenXMint: string;
  tokenYMint: string;
  tokenXDecimals: number;
  tokenYDecimals: number;
  lpOwnerAddress: string;
  managerAddress: string;
  instructionsCount: number;
  amounts: {
    tokenX: string;
    tokenY: string;
  };
  message: string;
}

interface DepositConfirmResponse {
  success: boolean;
  signature: string;
  poolAddress: string;
  tokenXMint: string;
  tokenYMint: string;
  amounts: {
    tokenX: string;
    tokenY: string;
  };
  message: string;
}

/**
 * Sign a transaction with the manager's private key
 */
function signTransaction(unsignedTxBase58: string, privateKey: string): string {
  const manager = Keypair.fromSecretKey(bs58.decode(privateKey));
  const txBuffer = bs58.decode(unsignedTxBase58);
  const transaction = Transaction.from(txBuffer);

  // Sign with manager wallet
  transaction.partialSign(manager);

  // Return signed transaction as base58
  return bs58.encode(transaction.serialize({ requireAllSignatures: false }));
}

/**
 * Sign multiple transactions with the manager's private key
 */
function signTransactions(unsignedTxsBase58: string[], privateKey: string): string[] {
  return unsignedTxsBase58.map(tx => signTransaction(tx, privateKey));
}

/**
 * Make an API request with error handling
 */
async function apiRequest<T>(
  endpoint: string,
  method: 'GET' | 'POST',
  body?: object
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  console.log(`  → ${method} ${url}`);

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`API Error (${response.status}): ${JSON.stringify(data)}`);
  }

  return data as T;
}

async function testDlmmApi() {
  try {
    console.log('\n🧪 Meteora DLMM API Test Script');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Validate environment variables
    if (!DLMM_POOL_ADDRESS) {
      throw new Error('DLMM_POOL_ADDRESS not set in environment');
    }
    if (!MANAGER_PRIVATE_KEY) {
      throw new Error('MANAGER_PRIVATE_KEY not set in environment');
    }

    const manager = Keypair.fromSecretKey(bs58.decode(MANAGER_PRIVATE_KEY));

    console.log('Configuration:');
    console.log(`  API Base URL:     ${API_BASE_URL}`);
    console.log(`  Pool Address:     ${DLMM_POOL_ADDRESS}`);
    console.log(`  Manager Wallet:   ${manager.publicKey.toBase58()}`);
    console.log(`  Withdrawal %:     ${WITHDRAWAL_PERCENTAGE}%`);
    console.log('');

    // =========================================================================
    // STEP 1: Test Withdrawal Flow
    // =========================================================================

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('📤 TESTING WITHDRAWAL FLOW');
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Step 1a: Build withdrawal transaction
    console.log('📋 Step 1: Building withdrawal transaction...');
    const withdrawBuildResponse = await apiRequest<WithdrawBuildResponse>(
      '/dlmm/withdraw/build',
      'POST',
      {
        poolAddress: DLMM_POOL_ADDRESS,
        withdrawalPercentage: WITHDRAWAL_PERCENTAGE,
      }
    );

    console.log('  ✅ Withdrawal transactions built successfully');
    console.log(`     Request ID: ${withdrawBuildResponse.requestId}`);
    console.log(`     Pool: ${withdrawBuildResponse.poolAddress}`);
    console.log(`     Token X Mint: ${withdrawBuildResponse.tokenXMint}`);
    console.log(`     Token Y Mint: ${withdrawBuildResponse.tokenYMint}`);
    console.log(`     Transaction Count: ${withdrawBuildResponse.transactionCount}`);
    console.log(`     Estimated X Amount: ${withdrawBuildResponse.estimatedAmounts.tokenX}`);
    console.log(`     Estimated Y Amount: ${withdrawBuildResponse.estimatedAmounts.tokenY}`);
    console.log('');

    // Step 1b: Sign all transactions
    console.log('🔐 Step 2: Signing withdrawal transactions...');
    const signedWithdrawTxs = signTransactions(
      withdrawBuildResponse.transactions,
      MANAGER_PRIVATE_KEY
    );
    console.log(`  ✅ ${signedWithdrawTxs.length} transaction(s) signed`);
    console.log('');

    // Step 1c: Confirm withdrawal
    console.log('📤 Step 3: Confirming withdrawal transactions...');
    const withdrawConfirmResponse = await apiRequest<WithdrawConfirmResponse>(
      '/dlmm/withdraw/confirm',
      'POST',
      {
        requestId: withdrawBuildResponse.requestId,
        signedTransactions: signedWithdrawTxs,
      }
    );

    console.log('  ✅ Withdrawal confirmed!');
    console.log(`     TX Signatures: ${withdrawConfirmResponse.signatures.length}`);
    for (const sig of withdrawConfirmResponse.signatures) {
      console.log(`       - https://solscan.io/tx/${sig}`);
    }
    console.log(`     Token X Withdrawn: ${withdrawConfirmResponse.estimatedAmounts.tokenX}`);
    console.log(`     Token Y Withdrawn: ${withdrawConfirmResponse.estimatedAmounts.tokenY}`);
    console.log('');

    // Wait a moment between operations
    console.log('⏳ Waiting 5 seconds before deposit...\n');
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // =========================================================================
    // STEP 2: Test Deposit Flow
    // =========================================================================

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('📥 TESTING DEPOSIT FLOW');
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Use the withdrawn amounts for deposit, but only 80% of SOL to test ratio mismatch
    const depositXAmount = withdrawConfirmResponse.estimatedAmounts.tokenX; // 100% of Token X (ZC)
    const depositYAmountFull = BigInt(withdrawConfirmResponse.estimatedAmounts.tokenY);
    const depositYAmount = ((depositYAmountFull * BigInt(DEPOSIT_SOL_PERCENTAGE)) / BigInt(100)).toString(); // 80% of Token Y (SOL)

    console.log(`  Withdrawn amounts:`);
    console.log(`     Token X (ZC): ${withdrawConfirmResponse.estimatedAmounts.tokenX}`);
    console.log(`     Token Y (SOL): ${withdrawConfirmResponse.estimatedAmounts.tokenY}`);
    console.log('');
    console.log(`  Depositing back (testing ratio mismatch):`);
    console.log(`     Token X (ZC): ${depositXAmount} (100%)`);
    console.log(`     Token Y (SOL): ${depositYAmount} (${DEPOSIT_SOL_PERCENTAGE}% of withdrawn)`);
    console.log('');

    // Step 2a: Build deposit transaction
    console.log('📋 Step 4: Building deposit transaction...');
    const depositBuildResponse = await apiRequest<DepositBuildResponse>(
      '/dlmm/deposit/build',
      'POST',
      {
        poolAddress: DLMM_POOL_ADDRESS,
        tokenXAmount: depositXAmount,
        tokenYAmount: depositYAmount,
      }
    );

    console.log('  ✅ Deposit transaction built successfully');
    console.log(`     Request ID: ${depositBuildResponse.requestId}`);
    console.log(`     Pool: ${depositBuildResponse.poolAddress}`);
    console.log(`     Token X Mint: ${depositBuildResponse.tokenXMint}`);
    console.log(`     Token Y Mint: ${depositBuildResponse.tokenYMint}`);
    console.log(`     Instructions: ${depositBuildResponse.instructionsCount}`);
    console.log(`     Token X Amount: ${depositBuildResponse.amounts.tokenX}`);
    console.log(`     Token Y Amount: ${depositBuildResponse.amounts.tokenY}`);
    console.log('');

    // Step 2b: Sign the full transaction
    console.log('🔐 Step 5: Signing deposit transaction...');
    const signedDepositTx = signTransaction(
      depositBuildResponse.transaction,
      MANAGER_PRIVATE_KEY
    );
    console.log(`  ✅ Transaction signed (${signedDepositTx.length} chars)`);
    console.log('');

    // Step 2c: Confirm deposit
    console.log('📥 Step 6: Confirming deposit transaction...');
    const depositConfirmResponse = await apiRequest<DepositConfirmResponse>(
      '/dlmm/deposit/confirm',
      'POST',
      {
        requestId: depositBuildResponse.requestId,
        signedTransaction: signedDepositTx,
      }
    );

    console.log('  ✅ Deposit confirmed!');
    console.log(`     TX Signature: ${depositConfirmResponse.signature}`);
    console.log(`     Explorer: https://solscan.io/tx/${depositConfirmResponse.signature}`);
    console.log(`     Token X Deposited: ${depositConfirmResponse.amounts.tokenX}`);
    console.log(`     Token Y Deposited: ${depositConfirmResponse.amounts.tokenY}`);
    console.log('');

    // =========================================================================
    // Summary
    // =========================================================================

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('✅ ALL TESTS PASSED SUCCESSFULLY!');
    console.log('═══════════════════════════════════════════════════════════════\n');

    console.log('📊 Summary:');
    console.log(`  Pool: ${DLMM_POOL_ADDRESS}`);
    console.log(`  Withdrawal TXs: ${withdrawConfirmResponse.signatures.length}`);
    for (const sig of withdrawConfirmResponse.signatures) {
      console.log(`    - ${sig}`);
    }
    console.log(`  Deposit TX: ${depositConfirmResponse.signature}`);
    console.log('');
    console.log('  💧 Withdrawal:');
    console.log(`     Token X: ${withdrawConfirmResponse.estimatedAmounts.tokenX}`);
    console.log(`     Token Y: ${withdrawConfirmResponse.estimatedAmounts.tokenY}`);
    console.log('');
    console.log('  💧 Deposit:');
    console.log(`     Token X: ${depositConfirmResponse.amounts.tokenX}`);
    console.log(`     Token Y: ${depositConfirmResponse.amounts.tokenY}`);
    console.log('');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('   Message:', error.message);
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  }
}

// Run the test
testDlmmApi();
