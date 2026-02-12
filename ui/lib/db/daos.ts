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
import type { Dao, DaoProposer, KeyRegistryEntry } from './types';

/**
 * DAO Management
 *
 * Functions for managing DAOs, proposers, and proposals.
 * Handles the complete DAO lifecycle from creation through proposal management.
 */

// Starting key index (previous indices already used)
const STARTING_KEY_INDEX = 9;

// ============================================================================
// Key Registry Functions
// ============================================================================

export async function getNextKeyIndex(pool: Pool): Promise<number> {
  const query = `
    SELECT COALESCE(MAX(key_idx), $1 - 1) + 1 AS next_idx
    FROM cmb_key_registry
  `;

  try {
    const result = await pool.query(query, [STARTING_KEY_INDEX]);
    const nextIdx = parseInt(result.rows[0].next_idx);
    return Math.max(nextIdx, STARTING_KEY_INDEX);
  } catch (error) {
    console.error('Error getting next key index:', error);
    throw error;
  }
}

export async function registerKey(
  pool: Pool,
  entry: Omit<KeyRegistryEntry, 'id' | 'created_at'>
): Promise<KeyRegistryEntry> {
  const query = `
    INSERT INTO cmb_key_registry (key_idx, public_key, purpose, dao_id)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `;

  const values = [
    entry.key_idx,
    entry.public_key,
    entry.purpose,
    entry.dao_id || null
  ];

  try {
    const result = await pool.query(query, values);
    return result.rows[0];
  } catch (error) {
    console.error('Error registering key:', error);
    throw error;
  }
}

export async function getKeyByIndex(
  pool: Pool,
  keyIdx: number
): Promise<KeyRegistryEntry | null> {
  const query = `
    SELECT * FROM cmb_key_registry
    WHERE key_idx = $1
  `;

  try {
    const result = await pool.query(query, [keyIdx]);
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Error fetching key by index:', error);
    throw error;
  }
}

export async function updateKeyDaoId(
  pool: Pool,
  keyIdx: number,
  daoId: number
): Promise<void> {
  const query = `
    UPDATE cmb_key_registry
    SET dao_id = $2
    WHERE key_idx = $1
  `;

  try {
    await pool.query(query, [keyIdx, daoId]);
  } catch (error) {
    console.error('Error updating key dao_id:', error);
    throw error;
  }
}

// ============================================================================
// DAO CRUD Functions
// ============================================================================

export async function createDao(
  pool: Pool,
  dao: Omit<Dao, 'id' | 'created_at' | 'visibility'>,
  visibility: number = 0
): Promise<Dao> {
  const query = `
    INSERT INTO cmb_daos (
      dao_pda,
      dao_name,
      moderator_pda,
      owner_wallet,
      admin_key_idx,
      admin_wallet,
      token_mint,
      pool_address,
      pool_type,
      quote_mint,
      treasury_multisig,
      mint_auth_multisig,
      treasury_cosigner,
      parent_dao_id,
      dao_type,
      withdrawal_percentage,
      funding_signature,
      visibility
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    RETURNING *
  `;

  const values = [
    dao.dao_pda,
    dao.dao_name,
    dao.moderator_pda || null,
    dao.owner_wallet,
    dao.admin_key_idx,
    dao.admin_wallet,
    dao.token_mint,
    dao.pool_address,
    dao.pool_type,
    dao.quote_mint,
    dao.treasury_multisig,
    dao.mint_auth_multisig,
    dao.treasury_cosigner,
    dao.parent_dao_id || null,
    dao.dao_type,
    dao.withdrawal_percentage,
    dao.funding_signature || null,
    visibility,
  ];

  try {
    const result = await pool.query(query, values);
    return result.rows[0];
  } catch (error) {
    console.error('Error creating DAO:', error);
    throw error;
  }
}

export async function getDaoByPda(
  pool: Pool,
  daoPda: string
): Promise<Dao | null> {
  const query = `
    SELECT * FROM cmb_daos
    WHERE dao_pda = $1
  `;

  try {
    const result = await pool.query(query, [daoPda]);
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Error fetching DAO by PDA:', error);
    throw error;
  }
}

export async function getDaoById(
  pool: Pool,
  id: number
): Promise<Dao | null> {
  const query = `
    SELECT * FROM cmb_daos
    WHERE id = $1
  `;

  try {
    const result = await pool.query(query, [id]);
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Error fetching DAO by ID:', error);
    throw error;
  }
}

export async function getDaoByName(
  pool: Pool,
  daoName: string
): Promise<Dao | null> {
  const query = `
    SELECT * FROM cmb_daos
    WHERE dao_name = $1
  `;

  try {
    const result = await pool.query(query, [daoName]);
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Error fetching DAO by name:', error);
    throw error;
  }
}

