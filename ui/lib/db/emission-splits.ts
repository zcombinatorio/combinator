/*
 * Combinator - Futarchy infrastructure for your project.
 * Copyright (C) 2026 Spice Finance Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 * Questions or feature requests? Reach out:
 * - Telegram Group: https://t.me/+Ao05jBnpEE0yZGVh
 * - Direct: https://t.me/handsdiff
 */

import { Pool } from 'pg';
import type { EmissionSplit, TokenLaunch } from './types';

/**
 * Emission Splits Management
 *
 * Functions for managing emission splits - allowing token emissions to be
 * distributed across multiple recipient wallets with configurable percentages.
 *
 * Emission splits are configured post-launch via PR/admin process, not at launch time.
 */

export async function createEmissionSplits(
  pool: Pool,
  tokenAddress: string,
  splits: Array<{
    recipient_wallet: string;
    split_percentage: number;
    label?: string;
  }>
): Promise<EmissionSplit[]> {
  // Validate total percentage
  const totalPercentage = splits.reduce((sum, s) => sum + s.split_percentage, 0);
  if (totalPercentage > 100) {
    throw new Error(`Total split percentage (${totalPercentage}%) exceeds 100%`);
  }

  // Validate no duplicate wallets
  const wallets = splits.map(s => s.recipient_wallet);
  const uniqueWallets = new Set(wallets);
  if (wallets.length !== uniqueWallets.size) {
    throw new Error('Duplicate wallet addresses found in splits');
  }

  const results: EmissionSplit[] = [];

  for (const split of splits) {
    const query = `
      INSERT INTO emission_splits (
        token_address,
        recipient_wallet,
        split_percentage,
        label
      ) VALUES ($1, $2, $3, $4)
      RETURNING *
    `;

    try {
      const result = await pool.query(query, [
        tokenAddress,
        split.recipient_wallet,
        split.split_percentage,
        split.label || null
      ]);

      results.push(result.rows[0]);
    } catch (error) {
      console.error(`Error creating emission split for ${split.recipient_wallet}:`, error);
      throw error;
    }
  }

  return results;
}

/**
 * Get all emission splits for a token
 * @param tokenAddress - The token address
 * @returns Array of emission splits ordered by percentage (highest first)
 */
export async function getEmissionSplits(
  pool: Pool,
  tokenAddress: string
): Promise<EmissionSplit[]> {
  const query = `
    SELECT * FROM emission_splits
    WHERE token_address = $1
    ORDER BY split_percentage DESC
  `;

  try {
    const result = await pool.query(query, [tokenAddress]);
    return result.rows;
  } catch (error) {
    console.error('Error fetching emission splits:', error);
    throw error;
  }
}

/**
 * Get emission split for a specific wallet and token
 * @param tokenAddress - The token address
 * @param walletAddress - The wallet address
 * @returns Emission split if exists, null otherwise
 */
export async function getWalletEmissionSplit(
  pool: Pool,
  tokenAddress: string,
  walletAddress: string
): Promise<EmissionSplit | null> {
  const query = `
    SELECT * FROM emission_splits
    WHERE token_address = $1 AND recipient_wallet = $2
    LIMIT 1
  `;

  try {
    const result = await pool.query(query, [tokenAddress, walletAddress]);
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Error fetching wallet emission split:', error);
    throw error;
  }
}

/**
 * Check if a wallet has claim rights for a token
 * @param tokenAddress - The token address
 * @param walletAddress - The wallet address
 * @param getTokenLaunchByAddress - Function to get token launch by address
 * @returns True if wallet has claim rights, false otherwise
 */
export async function hasClaimRights(
  pool: Pool,
  tokenAddress: string,
  walletAddress: string,
  getTokenLaunchByAddress: (address: string) => Promise<TokenLaunch | null>
): Promise<boolean> {
  const split = await getWalletEmissionSplit(pool, tokenAddress, walletAddress);

  // Check if they have a split configured
  if (split && split.split_percentage > 0) {
    return true;
  }

  // Fallback: Check if they're the original creator (for tokens without splits)
  const launch = await getTokenLaunchByAddress(tokenAddress);
  if (launch && launch.creator_wallet === walletAddress) {
    return true;
  }

  return false;
}

/**
 * Get all tokens where a wallet has claim rights
 * Includes tokens where wallet is creator OR has emission split
 * @param walletAddress - The wallet address
 * @returns Array of token launches where wallet can claim
 */
export async function getTokensWithClaimRights(
  pool: Pool,
  walletAddress: string
): Promise<TokenLaunch[]> {
  const query = `
    SELECT DISTINCT tl.*
    FROM token_launches tl
    LEFT JOIN emission_splits es ON tl.token_address = es.token_address
    WHERE tl.creator_wallet = $1
       OR es.recipient_wallet = $1
    ORDER BY tl.launch_time DESC
  `;

  try {
    const result = await pool.query(query, [walletAddress]);
    return result.rows;
  } catch (error) {
    console.error('Error fetching tokens with claim rights:', error);
    throw error;
  }
}
