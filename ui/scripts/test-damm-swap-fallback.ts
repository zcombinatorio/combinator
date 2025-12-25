/**
 * Test script for DAMM cleanup swap with Jupiter -> DAMM fallback
 * Uses the SURFTEST pool which is not indexed on Jupiter
 */
import 'dotenv/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';
import BN from 'bn.js';
import { CpAmm, getTokenProgram } from '@meteora-ag/cp-amm-sdk';

const SURFTEST_POOL = 'PS3rPSb49GnAkmh3tec1RQizgNSb1hUwPsYHGGuAy5r';
const SURFTEST_LP_OWNER = 'etBt7Ki2Gr2rhidNmXtHyxiGHkokKPayNhG787SusMj';
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

async function testDammSwapFallback() {
  console.log('=== DAMM Swap Fallback Test ===\n');
  console.log(`Pool: ${SURFTEST_POOL}`);
  console.log(`LP Owner: ${SURFTEST_LP_OWNER}`);
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Jupiter API Key: ${JUP_API_KEY ? 'present' : 'MISSING'}\n`);

  const connection = new Connection(RPC_URL, 'confirmed');
  const poolAddress = new PublicKey(SURFTEST_POOL);
  const lpOwner = new PublicKey(SURFTEST_LP_OWNER);

  // Create DAMM instance
  console.log('1. Creating DAMM (CpAmm) instance...');
  const cpAmm = new CpAmm(connection);
  const poolState = await cpAmm.fetchPoolState(poolAddress);

  const tokenAMint = poolState.tokenAMint;
  const tokenBMint = poolState.tokenBMint;

  const tokenAMintInfo = await getMint(connection, tokenAMint);
  const tokenBMintInfo = await getMint(connection, tokenBMint);

  const tokenAProgram = getTokenProgram(tokenAMintInfo.tlvData.length > 0 ? 1 : 0);
  const tokenBProgram = getTokenProgram(tokenBMintInfo.tlvData.length > 0 ? 1 : 0);

  console.log(`   Token A: ${tokenAMint.toBase58()} (decimals: ${tokenAMintInfo.decimals})`);
  console.log(`   Token B: ${tokenBMint.toBase58()} (decimals: ${tokenBMintInfo.decimals})`);
  console.log(`   Pool liquidity: ${poolState.liquidity.toString()}\n`);

  // Test swap parameters (small amount)
  const swapInputAmount = new BN(1000000); // 0.001 SOL worth
  const swapInputMint = tokenBMint; // Assume B is SOL
  const swapOutputMint = tokenAMint;

  console.log(`2. Test swap: ${swapInputAmount.toString()} lamports of Token B -> Token A\n`);

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

  // Step 2: Fallback to DAMM direct swap
  console.log('4. Falling back to direct DAMM swap...');

  try {
    // Get current slot and time for quote
    const slot = await connection.getSlot();
    const blockTime = await connection.getBlockTime(slot);
    const currentTime = blockTime || Math.floor(Date.now() / 1000);

    console.log(`   Current slot: ${slot}, time: ${currentTime}`);

    // Get swap quote from DAMM
    console.log('   Getting DAMM swap quote...');
    const swapQuote = cpAmm.getQuote({
      inAmount: swapInputAmount,
      inputTokenMint: swapInputMint,
      slippage: 5, // 5% slippage
      poolState,
      currentTime,
      currentSlot: slot,
      tokenADecimal: tokenAMintInfo.decimals,
      tokenBDecimal: tokenBMintInfo.decimals,
    });

    console.log(`   DAMM quote:`);
    console.log(`     Swap in amount: ${swapQuote.swapInAmount.toString()}`);
    console.log(`     Consumed in: ${swapQuote.consumedInAmount.toString()}`);
    console.log(`     Swap out amount: ${swapQuote.swapOutAmount.toString()}`);
    console.log(`     Min out amount: ${swapQuote.minSwapOutAmount.toString()}`);
    console.log(`     Total fee: ${swapQuote.totalFee.toString()}`);
    console.log(`     Price impact: ${swapQuote.priceImpact.toString()}%`);

    // Build swap transaction (but don't send)
    console.log('\n   Building swap transaction...');

    const swapTx = await cpAmm.swap({
      payer: lpOwner,
      pool: poolAddress,
      inputTokenMint: swapInputMint,
      outputTokenMint: swapOutputMint,
      amountIn: swapInputAmount,
      minimumAmountOut: swapQuote.minSwapOutAmount,
      tokenAMint: tokenAMint,
      tokenBMint: tokenBMint,
      tokenAVault: poolState.tokenAVault,
      tokenBVault: poolState.tokenBVault,
      tokenAProgram,
      tokenBProgram,
      referralTokenAccount: null,
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

    console.log('\n=== DAMM FALLBACK TEST PASSED ===');

  } catch (dammError: any) {
    console.log(`   DAMM swap FAILED: ${dammError.message}`);
    console.log(`   Stack: ${dammError.stack}`);
    console.log('\n=== DAMM FALLBACK TEST FAILED ===');
    process.exit(1);
  }
}

testDammSwapFallback().catch(console.error);
