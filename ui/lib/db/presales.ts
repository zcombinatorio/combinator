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

import { Pool } from 'pg';
import type { Presale, PresaleBid, PresaleClaim, PresaleClaimTransaction } from './types';

/**
 * Presale Management
 *
 * Functions for managing token presales, bids, claims, and vesting schedules.
 * Handles the complete presale lifecycle from creation through claim distribution.
 */

// ============================================================================
// Presale CRUD Functions
// ============================================================================

export async function createPresale(
  pool: Pool,
  presale: Omit<Presale, 'id' | 'created_at' | 'status'>
): Promise<Presale> {
  const query = `
    INSERT INTO presales (
      token_address,
      base_mint_priv_key,
      creator_wallet,
      token_name,
      token_symbol,
      token_metadata_url,
      presale_tokens,
      creator_twitter,
      creator_github,
      escrow_pub_key,
      escrow_priv_key,
      ca_ending
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
  `;

  const values = [
    presale.token_address,
    presale.base_mint_priv_key,
    presale.creator_wallet,
    presale.token_name || null,
    presale.token_symbol || null,
    presale.token_metadata_url,
    presale.presale_tokens ? JSON.stringify(presale.presale_tokens) : null,
    presale.creator_twitter || null,
    presale.creator_github || null,
    presale.escrow_pub_key || null,
    presale.escrow_priv_key || null,
    presale.ca_ending || null
  ];

  try {
    const result = await pool.query(query, values);
    return result.rows[0];
  } catch (error) {
    console.error('Error creating presale:', error);
    throw error;
  }
}

export async function getPresaleByTokenAddress(
  pool: Pool,
  tokenAddress: string
): Promise<Presale | null> {
  const query = `
    SELECT * FROM presales
    WHERE token_address = $1
  `;

  try {
    const result = await pool.query(query, [tokenAddress]);
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Error fetching presale by token address:', error);
    throw error;
  }
}

export async function updatePresaleStatus(
  pool: Pool,
  tokenAddress: string,
  status: string,
  baseMintAddress?: string,
  tokensBought?: string
): Promise<Presale | null> {
  let query: string;
  let values: any[];

  if (baseMintAddress && tokensBought) {
    // Update status, base_mint_address, and tokens_bought
    query = `
      UPDATE presales
      SET status = $2,
          base_mint_address = $3,
          tokens_bought = $4,
          launched_at = NOW()
      WHERE token_address = $1
      RETURNING *
    `;
    values = [tokenAddress, status, baseMintAddress, tokensBought];
  } else {
    // Just update status
    query = `
      UPDATE presales
      SET status = $2
      WHERE token_address = $1
      RETURNING *
    `;
    values = [tokenAddress, status];
  }

  try {
    const result = await pool.query(query, values);
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Error updating presale status:', error);
    throw error;
  }
}

export async function getPresalesByCreatorWallet(
  pool: Pool,
  creatorWallet: string,
  limit = 100
): Promise<Presale[]> {
  const query = `
    SELECT * FROM presales
    WHERE creator_wallet = $1
    ORDER BY created_at DESC
    LIMIT $2
  `;

  try {
    const result = await pool.query(query, [creatorWallet, limit]);
    return result.rows;
  } catch (error) {
    console.error('Error fetching presales by creator wallet:', error);
    throw error;
  }
}

// ============================================================================
// Presale Bid Management Functions
// ============================================================================

export async function recordPresaleBid(
  pool: Pool,
  bid: Omit<PresaleBid, 'id' | 'created_at'>
): Promise<PresaleBid> {
  const query = `
    INSERT INTO presale_bids (
      presale_id,
      token_address,
      wallet_address,
      amount_lamports,
      transaction_signature,
      block_time,
      slot,
      verified_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (transaction_signature) DO NOTHING
    RETURNING *
  `;

  const values = [
    bid.presale_id,
    bid.token_address,
    bid.wallet_address,
    bid.amount_lamports.toString(),
    bid.transaction_signature,
    bid.block_time || null,
    bid.slot ? bid.slot.toString() : null,
    bid.verified_at || new Date()
  ];

  try {
    const result = await pool.query(query, values);
    if (result.rows.length === 0) {
      throw new Error('Bid already recorded or conflict occurred');
    }
    return {
      ...result.rows[0],
      amount_lamports: BigInt(result.rows[0].amount_lamports),
      slot: result.rows[0].slot ? BigInt(result.rows[0].slot) : undefined
    };
  } catch (error) {
    console.error('Error recording presale bid:', error);
    throw error;
  }
}

