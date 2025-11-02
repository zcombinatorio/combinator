import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddress } from '@solana/spl-token';
import { Token, TokenBalances } from '../types';
import { TOKEN_CONFIG } from '../constants';

/**
 * Fetch all token balances for a wallet
 */
export async function fetchBalances(
  connection: Connection,
  wallet: PublicKey
): Promise<TokenBalances> {
  const balances: TokenBalances = {
    SOL: '0',
    ZC: '0',
    TEST: '0',
    SHIRTLESS: '0',
    GITPOST: '0',
    PERC: '0',
  };

  try {
    // Fetch SOL balance
    const solBalance = await connection.getBalance(wallet);
    balances.SOL = (solBalance / LAMPORTS_PER_SOL).toFixed(4);

    // Fetch SPL token balances
    for (const [token, config] of Object.entries(TOKEN_CONFIG)) {
      if (token === 'SOL') continue; // Already handled

      try {
        const ata = await getAssociatedTokenAddress(config.mint, wallet, true);
        const account = await getAccount(connection, ata);
        const decimals = config.decimals;
        balances[token as Token] = (Number(account.amount) / Math.pow(10, decimals)).toFixed(4);
      } catch (e) {
        // Account doesn't exist, balance is 0
        balances[token as Token] = '0';
      }
    }
  } catch (error) {
    console.error('Error fetching balances:', error);
  }

  return balances;
}

/**
 * Fetch balance for a single token
 */
export async function fetchTokenBalance(
  connection: Connection,
  wallet: PublicKey,
  token: Token
): Promise<string> {
  try {
    if (token === 'SOL') {
      const solBalance = await connection.getBalance(wallet);
      return (solBalance / LAMPORTS_PER_SOL).toFixed(4);
    }

    const config = TOKEN_CONFIG[token];
    const ata = await getAssociatedTokenAddress(config.mint, wallet, true);
    const account = await getAccount(connection, ata);
    return (Number(account.amount) / Math.pow(10, config.decimals)).toFixed(4);
  } catch (e) {
    return '0';
  }
}
