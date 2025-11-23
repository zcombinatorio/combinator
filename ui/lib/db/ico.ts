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

import type { Pool } from 'pg';
import type { IcoSale, IcoPurchase, IcoClaim } from './types';

// ============================================================================
// ICO Sales Functions
// ============================================================================

export async function createIcoSale(
  pool: Pool,
  sale: Omit<IcoSale, 'id' | 'created_at' | 'status' | 'tokens_sold' | 'total_sol_raised'>
): Promise<IcoSale> {
  const query = `
    INSERT INTO ico_sales (
      token_address,
      creator_wallet,
      token_metadata_url,
      total_tokens_for_sale,
      token_price_sol,
      token_decimals,
      escrow_pub_key,
      escrow_priv_key,
      vault_token_account,
      treasury_wallet,
      treasury_sol_amount
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *
  `;

  const values = [
    sale.token_address,
    sale.creator_wallet,
    sale.token_metadata_url,
    sale.total_tokens_for_sale.toString(),
    sale.token_price_sol,
    sale.token_decimals,
    sale.escrow_pub_key || null,
    sale.escrow_priv_key || null,
    sale.vault_token_account || null,
    sale.treasury_wallet || null,
    sale.treasury_sol_amount.toString(),
  ];

  try {
    const result = await pool.query(query, values);
    const row = result.rows[0];
    return {
      ...row,
      total_tokens_for_sale: BigInt(row.total_tokens_for_sale),
      treasury_sol_amount: BigInt(row.treasury_sol_amount),
    };
  } catch (error) {
    console.error('Error creating ICO sale:', error);
    throw error;
  }
}

// Helper type for ICO sales with guaranteed calculated fields
export type IcoSaleWithStats = IcoSale & {
  tokens_sold: bigint;  // Guaranteed by COALESCE in query
  total_sol_raised: bigint;  // Guaranteed by COALESCE in query
};

export async function getIcoSaleByTokenAddress(
  pool: Pool,
  tokenAddress: string
): Promise<IcoSaleWithStats | null> {
  const query = `
    SELECT
      s.*,
      COALESCE(SUM(p.tokens_bought), 0) as tokens_sold,
      COALESCE(SUM(p.sol_amount_lamports), 0) as total_sol_raised
    FROM ico_sales s
    LEFT JOIN ico_purchases p ON p.ico_sale_id = s.id
    WHERE s.token_address = $1
    GROUP BY s.id
  `;

  try {
    const result = await pool.query(query, [tokenAddress]);
    if (result.rows.length === 0) return null;

    const row = result.rows[0];

    // Validate critical fields - these should never be null due to COALESCE
    if (row.tokens_sold === null || row.tokens_sold === undefined) {
      console.error('[getIcoSaleByTokenAddress] tokens_sold is null/undefined:', row);
      throw new Error('Database query returned invalid tokens_sold value');
    }
    if (row.total_sol_raised === null || row.total_sol_raised === undefined) {
      console.error('[getIcoSaleByTokenAddress] total_sol_raised is null/undefined:', row);
      throw new Error('Database query returned invalid total_sol_raised value');
    }

    return {
      ...row,
      total_tokens_for_sale: BigInt(row.total_tokens_for_sale),
      tokens_sold: BigInt(row.tokens_sold),
      total_sol_raised: BigInt(row.total_sol_raised),
      treasury_sol_amount: BigInt(row.treasury_sol_amount),
    };
  } catch (error) {
    console.error('Error fetching ICO sale:', error);
    throw error;
  }
}

export async function getIcoSaleById(
  pool: Pool,
  id: number
): Promise<IcoSaleWithStats | null> {
  const query = `
    SELECT
      s.*,
      COALESCE(SUM(p.tokens_bought), 0) as tokens_sold,
      COALESCE(SUM(p.sol_amount_lamports), 0) as total_sol_raised
    FROM ico_sales s
    LEFT JOIN ico_purchases p ON p.ico_sale_id = s.id
    WHERE s.id = $1
    GROUP BY s.id
  `;

  try {
    const result = await pool.query(query, [id]);
    if (result.rows.length === 0) return null;

    const row = result.rows[0];

    // Validate critical fields - these should never be null due to COALESCE
    if (row.tokens_sold === null || row.tokens_sold === undefined) {
      console.error('[getIcoSaleById] tokens_sold is null/undefined:', row);
      throw new Error('Database query returned invalid tokens_sold value');
    }
    if (row.total_sol_raised === null || row.total_sol_raised === undefined) {
      console.error('[getIcoSaleById] total_sol_raised is null/undefined:', row);
      throw new Error('Database query returned invalid total_sol_raised value');
    }

    return {
      ...row,
      total_tokens_for_sale: BigInt(row.total_tokens_for_sale),
      tokens_sold: BigInt(row.tokens_sold),
      total_sol_raised: BigInt(row.total_sol_raised),
      treasury_sol_amount: BigInt(row.treasury_sol_amount),
    };
  } catch (error) {
    console.error('Error fetching ICO sale by ID:', error);
    throw error;
  }
}

