/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2026 Spice Finance Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

/**
 * Mutex locks for preventing concurrent liquidity operations on the same pool
 * Ensures sequential processing of withdrawals, deposits, and swaps
 */

// Map of pool address -> lock promise
const liquidityLocks = new Map<string, Promise<void>>();

/**
 * Acquire a liquidity lock for a specific pool
 * Prevents race conditions during liquidity operations
 *
 * @param poolAddress - The pool address to lock
 * @returns A release function to call when the operation is complete
 *
 * @example
 * const releaseLock = await acquireLiquidityLock(poolAddress);
 * try {
 *   // ... perform liquidity operation
 * } finally {
 *   releaseLock();
 * }
 */
export async function acquireLiquidityLock(poolAddress: string): Promise<() => void> {
  const key = poolAddress.toLowerCase();

  // Wait for any existing lock to be released
  while (liquidityLocks.has(key)) {
    await liquidityLocks.get(key);
  }

  // Create a new lock
  let releaseLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  liquidityLocks.set(key, lockPromise);

  // Return the release function
  return () => {
    liquidityLocks.delete(key);
    releaseLock!();
  };
}

/**
 * Check if a pool currently has an active lock
 * Useful for debugging and monitoring
 */
export function hasLiquidityLock(poolAddress: string): boolean {
  return liquidityLocks.has(poolAddress.toLowerCase());
}

/**
 * Get the number of active locks
 * Useful for monitoring
 */
export function getActiveLockCount(): number {
  return liquidityLocks.size;
}
