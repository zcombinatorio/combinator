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

/**
 * Presale Service
 *
 * Core business logic for token presales including:
 * - Presale claim transaction management
 * - Presale launch transaction management
 * - Lock management for concurrency control
 */

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Presale claim transaction storage
 * Used to track pending presale claims before blockchain confirmation
 */
export interface PresaleClaimTransaction {
  tokenAddress: string;
  userWallet: string;
  claimAmount: string;
  userTokenAccount: string;
  escrowTokenAccount: string;
  mintDecimals: number;
  timestamp: number;
  escrowPublicKey: string;
  encryptedEscrowKey: string; // Store encrypted key, decrypt only when signing
}

/**
 * Presale launch transaction storage
 * Used to track pending presale launches before blockchain confirmation
 */
export interface StoredPresaleLaunchTransaction {
  combinedTx: string;
  tokenAddress: string;
  payerPublicKey: string;
  escrowPublicKey: string;
  baseMintKeypair: string; // Base58 encoded secret key for the base mint
  timestamp: number;
}

// ============================================================================
// In-Memory Storage
// ============================================================================

/**
 * In-memory storage for presale claim transactions
 * Maps transactionKey -> presale claim data
 */
export const presaleClaimTransactions = new Map<string, PresaleClaimTransaction>();

/**
 * In-memory storage for presale launch transactions
 * Maps transactionId -> presale launch data
 */
export const presaleLaunchTransactions = new Map<string, StoredPresaleLaunchTransaction>();

/**
 * Mutex locks for presale claims (per-token to prevent double claims)
 * Maps token address -> Promise that resolves when processing is done
 */
const presaleClaimLocks = new Map<string, Promise<void>>();

// ============================================================================
// Transaction Cleanup
// ============================================================================

/**
 * Transaction expiry time in milliseconds (15 minutes)
 */
export const TRANSACTION_EXPIRY_MS = 15 * 60 * 1000;

/**
 * Clean up old presale launch transactions periodically
 * Runs every minute and removes transactions older than 15 minutes
 */
export const startPresaleTransactionCleanup = () => {
  setInterval(() => {
    const now = Date.now();
    for (const [id, tx] of presaleLaunchTransactions.entries()) {
      if (now - tx.timestamp > TRANSACTION_EXPIRY_MS) {
        presaleLaunchTransactions.delete(id);
      }
    }
  }, 60 * 1000); // Run cleanup every minute
};

// ============================================================================
// Lock Management
// ============================================================================

/**
 * Acquire a presale claim lock for a specific token
 * Prevents race conditions during presale claim processing
 *
 * @param token - The token address to lock
 * @returns A function to release the lock
 */
export async function acquirePresaleClaimLock(token: string): Promise<() => void> {
  const key = token.toLowerCase();

  // Wait for any existing lock to be released
  while (presaleClaimLocks.has(key)) {
    await presaleClaimLocks.get(key);
  }

  // Create a new lock
  let releaseLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  presaleClaimLocks.set(key, lockPromise);

  // Return the release function
  return () => {
    presaleClaimLocks.delete(key);
    releaseLock!();
  };
}
