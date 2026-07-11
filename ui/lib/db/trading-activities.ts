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

/**
 * Trading Activity Queries
 *
 * Read-only functions for querying wallet participation on futarchy proposal markets.
 * Data is populated by external indexer into cmb_trade_history table.
 */

// ============================================================================
// Types
// ============================================================================

export interface TradingActivity {
  id: number;
  trader: string;
  proposal_pda: string;
  market: number;
  is_base_to_quote: boolean;
  amount_in: string;
  amount_out: string;
  tx_signature: string | null;
  timestamp: Date;
  price: string | null;
}

export interface WalletStats {
  totalVolume: string;
  totalTransactions: number;
  uniqueProposals: number;
}

export interface LeaderboardEntry {
  trader: string;
  total_volume: string;
  transaction_count: number;
}

export interface ProposalStats {
  totalVolume: string;
  totalTransactions: number;
  uniqueTraders: number;
}

// ============================================================================
// Wallet Query Functions
// ============================================================================

/**
 * Get paginated trading activities for a wallet.
 * Optionally filter by DAO name.
 */
export async function getWalletActivities(
  pool: Pool,
  walletAddress: string,
  options?: { limit?: number; offset?: number; daoName?: string }
): Promise<TradingActivity[]> {
  const limit = options?.limit || 50;
  const offset = options?.offset || 0;
  const daoName = options?.daoName;

  let query: string;
  let params: (string | number)[];

  if (daoName) {
    // Filter by DAO name via join
    query = `
      SELECT
        t.id,
        t.trader,
        t.proposal_pda,
        t.market,
        t.is_base_to_quote,
        t.amount_in::TEXT AS amount_in,
        t.amount_out::TEXT AS amount_out,
        t.tx_signature,
        t.timestamp,
        t.price::TEXT AS price
      FROM cmb_trade_history t
      JOIN cmb_proposal_dao_mapping m ON t.proposal_pda = m.proposal_pda
      JOIN cmb_daos d ON m.dao_pda = d.dao_pda
      WHERE t.trader = $1 AND d.dao_name = $2
      ORDER BY t.timestamp DESC
      LIMIT $3 OFFSET $4
    `;
    params = [walletAddress, daoName, limit, offset];
  } else {
    query = `
      SELECT
        id,
        trader,
        proposal_pda,
        market,
        is_base_to_quote,
        amount_in::TEXT AS amount_in,
        amount_out::TEXT AS amount_out,
        tx_signature,
        timestamp,
        price::TEXT AS price
      FROM cmb_trade_history
      WHERE trader = $1
      ORDER BY timestamp DESC
      LIMIT $2 OFFSET $3
    `;
    params = [walletAddress, limit, offset];
  }

  try {
    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    console.error('Error fetching wallet activities:', error);
    throw error;
  }
}

/**
 * Get aggregate stats for a wallet.
 * Optionally filter by DAO name.
 */
export async function getWalletStats(
  pool: Pool,
  walletAddress: string,
  options?: { daoName?: string }
): Promise<WalletStats> {
  const daoName = options?.daoName;

  let query: string;
  let params: string[];

  if (daoName) {
    query = `
      SELECT
        COALESCE(SUM(t.amount_in), 0)::TEXT AS total_volume,
        COUNT(*) AS total_transactions,
        COUNT(DISTINCT t.proposal_pda) AS unique_proposals
      FROM cmb_trade_history t
      JOIN cmb_proposal_dao_mapping m ON t.proposal_pda = m.proposal_pda
      JOIN cmb_daos d ON m.dao_pda = d.dao_pda
      WHERE t.trader = $1 AND d.dao_name = $2
    `;
    params = [walletAddress, daoName];
  } else {
    query = `
      SELECT
        COALESCE(SUM(amount_in), 0)::TEXT AS total_volume,
        COUNT(*) AS total_transactions,
        COUNT(DISTINCT proposal_pda) AS unique_proposals
      FROM cmb_trade_history
      WHERE trader = $1
    `;
    params = [walletAddress];
  }

  try {
    const result = await pool.query(query, params);
    const row = result.rows[0];

    return {
      totalVolume: row.total_volume,
      totalTransactions: parseInt(row.total_transactions),
      uniqueProposals: parseInt(row.unique_proposals),
    };
  } catch (error) {
    console.error('Error fetching wallet stats:', error);
    throw error;
  }
}

// ============================================================================
// Leaderboard Functions
// ============================================================================

/**
 * Get top traders by volume.
 * Optionally filter by DAO name or specific proposal.
 */
