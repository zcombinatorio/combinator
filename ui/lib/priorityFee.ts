/*
 * Z Combinator - Solana Token Launchpad
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
 */

import { Connection, PublicKey } from '@solana/web3.js';

export enum PriorityFeeMode {
  None = 'none',
  Low = 'low',
  Medium = 'medium',
  High = 'high',
  Dynamic = 'dynamic',
}

// Default max priority fee (25,000 microlamports = 0.0000125 SOL for 500k CU)
const DEFAULT_MAX_PRIORITY_FEE = 25_000;

/**
 * Get priority fee based on mode and network conditions
 * @param connection - Solana connection
 * @param mode - Priority fee mode
 * @param accountKeys - Account keys involved in transaction (for dynamic mode)
 * @param maxPriorityFee - Maximum priority fee cap (default: 25,000 microlamports)
 * @returns Priority fee in microlamports per compute unit
 */
export async function getPriorityFee(
  connection: Connection,
  mode: PriorityFeeMode,
  accountKeys: PublicKey[] = [],
  maxPriorityFee: number = DEFAULT_MAX_PRIORITY_FEE
): Promise<number> {
  // Static modes
  if (mode === PriorityFeeMode.None) {
    return 0;
  }

  // For dynamic mode, always fetch from network
  if (mode === PriorityFeeMode.Dynamic) {
    try {
      // Get recent prioritization fees for the accounts
      const recentFees = await connection.getRecentPrioritizationFees({
        lockedWritableAccounts: accountKeys
      });

      if (!recentFees || recentFees.length === 0) {
        // Fallback to medium if no data available
        return 5000;
      }

      // Sort fees and get 75th percentile
      const fees = recentFees
        .map((f: { prioritizationFee: number }) => f.prioritizationFee)
        .filter((f: number) => f > 0)
        .sort((a: number, b: number) => a - b);

      if (fees.length === 0) {
        return 5000; // Default to medium
      }

      const percentileIndex = Math.floor(fees.length * 0.75);
      const suggestedFee = fees[percentileIndex];

      // Cap at max configured fee
      return Math.min(suggestedFee, maxPriorityFee);
    } catch (error) {
      console.warn('Failed to get dynamic priority fee, using medium', error);
      return 5000; // Default to medium
    }
  }

  // Static preset modes
  switch (mode) {
    case PriorityFeeMode.Low:
      return 1000;  // 0.001 lamports per CU
    case PriorityFeeMode.Medium:
      return 5000;  // 0.005 lamports per CU
    case PriorityFeeMode.High:
      return 15000; // 0.015 lamports per CU
    default:
      return 5000;  // Default to medium
  }
}