/**
 * Get a DAO by its funding signature.
 * Used to prevent replay attacks where the same funding tx is used for multiple DAOs.
 */
export async function getDaoByFundingSignature(
  pool: Pool,
  fundingSignature: string
): Promise<Dao | null> {
  const query = `
    SELECT * FROM cmb_daos
    WHERE funding_signature = $1
  `;

  try {
    const result = await pool.query(query, [fundingSignature]);
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Error fetching DAO by funding signature:', error);
    throw error;
  }
}

export async function getDaoByModeratorPda(
  pool: Pool,
  moderatorPda: string
): Promise<Dao | null> {
  // Only return parent DAOs - child DAOs share parent's moderator but don't manage liquidity
  const query = `
    SELECT * FROM cmb_daos
    WHERE moderator_pda = $1 AND dao_type = 'parent'
  `;

  try {
    const result = await pool.query(query, [moderatorPda]);
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Error fetching DAO by moderator PDA:', error);
    throw error;
  }
}

/**
 * Get a DAO by its pool address (DAMM or DLMM pool)
 * Used by liquidity routes to check if a pool is DAO-managed
 * Only returns parent DAOs since they own the liquidity
 */
export async function getDaoByPoolAddress(
  pool: Pool,
  poolAddress: string,
  adminWallet?: string
): Promise<Dao | null> {
  // If adminWallet provided, filter by it; otherwise return most recently created
  const query = adminWallet
    ? `SELECT * FROM cmb_daos WHERE pool_address = $1 AND dao_type = 'parent' AND admin_wallet = $2`
    : `SELECT * FROM cmb_daos WHERE pool_address = $1 AND dao_type = 'parent' ORDER BY created_at DESC LIMIT 1`;

  const params = adminWallet ? [poolAddress, adminWallet] : [poolAddress];

  try {
    const result = await pool.query(query, params);
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Error fetching DAO by pool address:', error);
    throw error;
  }
}

export async function getAllDaos(
  pool: Pool,
  options?: { limit?: number; offset?: number; daoType?: 'parent' | 'child' }
): Promise<Dao[]> {
  let query = `SELECT * FROM cmb_daos`;
  const values: (string | number)[] = [];
  let paramCount = 0;

  if (options?.daoType) {
    paramCount++;
    query += ` WHERE dao_type = $${paramCount}`;
    values.push(options.daoType);
  }

  query += ` ORDER BY created_at DESC`;

  if (options?.limit) {
    paramCount++;
    query += ` LIMIT $${paramCount}`;
    values.push(options.limit);
  }

  if (options?.offset) {
    paramCount++;
    query += ` OFFSET $${paramCount}`;
    values.push(options.offset);
  }

  try {
    const result = await pool.query(query, values);
    return result.rows;
  } catch (error) {
    console.error('Error fetching all DAOs:', error);
    throw error;
  }
}

export async function getDaosByOwner(
  pool: Pool,
  ownerWallet: string
): Promise<Dao[]> {
  const query = `
    SELECT * FROM cmb_daos
    WHERE owner_wallet = $1
    ORDER BY created_at DESC
  `;

  try {
    const result = await pool.query(query, [ownerWallet]);
    return result.rows;
  } catch (error) {
    console.error('Error fetching DAOs by owner:', error);
    throw error;
  }
}

export async function getChildDaos(
  pool: Pool,
  parentDaoId: number
): Promise<Dao[]> {
  const query = `
    SELECT * FROM cmb_daos
    WHERE parent_dao_id = $1
    ORDER BY created_at DESC
  `;

  try {
    const result = await pool.query(query, [parentDaoId]);
    return result.rows;
  } catch (error) {
    console.error('Error fetching child DAOs:', error);
    throw error;
  }
}

export async function updateDaoModeratorPda(
  pool: Pool,
  daoId: number,
  moderatorPda: string
): Promise<void> {
  const query = `
    UPDATE cmb_daos
    SET moderator_pda = $2
    WHERE id = $1
  `;

  try {
    await pool.query(query, [daoId, moderatorPda]);
  } catch (error) {
    console.error('Error updating DAO moderator PDA:', error);
    throw error;
  }
}

/**
 * Finalize a reserved DAO by replacing PENDING placeholders with real on-chain values.
 * Called after the client creates the DAO on-chain and calls transferAdmin.
 */
export async function finalizeReservedDao(
  pool: Pool,
  daoId: number,
  updates: {
    dao_pda: string;
    dao_name: string;
    moderator_pda: string;
    treasury_multisig: string;
    mint_auth_multisig: string;
    visibility: number;
  }
): Promise<Dao | null> {
  const query = `
    UPDATE cmb_daos
    SET dao_pda = $2,
        dao_name = $3,
        moderator_pda = $4,
        treasury_multisig = $5,
        mint_auth_multisig = $6,
        visibility = $7
    WHERE id = $1
    RETURNING *
  `;

  const values = [
    daoId,
    updates.dao_pda,
    updates.dao_name,
    updates.moderator_pda,
    updates.treasury_multisig,
    updates.mint_auth_multisig,
    updates.visibility,
  ];

  try {
    const result = await pool.query(query, values);
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Error finalizing reserved DAO:', error);
    throw error;
  }
}

