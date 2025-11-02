import { PublicKey } from '@solana/web3.js';
import { Token } from './types';

// Network & Infrastructure
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.mainnet-beta.solana.com';
export const ALT_ADDRESS = '8wUFS6aQ4fSN7BnvXJP83ZDRbVgq3KzPHeVsWqVWJk4B';

// Transaction & Timing Constants
export const MAX_TRANSACTION_SIZE = 1232;
export const QUOTE_REFRESH_INTERVAL = 10000; // 10 seconds
export const COUNTDOWN_INTERVAL = 1000; // 1 second
export const BALANCE_REFRESH_DELAY = 10000; // 10 seconds
export const CONFIRMATION_TIMEOUT_ATTEMPTS = 30;
export const CONFIRMATION_DELAY_MS = 1000;
export const TRANSACTION_SPLIT_DELAY = 2000; // 2 seconds
export const SOL_RENT_BUFFER = 0.01; // SOL

// Token Configuration
// To add a new token: add an entry here with all token properties
export const TOKEN_CONFIG: Record<Token, {
  symbol: string;
  displaySymbol: string;
  decimals: number;
  mint: PublicKey;
  icon: string;
}> = {
  SOL: {
    symbol: 'SOL',
    displaySymbol: 'SOL',
    decimals: 9,
    mint: new PublicKey('So11111111111111111111111111111111111111112'),
    icon: '/solana_logo.png',
  },
  ZC: {
    symbol: 'ZC',
    displaySymbol: 'ZC',
    decimals: 6,
    mint: new PublicKey('GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC'),
    icon: '/zcombinator-logo.png',
  },
  TEST: {
    symbol: 'TEST',
    displaySymbol: 'TEST',
    decimals: 6,
    mint: new PublicKey('9q7QYACmxQmj1XATGua2eXpWfZHztibB4gw59FJobCts'),
    icon: '/percent.png',
  },
  SHIRTLESS: {
    symbol: 'SHIRTLESS',
    displaySymbol: 'SHIRTLESS',
    decimals: 6,
    mint: new PublicKey('34mjcwkHeZWqJ8Qe3WuMJjHnCZ1pZeAd3AQ1ZJkKH6is'),
    icon: '/shirtless-logo.png',
  },
  GITPOST: {
    symbol: 'GITPOST',
    displaySymbol: 'POST',
    decimals: 6,
    mint: new PublicKey('BSu52RaorX691LxPyGmLp2UiPzM6Az8w2Txd9gxbZN14'),
    icon: '/gitpost-logo.png',
  },
  PERC: {
    symbol: 'PERC',
    displaySymbol: 'PERC',
    decimals: 6,
    mint: new PublicKey('zcQPTGhdiTMFM6erwko2DWBTkN8nCnAGM7MUX9RpERC'),
    icon: '/sp-logo.png',
  },
  ZTORIO: {
    symbol: 'ZTORIO',
    displaySymbol: 'ZTORIO',
    decimals: 6,
    mint: new PublicKey('5LcnUNQqWZdp67Y7dd7jrSsrqFaBjAixMPVQ3aU7bZTo'),
    icon: '/ztorio.png',
  },
};

// Pool Configuration
// To add a new pool: add an entry here with the pool address and type
export type PoolType = 'cp-amm' | 'dbc';

export interface PoolConfig {
  address: string;
  type: PoolType;
  tokenA: Token;
  tokenB: Token;
  // For DBC pools, specify which token is the quote token
  // (the other token is the base token)
  quoteToken?: Token;
}

// Pool registry - add new pools here
export const POOLS: PoolConfig[] = [
  {
    address: 'CCZdbVvDqPN8DmMLVELfnt9G1Q9pQNt3bTGifSpUY9Ad',
    type: 'cp-amm',
    tokenA: 'SOL',
    tokenB: 'ZC',
  },
  {
    address: 'EGXMUVs2c7xQv12prySkRwNTznCNgLiVwnNByEP9Xg6i',
    type: 'dbc',
    tokenA: 'TEST',
    tokenB: 'ZC',
    quoteToken: 'ZC',
  },
  {
    address: 'EcE7GyMLvTK6tLWz2q7FopWqoW5836BbBh78nteon9vQ',
    type: 'dbc',
    tokenA: 'SHIRTLESS',
    tokenB: 'ZC',
    quoteToken: 'ZC',
  },
  {
    address: '7LpSRp9R1KaVvgpgjrWfCLB476x4CKKVvf5ZmbpMugVU',
    type: 'dbc',
    tokenA: 'SHIRTLESS',
    tokenB: 'GITPOST',
    quoteToken: 'SHIRTLESS',
  },
  {
    address: '68RgJa1BTBLxhgW5p7eAZ2S2WfuHRGtzwDCxPR3ASBEe',
    type: 'dbc',
    tokenA: 'ZC',
    tokenB: 'PERC',
    quoteToken: 'ZC',
  },
  {
    address: 'J9y4bok9Dj4rJLBKBkj1Ls29u7AXNHdfZCL7Q6DwExW',
    type: 'cp-amm',
    tokenA: 'ZC',
    tokenB: 'ZTORIO',
  },
];

// Backward compatibility exports (TODO: refactor to use new utilities)
export const WSOL = TOKEN_CONFIG.SOL.mint;
export const ZC_MINT = TOKEN_CONFIG.ZC.mint;
export const TEST_MINT = TOKEN_CONFIG.TEST.mint;
export const SHIRTLESS_MINT = TOKEN_CONFIG.SHIRTLESS.mint;
export const GITPOST_MINT = TOKEN_CONFIG.GITPOST.mint;

// Pool address exports for backward compatibility
export const SOL_TO_ZC_POOL = POOLS[0].address;
export const ZC_TO_TEST_POOL = POOLS[1].address;
export const ZC_TO_SHIRTLESS_POOL = POOLS[2].address;
export const SHIRTLESS_TO_GITPOST_POOL = POOLS[3].address;

// Helper to find pool for a token pair
export function getPoolForPair(tokenA: Token, tokenB: Token): PoolConfig | undefined {
  return POOLS.find(pool =>
    (pool.tokenA === tokenA && pool.tokenB === tokenB) ||
    (pool.tokenA === tokenB && pool.tokenB === tokenA)
  );
}
