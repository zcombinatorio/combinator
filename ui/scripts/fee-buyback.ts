/**
 * Fee Buyback Script (Step 2)
 *
 * Converts all non-ZC tokens in the fee wallet into ZC via Jupiter swaps.
 * The RewardsService (3pm ET cron) picks up the ZC balance and distributes it.
 *
 * Step 1 (fee-claim.ts) claims LP fees → deposits SOL, USDC, DAO tokens into fee wallet.
 * Step 2 (this script) swaps everything to ZC.
 * Step 3 (RewardsService) distributes ZC via merkle-tree-based postRewards.
 *
 * Usage: npx tsx fee-buyback.ts
 */

import 'dotenv/config';
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import bs58 from 'bs58';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  RPC_URL: process.env.RPC_URL || 'https://api.mainnet-beta.solana.com',

  // Protocol fee wallet private key (base58 encoded)
  WALLET_PRIVATE_KEY: process.env.FEE_WALLET_PRIVATE_KEY || '',

  // Token addresses
  ZC_MINT: 'GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC',
  USDC_MINT: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  SOL_MINT: 'So11111111111111111111111111111111111111112',

  // Reserve SOL for gas (0.1 SOL)
  SOL_RESERVE_LAMPORTS: BigInt(100_000_000),

  // Jupiter API
  JUPITER_API_URL: 'https://api.jup.ag/swap/v1',

  // Slippage tolerance (in basis points, 100 = 1%)
  SLIPPAGE_BPS: 100,
};

// Additional token mints to swap (beyond SOL and USDC)
const OTHER_TOKEN_MINTS: { mint: string; symbol: string; decimals: number }[] = [
  // Add DAO tokens here as they accumulate in the fee wallet, e.g.:
  // { mint: 'TokenMintAddress...', symbol: 'TOKEN', decimals: 9 },
  { mint: 'CtmadLp7st6DSehwFBE4BFvizBQib7kv8quJDTyoUJSP', symbol: 'SP', decimals: 6 },
];

// ============================================================================
// TYPES
// ============================================================================

interface JupiterQuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: unknown[];
}

interface JupiterSwapResponse {
  swapTransaction: string; // base64 encoded transaction
}

interface SwapResult {
  symbol: string;
  inputAmount: bigint;
  outputAmount: bigint;
  signature: string;
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

// ============================================================================
// BALANCE FUNCTIONS
// ============================================================================

async function getSolBalance(connection: Connection, wallet: PublicKey): Promise<bigint> {
  const balance = await connection.getBalance(wallet);
  return BigInt(balance);
}

async function getTokenBalance(
  connection: Connection,
  wallet: PublicKey,
  mint: PublicKey
): Promise<bigint> {
  try {
    const tokenAccount = await getAssociatedTokenAddress(mint, wallet);
    const balance = await connection.getTokenAccountBalance(tokenAccount);
    return BigInt(balance.value.amount);
  } catch {
    return BigInt(0);
  }
}

// ============================================================================
// JUPITER SWAP FUNCTIONS
// ============================================================================

function getJupiterHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const JUP_API_KEY = process.env.JUP_API_KEY;
  if (JUP_API_KEY) {
    headers['x-api-key'] = JUP_API_KEY;
  }
  return headers;
}

async function getJupiterQuote(
  inputMint: string,
  outputMint: string,
  amount: bigint
): Promise<JupiterQuoteResponse> {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amount.toString(),
    slippageBps: CONFIG.SLIPPAGE_BPS.toString(),
  });

  const response = await fetch(`${CONFIG.JUPITER_API_URL}/quote?${params}`, {
    headers: getJupiterHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Failed to get Jupiter quote: ${response.statusText}`);
  }

  return response.json();
}

async function getJupiterSwapTransaction(
  quoteResponse: JupiterQuoteResponse,
  userPublicKey: string
): Promise<JupiterSwapResponse> {
  const response = await fetch(`${CONFIG.JUPITER_API_URL}/swap`, {
    method: 'POST',
    headers: getJupiterHeaders(),
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: {
          maxLamports: 1_000_000,
          priorityLevel: 'medium',
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to get Jupiter swap transaction: ${response.statusText}`);
  }

  return response.json();
}

