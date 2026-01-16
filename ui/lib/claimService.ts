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

import { calculateClaimEligibility } from './helius';
import {
  getWalletEmissionSplit,
  getTokenCreatorWallet,
  getEmissionSplits,
  getTotalClaimedByWallet
} from './db';

/**
 * Claim Service
 *
 * Core business logic for token emission claims with emission splits support.
 * Handles per-wallet claim calculations, eligibility checks, and claim tracking.
 */

// ============================================================================
// In-Memory Storage
// ============================================================================

/**
 * Claim transaction storage for pending claims
 * Maps transactionKey -> claim data
 */
export interface ClaimTransaction {
  tokenAddress: string;
  userWallet: string;
  claimAmount: string;
  mintDecimals: number;
  timestamp: number;
  unsignedTransactionHash: string; // SHA-256 hash for tamper detection
}

export const claimTransactions = new Map<string, ClaimTransaction>();

/**
 * Mutex locks for preventing concurrent claim processing
 * Maps token address -> Promise that resolves when processing is done
 * Lock is per-token since claim eligibility is global per token
 */
const claimLocks = new Map<string, Promise<void>>();

// ============================================================================
// Lock Management
// ============================================================================

/**
 * Acquire a claim lock for a specific token
 * Prevents race conditions during claim processing
 *
 * @param token - The token address to lock
 * @returns A function to release the lock
 */
export async function acquireClaimLock(token: string): Promise<() => void> {
  const key = token.toLowerCase();

  // Wait for any existing lock to be released
  while (claimLocks.has(key)) {
    await claimLocks.get(key);
  }

  // Create a new lock
  let releaseLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  claimLocks.set(key, lockPromise);

  // Return the release function
  return () => {
    claimLocks.delete(key);
    releaseLock!();
  };
}

// ============================================================================
// Claim Eligibility Calculations
// ============================================================================

/**
 * Calculate claim eligibility for a specific wallet
 * Takes into account:
 * - Global emission limits (calculateClaimEligibility)
 * - Wallet's emission split percentage
 * - Amount already claimed by this wallet
 *
 * Security: Prevents wallets from claiming more than their allocated percentage
 *
 * @param tokenAddress - The token address
 * @param walletAddress - The wallet address
 * @param tokenLaunchTime - The token launch timestamp
 * @returns Object containing wallet-specific claim eligibility data
 */
export async function calculateWalletClaimEligibility(
  tokenAddress: string,
  walletAddress: string,
  tokenLaunchTime: Date
): Promise<{
  availableToClaimForWallet: bigint;
  walletSplitPercentage: number;
  totalAlreadyClaimedByWallet: bigint;
  globalAvailableToClaim: bigint;
  globalMaxClaimableNow: bigint;
}> {
  // Get global claim eligibility (total emissions available across all wallets)
  const globalEligibility = await calculateClaimEligibility(tokenAddress, tokenLaunchTime);

  // Get wallet's emission split percentage
  const walletSplit = await getWalletEmissionSplit(tokenAddress, walletAddress);
  let splitPercentage = 0;

  if (walletSplit && walletSplit.split_percentage > 0) {
    // Wallet has a configured split
    splitPercentage = walletSplit.split_percentage;
  } else {
    // Check if wallet is the creator (fallback for tokens without splits)
    const creatorWallet = await getTokenCreatorWallet(tokenAddress);
    if (creatorWallet && creatorWallet.trim() === walletAddress.trim()) {
      // Creator gets 100% when no splits configured
      const emissionSplits = await getEmissionSplits(tokenAddress);
      if (emissionSplits.length === 0) {
        splitPercentage = 100;
      } else {
        // Creator has no explicit split and others exist - they get 0%
        splitPercentage = 0;
      }
    }
  }

  if (splitPercentage === 0) {
    // Wallet has no claim rights
    return {
      availableToClaimForWallet: BigInt(0),
      walletSplitPercentage: 0,
      totalAlreadyClaimedByWallet: BigInt(0),
      globalAvailableToClaim: globalEligibility.availableToClaim,
      globalMaxClaimableNow: globalEligibility.maxClaimableNow
    };
  }

  // Get total already claimed by this wallet
  const totalClaimedByWallet = await getTotalClaimedByWallet(tokenAddress, walletAddress);

  // Calculate this wallet's allocation of the TOTAL emissions (not just available)
  // The 90% claimer portion applies to the global max
  const claimersTotal = (globalEligibility.maxClaimableNow * BigInt(9)) / BigInt(10);
  const walletMaxAllocation = (claimersTotal * BigInt(Math.floor(splitPercentage * 100))) / BigInt(10000);

  // Calculate how much this wallet can still claim
  const availableForWallet = walletMaxAllocation > totalClaimedByWallet
    ? walletMaxAllocation - totalClaimedByWallet
    : BigInt(0);

  // Also respect the global available limit (can't claim more than globally available)
  const walletShareOfGlobalAvailable = (globalEligibility.availableToClaim * BigInt(9) / BigInt(10) * BigInt(Math.floor(splitPercentage * 100))) / BigInt(10000);
  const finalAvailable = availableForWallet < walletShareOfGlobalAvailable ? availableForWallet : walletShareOfGlobalAvailable;

  return {
    availableToClaimForWallet: finalAvailable,
    walletSplitPercentage: splitPercentage,
    totalAlreadyClaimedByWallet: totalClaimedByWallet,
    globalAvailableToClaim: globalEligibility.availableToClaim,
    globalMaxClaimableNow: globalEligibility.maxClaimableNow
  };
}
