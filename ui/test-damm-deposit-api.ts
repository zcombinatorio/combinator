/*
 * Combinator - DAMM Deposit API Test Script
 *
 * This script tests the DAMM liquidity deposit API endpoints:
 * 1. POST /damm/deposit/build - Builds unsigned deposit transaction
 * 2. POST /damm/deposit/confirm - Signs and submits the transaction
 *
 * Required ENV variables:
 * - API_URL: The API server URL (e.g., http://localhost:3001)
 * - MANAGER_PRIVATE_KEY: Private key of the manager wallet (Base58)
 * - TOKEN_A_AMOUNT: Amount of Token A to deposit (UI units, e.g., 100.5)
 * - TOKEN_B_AMOUNT: Amount of Token B to deposit (UI units, e.g., 0.25 for SOL)
 */

import dotenv from 'dotenv';
import { Keypair, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';

dotenv.config();

// Configuration
const API_URL = process.env.API_URL || 'https://api.zcombinator.io';
const MANAGER_PRIVATE_KEY = process.env.MANAGER_PRIVATE_KEY;
const TOKEN_A_AMOUNT = parseFloat(process.env.TOKEN_A_AMOUNT || '847935.537627');
const TOKEN_B_AMOUNT = parseFloat(process.env.TOKEN_B_AMOUNT || '1.918359274');

interface BuildResponse {
  success: boolean;
  transaction: string;
  requestId: string;
  poolAddress: string;
  tokenAMint: string;
  tokenBMint: string;
  isTokenBNativeSOL: boolean;
  instructionsCount: number;
  amounts: {
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
  amounts: {
    tokenA: string;
    tokenB: string;
    liquidityDelta: string;
  };
  message: string;
}

async function testDammDepositApi() {
  try {
    console.log('\n🧪 DAMM Deposit API Test Script');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Validate environment variables
    if (!MANAGER_PRIVATE_KEY) {
      throw new Error('MANAGER_PRIVATE_KEY not set in environment');
    }

    if (TOKEN_A_AMOUNT <= 0 || TOKEN_B_AMOUNT < 0) {
      throw new Error('TOKEN_A_AMOUNT must be positive and TOKEN_B_AMOUNT must be non-negative');
    }

    // Initialize manager keypair
    const managerKeypair = Keypair.fromSecretKey(bs58.decode(MANAGER_PRIVATE_KEY));

    console.log('Configuration:');
    console.log(`  API URL:              ${API_URL}`);
    console.log(`  Manager Wallet:       ${managerKeypair.publicKey.toBase58()}`);
    console.log(`  Token A Amount:       ${TOKEN_A_AMOUNT}`);
    console.log(`  Token B Amount:       ${TOKEN_B_AMOUNT}`);
    console.log('');

    // ========================================================================
    // Step 1: Build deposit transaction
    // ========================================================================
    console.log('📦 Step 1: Building deposit transaction...');

    const buildResponse = await fetch(`${API_URL}/damm/deposit/build`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tokenAAmount: TOKEN_A_AMOUNT,
        tokenBAmount: TOKEN_B_AMOUNT,
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
    console.log('  📊 Deposit amounts (raw):');
    console.log(`    Token A:            ${buildData.amounts.tokenA}`);
    console.log(`    Token B:            ${buildData.amounts.tokenB}`);
    console.log(`    Liquidity Delta:    ${buildData.amounts.liquidityDelta}`);
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
    console.log(`  Signers needed:       Manager + LP Owner (server)`);

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
    // Step 3: Confirm deposit transaction
    // ========================================================================
    console.log('📤 Step 3: Confirming deposit transaction...');

    const confirmResponse = await fetch(`${API_URL}/damm/deposit/confirm`, {
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
    console.log('✅ DAMM Deposit Test Completed Successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('📊 Deposit Summary:');
    console.log(`  Transaction:          ${confirmData.signature}`);
    console.log(`  Solscan:              https://solscan.io/tx/${confirmData.signature}`);
    console.log(`  Pool:                 ${confirmData.poolAddress}`);
    console.log('');
    console.log('  💰 Amounts deposited (raw):');
    console.log(`    Token A:            ${confirmData.amounts.tokenA}`);
    console.log(`    Token B:            ${confirmData.amounts.tokenB}`);
    console.log(`    Liquidity Delta:    ${confirmData.amounts.liquidityDelta}`);
    console.log('');
    console.log('  📝 Flow executed:');
    console.log(`    1. Manager → LP Owner:  Transferred tokens`);
    console.log(`    2. LP Owner → Pool:     Deposited to liquidity pool`);
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
testDammDepositApi();