// ============================================================================
// DAO Proposer Functions
// ============================================================================

export async function addProposer(
  pool: Pool,
  proposer: Omit<DaoProposer, 'id' | 'created_at'>
): Promise<DaoProposer> {
  const query = `
    INSERT INTO cmb_dao_proposers (dao_id, proposer_wallet, added_by)
    VALUES ($1, $2, $3)
    ON CONFLICT (dao_id, proposer_wallet) DO NOTHING
    RETURNING *
  `;

  const values = [
    proposer.dao_id,
    proposer.proposer_wallet,
    proposer.added_by
  ];

  try {
    const result = await pool.query(query, values);
    // If conflict, fetch existing
    if (result.rows.length === 0) {
      const existing = await getProposer(pool, proposer.dao_id, proposer.proposer_wallet);
      if (existing) return existing;
      throw new Error('Failed to add proposer');
    }
    return result.rows[0];
  } catch (error) {
    console.error('Error adding proposer:', error);
    throw error;
  }
}

export async function removeProposer(
  pool: Pool,
  daoId: number,
  proposerWallet: string
): Promise<boolean> {
  const query = `
    DELETE FROM cmb_dao_proposers
    WHERE dao_id = $1 AND proposer_wallet = $2
    RETURNING id
  `;

  try {
    const result = await pool.query(query, [daoId, proposerWallet]);
    return result.rows.length > 0;
  } catch (error) {
    console.error('Error removing proposer:', error);
    throw error;
  }
}

export async function getProposer(
  pool: Pool,
  daoId: number,
  proposerWallet: string
): Promise<DaoProposer | null> {
  const query = `
    SELECT * FROM cmb_dao_proposers
    WHERE dao_id = $1 AND proposer_wallet = $2
  `;

  try {
    const result = await pool.query(query, [daoId, proposerWallet]);
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Error fetching proposer:', error);
    throw error;
  }
}

export async function isProposer(
  pool: Pool,
  daoId: number,
  walletAddress: string
): Promise<boolean> {
  // Check if wallet is either the DAO owner or an authorized proposer
  const query = `
    SELECT 1 FROM cmb_daos WHERE id = $1 AND owner_wallet = $2
    UNION
    SELECT 1 FROM cmb_dao_proposers WHERE dao_id = $1 AND proposer_wallet = $2
    LIMIT 1
  `;

  try {
    const result = await pool.query(query, [daoId, walletAddress]);
    return result.rows.length > 0;
  } catch (error) {
    console.error('Error checking proposer status:', error);
    throw error;
  }
}

export async function getProposersByDao(
  pool: Pool,
  daoId: number
): Promise<DaoProposer[]> {
  const query = `
    SELECT * FROM cmb_dao_proposers
    WHERE dao_id = $1
    ORDER BY created_at DESC
  `;

  try {
    const result = await pool.query(query, [daoId]);
    return result.rows;
  } catch (error) {
    console.error('Error fetching proposers by DAO:', error);
    throw error;
  }
}

// ============================================================================
// Aggregation / Stats Functions
// ============================================================================

export async function getDaoStats(
  pool: Pool,
  daoId: number
): Promise<{
  proposerCount: number;
  childDaoCount: number;
}> {
  const query = `
    SELECT
      (SELECT COUNT(*) FROM cmb_dao_proposers WHERE dao_id = $1) AS proposer_count,
      (SELECT COUNT(*) FROM cmb_daos WHERE parent_dao_id = $1) AS child_dao_count
  `;

  try {
    const result = await pool.query(query, [daoId]);
    const row = result.rows[0];

    return {
      proposerCount: parseInt(row.proposer_count),
      childDaoCount: parseInt(row.child_dao_count),
    };
  } catch (error) {
    console.error('Error fetching DAO stats:', error);
    throw error;
  }
}

