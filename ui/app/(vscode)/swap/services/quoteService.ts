import { Connection, PublicKey } from '@solana/web3.js';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';
import BN from 'bn.js';
import { Token, SwapQuoteInfo, RoutingStrategy } from '../types';
import { getTokenDecimals, getTokenMint } from '../utils/tokenUtils';
import { getSwapRoute, findMultiHopRoute } from '../utils/routingUtils';
import { getPoolsForRoute } from '../utils/poolUtils';
import { getJupiterQuote, formatJupiterRoute } from './jupiterSwapService';

export interface QuoteResult {
  outputAmount: string;
  priceImpact?: string;
  route: Token[];
}

// Environment variable to control routing strategy
const ROUTING_STRATEGY = (process.env.NEXT_PUBLIC_ROUTING_STRATEGY as RoutingStrategy) || 'auto';

/**
 * Check if the swap is between ZC and SOL (in either direction)
 */
function isZCSolSwap(fromToken: Token, toToken: Token): boolean {
  return (
    (fromToken === 'ZC' && toToken === 'SOL') ||
    (fromToken === 'SOL' && toToken === 'ZC')
  );
}

/**
 * Get a quote for swapping tokens
 * This works generically for any token pair with configured pools
 */
export async function getQuote(
  connection: Connection,
  fromToken: Token,
  toToken: Token,
  amountIn: string,
  slippage: number
): Promise<QuoteResult | null> {
  const route = getSwapRoute(fromToken, toToken);

  if (route === 'invalid') {
    return null;
  }

  // Parse input amount
  const fromDecimals = getTokenDecimals(fromToken);
  const amountFloat = parseFloat(amountIn);
  const multiplier = Math.pow(10, fromDecimals);
  const amountRaw = Math.floor(amountFloat * multiplier);
  const amountBN = new BN(amountRaw.toString());

  // Get the full token path
  const maxHops = route === 'direct-cp' || route === 'direct-dbc' ? 1 :
                  route === 'double' ? 2 : 3;
  const tokenPath = findMultiHopRoute(fromToken, toToken, maxHops);

  if (!tokenPath) {
    return null;
  }

  // Calculate quote through the path
  let currentAmount = amountBN;
  let totalPriceImpact = 0;
  const pools = await getPoolsForRoute(tokenPath, connection);

  const cpAmm = new CpAmm(connection);
  const dbcClient = new DynamicBondingCurveClient(connection, 'confirmed');

  for (let i = 0; i < pools.length; i++) {
    const pool = pools[i];
    const fromTokenHop = tokenPath[i];
    const toTokenHop = tokenPath[i + 1];

    if (pool.type === 'cp-amm') {
      // CP-AMM quote
      const poolState = await cpAmm._program.account.pool.fetch(new PublicKey(pool.address));
      const currentTime = Math.floor(Date.now() / 1000);
      const currentSlot = await connection.getSlot();

      const fromDec = getTokenDecimals(fromTokenHop);
      const toDec = getTokenDecimals(toTokenHop);

      const quote = cpAmm.getQuote({
        inAmount: currentAmount,
        inputTokenMint: getTokenMint(fromTokenHop),
        slippage: slippage,
        poolState: poolState,
        currentTime,
        currentSlot,
        tokenADecimal: fromDec,
        tokenBDecimal: toDec,
      });

      currentAmount = quote.swapOutAmount;
      totalPriceImpact += parseFloat(quote.priceImpact.toString());
    } else {
      // DBC quote
      const poolState = await dbcClient.state.getPool(pool.address);
      const config = await dbcClient.state.getPoolConfig(poolState.config);

      // Get token decimals for this hop
      const fromDec = getTokenDecimals(fromTokenHop);
      const toDec = getTokenDecimals(toTokenHop);

      // Calculate price impact for DBC
      try {
        // Get a small quote to determine the marginal (spot) price
        // Using 1 token (in raw units: 1 × 10^decimals) to approximate the current market rate
        const smallAmount = new BN(Math.pow(10, fromDec));
        const smallQuote = dbcClient.pool.swapQuote({
          virtualPool: poolState,
          config: config,
          swapBaseForQuote: pool.swapBaseForQuote,
          amountIn: smallAmount,
          hasReferral: false,
          currentPoint: poolState.activationPoint,
        });

        // Calculate spot price from the small quote
        const spotPrice = Number(smallQuote.outputAmount) / Number(smallAmount);

        // Get the actual quote for the full amount
        const quote = dbcClient.pool.swapQuote({
          virtualPool: poolState,
          config: config,
          swapBaseForQuote: pool.swapBaseForQuote,
          amountIn: currentAmount,
          hasReferral: false,
          currentPoint: poolState.activationPoint,
        });

        // Calculate average execution price
        const amountInNum = Number(currentAmount.toString());
        const amountOutNum = Number(quote.outputAmount.toString());
        const avgExecutionPrice = amountOutNum / amountInNum;

        // Calculate price impact
        // For selling: if avgPrice < spotPrice, you're getting worse rates (negative slippage)
        const priceImpactPct = Math.abs((avgExecutionPrice - spotPrice) / spotPrice) * 100;

        totalPriceImpact += priceImpactPct;
        currentAmount = quote.outputAmount;
      } catch (error) {
        console.error('Error calculating DBC price impact:', error);

        // Fallback: get quote without price impact calculation
        const quote = dbcClient.pool.swapQuote({
          virtualPool: poolState,
          config: config,
          swapBaseForQuote: pool.swapBaseForQuote,
          amountIn: currentAmount,
          hasReferral: false,
          currentPoint: poolState.activationPoint,
        });

        currentAmount = quote.outputAmount;
      }
    }
  }

  const toDecimals = getTokenDecimals(toToken);
  const outputAmount = (parseInt(currentAmount.toString()) / Math.pow(10, toDecimals)).toFixed(toDecimals);

  return {
    outputAmount,
    priceImpact: totalPriceImpact > 0 ? totalPriceImpact.toString() : undefined,
    route: tokenPath,
  };
}

