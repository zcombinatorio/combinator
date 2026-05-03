/*
 * Combinator - DAMM Withdraw API Test Script
 *
 * This script tests the DAMM liquidity withdrawal API endpoints:
 * 1. POST /damm/withdraw/build - Builds unsigned withdrawal transaction
 * 2. POST /damm/withdraw/confirm - Signs and submits the transaction
 *
 * Required ENV variables:
 * - API_URL: The API server URL (e.g., http://localhost:3001)
 * - MANAGER_PRIVATE_KEY: Private key of the manager wallet (Base58)
 * - WITHDRAWAL_PERCENTAGE: Percentage to withdraw (1-99), defaults to 50
 */

import dotenv from 'dotenv';
import { Keypair, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';

dotenv.config();

// Configuration
const API_URL = process.env.API_URL || 'https://api.zcombinator.io';
const MANAGER_PRIVATE_KEY = process.env.MANAGER_PRIVATE_KEY;
const WITHDRAWAL_PERCENTAGE = parseFloat(process.env.WITHDRAWAL_PERCENTAGE || '50');

interface BuildResponse {
  success: boolean;
  transaction: string;
  requestId: string;
  poolAddress: string;
  tokenAMint: string;
  tokenBMint: string;
  isTokenBNativeSOL: boolean;
  withdrawalPercentage: number;
  instructionsCount: number;
  estimatedAmounts: {
    tokenA: string;
    tokenB: string;
    liquidityDelta: string;
  };
  message: string;
}

interface ConfirmResponse {
  success: boolean;
  signature: string;
  poolAddress: string;
  tokenAMint: string;
  tokenBMint: string;
  withdrawalPercentage: number;
  estimatedAmounts: {
    tokenA: string;
    tokenB: string;
    liquidityDelta: string;
  };
  message: string;
}

async function testDammWithdrawApi() {
  try {
    console.log('\n🧪 DAMM Withdraw API Test Script');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Validate environment variables
    if (!MANAGER_PRIVATE_KEY) {
      throw new Error('MANAGER_PRIVATE_KEY not set in environment');
    }

    if (WITHDRAWAL_PERCENTAGE < 1 || WITHDRAWAL_PERCENTAGE > 99) {
      throw new Error('WITHDRAWAL_PERCENTAGE must be between 1 and 99');
    }

    // Initialize manager keypair
    const managerKeypair = Keypair.fromSecretKey(bs58.decode(MANAGER_PRIVATE_KEY));

    console.log('Configuration:');
    console.log(`  API URL:              ${API_URL}`);
    console.log(`  Manager Wallet:       ${managerKeypair.publicKey.toBase58()}`);
    console.log(`  Withdrawal %:         ${WITHDRAWAL_PERCENTAGE}%`);
    console.log('');

    // ========================================================================
    // Step 1: Build withdrawal transaction
    // ========================================================================
    console.log('📦 Step 1: Building withdrawal transaction...');

    const buildResponse = await fetch(`${API_URL}/damm/withdraw/build`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        withdrawalPercentage: WITHDRAWAL_PERCENTAGE,
      }),
    });

    if (!buildResponse.ok) {
      const errorData = await buildResponse.json();
      throw new Error(`Build request failed: ${errorData.error || buildResponse.statusText}`);
    }

    const buildData: BuildResponse = await buildResponse.json();

    if (!buildData.success) {
      throw new Error('Build request returned success: false');
    }

    console.log('  ✅ Build successful!');
    console.log(`  Request ID:           ${buildData.requestId}`);
    console.log(`  Pool Address:         ${buildData.poolAddress}`);
    console.log(`  Token A Mint:         ${buildData.tokenAMint}`);
    console.log(`  Token B Mint:         ${buildData.tokenBMint}`);
    console.log(`  Token B is SOL:       ${buildData.isTokenBNativeSOL}`);
    console.log(`  Instructions:         ${buildData.instructionsCount}`);
    console.log('');
    console.log('  📊 Estimated withdrawal amounts:');
    console.log(`    Token A:            ${buildData.estimatedAmounts.tokenA} raw`);
    console.log(`    Token B:            ${buildData.estimatedAmounts.tokenB} raw`);
    console.log(`    Liquidity Delta:    ${buildData.estimatedAmounts.liquidityDelta}`);
    console.log('');

    // ========================================================================
    // Step 2: Sign transaction with manager wallet
    // ========================================================================
    console.log('✍️  Step 2: Signing transaction with manager wallet...');

    // Deserialize the unsigned transaction
    const transactionBuffer = bs58.decode(buildData.transaction);
    const transaction = Transaction.from(transactionBuffer);

    console.log(`  Fee Payer:            ${transaction.feePayer?.toBase58()}`);
    console.log(`  Blockhash:            ${transaction.recentBlockhash}`);

    // Verify fee payer matches manager wallet
    if (!transaction.feePayer?.equals(managerKeypair.publicKey)) {
      throw new Error(
        `Fee payer mismatch: expected ${managerKeypair.publicKey.toBase58()}, got ${transaction.feePayer?.toBase58()}`
      );
    }

    // Sign the transaction with manager wallet
    transaction.partialSign(managerKeypair);

    // Serialize the signed transaction
    const signedTransaction = bs58.encode(transaction.serialize({ requireAllSignatures: false }));

    console.log('  ✅ Transaction signed successfully');
    console.log('');
    // process.exit(0);

    // ========================================================================
    // Step 3: Confirm withdrawal transaction
    // ========================================================================
    console.log('📤 Step 3: Confirming withdrawal transaction...');

    const confirmResponse = await fetch(`${API_URL}/damm/withdraw/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        signedTransaction,
        requestId: buildData.requestId,
      }),
    });

    if (!confirmResponse.ok) {
      const errorData = await confirmResponse.json();
      throw new Error(`Confirm request failed: ${errorData.error || confirmResponse.statusText}`);
    }

    const confirmData: ConfirmResponse = await confirmResponse.json();

    if (!confirmData.success) {
      throw new Error('Confirm request returned success: false');
    }

    console.log('  ✅ Transaction submitted successfully!');
    console.log('');

    // ========================================================================
    // Final Summary
    // ========================================================================
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ DAMM Withdrawal Test Completed Successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('📊 Withdrawal Summary:');
    console.log(`  Transaction:          ${confirmData.signature}`);
    console.log(`  Solscan:              https://solscan.io/tx/${confirmData.signature}`);
    console.log(`  Pool:                 ${confirmData.poolAddress}`);
    console.log(`  Withdrawal %:         ${confirmData.withdrawalPercentage}%`);
    console.log('');
    console.log('  💰 Amounts withdrawn:');
    console.log(`    Token A:            ${confirmData.estimatedAmounts.tokenA} raw`);
    console.log(`    Token B:            ${confirmData.estimatedAmounts.tokenB} raw`);
    console.log(`    Liquidity Delta:    ${confirmData.estimatedAmounts.liquidityDelta}`);
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

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
testDammWithdrawApi();
