import { Transaction } from '@solana/web3.js';

export type Token = 'SOL' | 'ZC' | 'TEST' | 'SHIRTLESS' | 'GITPOST' | 'PERC' | 'ZTORIO';

export type SwapRoute = 'direct-cp' | 'direct-dbc' | 'double' | 'triple' | 'jupiter' | 'invalid';

export type TokenBalances = Record<Token, string>;

export interface SolanaWalletProvider {
  signAndSendTransaction: (transaction: Transaction) => Promise<{ signature: string }>;
}

export interface WindowWithWallets extends Window {
  solana?: SolanaWalletProvider;
  solflare?: SolanaWalletProvider;
}

// Jupiter-specific types
export interface JupiterRouteInfo {
  label: string;
  inputMint: string;
  outputMint: string;
  lpFee: {
    amount: string;
    pct: number;
  };
}

export interface JupiterQuoteInfo {
  inAmount: string;
  outAmount: string;
  priceImpactPct: number;
  route: {
    marketInfos: JupiterRouteInfo[];
  };
}

export type RoutingStrategy = 'jupiter' | 'custom' | 'auto';

export interface SwapQuoteInfo {
  estimatedOutput: string;
  priceImpact: number;
  route: string;
  routingStrategy: RoutingStrategy;
  jupiterQuote?: JupiterQuoteInfo;
}
