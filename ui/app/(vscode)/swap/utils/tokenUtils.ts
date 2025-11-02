import { PublicKey } from '@solana/web3.js';
import { Token } from '../types';
import { TOKEN_CONFIG } from '../constants';

/**
 * Get the display symbol for a token
 * @example getTokenSymbol('GITPOST') // returns 'POST'
 */
export function getTokenSymbol(token: Token): string {
  return TOKEN_CONFIG[token]?.displaySymbol || token;
}

/**
 * Get the icon path for a token
 * @example getTokenIcon('SOL') // returns '/solana_logo.png'
 */
export function getTokenIcon(token: Token): string {
  return TOKEN_CONFIG[token]?.icon || '/percent.png';
}

/**
 * Get the decimal places for a token
 * @example getTokenDecimals('SOL') // returns 9
 */
export function getTokenDecimals(token: Token): number {
  return TOKEN_CONFIG[token]?.decimals || 6;
}

/**
 * Get the mint address for a token
 * @example getTokenMint('ZC') // returns PublicKey
 */
export function getTokenMint(token: Token): PublicKey {
  return TOKEN_CONFIG[token]?.mint;
}

/**
 * Get all available tokens
 */
export function getAllTokens(): Token[] {
  return Object.keys(TOKEN_CONFIG) as Token[];
}