export async function updateIcoSaleStatus(
  pool: Pool,
  tokenAddress: string,
  status: 'active' | 'finalized'
): Promise<IcoSale | null> {
  const query = `
    WITH updated AS (
      UPDATE ico_sales
      SET status = $2
      WHERE token_address = $1
      RETURNING *
    )
    SELECT
      s.*,
      COALESCE(SUM(p.tokens_bought), 0) as tokens_sold,
      COALESCE(SUM(p.sol_amount_lamports), 0) as total_sol_raised
    FROM updated s
    LEFT JOIN ico_purchases p ON p.ico_sale_id = s.id
    GROUP BY s.id, s.token_address, s.creator_wallet, s.token_metadata_url,
             s.total_tokens_for_sale, s.token_price_sol, s.status,
             s.escrow_pub_key, s.escrow_priv_key, s.vault_token_account,
             s.treasury_wallet, s.treasury_sol_amount, s.created_at
  `;

  try {
    const result = await pool.query(query, [tokenAddress, status]);
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      ...row,
      total_tokens_for_sale: BigInt(row.total_tokens_for_sale),
      tokens_sold: BigInt(row.tokens_sold),
      total_sol_raised: BigInt(row.total_sol_raised),
      treasury_sol_amount: BigInt(row.treasury_sol_amount),
    };
  } catch (error) {
    console.error('Error updating ICO sale status:', error);
    throw error;
  }
}

// ============================================================================
// ICO Purchases Functions
// ============================================================================

/**
 * Check if a purchase transaction signature has already been processed
 * Used for fail-fast duplicate detection in HTTP layer
 */
export async function isPurchaseSignatureProcessed(
  pool: Pool,
  signature: string
): Promise<boolean> {
  const query = `
    SELECT 1 FROM ico_purchases
    WHERE transaction_signature = $1
    LIMIT 1
  `;

  try {
    const result = await pool.query(query, [signature]);
    return result.rows.length > 0;
  } catch (error) {
    console.error('Error checking purchase signature:', error);
    throw error;
  }
}

