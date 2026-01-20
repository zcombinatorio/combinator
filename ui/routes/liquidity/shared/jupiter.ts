/*
 * Combinator - Futarchy infrastructure for your project.
 * Copyright (C) 2026 Spice Finance Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Questions or feature requests? Reach out:
 * - Telegram Group: https://t.me/+Ao05jBnpEE0yZGVh
 * - Direct: https://t.me/handsdiff
 */

import { Transaction, PublicKey } from '@solana/web3.js';

/**
 * Jupiter Price API response structure
 */
interface JupiterPriceResponse {
  [mint: string]: {
    usdPrice: number;
    blockId: number;
    decimals: number;
    priceChange24h?: number;
  };
}

/**
 * Jupiter price result
 */
export interface JupiterPriceResult {
  tokenAUsdPrice: number;
  tokenBUsdPrice: number;
  tokenBPerTokenA: number; // How many tokenB per 1 tokenA
}

/**
 * Get Jupiter API headers with optional API key
 */
function getJupiterHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const apiKey = process.env.JUP_API_KEY;
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }
  return headers;
}

/**
 * Fetch with timeout helper
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = 10000
): Promise<Response> {
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

/**
 * Fetch token prices from Jupiter Price API V3
 * Returns price of tokenA in terms of tokenB
 *
 * @param tokenAMint - First token mint address
 * @param tokenBMint - Second token mint address
 * @returns Price information
 */
export async function getJupiterPrice(
  tokenAMint: string,
  tokenBMint: string
): Promise<JupiterPriceResult> {
  const headers = getJupiterHeaders();

  const response = await fetchWithTimeout(
    `https://api.jup.ag/price/v3?ids=${tokenAMint},${tokenBMint}`,
    { headers },
    10000
  );

  if (!response.ok) {
    throw new Error(`Jupiter API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as JupiterPriceResponse;

  const tokenAData = data[tokenAMint];
  const tokenBData = data[tokenBMint];

  if (!tokenAData || !tokenAData.usdPrice) {
    throw new Error(`Jupiter API: No price data for token A (${tokenAMint})`);
  }

  if (!tokenBData || !tokenBData.usdPrice) {
    throw new Error(`Jupiter API: No price data for token B (${tokenBMint})`);
  }

  // tokenBPerTokenA = how many tokenB you get for 1 tokenA
  // e.g., if ZC = $0.001 and SOL = $100, then tokenBPerTokenA = 0.001 / 100 = 0.00001 SOL per ZC
  const tokenBPerTokenA = tokenAData.usdPrice / tokenBData.usdPrice;

  console.log(`  Jupiter prices: tokenA=$${tokenAData.usdPrice}, tokenB=$${tokenBData.usdPrice}`);
  console.log(`  Market rate: 1 tokenA = ${tokenBPerTokenA} tokenB`);

  return {
    tokenAUsdPrice: tokenAData.usdPrice,
    tokenBUsdPrice: tokenBData.usdPrice,
    tokenBPerTokenA,
  };
}

/**
 * Jupiter swap quote result
 */
export interface JupiterSwapQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  slippageBps: number;
  routePlan: any[];
}

/**
 * Fetch a swap quote from Jupiter
 *
 * @param inputMint - Input token mint address
 * @param outputMint - Output token mint address
 * @param amount - Amount in raw units (lamports/smallest unit)
 * @param slippageBps - Slippage tolerance in basis points (default: 500 = 5%)
 */
export async function getJupiterSwapQuote(
  inputMint: string,
  outputMint: string,
  amount: string,
  slippageBps: number = 500
): Promise<JupiterSwapQuote> {
  const headers = getJupiterHeaders();

  const quoteUrl = `https://api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}&asLegacyTransaction=true`;

  const response = await fetchWithTimeout(quoteUrl, { headers }, 10000);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Jupiter quote failed: ${response.status} - ${errorText}`);
  }

  const quoteData = await response.json();

  // Check for "no route" error
  if (quoteData.error || quoteData.errorCode) {
    throw new Error(`Jupiter: ${quoteData.error || quoteData.errorCode}`);
  }

  return quoteData;
}

/**
 * Build a swap transaction from Jupiter
 *
 * @param quoteResponse - The quote response from getJupiterSwapQuote
 * @param userPublicKey - The user's public key who will execute the swap
 * @returns Base64-encoded transaction
 */
export async function buildJupiterSwapTransaction(
  quoteResponse: JupiterSwapQuote,
  userPublicKey: PublicKey
): Promise<Transaction> {
  const headers = getJupiterHeaders();

  const swapResponse = await fetchWithTimeout('https://api.jup.ag/swap/v1/swap', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      quoteResponse,
      userPublicKey: userPublicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
      asLegacyTransaction: true
    })
  }, 15000);

  if (!swapResponse.ok) {
    const errorText = await swapResponse.text();
    throw new Error(`Jupiter swap failed: ${swapResponse.status} - ${errorText}`);
  }

  const swapData = await swapResponse.json();
  const swapTransactionBase64 = swapData.swapTransaction;

  // Decode the swap transaction
  const swapTransactionBuffer = Buffer.from(swapTransactionBase64, 'base64');
  return Transaction.from(swapTransactionBuffer);
}

/**
 * Combined function to get quote and build swap transaction
 */
export async function getJupiterSwapTransaction(
  inputMint: string,
  outputMint: string,
  amount: string,
  userPublicKey: PublicKey,
  slippageBps: number = 500
): Promise<{ transaction: Transaction; expectedOutput: string }> {
  console.log('  Fetching Jupiter quote...');
  const quote = await getJupiterSwapQuote(inputMint, outputMint, amount, slippageBps);
  console.log(`  Jupiter quote: ${amount} → ${quote.outAmount}`);

  console.log('  Fetching Jupiter swap transaction...');
  const transaction = await buildJupiterSwapTransaction(quote, userPublicKey);
  console.log('  ✓ Jupiter swap transaction built successfully');

  return {
    transaction,
    expectedOutput: quote.outAmount
  };
}
