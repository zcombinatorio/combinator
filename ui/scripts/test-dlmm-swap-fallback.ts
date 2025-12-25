/**
 * Test script for DLMM cleanup swap with Jupiter -> DLMM fallback
 * Uses the TESTSURF pool which is not indexed on Jupiter
 */
import 'dotenv/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';
import BN from 'bn.js';
import DLMM from '@meteora-ag/dlmm';

const TESTSURF_POOL = 'EC7MUufEpZcRZyXTFt16MMNLjJVnj9Vkku4UwdZ713Hx';
const TESTSURF_LP_OWNER = 'BnzxLbNmM63RxhHDdfeWa7BmV2YM4q7KxDJ3w75kDZo';
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const JUP_API_KEY = process.env.JUP_API_KEY;

// Helper to fetch with timeout
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeout);
    return response;
  } catch (error: any) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
}

async function testDlmmSwapFallback() {
  console.log('=== DLMM Swap Fallback Test ===\n');
  console.log(`Pool: ${TESTSURF_POOL}`);
  console.log(`LP Owner: ${TESTSURF_LP_OWNER}`);
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Jupiter API Key: ${JUP_API_KEY ? 'present' : 'MISSING'}\n`);

  const connection = new Connection(RPC_URL, 'confirmed');
  const poolAddress = new PublicKey(TESTSURF_POOL);
  const lpOwner = new PublicKey(TESTSURF_LP_OWNER);

  // Create DLMM instance
  console.log('1. Creating DLMM instance...');
  const dlmmPool = await DLMM.create(connection, poolAddress);
  const lbPair = dlmmPool.lbPair;

  const tokenXMint = lbPair.tokenXMint;
  const tokenYMint = lbPair.tokenYMint;

  const tokenXMintInfo = await getMint(connection, tokenXMint);
  const tokenYMintInfo = await getMint(connection, tokenYMint);

  console.log(`   Token X: ${tokenXMint.toBase58()} (decimals: ${tokenXMintInfo.decimals})`);
  console.log(`   Token Y: ${tokenYMint.toBase58()} (decimals: ${tokenYMintInfo.decimals})`);

  // Get active bin price
  const { activeBin } = await dlmmPool.getPositionsByUserAndLbPair(lpOwner);
  console.log(`   Active Bin Price: ${activeBin?.pricePerToken || 'N/A'}\n`);

  // Test swap parameters (small amount)
  const swapInputAmount = new BN(1000000); // 0.001 SOL worth
  const swapForY = false; // Y -> X (SOL -> TESTSURF)
  const swapInputMint = tokenYMint;
  const swapOutputMint = tokenXMint;

  console.log(`2. Test swap: ${swapInputAmount.toString()} lamports of Token Y -> Token X\n`);

  // Step 1: Try Jupiter
  console.log('3. Attempting Jupiter swap...');
  const jupiterHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (JUP_API_KEY) {
    jupiterHeaders['x-api-key'] = JUP_API_KEY;
  }

  let jupiterSuccess = false;
  try {
    const quoteUrl = `https://api.jup.ag/swap/v1/quote?inputMint=${swapInputMint.toBase58()}&outputMint=${swapOutputMint.toBase58()}&amount=${swapInputAmount.toString()}&slippageBps=500&asLegacyTransaction=true`;
    console.log(`   Quote URL: ${quoteUrl}`);

    const quoteResponse = await fetchWithTimeout(quoteUrl, { headers: jupiterHeaders }, 10000);
    console.log(`   Quote response: ${quoteResponse.status} ${quoteResponse.statusText}`);

    if (!quoteResponse.ok) {
      const errorText = await quoteResponse.text();
      console.log(`   Quote error: ${errorText}`);
      throw new Error(`Jupiter quote failed: ${quoteResponse.status}`);
    }

    const quoteData = await quoteResponse.json();

    if (quoteData.error || quoteData.errorCode) {
      console.log(`   Quote error: ${quoteData.error || quoteData.errorCode}`);
      throw new Error(`Jupiter: ${quoteData.error || quoteData.errorCode}`);
    }

    console.log(`   Jupiter quote: ${swapInputAmount.toString()} -> ${quoteData.outAmount}`);
    jupiterSuccess = true;

  } catch (jupiterError: any) {
    console.log(`   Jupiter FAILED: ${jupiterError.message}\n`);
  }

  if (jupiterSuccess) {
    console.log('\n   Jupiter succeeded (unexpected for test token)');
    return;
  }

  // Step 2: Fallback to DLMM direct swap
  console.log('4. Falling back to direct DLMM swap...');

  try {
    // Get bin arrays for the swap direction
    console.log(`   Getting bin arrays for swap (swapForY=${swapForY})...`);
    const binArrays = await dlmmPool.getBinArrayForSwap(swapForY);

    if (!binArrays || binArrays.length === 0) {
      throw new Error('No bin arrays available for swap');
    }
    console.log(`   Found ${binArrays.length} bin arrays`);

    // Get swap quote from DLMM
    console.log('   Getting DLMM swap quote...');
    const slippageBps = new BN(500); // 5% slippage
    const swapQuote = dlmmPool.swapQuote(swapInputAmount, swapForY, slippageBps, binArrays);

    console.log(`   DLMM quote:`);
    console.log(`     Input: ${swapInputAmount.toString()}`);
    console.log(`     Output: ${swapQuote.outAmount.toString()}`);
    console.log(`     Min output: ${swapQuote.minOutAmount.toString()}`);
    console.log(`     Fee: ${swapQuote.fee.toString()}`);
    console.log(`     Price impact: ${swapQuote.priceImpact?.toString() || 'N/A'}`);
    console.log(`     Bin arrays needed: ${swapQuote.binArraysPubkey.length}`);

    // Build swap transaction (but don't send)
    console.log('\n   Building swap transaction...');

    const swapTx = await dlmmPool.swap({
      inToken: swapInputMint,
      outToken: swapOutputMint,
      inAmount: swapInputAmount,
      minOutAmount: swapQuote.minOutAmount,
      lbPair: poolAddress,
      user: lpOwner,
      binArraysPubkey: swapQuote.binArraysPubkey,
    });

    console.log(`   Transaction built successfully!`);
    console.log(`   Instructions: ${swapTx.instructions.length}`);

    // Set blockhash and fee payer for serialization test
    const { blockhash } = await connection.getLatestBlockhash();
    swapTx.recentBlockhash = blockhash;
    swapTx.feePayer = lpOwner;

    // Test serialization (like the API does)
    const serialized = swapTx.serialize({ requireAllSignatures: false });
    console.log(`   Serialized size: ${serialized.length} bytes`);

    console.log('\n=== DLMM FALLBACK TEST PASSED ===');

  } catch (dlmmError: any) {
    console.log(`   DLMM swap FAILED: ${dlmmError.message}`);
    console.log('\n=== DLMM FALLBACK TEST FAILED ===');
    process.exit(1);
  }
}

testDlmmSwapFallback().catch(console.error);