export async function getVolumeLeaderboard(
  pool: Pool,
  options?: { limit?: number; offset?: number; daoName?: string; proposalPda?: string }
): Promise<LeaderboardEntry[]> {
  const limit = options?.limit || 50;
  const offset = options?.offset || 0;
  const daoName = options?.daoName;
  const proposalPda = options?.proposalPda;

  let query: string;
  let params: (string | number)[];

  if (proposalPda) {
    // Filter by specific proposal
    query = `
      SELECT
        trader,
        SUM(amount_in)::TEXT AS total_volume,
        COUNT(*) AS transaction_count
      FROM cmb_trade_history
      WHERE proposal_pda = $1
      GROUP BY trader
      ORDER BY SUM(amount_in) DESC
      LIMIT $2 OFFSET $3
    `;
    params = [proposalPda, limit, offset];
  } else if (daoName) {
    // Filter by DAO name
    query = `
      SELECT
        t.trader,
        SUM(t.amount_in)::TEXT AS total_volume,
        COUNT(*) AS transaction_count
      FROM cmb_trade_history t
      JOIN cmb_proposal_dao_mapping m ON t.proposal_pda = m.proposal_pda
      JOIN cmb_daos d ON m.dao_pda = d.dao_pda
      WHERE d.dao_name = $1
      GROUP BY t.trader
      ORDER BY SUM(t.amount_in) DESC
      LIMIT $2 OFFSET $3
    `;
    params = [daoName, limit, offset];
  } else {
    // No filter - all trades
    query = `
      SELECT
        trader,
        SUM(amount_in)::TEXT AS total_volume,
        COUNT(*) AS transaction_count
      FROM cmb_trade_history
      GROUP BY trader
      ORDER BY SUM(amount_in) DESC
      LIMIT $1 OFFSET $2
    `;
    params = [limit, offset];
  }

  try {
    const result = await pool.query(query, params);
    return result.rows.map(row => ({
      trader: row.trader,
      total_volume: row.total_volume,
      transaction_count: parseInt(row.transaction_count),
    }));
  } catch (error) {
    console.error('Error fetching volume leaderboard:', error);
    throw error;
  }
}

// ============================================================================
// Proposal Query Functions
// ============================================================================

/**
 * Get all trading activities for a proposal.
 */
export async function getProposalActivities(
  pool: Pool,
  proposalPda: string,
  options?: { limit?: number; offset?: number }
): Promise<TradingActivity[]> {
  const limit = options?.limit || 50;
  const offset = options?.offset || 0;

  const query = `
    SELECT
      id,
      trader,
      proposal_pda,
      market,
      is_base_to_quote,
      amount_in::TEXT AS amount_in,
      amount_out::TEXT AS amount_out,
      tx_signature,
      timestamp,
      price::TEXT AS price
    FROM cmb_trade_history
    WHERE proposal_pda = $1
    ORDER BY timestamp DESC
    LIMIT $2 OFFSET $3
  `;

  try {
    const result = await pool.query(query, [proposalPda, limit, offset]);
    return result.rows;
  } catch (error) {
    console.error('Error fetching proposal activities:', error);
    throw error;
  }
}

/**
 * Get aggregate stats for a proposal.
 */
export async function getProposalStats(
  pool: Pool,
  proposalPda: string
): Promise<ProposalStats> {
  const query = `
    SELECT
      COALESCE(SUM(amount_in), 0)::TEXT AS total_volume,
      COUNT(*) AS total_transactions,
      COUNT(DISTINCT trader) AS unique_traders
    FROM cmb_trade_history
    WHERE proposal_pda = $1
  `;

  try {
    const result = await pool.query(query, [proposalPda]);
    const row = result.rows[0];

    return {
      totalVolume: row.total_volume,
      totalTransactions: parseInt(row.total_transactions),
      uniqueTraders: parseInt(row.unique_traders),
    };
  } catch (error) {
    console.error('Error fetching proposal stats:', error);
    throw error;
  }
}

// ============================================================================
// Proposal-to-DAO Mapping Functions
// ============================================================================

/**
 * Upsert a proposal-to-DAO mapping.
 * Called when a proposal is created or fetched.
 */
export async function upsertProposalDaoMapping(
  pool: Pool,
  proposalPda: string,
  daoPda: string
): Promise<void> {
  const query = `
    INSERT INTO cmb_proposal_dao_mapping (proposal_pda, dao_pda)
    VALUES ($1, $2)
    ON CONFLICT (proposal_pda) DO NOTHING
  `;

  try {
    await pool.query(query, [proposalPda, daoPda]);
  } catch (error) {
    console.error('Error upserting proposal-dao mapping:', error);
    throw error;
  }
}