/**
 * Get a unified quote that can use either Jupiter or custom routing
 * Jupiter is ONLY used for ZC <> SOL swaps to find optimal routing across multiple pools
 * All other swaps use custom routing
 */
export async function getUnifiedQuote(
  connection: Connection,
  fromToken: Token,
  toToken: Token,
  amountIn: string,
  slippage: number
): Promise<SwapQuoteInfo | null> {
  try {
    // Check if this is a ZC/SOL swap - only use Jupiter for this pair
    const shouldUseJupiter = isZCSolSwap(fromToken, toToken);

    if (!shouldUseJupiter) {
      // Not a ZC/SOL swap - use custom routing
      const customQuote = await getQuote(connection, fromToken, toToken, amountIn, slippage);

      if (customQuote) {
        return {
          estimatedOutput: customQuote.outputAmount,
          priceImpact: parseFloat(customQuote.priceImpact || '0'),
          route: customQuote.route.join(' → '),
          routingStrategy: 'custom',
        };
      }
      return null;
    }

    // This is a ZC/SOL swap - determine routing strategy
    let strategy: RoutingStrategy = ROUTING_STRATEGY;

    if (strategy === 'auto') {
      // Auto mode: Try Jupiter first, fall back to custom if it fails
      strategy = 'jupiter';
    }

    if (strategy === 'jupiter') {
      // Try Jupiter for ZC/SOL swap
      const jupiterQuote = await getJupiterQuote({
        fromToken,
        toToken,
        amount: amountIn,
        slippage: slippage * 100, // Convert to bps
        isMaxAmount: false,
      });

      if (jupiterQuote) {
        const toDecimals = getTokenDecimals(toToken);
        const outputAmount = (parseInt(jupiterQuote.outAmount) / Math.pow(10, toDecimals)).toFixed(toDecimals);

        return {
          estimatedOutput: outputAmount,
          priceImpact: jupiterQuote.priceImpactPct,
          route: formatJupiterRoute(jupiterQuote),
          routingStrategy: 'jupiter',
          jupiterQuote,
        };
      }

      // Jupiter failed, fall back to custom if auto mode
      if (ROUTING_STRATEGY === 'auto') {
        console.warn('Jupiter quote failed for ZC/SOL, falling back to custom routing');
        strategy = 'custom';
      } else {
        return null;
      }
    }

    if (strategy === 'custom') {
      // Use custom routing for ZC/SOL
      const customQuote = await getQuote(connection, fromToken, toToken, amountIn, slippage);

      if (customQuote) {
        return {
          estimatedOutput: customQuote.outputAmount,
          priceImpact: parseFloat(customQuote.priceImpact || '0'),
          route: customQuote.route.join(' → '),
          routingStrategy: 'custom',
        };
      }
    }

    return null;
  } catch (error) {
    console.error('Error getting unified quote:', error);

    // Fall back to custom routing if Jupiter fails and we're in auto mode
    if (ROUTING_STRATEGY === 'auto') {
      try {
        const customQuote = await getQuote(connection, fromToken, toToken, amountIn, slippage);

        if (customQuote) {
          return {
            estimatedOutput: customQuote.outputAmount,
            priceImpact: parseFloat(customQuote.priceImpact || '0'),
            route: customQuote.route.join(' → '),
            routingStrategy: 'custom',
          };
        }
      } catch (fallbackError) {
        console.error('Fallback quote also failed:', fallbackError);
      }
    }

    return null;
  }
}