export async function getPresaleBidBySignature(
  pool: Pool,
  transactionSignature: string
): Promise<PresaleBid | null> {
  const query = `
    SELECT * FROM presale_bids
    WHERE transaction_signature = $1
    LIMIT 1
  `;

  try {
    const result = await pool.query(query, [transactionSignature]);
    if (result.rows.length === 0) {
      return null;
    }
    return {
      ...result.rows[0],
      amount_lamports: BigInt(result.rows[0].amount_lamports),
      slot: result.rows[0].slot ? BigInt(result.rows[0].slot) : undefined
    };
  } catch (error) {
    console.error('Error checking for existing bid:', error);
    throw error;
  }
}

export async function getPresaleBids(
  pool: Pool,
  tokenAddress: string
): Promise<PresaleBid[]> {
  const query = `
    SELECT * FROM presale_bids
    WHERE token_address = $1
    ORDER BY created_at ASC
  `;

  try {
    const result = await pool.query(query, [tokenAddress]);
    return result.rows.map(row => ({
      ...row,
      amount_lamports: BigInt(row.amount_lamports)
    }));
  } catch (error) {
    console.error('Error fetching presale bids:', error);
    throw error;
  }
}

export async function getTotalPresaleBids(
  pool: Pool,
  tokenAddress: string
): Promise<{
  totalBids: number;
  totalAmount: bigint;
}> {
  const query = `
    SELECT
      COUNT(*) as total_bids,
      COALESCE(SUM(amount_lamports), 0) as total_amount
    FROM presale_bids
    WHERE token_address = $1
  `;

  try {
    const result = await pool.query(query, [tokenAddress]);
    const row = result.rows[0];

    return {
      totalBids: parseInt(row.total_bids),
      totalAmount: BigInt(row.total_amount)
    };
  } catch (error) {
    console.error('Error fetching total presale bids:', error);
    throw error;
  }
}

export async function getUserPresaleContribution(
  pool: Pool,
  tokenAddress: string,
  walletAddress: string
): Promise<bigint> {
  const query = `
    SELECT COALESCE(SUM(amount_lamports), 0) as total_contribution
    FROM presale_bids
    WHERE token_address = $1 AND wallet_address = $2
  `;

  try {
    const result = await pool.query(query, [tokenAddress, walletAddress]);
    return BigInt(result.rows[0].total_contribution);
  } catch (error) {
    console.error('Error fetching user presale contribution:', error);
    throw error;
  }
}

/**
 * @deprecated Use initializePresaleClaims from presaleVestingService.ts instead
 * This function is kept for backwards compatibility but should not be used in new code
 */
export async function updatePresaleTokensBought(
  pool: Pool,
  tokenAddress: string,
  tokensBought: string
): Promise<void> {
  const query = `
    UPDATE presales
    SET tokens_bought = $2
    WHERE token_address = $1
  `;

  try {
    await pool.query(query, [tokenAddress, tokensBought]);
  } catch (error) {
    console.error('Error updating presale tokens bought:', error);
    throw error;
  }
}

// ============================================================================
// Presale Claim and Vesting Functions
// ============================================================================

/**
 * Get presale claim record for a specific wallet
 * @param presaleId - The presale ID
 * @param walletAddress - The wallet address to look up
 * @returns The presale claim record or null if not found
 */
