/**
 * Whitelist configuration for multi-token decision markets
 * Maps DAMM pool addresses to authorized wallet addresses
 *
 * IMPORTANT: Each pool's whitelist MUST include:
 * 1. The pool's backend authority wallet public key (from percent-os)
 *    - This wallet signs withdrawal transactions from DAMM
 *    - Public key corresponds to the private key in POOL_AUTHORITY_{TICKER}_PATH
 * 2. Authorized user wallets (e.g., team members who can create DMs)
 *
 * Security: Both percent-os API and zcombinator DAMM API validate against this whitelist
 */

// Map of DAMM pool address → array of authorized wallet public keys
// Each pool can have multiple authorized wallets
export const POOL_WHITELIST: Record<string, string[]> = {
  // ZC-SOL DAMM Pool (default)
  'CCZdbVvDqPN8DmMLVELfnt9G1Q9pQNt3bTGifSpUY9Ad': [
    '79TLv4oneDA1tDUSNXBxNCnemzNmLToBHYXnfZWDQNeP',
    'BXc9g3zxbQhhfkLjxXbtSHrfd6MSFRdJo8pDQhW95QUw',
    'FgACAue3FuWPrL7xSqXWtUdHLne52dvVsKyKxjwqPYtr',
    'FtV94i2JvmaqsE1rBT72C9YR58wYJXt1ZjRmPb4tDvMK',
    'GZMLeHbDxurMD9me9X3ib9UbF3GYuditPbHprj8oTajZ',
  ],
  // oogway
  '2FCqTyvFcE4uXgRL1yh56riZ9vdjVgoP6yknZW3f8afX': [
    '79TLv4oneDA1tDUSNXBxNCnemzNmLToBHYXnfZWDQNeP',
    'BXc9g3zxbQhhfkLjxXbtSHrfd6MSFRdJo8pDQhW95QUw',
    'GZMLeHbDxurMD9me9X3ib9UbF3GYuditPbHprj8oTajZ',
  ],
};

/**
 * Get all pool addresses that a wallet is authorized to use
 * @param walletAddress - The connected wallet's public key
 * @returns Array of pool addresses the wallet can create DMs for
 */
export function getPoolsForWallet(walletAddress: string): string[] {
  const authorizedPools: string[] = [];

  for (const [poolAddress, authorizedWallets] of Object.entries(POOL_WHITELIST)) {
    if (authorizedWallets.includes(walletAddress)) {
      authorizedPools.push(poolAddress);
    }
  }

  return authorizedPools;
}

/**
 * Check if a wallet is authorized for a specific pool
 * @param walletAddress - The connected wallet's public key
 * @param poolAddress - The DAMM pool address to check
 * @returns true if wallet is authorized for the pool
 */
export function isWalletAuthorizedForPool(walletAddress: string, poolAddress: string): boolean {
  const authorizedWallets = POOL_WHITELIST[poolAddress];
  if (!authorizedWallets) {
    return false;
  }
  return authorizedWallets.includes(walletAddress);
}

/**
 * Check if a wallet is whitelisted for any pool
 * @param walletAddress - The connected wallet's public key
 * @returns true if wallet is authorized for at least one pool
 */
export function isWalletWhitelisted(walletAddress: string): boolean {
  return getPoolsForWallet(walletAddress).length > 0;
}
