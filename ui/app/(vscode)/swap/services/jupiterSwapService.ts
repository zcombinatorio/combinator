import { Connection, PublicKey } from '@solana/web3.js';
import { createJupiterApiClient, QuoteGetRequest, QuoteResponse } from '@jup-ag/api';
import { Token } from '../types';
import { getTokenMint, getTokenDecimals } from '../utils/tokenUtils';

export interface JupiterSwapParams {
  connection: Connection;
  wallet: PublicKey;
  fromToken: Token;
  toToken: Token;
  amount: string;
  slippage: number; // in basis points (e.g., 50 = 0.5%)
  isMaxAmount: boolean;
}

export interface JupiterQuoteResult {
  inAmount: string;
  outAmount: string;
  priceImpactPct: number;
  route: {
    marketInfos: Array<{
      label: string;
      inputMint: string;
      outputMint: string;
      lpFee: { amount: string; pct: number };
    }>;
  };
}

/**
 * Get a swap quote from Jupiter
 */
export async function getJupiterQuote(
  params: Omit<JupiterSwapParams, 'connection' | 'wallet'>
): Promise<JupiterQuoteResult | null> {
  try {
    const { fromToken, toToken, amount, slippage } = params;

    const jupiterApi = createJupiterApiClient();

    const inputMint = getTokenMint(fromToken);
    const outputMint = getTokenMint(toToken);
    const inputDecimals = getTokenDecimals(fromToken);

    // Convert amount to lamports
    const amountFloat = parseFloat(amount);
    const amountLamports = Math.floor(amountFloat * Math.pow(10, inputDecimals));

    const quoteRequest: QuoteGetRequest = {
      inputMint: inputMint.toString(),
      outputMint: outputMint.toString(),
      amount: amountLamports,
      slippageBps: slippage,
      onlyDirectRoutes: false,
      asLegacyTransaction: false,
    };

    const quote: QuoteResponse = await jupiterApi.quoteGet(quoteRequest);

    if (!quote) {
      return null;
    }

    // Format the quote for our UI
    return {
      inAmount: quote.inAmount,
      outAmount: quote.outAmount,
      priceImpactPct: parseFloat(quote.priceImpactPct || '0'),
      route: {
        marketInfos: quote.routePlan.map((plan) => ({
          label: plan.swapInfo.label || 'Unknown',
          inputMint: plan.swapInfo.inputMint,
          outputMint: plan.swapInfo.outputMint,
          lpFee: {
            amount: plan.swapInfo.feeAmount,
            pct: 0, // feePct is not available in the Jupiter API response
          },
        })),
      },
    };
  } catch (error) {
    console.error('Jupiter quote error:', error);
    return null;
  }
}

/**
 * Format route info for display
 */
export function formatJupiterRoute(quoteInfo: JupiterQuoteResult): string {
  const markets = quoteInfo.route.marketInfos;

  if (markets.length === 0) return 'Unknown route';
  if (markets.length === 1) return `Via ${markets[0].label}`;

  return `Via ${markets.map(m => m.label).join(' → ')}`;
}