export async function getPresaleClaimByWallet(
  pool: Pool,
  presaleId: number,
  walletAddress: string
): Promise<PresaleClaim | null> {
  const query = `
    SELECT * FROM presale_claims
    WHERE presale_id = $1 AND wallet_address = $2
  `;

  try {
    const result = await pool.query(query, [presaleId, walletAddress]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching presale claim:', error);
    throw error;
  }
}

/**
 * Create or update a presale claim record
 * Initializes a user's vesting schedule after presale launch
 * @param claim - The claim data (excludes auto-generated fields)
 * @returns The created or updated presale claim record
 */
export async function createOrUpdatePresaleClaim(
  pool: Pool,
  claim: Omit<PresaleClaim, 'id' | 'created_at' | 'updated_at' | 'tokens_claimed' | 'last_claim_at'>
): Promise<PresaleClaim> {
  const query = `
    INSERT INTO presale_claims (
      presale_id, wallet_address, tokens_allocated, tokens_claimed, vesting_start_at
    ) VALUES ($1, $2, $3, '0', $4)
    ON CONFLICT (presale_id, wallet_address) DO UPDATE SET
      tokens_allocated = EXCLUDED.tokens_allocated,
      vesting_start_at = EXCLUDED.vesting_start_at,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `;

  const values = [
    claim.presale_id,
    claim.wallet_address,
    claim.tokens_allocated,
    claim.vesting_start_at
  ];

  try {
    const result = await pool.query(query, values);
    return result.rows[0];
  } catch (error) {
    console.error('Error creating/updating presale claim:', error);
    throw error;
  }
}

/**
 * Record a successful presale claim transaction
 * Creates an immutable audit trail of all claims
 * @param transaction - The claim transaction data
 * @returns The recorded transaction
 * @throws Error if transaction signature already exists (prevents double claims)
 */
export async function recordPresaleClaimTransaction(
  pool: Pool,
  transaction: Omit<PresaleClaimTransaction, 'id' | 'created_at'>
): Promise<PresaleClaimTransaction> {
  const query = `
    INSERT INTO presale_claim_transactions (
      presale_id, wallet_address, amount_claimed, transaction_signature,
      block_time, slot, verified_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `;

  const values = [
    transaction.presale_id,
    transaction.wallet_address,
    transaction.amount_claimed,
    transaction.transaction_signature,
    transaction.block_time || null,
    transaction.slot || null,
    transaction.verified_at
  ];

  try {
    const result = await pool.query(query, values);
    return result.rows[0];
  } catch (error) {
    if (error instanceof Error && error.message.includes('duplicate key')) {
      throw new Error('Transaction already recorded');
    }
    console.error('Error recording presale claim transaction:', error);
    throw error;
  }
}

/**
 * Update the claimed amount for a presale claim
 * Increments tokens_claimed and updates last_claim_at timestamp
 * @param presaleId - The presale ID
 * @param walletAddress - The wallet address
 * @param amountClaimed - The amount of tokens being claimed (will be added to existing claimed amount)
 */
export async function updatePresaleClaimAmount(
  pool: Pool,
  presaleId: number,
  walletAddress: string,
  amountClaimed: string
): Promise<void> {
  const query = `
    UPDATE presale_claims
    SET
      tokens_claimed = (CAST(tokens_claimed AS DECIMAL) + CAST($3 AS DECIMAL))::TEXT,
      last_claim_at = NOW(),
      updated_at = NOW()
    WHERE presale_id = $1 AND wallet_address = $2
  `;

  try {
    await pool.query(query, [presaleId, walletAddress, amountClaimed]);
  } catch (error) {
    console.error('Error updating presale claim amount:', error);
    throw error;
  }
}

/**
 * Get all presale claim records for a specific presale
 * Useful for generating statistics and reports
 * @param presaleId - The presale ID
 * @returns Array of all claim records for this presale
 */
export async function getPresaleClaimsByPresale(
  pool: Pool,
  presaleId: number
): Promise<PresaleClaim[]> {
  const query = `
    SELECT * FROM presale_claims
    WHERE presale_id = $1
    ORDER BY created_at DESC
  `;

  try {
    const result = await pool.query(query, [presaleId]);
    return result.rows;
  } catch (error) {
    console.error('Error fetching presale claims:', error);
    throw error;
  }
}
