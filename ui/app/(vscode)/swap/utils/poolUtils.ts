import { Connection } from '@solana/web3.js';
import {
  DynamicBondingCurveClient,
  deriveDammV2PoolAddress,
  DAMM_V2_MIGRATION_FEE_ADDRESS,
} from '@meteora-ag/dynamic-bonding-curve-sdk';
import { Token } from '../types';
import { getPoolForPair } from '../constants';

export interface PoolInfo {
  address: string;
  type: 'cp-amm' | 'dbc';
  swapBaseForQuote: boolean;
}

/**
 * Check if a DBC pool has migrated to DAMM V2
 * Returns the migration status and derived DAMM V2 address if migrated
 */
async function checkMigrationStatus(
  connection: Connection,
  dbcPoolAddress: string
): Promise<{ isMigrated: boolean; dammV2Address?: string }> {
  try {
    const dbcClient = new DynamicBondingCurveClient(connection, 'confirmed');
    const poolState = await dbcClient.state.getPool(dbcPoolAddress);

    if (poolState.isMigrated !== 1) {
      return { isMigrated: false };
    }

    // Pool is migrated - derive DAMM V2 address
    const config = await dbcClient.state.getPoolConfig(poolState.config);
    const dammConfig = DAMM_V2_MIGRATION_FEE_ADDRESS[config.migrationFeeOption];

    if (!dammConfig) {
      throw new Error(`Invalid migration fee option: ${config.migrationFeeOption}`);
    }

    const dammV2Address = deriveDammV2PoolAddress(
      dammConfig,
      config.quoteMint,
      poolState.baseMint
    );

    return { isMigrated: true, dammV2Address: dammV2Address.toString() };
  } catch (error) {
    console.error('Migration check failed for', dbcPoolAddress, error);
    return { isMigrated: false }; // Fallback to using DBC pool
  }
}

/**
 * Get pool configuration for a token pair
 * For DBC pools, also determines if we're swapping base for quote or vice versa
 * Automatically detects if a DBC pool has migrated and returns DAMM V2 address
 */
export async function getPoolInfo(from: Token, to: Token, connection: Connection): Promise<PoolInfo | null> {
  const pool = getPoolForPair(from, to);

  if (!pool) return null;

  // Check if DBC pool has migrated to DAMM V2
  if (pool.type === 'dbc') {
    const migrationStatus = await checkMigrationStatus(connection, pool.address);

    if (migrationStatus.isMigrated && migrationStatus.dammV2Address) {
      // Pool has migrated - return DAMM V2 pool info as CP-AMM
      return {
        address: migrationStatus.dammV2Address,
        type: 'cp-amm',
        swapBaseForQuote: false, // CP-AMM doesn't use this flag
      };
    }

    // Pool not migrated - continue with DBC logic
    let swapBaseForQuote = false;

    if (pool.quoteToken) {
      // Determine if we're swapping base token for quote token
      // swapBaseForQuote = true means we're selling the base token for quote token
      // swapBaseForQuote = false means we're buying the base token with quote token
      const baseToken = pool.quoteToken === pool.tokenA ? pool.tokenB : pool.tokenA;
      swapBaseForQuote = from === baseToken;
    }

    return {
      address: pool.address,
      type: pool.type,
      swapBaseForQuote,
    };
  }

  // CP-AMM pool - return as is
  return {
    address: pool.address,
    type: pool.type,
    swapBaseForQuote: false,
  };
}

/**
 * Get all pools involved in a multi-hop swap route
 * Returns an array of pool info for each hop
 * Automatically detects migrated DBC pools and uses DAMM V2 addresses
 */
export async function getPoolsForRoute(tokens: Token[], connection: Connection): Promise<PoolInfo[]> {
  const pools: PoolInfo[] = [];

  for (let i = 0; i < tokens.length - 1; i++) {
    const poolInfo = await getPoolInfo(tokens[i], tokens[i + 1], connection);
    if (!poolInfo) {
      throw new Error(`No pool found for ${tokens[i]} -> ${tokens[i + 1]}`);
    }
    pools.push(poolInfo);
  }

  return pools;
}