async function executeSwap(
  connection: Connection,
  wallet: Keypair,
  inputMint: string,
  outputMint: string,
  amount: bigint,
  inputSymbol: string
): Promise<{ signature: string; outputAmount: bigint } | null> {
  log(`Getting quote to swap ${amount.toString()} ${inputSymbol} to ZC`);

  try {
    const quote = await getJupiterQuote(inputMint, outputMint, amount);
    log(`Quote received: ${quote.inAmount} ${inputSymbol} -> ${quote.outAmount} ZC`);
    log(`Price impact: ${quote.priceImpactPct}%`);

    const swapResponse = await getJupiterSwapTransaction(quote, wallet.publicKey.toBase58());

    const txBuffer = Buffer.from(swapResponse.swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(txBuffer);
    transaction.sign([wallet]);

    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: true,
      maxRetries: 2,
    });

    log(`Swap transaction sent: ${signature}`);

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    });

    log(`Swap confirmed: ${signature}`);

    return {
      signature,
      outputAmount: BigInt(quote.outAmount),
    };
  } catch (error) {
    logError(`Error executing ${inputSymbol} -> ZC swap`, error);
    return null;
  }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  log('='.repeat(60));
  log('Starting Fee Buyback Script (Step 2: Swap to ZC)');
  log('='.repeat(60));

  // Validate configuration
  if (!CONFIG.WALLET_PRIVATE_KEY) {
    throw new Error('FEE_WALLET_PRIVATE_KEY environment variable is required');
  }

  // Initialize connection and wallet
  const connection = new Connection(CONFIG.RPC_URL, 'confirmed');
  const wallet = Keypair.fromSecretKey(bs58.decode(CONFIG.WALLET_PRIVATE_KEY));

  log(`Wallet address: ${wallet.publicKey.toBase58()}`);

  const swapResults: SwapResult[] = [];

  // ========================================================================
  // Check initial balances
  // ========================================================================
  log('\n--- Checking Balances ---');

  const solBalance = await getSolBalance(connection, wallet.publicKey);
  const usdcBalance = await getTokenBalance(connection, wallet.publicKey, new PublicKey(CONFIG.USDC_MINT));
  const initialZcBalance = await getTokenBalance(connection, wallet.publicKey, new PublicKey(CONFIG.ZC_MINT));

  log(`SOL balance: ${Number(solBalance) / LAMPORTS_PER_SOL} SOL (${solBalance.toString()} lamports)`);
  log(`USDC balance: ${usdcBalance.toString()}`);
  log(`ZC balance: ${initialZcBalance.toString()}`);

  for (const token of OTHER_TOKEN_MINTS) {
    const balance = await getTokenBalance(connection, wallet.publicKey, new PublicKey(token.mint));
    log(`${token.symbol} balance: ${balance.toString()}`);
  }

  // ========================================================================
  // Swap SOL to ZC (keeping reserve for gas)
  // ========================================================================
  log('\n--- Swapping SOL to ZC ---');

  const solToSwap = solBalance - CONFIG.SOL_RESERVE_LAMPORTS;

  if (solToSwap > BigInt(0)) {
    log(`Swapping ${Number(solToSwap) / LAMPORTS_PER_SOL} SOL (keeping ${Number(CONFIG.SOL_RESERVE_LAMPORTS) / LAMPORTS_PER_SOL} SOL for gas)`);

    const result = await executeSwap(connection, wallet, CONFIG.SOL_MINT, CONFIG.ZC_MINT, solToSwap, 'SOL');

    if (result) {
      swapResults.push({ symbol: 'SOL', inputAmount: solToSwap, outputAmount: result.outputAmount, signature: result.signature });
    }

    await sleep(2000);
  } else {
    log(`Insufficient SOL for swap (balance: ${Number(solBalance) / LAMPORTS_PER_SOL} SOL, reserve: ${Number(CONFIG.SOL_RESERVE_LAMPORTS) / LAMPORTS_PER_SOL} SOL)`);
  }

  // ========================================================================
  // Swap USDC to ZC
  // ========================================================================
  log('\n--- Swapping USDC to ZC ---');

  if (usdcBalance > BigInt(0)) {
    log(`Swapping ${usdcBalance.toString()} USDC`);

    const result = await executeSwap(connection, wallet, CONFIG.USDC_MINT, CONFIG.ZC_MINT, usdcBalance, 'USDC');

    if (result) {
      swapResults.push({ symbol: 'USDC', inputAmount: usdcBalance, outputAmount: result.outputAmount, signature: result.signature });
    }

    await sleep(2000);
  } else {
    log('No USDC balance to swap');
  }

  // ========================================================================
  // Swap other tokens to ZC
  // ========================================================================
  if (OTHER_TOKEN_MINTS.length > 0) {
    log('\n--- Swapping Other Tokens to ZC ---');

    for (const token of OTHER_TOKEN_MINTS) {
      const balance = await getTokenBalance(connection, wallet.publicKey, new PublicKey(token.mint));

      if (balance > BigInt(0)) {
        log(`Swapping ${balance.toString()} ${token.symbol}`);

        const result = await executeSwap(connection, wallet, token.mint, CONFIG.ZC_MINT, balance, token.symbol);

        if (result) {
          swapResults.push({ symbol: token.symbol, inputAmount: balance, outputAmount: result.outputAmount, signature: result.signature });
        }

        await sleep(2000);
      } else {
        log(`No ${token.symbol} balance to swap`);
      }
    }
  }

  // ========================================================================
  // Summary
  // ========================================================================
  log('\n' + '='.repeat(60));
  log('Fee Buyback Summary');
  log('='.repeat(60));

  if (swapResults.length === 0) {
    log('No swaps executed (no non-ZC token balances found)');
  } else {
    const totalZcReceived = swapResults.reduce((sum, r) => sum + r.outputAmount, BigInt(0));

    for (const result of swapResults) {
      log(`  ${result.symbol}: ${result.inputAmount.toString()} -> ${result.outputAmount.toString()} ZC (tx: ${result.signature})`);
    }
    log(`Total ZC received from swaps: ${totalZcReceived.toString()}`);
  }

  const finalZcBalance = await getTokenBalance(connection, wallet.publicKey, new PublicKey(CONFIG.ZC_MINT));
  const finalSolBalance = await getSolBalance(connection, wallet.publicKey);

  log(`\nFinal ZC balance in fee wallet: ${finalZcBalance.toString()}`);
  log(`Final SOL balance: ${Number(finalSolBalance) / LAMPORTS_PER_SOL} SOL`);
  log('ZC will be distributed by RewardsService at next 3pm ET run');
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