export async function getDaoStatsBatch(
  pool: Pool,
  daoIds: number[]
): Promise<Map<number, { proposerCount: number; childDaoCount: number }>> {
  if (daoIds.length === 0) {
    return new Map();
  }

  const query = `
    SELECT
      d.id AS dao_id,
      COALESCE(p.proposer_count, 0) AS proposer_count,
      COALESCE(c.child_count, 0) AS child_dao_count
    FROM unnest($1::int[]) AS d(id)
    LEFT JOIN (
      SELECT dao_id, COUNT(*) AS proposer_count
      FROM cmb_dao_proposers
      WHERE dao_id = ANY($1)
      GROUP BY dao_id
    ) p ON p.dao_id = d.id
    LEFT JOIN (
      SELECT parent_dao_id, COUNT(*) AS child_count
      FROM cmb_daos
      WHERE parent_dao_id = ANY($1)
      GROUP BY parent_dao_id
    ) c ON c.parent_dao_id = d.id
  `;

  try {
    const result = await pool.query(query, [daoIds]);
    const statsMap = new Map<number, { proposerCount: number; childDaoCount: number }>();

    for (const row of result.rows) {
      statsMap.set(row.dao_id, {
        proposerCount: parseInt(row.proposer_count),
        childDaoCount: parseInt(row.child_dao_count),
      });
    }

    return statsMap;
  } catch (error) {
    console.error('Error fetching DAO stats batch:', error);
    throw error;
  }
}

// ============================================================================
// Proposer Threshold Functions
// ============================================================================

/**
 * Update the proposer token threshold for a DAO.
 * Each DAO (parent or child) maintains its own independent threshold.
 * Set to null to disable token holding requirement (only wallet whitelist applies).
 */
export async function updateProposerThreshold(
  pool: Pool,
  daoId: number,
  threshold: string | null
): Promise<void> {
  const query = `
    UPDATE cmb_daos
    SET proposer_token_threshold = $2
    WHERE id = $1
  `;

  try {
    await pool.query(query, [daoId, threshold]);
  } catch (error) {
    console.error('Error updating proposer threshold:', error);
    throw error;
  }
}

/**
 * Get the proposer token threshold for a DAO.
 * Returns null if no threshold is set.
 */
export async function getProposerThreshold(
  pool: Pool,
  daoId: number
): Promise<string | null> {
  const query = `
    SELECT proposer_token_threshold FROM cmb_daos
    WHERE id = $1
  `;

  try {
    const result = await pool.query(query, [daoId]);
    return result.rows.length > 0 ? result.rows[0].proposer_token_threshold : null;
  } catch (error) {
    console.error('Error fetching proposer threshold:', error);
    throw error;
  }
}

/**
 * Get both the proposer token threshold and holding period for a DAO.
 * Returns the full proposer configuration.
 */
export async function getProposerThresholdConfig(
  pool: Pool,
  daoId: number
): Promise<{ threshold: string | null; holdingPeriodHours: number | null }> {
  const query = `
    SELECT proposer_token_threshold, proposer_holding_period_hours FROM cmb_daos
    WHERE id = $1
  `;

  try {
    const result = await pool.query(query, [daoId]);
    if (result.rows.length === 0) {
      return { threshold: null, holdingPeriodHours: null };
    }
    return {
      threshold: result.rows[0].proposer_token_threshold,
      holdingPeriodHours: result.rows[0].proposer_holding_period_hours,
    };
  } catch (error) {
    console.error('Error fetching proposer threshold config:', error);
    throw error;
  }
}

/**
 * Update the proposer holding period for a DAO.
 * Set to null to disable time-weighted average (use current balance).
 */
export async function updateProposerHoldingPeriod(
  pool: Pool,
  daoId: number,
  hours: number | null
): Promise<void> {
  const query = `
    UPDATE cmb_daos
    SET proposer_holding_period_hours = $2
    WHERE id = $1
  `;

  try {
    await pool.query(query, [daoId, hours]);
  } catch (error) {
    console.error('Error updating proposer holding period:', error);
    throw error;
  }
}

// ============================================================================
// Withdrawal Percentage Functions
// ============================================================================

/**
 * Update the withdrawal percentage for a DAO.
 * Each DAO (parent or child) maintains its own independent withdrawal percentage.
 * Valid range: 1-50 (enforced by database constraint).
 */
export async function updateWithdrawalPercentage(
  pool: Pool,
  daoId: number,
  percentage: number
): Promise<void> {
  // Validate range before attempting update
  if (percentage < 5 || percentage > 50) {
    throw new Error('Withdrawal percentage must be between 5 and 50');
  }

  const query = `
    UPDATE cmb_daos
    SET withdrawal_percentage = $2
    WHERE id = $1
  `;

  try {
    await pool.query(query, [daoId, percentage]);
  } catch (error) {
    console.error('Error updating withdrawal percentage:', error);
    throw error;
  }
}

/**
 * Get the withdrawal percentage for a DAO.
 * Returns the percentage (1-50) or 12 as default if not found.
 */
export async function getWithdrawalPercentage(
  pool: Pool,
  daoId: number
): Promise<number> {
  const query = `
    SELECT withdrawal_percentage FROM cmb_daos
    WHERE id = $1
  `;

  try {
    const result = await pool.query(query, [daoId]);
    return result.rows.length > 0 ? result.rows[0].withdrawal_percentage : 12;
  } catch (error) {
    console.error('Error fetching withdrawal percentage:', error);
    throw error;
  }
}