export async function recordIcoPurchase(
  pool: Pool,
  purchase: Omit<IcoPurchase, 'id' | 'created_at' | 'tokens_to_vault' | 'tokens_claimable'>
): Promise<IcoPurchase> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // CRITICAL: Lock the ICO sale row to prevent race conditions
    // This ensures only one purchase can be processed at a time for this ICO
    const lockQuery = `
      SELECT id, total_tokens_for_sale
      FROM ico_sales
      WHERE id = $1
      FOR UPDATE
    `;

    const lockResult = await client.query(lockQuery, [purchase.ico_sale_id]);

    if (lockResult.rows.length === 0) {
      throw new Error('ICO sale not found');
    }

    const totalTokensForSale = BigInt(lockResult.rows[0].total_tokens_for_sale);

    // Check if this signature has already been processed to prevent double-purchasing
    // This check is AFTER the lock to prevent race conditions
    const checkQuery = `
      SELECT transaction_signature
      FROM ico_purchases
      WHERE transaction_signature = $1
    `;

    const checkResult = await client.query(checkQuery, [purchase.transaction_signature]);

    if (checkResult.rows.length > 0) {
      throw new Error('Purchase transaction already processed');
    }

    // CRITICAL: Check if this purchase would exceed total tokens for sale
    const totalSoldQuery = `
      SELECT COALESCE(SUM(tokens_bought), 0) as total_sold
      FROM ico_purchases
      WHERE ico_sale_id = $1
    `;

    const totalSoldResult = await client.query(totalSoldQuery, [purchase.ico_sale_id]);
    const currentTotalSold = BigInt(totalSoldResult.rows[0].total_sold);
    const newTotal = currentTotalSold + purchase.tokens_bought;

    if (newTotal > totalTokensForSale) {
      throw new Error(
        `Cannot process purchase: would exceed total tokens for sale. ` +
        `Already sold: ${currentTotalSold}, attempting to buy: ${purchase.tokens_bought}, ` +
        `limit: ${totalTokensForSale}`
      );
    }

    // Insert purchase record
    const purchaseQuery = `
      INSERT INTO ico_purchases (
        ico_sale_id,
        wallet_address,
        sol_amount_lamports,
        tokens_bought,
        transaction_signature
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;

    const purchaseValues = [
      purchase.ico_sale_id,
      purchase.wallet_address,
      purchase.sol_amount_lamports.toString(),
      purchase.tokens_bought.toString(),
      purchase.transaction_signature,
    ];

    const purchaseResult = await client.query(purchaseQuery, purchaseValues);

    // Check if sold out and update status to finalized (enables claiming)
    const soldOutCheckQuery = `
      WITH total_purchased AS (
        SELECT COALESCE(SUM(tokens_bought), 0) as total
        FROM ico_purchases
        WHERE ico_sale_id = $1
      )
      UPDATE ico_sales
      SET status = 'finalized'
      WHERE id = $1
        AND (SELECT total FROM total_purchased) >= total_tokens_for_sale
        AND status = 'active'
    `;

    await client.query(soldOutCheckQuery, [purchase.ico_sale_id]);

    // Upsert claim record (create if doesn't exist, no update needed as tokens_claimable is calculated)
    const claimQuery = `
      INSERT INTO ico_claims (
        ico_sale_id,
        wallet_address
      ) VALUES ($1, $2)
      ON CONFLICT (ico_sale_id, wallet_address)
      DO UPDATE SET
        updated_at = NOW()
    `;

    await client.query(claimQuery, [
      purchase.ico_sale_id,
      purchase.wallet_address,
    ]);

    await client.query('COMMIT');

    const row = purchaseResult.rows[0];

    // Calculate tokens_to_vault and tokens_claimable (50/50 split)
    const tokensBought = BigInt(row.tokens_bought);
    const tokensToVault = tokensBought / BigInt(2);
    const tokensClaimable = tokensBought - tokensToVault;

    return {
      ...row,
      sol_amount_lamports: BigInt(row.sol_amount_lamports),
      tokens_bought: tokensBought,
      tokens_to_vault: tokensToVault,
      tokens_claimable: tokensClaimable,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error recording ICO purchase:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function getIcoPurchasesByWallet(
  pool: Pool,
  tokenAddress: string,
  walletAddress: string
): Promise<IcoPurchase[]> {
  const query = `
    SELECT p.* FROM ico_purchases p
    JOIN ico_sales s ON p.ico_sale_id = s.id
    WHERE s.token_address = $1 AND p.wallet_address = $2
    ORDER BY p.created_at DESC
  `;

  try {
    const result = await pool.query(query, [tokenAddress, walletAddress]);
    return result.rows.map((row) => {
      const tokensBought = BigInt(row.tokens_bought);
      const tokensToVault = tokensBought / BigInt(2);
      const tokensClaimable = tokensBought - tokensToVault;

      return {
        ...row,
        sol_amount_lamports: BigInt(row.sol_amount_lamports),
        tokens_bought: tokensBought,
        tokens_to_vault: tokensToVault,
        tokens_claimable: tokensClaimable,
      };
    });
  } catch (error) {
    console.error('Error fetching ICO purchases by wallet:', error);
    throw error;
  }
}

export async function getAllIcoPurchases(
  pool: Pool,
  tokenAddress: string
): Promise<IcoPurchase[]> {
  const query = `
    SELECT p.* FROM ico_purchases p
    JOIN ico_sales s ON p.ico_sale_id = s.id
    WHERE s.token_address = $1
    ORDER BY p.created_at ASC
  `;

  try {
    const result = await pool.query(query, [tokenAddress]);
    return result.rows.map((row) => {
      const tokensBought = BigInt(row.tokens_bought);
      const tokensToVault = tokensBought / BigInt(2);
      const tokensClaimable = tokensBought - tokensToVault;

      return {
        ...row,
        sol_amount_lamports: BigInt(row.sol_amount_lamports),
        tokens_bought: tokensBought,
        tokens_to_vault: tokensToVault,
        tokens_claimable: tokensClaimable,
      };
    });
  } catch (error) {
    console.error('Error fetching all ICO purchases:', error);
    throw error;
  }
}

// ============================================================================
// ICO Claims Functions
// ============================================================================

/**
 * Check if a claim transaction signature has already been processed
 * Used for fail-fast duplicate detection in HTTP layer
 */
export async function isClaimSignatureProcessed(
  pool: Pool,
  signature: string
): Promise<boolean> {
  const query = `
    SELECT 1 FROM ico_claims
    WHERE claim_transaction_signature = $1
    LIMIT 1
  `;

  try {
    const result = await pool.query(query, [signature]);
    return result.rows.length > 0;
  } catch (error) {
    console.error('Error checking claim signature:', error);
    throw error;
  }
}

export async function getIcoClaimByWallet(
  pool: Pool,
  tokenAddress: string,
  walletAddress: string
): Promise<IcoClaim | null> {
  const query = `
    SELECT
      c.*,
      COALESCE(SUM(p.tokens_bought) / 2, 0) as tokens_claimable
    FROM ico_claims c
    JOIN ico_sales s ON c.ico_sale_id = s.id
    LEFT JOIN ico_purchases p ON p.ico_sale_id = c.ico_sale_id AND p.wallet_address = c.wallet_address
    WHERE s.token_address = $1 AND c.wallet_address = $2
    GROUP BY c.id, c.ico_sale_id, c.wallet_address, c.tokens_claimed, c.claim_transaction_signature, c.claimed_at, c.created_at, c.updated_at
  `;

  try {
    const result = await pool.query(query, [tokenAddress, walletAddress]);
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      ...row,
      tokens_claimable: BigInt(row.tokens_claimable),
      tokens_claimed: BigInt(row.tokens_claimed),
    };
  } catch (error) {
    console.error('Error fetching ICO claim:', error);
    throw error;
  }
}

export async function updateIcoClaim(
  pool: Pool,
  icoSaleId: number,
  walletAddress: string,
  tokensClaimed: bigint,
  claimSignature: string
): Promise<IcoClaim | null> {
  try {
    // Check if this signature has already been processed to prevent double-claiming
    const checkQuery = `
      SELECT claim_transaction_signature
      FROM ico_claims
      WHERE claim_transaction_signature = $1
    `;

    const checkResult = await pool.query(checkQuery, [claimSignature]);

    if (checkResult.rows.length > 0) {
      throw new Error('Claim transaction already processed');
    }

    // Update the claim record and calculate tokens_claimable from purchases
    const query = `
      WITH updated AS (
        UPDATE ico_claims
        SET
          tokens_claimed = tokens_claimed + $3,
          claim_transaction_signature = $4,
          claimed_at = NOW(),
          updated_at = NOW()
        WHERE ico_sale_id = $1 AND wallet_address = $2
        RETURNING *
      )
      SELECT
        c.*,
        COALESCE(SUM(p.tokens_bought) / 2, 0) as tokens_claimable
      FROM updated c
      LEFT JOIN ico_purchases p ON p.ico_sale_id = c.ico_sale_id AND p.wallet_address = c.wallet_address
      GROUP BY c.id, c.ico_sale_id, c.wallet_address, c.tokens_claimed, c.claim_transaction_signature, c.claimed_at, c.created_at, c.updated_at
    `;

    const result = await pool.query(query, [
      icoSaleId,
      walletAddress,
      tokensClaimed.toString(),
      claimSignature,
    ]);

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      ...row,
      tokens_claimable: BigInt(row.tokens_claimable),
      tokens_claimed: BigInt(row.tokens_claimed),
    };
  } catch (error) {
    console.error('Error updating ICO claim:', error);
    throw error;
  }
}

export async function getAllIcoClaims(
  pool: Pool,
  tokenAddress: string
): Promise<IcoClaim[]> {
  const query = `
    SELECT
      c.*,
      COALESCE(SUM(p.tokens_bought) / 2, 0) as tokens_claimable
    FROM ico_claims c
    JOIN ico_sales s ON c.ico_sale_id = s.id
    LEFT JOIN ico_purchases p ON p.ico_sale_id = c.ico_sale_id AND p.wallet_address = c.wallet_address
    WHERE s.token_address = $1
    GROUP BY c.id, c.ico_sale_id, c.wallet_address, c.tokens_claimed, c.claim_transaction_signature, c.claimed_at, c.created_at, c.updated_at
    ORDER BY c.created_at ASC
  `;

  try {
    const result = await pool.query(query, [tokenAddress]);
    return result.rows.map((row) => ({
      ...row,
      tokens_claimable: BigInt(row.tokens_claimable),
      tokens_claimed: BigInt(row.tokens_claimed),
    }));
  } catch (error) {
    console.error('Error fetching all ICO claims:', error);
    throw error;
  }
}
