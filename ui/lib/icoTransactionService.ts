/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2025 Spice Finance Inc.
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

/**
 * ICO Transaction Service
 *
 * Core business logic for ICO transactions including:
 * - Purchase transaction management
 * - Claim transaction management
 * - Lock management for concurrency control to prevent overselling
 */

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * ICO purchase transaction storage
 * Used to track pending purchases before blockchain confirmation
 */
export interface IcoPurchaseTransaction {
  tokenAddress: string;
  buyerWallet: string;
  solAmountLamports: string;
  tokensBought: string;
  tokensToVault: string;
  tokensClaimable: string;
  timestamp: number;
}

/**
 * ICO claim transaction storage
 * Used to track pending claims before blockchain confirmation
 */
export interface IcoClaimTransaction {
  tokenAddress: string;
  userWallet: string;
  tokensToClaim: string;
  timestamp: number;
}

// ============================================================================
// In-Memory Storage
// ============================================================================

/**
 * In-memory storage for ICO purchase transactions
 * Maps transactionKey -> purchase data
 */
export const icoPurchaseTransactions = new Map<string, IcoPurchaseTransaction>();

/**
 * In-memory storage for ICO claim transactions
 * Maps transactionKey -> claim data
 */
export const icoClaimTransactions = new Map<string, IcoClaimTransaction>();

/**
 * Mutex locks for ICO purchases (per-token to prevent overselling)
 * Maps token address -> Promise that resolves when processing is done
 */
const icoPurchaseLocks = new Map<string, Promise<void>>();

/**
 * Mutex locks for ICO claims (per-token to prevent double claims)
 * Maps token address -> Promise that resolves when processing is done
 */
const icoClaimLocks = new Map<string, Promise<void>>();

// ============================================================================
// Transaction Cleanup
// ============================================================================

/**
 * Transaction expiry time in milliseconds (15 minutes)
 */
export const TRANSACTION_EXPIRY_MS = 15 * 60 * 1000;

/**
 * Clean up old ICO transactions periodically
 * Runs every minute and removes transactions older than 15 minutes
 */
export const startIcoTransactionCleanup = () => {
  setInterval(() => {
    const now = Date.now();

    // Cleanup purchase transactions
    for (const [key, tx] of icoPurchaseTransactions.entries()) {
      if (now - tx.timestamp > TRANSACTION_EXPIRY_MS) {
        icoPurchaseTransactions.delete(key);
      }
    }

    // Cleanup claim transactions
    for (const [key, tx] of icoClaimTransactions.entries()) {
      if (now - tx.timestamp > TRANSACTION_EXPIRY_MS) {
        icoClaimTransactions.delete(key);
      }
    }
  }, 60 * 1000); // Run cleanup every minute
};

// ============================================================================
// Lock Management
// ============================================================================

/**
 * Acquire an ICO purchase lock for a specific token
 * Prevents race conditions during purchase processing (critical for preventing overselling)
 *
 * @param token - The token address to lock
 * @returns A function to release the lock
 */
export async function acquireIcoPurchaseLock(token: string): Promise<() => void> {
  const key = token.toLowerCase();

  // Wait for any existing lock to be released
  while (icoPurchaseLocks.has(key)) {
    await icoPurchaseLocks.get(key);
  }

  // Create a new lock
  let releaseLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  icoPurchaseLocks.set(key, lockPromise);

  // Return the release function
  return () => {
    icoPurchaseLocks.delete(key);
    releaseLock!();
  };
}

/**
 * Acquire an ICO claim lock for a specific token
 * Prevents race conditions during claim processing
 *
 * @param token - The token address to lock
 * @returns A function to release the lock
 */
export async function acquireIcoClaimLock(token: string): Promise<() => void> {
  const key = token.toLowerCase();

  // Wait for any existing lock to be released
  while (icoClaimLocks.has(key)) {
    await icoClaimLocks.get(key);
  }

  // Create a new lock
  let releaseLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  icoClaimLocks.set(key, lockPromise);

  // Return the release function
  return () => {
    icoClaimLocks.delete(key);
    releaseLock!();
  };
}
