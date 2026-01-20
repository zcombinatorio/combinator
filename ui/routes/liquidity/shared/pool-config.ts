/*
 * Combinator - Futarchy infrastructure for your project.
 * Copyright (C) 2026 Spice Finance Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Questions or feature requests? Reach out:
 * - Telegram Group: https://t.me/+Ao05jBnpEE0yZGVh
 * - Direct: https://t.me/handsdiff
 */

import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { getPool } from '../../../lib/db';
import { getDaoByPoolAddress } from '../../../lib/db/daos';
import { fetchAdminKeypair, AdminKeyError } from '../../../lib/keyService';

// Re-export AdminKeyError so callers can catch it
export { AdminKeyError };

/**
 * Pool configuration result from either legacy config or DAO database
 */
export interface PoolConfig {
  lpOwnerKeypair: Keypair;
  managerWallet: string;
  source: 'legacy' | 'dao';
  daoName?: string;
}

/**
 * Pool type for determining which AMM SDK to use
 */
export type PoolType = 'dlmm' | 'damm';

/**
 * Legacy pool mappings for backward compatibility
 * Maps pool address -> ticker for env var lookup
 */
export const DLMM_POOL_TO_TICKER: Record<string, string> = {
  '7jbhVZcYqCRmciBcZzK8L5B96Pyw7i1SpXQFKBkzD3G2': 'ZC',
  'EC7MUufEpZcRZyXTFt16MMNLjJVnj9Vkku4UwdZ713Hx': 'TESTSURF',
};

export const DAMM_POOL_TO_TICKER: Record<string, string> = {
  '2FCqTyvFcE4uXgRL1yh56riZ9vdjVgoP6yknZW3f8afX': 'OOGWAY',
  'Ez1QYeC95xJRwPA9SR7YWC1H1Tj43exJr91QqKf8Puu1': 'SURF',
  'PS3rPSb49GnAkmh3tec1RQizgNSb1hUwPsYHGGuAy5r': 'SURFTEST',
};

/**
 * Restricted LP owner address - never allow cleanup swap or deposit using LP balances
 */
export const RESTRICTED_LP_OWNER = 'Hq7Xh37tT4sesD6wA4DphYfxeMJRhhFWS3KVUSSGjqzc';

/**
 * Check if a pool is authorized and get its configuration
 * First checks legacy whitelist (env vars), then checks DAO database
 *
 * @param poolAddress - The pool address
 * @param poolType - The type of pool (dlmm or damm)
 * @param adminWallet - Optional admin wallet to disambiguate when multiple DAOs share same pool
 * @returns Pool configuration if authorized
 * @throws Error if pool not authorized
 */
export async function getPoolConfig(
  poolAddress: string,
  poolType: PoolType,
  adminWallet?: string
): Promise<PoolConfig> {
  const poolToTicker = poolType === 'dlmm' ? DLMM_POOL_TO_TICKER : DAMM_POOL_TO_TICKER;
  const logPrefix = poolType.toUpperCase();

  // First, check legacy whitelist
  const ticker = poolToTicker[poolAddress];
  if (ticker) {
    const poolSpecificLpOwner = process.env[`LP_OWNER_PRIVATE_KEY_${ticker}`];
    const poolSpecificManager = process.env[`MANAGER_WALLET_${ticker}`];

    if (poolSpecificLpOwner && poolSpecificManager) {
      console.log(`[${logPrefix}] Using legacy config for ${ticker}`);
      const lpOwnerKeypair = Keypair.fromSecretKey(bs58.decode(poolSpecificLpOwner));
      return {
        lpOwnerKeypair,
        managerWallet: poolSpecificManager,
        source: 'legacy',
      };
    }
  }

  // Next, check DAO database - pass adminWallet to disambiguate when multiple DAOs share a pool
  const pool = getPool();
  const dao = await getDaoByPoolAddress(pool, poolAddress, adminWallet);

  if (dao && dao.pool_type === poolType) {
    console.log(`[${logPrefix}] Using DAO config for ${dao.dao_name} (pool: ${poolAddress}, admin: ${dao.admin_wallet})`);
    const lpOwnerKeypair = await fetchAdminKeypair(dao.admin_key_idx, dao.dao_name);
    return {
      lpOwnerKeypair,
      managerWallet: dao.admin_wallet,
      source: 'dao',
      daoName: dao.dao_name,
    };
  }

  throw new Error(`Pool ${poolAddress} not authorized for ${poolType} liquidity operations`);
}

/**
 * Check if an LP owner address is restricted from cleanup operations
 */
export function isRestrictedLpOwner(lpOwnerAddress: string): boolean {
  return lpOwnerAddress === RESTRICTED_LP_OWNER;
}
