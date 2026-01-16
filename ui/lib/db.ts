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
import type {
  TokenLaunch,
  VerificationChallenge,
  MintTransaction,
  TokenHolder,
  DesignatedClaim,
  EmissionSplit,
  Presale,
  PresaleBid,
  PresaleClaim,
  PresaleClaimTransaction,
  Contribution,
  IcoSale,
  IcoPurchase,
  IcoClaim,
} from './db/types';
import * as emissionSplitsModule from './db/emission-splits';
import * as presalesModule from './db/presales';
import * as icoModule from './db/ico';

// Re-export all database types for backwards compatibility
export type {
  TokenLaunch,
  VerificationChallenge,
  MintTransaction,
  ClaimRecord,
  TokenHolder,
  DesignatedClaim,
  EmissionSplit,
  Presale,
  PresaleBid,
  PresaleClaim,
  PresaleClaimTransaction,
  Contribution,
  IcoSale,
  IcoPurchase,
  IcoClaim,
  KeyRegistryEntry,
  Dao,
  DaoProposer,
} from './db/types';

// Mock database support
import { shouldUseMockData, getMockDatabase } from './mock';

let pool: Pool | null = null;
let mockDb: ReturnType<typeof getMockDatabase> | null = null;

// Check if we should use mock data
function shouldUseMockDatabase(): boolean {
  return shouldUseMockData();
}

// Get mock database instance
function getMockDb() {
  if (!mockDb) {
    mockDb = getMockDatabase();
  }
  return mockDb;
}

export function getPool(): Pool {
  // If in mock mode, return a dummy pool (won't actually be used)
  if (shouldUseMockDatabase()) {
    // Return a dummy pool object to prevent errors
    return {} as Pool;
  }

  if (!pool) {
    const dbUrl = process.env.DB_URL;

    if (!dbUrl) {
      throw new Error('DB_URL environment variable is not set');
    }

    pool = new Pool({
      connectionString: dbUrl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
    });
  }

  return pool;
}


export async function recordTokenLaunch(launch: Omit<TokenLaunch, 'id' | 'created_at' | 'launch_time'>): Promise<TokenLaunch> {
  // Use mock database if enabled
  if (shouldUseMockDatabase()) {
    return getMockDb().recordTokenLaunch(launch);
  }

  const pool = getPool();

  const query = `
    INSERT INTO token_launches (
      creator_wallet,
      token_address,
      token_metadata_url,
      token_name,
      token_symbol,
      creator_twitter,
      creator_github
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (token_address) DO NOTHING
    RETURNING *
  `;

  const values = [
    launch.creator_wallet,
    launch.token_address,
    launch.token_metadata_url,
    launch.token_name || null,
    launch.token_symbol || null,
    launch.creator_twitter || null,
    launch.creator_github || null
  ];

  try {
    const result = await pool.query(query, values);
    const tokenLaunch = result.rows[0];

    // If social profiles are provided, create a designated claim record
    if (tokenLaunch && (launch.creator_twitter || launch.creator_github)) {
      await createDesignatedClaim(
        tokenLaunch.token_address,
        tokenLaunch.creator_wallet,
        launch.creator_twitter,
        launch.creator_github
      );
    }

    return tokenLaunch;
  } catch (error) {
    console.error('Error recording token launch:', error);
    throw error;
  }
}

export async function getTokenLaunches(creatorWallet?: string, limit = 100): Promise<TokenLaunch[]> {
  // Use mock database if enabled
  if (shouldUseMockDatabase()) {
    return getMockDb().getTokenLaunches(creatorWallet, limit);
  }

  const pool = getPool();

  let query = `
    SELECT * FROM token_launches
  `;

  const values: (string | null)[] = [];

  if (creatorWallet) {
    query += ' WHERE creator_wallet = $1';
    values.push(creatorWallet);
  }

  query += ' ORDER BY launch_time DESC';

  if (limit) {
    query += ` LIMIT ${limit}`;
  }

  try {
    const result = await pool.query(query, values);
    return result.rows;
  } catch (error) {
    console.error('Error fetching token launches:', error);
    throw error;
  }
}

export async function getTokenLaunchByAddress(tokenAddress: string): Promise<TokenLaunch | null> {
  // Use mock database if enabled
  if (shouldUseMockDatabase()) {
    return getMockDb().getTokenLaunchByAddress(tokenAddress);
  }

  const pool = getPool();

  const query = `
    SELECT * FROM token_launches
    WHERE token_address = $1
  `;

  try {
    const result = await pool.query(query, [tokenAddress]);
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Error fetching token launch by address:', error);
    throw error;
  }
}

export async function getTokenLaunchesBySocials(twitterUsername?: string, githubUrl?: string, limit = 100): Promise<TokenLaunch[]> {
  // Use mock database if enabled
  if (shouldUseMockDatabase()) {
    return getMockDb().getTokenLaunchesBySocials(twitterUsername, githubUrl, limit);
  }

  const pool = getPool();

  if (!twitterUsername && !githubUrl) {
    return [];
  }

  let query = `
    SELECT * FROM token_launches
    WHERE
  `;

  const conditions: string[] = [];
  const values: (string | null)[] = [];
  let paramCount = 0;

  // For Twitter/X, match both twitter.com and x.com URLs with the username
  if (twitterUsername) {
    // If it's just a username, build both URL formats
    // If it's already a full URL, extract the username first
    let username = twitterUsername;

    // Extract username if a full URL was passed
    if (twitterUsername.includes('twitter.com/') || twitterUsername.includes('x.com/')) {
      const match = twitterUsername.match(/(?:twitter\.com|x\.com)\/([A-Za-z0-9_]+)/);
      username = match ? match[1] : twitterUsername;
    }

    // Match multiple URL formats: with/without https://, twitter.com/x.com
    const urlVariations = [
      `https://twitter.com/${username}`,
      `https://x.com/${username}`,
      `twitter.com/${username}`,
      `x.com/${username}`
    ];

    // Build OR conditions for all URL variations
    const orConditions = urlVariations.map(() => {
      paramCount++;
      return `creator_twitter = $${paramCount}`;
    }).join(' OR ');

    conditions.push(`(${orConditions})`);
    values.push(...urlVariations);
  }

  if (githubUrl) {
    // Extract username if needed
    let githubUsername = githubUrl;
    if (githubUrl.includes('github.com/')) {
      const match = githubUrl.match(/github\.com\/([A-Za-z0-9-]+)/);
      githubUsername = match ? match[1] : githubUrl;
    }

    // Match multiple URL formats for GitHub
    const githubVariations = [
      `https://github.com/${githubUsername}`,
      `github.com/${githubUsername}`
    ];

    const orConditions = githubVariations.map(() => {
      paramCount++;
      return `creator_github = $${paramCount}`;
    }).join(' OR ');

    conditions.push(`(${orConditions})`);
    values.push(...githubVariations);
  }

  query += conditions.join(' OR ');
  query += ' ORDER BY launch_time DESC';

  if (limit) {
    query += ` LIMIT ${limit}`;
  }

  try {
    const result = await pool.query(query, values);
    return result.rows;
  } catch (error) {
    console.error('Error fetching token launches by socials:', error);
    throw error;
  }
}

export async function getTokenLaunchTime(tokenAddress: string): Promise<Date | null> {
  const pool = getPool();

  const query = `
    SELECT launch_time
    FROM token_launches
    WHERE token_address = $1
  `;

  try {
    const result = await pool.query(query, [tokenAddress]);

    if (result.rows.length === 0) {
      return null;
    }

    return new Date(result.rows[0].launch_time);
  } catch (error) {
    console.error('Error fetching token launch time:', error);
    throw error;
  }
}

export async function getTokenCreatorWallet(tokenAddress: string): Promise<string | null> {
  const pool = getPool();

  const query = `
    SELECT creator_wallet
    FROM token_launches
    WHERE token_address = $1
  `;

  try {
    const result = await pool.query(query, [tokenAddress]);

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0].creator_wallet;
  } catch (error) {
    console.error('Error fetching token creator wallet:', error);
    throw error;
  }
}

export async function initializeDatabase(): Promise<void> {
  const pool = getPool();

  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS token_launches (
      id SERIAL PRIMARY KEY,
      launch_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
      creator_wallet TEXT NOT NULL,
      token_address TEXT NOT NULL,
      token_metadata_url TEXT NOT NULL,
      token_name TEXT,
      token_symbol TEXT,
      creator_twitter TEXT,
      creator_github TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
      verified BOOLEAN DEFAULT FALSE,
      UNIQUE(token_address)
    );

    CREATE INDEX IF NOT EXISTS idx_token_launches_creator_wallet ON token_launches(creator_wallet);
    CREATE INDEX IF NOT EXISTS idx_token_launches_launch_time ON token_launches(launch_time DESC);
    CREATE INDEX IF NOT EXISTS idx_token_launches_token_address ON token_launches(token_address);
    CREATE INDEX IF NOT EXISTS idx_token_launches_creator_twitter ON token_launches(creator_twitter);
    CREATE INDEX IF NOT EXISTS idx_token_launches_creator_github ON token_launches(creator_github);

    CREATE TABLE IF NOT EXISTS mint_transactions (
      id SERIAL PRIMARY KEY,
      signature TEXT UNIQUE NOT NULL,
      timestamp BIGINT NOT NULL,
      token_address TEXT NOT NULL,
      wallet_address TEXT NOT NULL,
      amount BIGINT NOT NULL,
      tx_data JSONB NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mint_transactions_token_wallet ON mint_transactions(token_address, wallet_address);
    CREATE INDEX IF NOT EXISTS idx_mint_transactions_timestamp ON mint_transactions(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_mint_transactions_signature ON mint_transactions(signature);
    CREATE INDEX IF NOT EXISTS idx_mint_transactions_token_address ON mint_transactions(token_address);

    CREATE TABLE IF NOT EXISTS claim_records (
      id SERIAL PRIMARY KEY,
      wallet_address TEXT NOT NULL,
      token_address TEXT NOT NULL,
      amount TEXT NOT NULL,
      transaction_signature TEXT UNIQUE NOT NULL,
      confirmed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    -- Indexes optimized for token-based claim eligibility (global per token)
    CREATE INDEX IF NOT EXISTS idx_claim_records_token ON claim_records(token_address);
    CREATE INDEX IF NOT EXISTS idx_claim_records_token_time ON claim_records(token_address, confirmed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_claim_records_confirmed_at ON claim_records(confirmed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_claim_records_signature ON claim_records(transaction_signature);

    CREATE TABLE IF NOT EXISTS token_holders (
      id SERIAL PRIMARY KEY,
      token_address TEXT NOT NULL,
      wallet_address TEXT NOT NULL,
      token_balance NUMERIC(20,6) NOT NULL DEFAULT 0,
      staked_balance NUMERIC(20,6) NOT NULL DEFAULT 0,
      telegram_username TEXT,
      x_username TEXT,
      discord_username TEXT,
      custom_label TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
      last_sync_at TIMESTAMP WITH TIME ZONE,
      UNIQUE(token_address, wallet_address)
    );

    CREATE INDEX IF NOT EXISTS idx_token_holders_token_address ON token_holders(token_address);
    CREATE INDEX IF NOT EXISTS idx_token_holders_wallet_address ON token_holders(wallet_address);
    CREATE INDEX IF NOT EXISTS idx_token_holders_token_wallet ON token_holders(token_address, wallet_address);
    CREATE INDEX IF NOT EXISTS idx_token_holders_balance ON token_holders(token_address, token_balance DESC);
    CREATE INDEX IF NOT EXISTS idx_token_holders_telegram_lower ON token_holders(lower(telegram_username));
    CREATE INDEX IF NOT EXISTS idx_token_holders_x_lower ON token_holders(lower(x_username));
    CREATE INDEX IF NOT EXISTS idx_token_holders_discord_lower ON token_holders(lower(discord_username));

    CREATE TABLE IF NOT EXISTS designated_claims (
      id SERIAL PRIMARY KEY,
      token_address TEXT NOT NULL,
      original_launcher TEXT NOT NULL,
      designated_twitter TEXT,
      designated_github TEXT,
      verified_wallet TEXT,
      verified_embedded_wallet TEXT,
      verified_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
      UNIQUE(token_address)
    );

    CREATE INDEX IF NOT EXISTS idx_designated_claims_token ON designated_claims(token_address);
    CREATE INDEX IF NOT EXISTS idx_designated_claims_launcher ON designated_claims(original_launcher);
    CREATE INDEX IF NOT EXISTS idx_designated_claims_twitter ON designated_claims(designated_twitter);
    CREATE INDEX IF NOT EXISTS idx_designated_claims_github ON designated_claims(designated_github);
    CREATE INDEX IF NOT EXISTS idx_designated_claims_verified_wallet ON designated_claims(verified_wallet);
    CREATE INDEX IF NOT EXISTS idx_designated_claims_verified_embedded ON designated_claims(verified_embedded_wallet);

    -- Emission splits table for multi-claimer support
    CREATE TABLE IF NOT EXISTS emission_splits (
      id SERIAL PRIMARY KEY,
      token_address TEXT NOT NULL,
      recipient_wallet TEXT NOT NULL,
      split_percentage DECIMAL(5,2) NOT NULL,
      label TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,

      UNIQUE(token_address, recipient_wallet),
      CHECK(split_percentage > 0 AND split_percentage <= 100),
      FOREIGN KEY (token_address) REFERENCES token_launches(token_address) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_emission_splits_token ON emission_splits(token_address);
    CREATE INDEX IF NOT EXISTS idx_emission_splits_recipient ON emission_splits(recipient_wallet);

    -- Security tables for verification
    CREATE TABLE IF NOT EXISTS verification_challenges (
      id SERIAL PRIMARY KEY,
      wallet_address TEXT NOT NULL,
      challenge_nonce TEXT NOT NULL UNIQUE,
      challenge_message TEXT NOT NULL,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      used BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_verification_challenges_wallet ON verification_challenges(wallet_address);
    CREATE INDEX IF NOT EXISTS idx_verification_challenges_nonce ON verification_challenges(challenge_nonce);
    CREATE INDEX IF NOT EXISTS idx_verification_challenges_expires ON verification_challenges(expires_at);

    CREATE TABLE IF NOT EXISTS verification_audit_logs (
      id SERIAL PRIMARY KEY,
      event_type TEXT NOT NULL,
      token_address TEXT,
      wallet_address TEXT,
      social_twitter TEXT,
      social_github TEXT,
      ip_address TEXT,
      user_agent TEXT,
      error_message TEXT,
      metadata JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_logs_event ON verification_audit_logs(event_type);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_token ON verification_audit_logs(token_address);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_wallet ON verification_audit_logs(wallet_address);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON verification_audit_logs(created_at DESC);

    -- Add verification_lock column to designated_claims if not exists
    ALTER TABLE designated_claims ADD COLUMN IF NOT EXISTS verification_lock_until TIMESTAMP WITH TIME ZONE;
    ALTER TABLE designated_claims ADD COLUMN IF NOT EXISTS verification_attempts INTEGER DEFAULT 0;
    ALTER TABLE designated_claims ADD COLUMN IF NOT EXISTS last_verification_attempt TIMESTAMP WITH TIME ZONE;

    CREATE OR REPLACE FUNCTION update_token_holders_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
    END;
    $$ language 'plpgsql';

    DROP TRIGGER IF EXISTS update_token_holders_updated_at_trigger ON token_holders;
    CREATE TRIGGER update_token_holders_updated_at_trigger
        BEFORE UPDATE ON token_holders
        FOR EACH ROW
        EXECUTE FUNCTION update_token_holders_updated_at();

    CREATE TABLE IF NOT EXISTS presales (
      id SERIAL PRIMARY KEY,
      token_address TEXT NOT NULL UNIQUE,
      creator_wallet TEXT NOT NULL,
      token_name TEXT,
      token_symbol TEXT,
      token_metadata_url TEXT NOT NULL,
      presale_tokens JSONB,
      creator_twitter TEXT,
      creator_github TEXT,
      status TEXT DEFAULT 'pending' NOT NULL,
      escrow_pub_key TEXT,
      escrow_priv_key TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_presales_token_address ON presales(token_address);
    CREATE INDEX IF NOT EXISTS idx_presales_creator_wallet ON presales(creator_wallet);
    CREATE INDEX IF NOT EXISTS idx_presales_status ON presales(status);
    CREATE INDEX IF NOT EXISTS idx_presales_created_at ON presales(created_at DESC);

    -- Add escrow key columns if they don't exist (for existing databases)
    ALTER TABLE presales ADD COLUMN IF NOT EXISTS escrow_pub_key TEXT;
    ALTER TABLE presales ADD COLUMN IF NOT EXISTS escrow_priv_key TEXT;

    CREATE TABLE IF NOT EXISTS presale_bids (
      id SERIAL PRIMARY KEY,
      presale_id INTEGER NOT NULL REFERENCES presales(id) ON DELETE CASCADE,
      token_address TEXT NOT NULL,
      wallet_address TEXT NOT NULL,
      amount_lamports BIGINT NOT NULL,
      transaction_signature TEXT UNIQUE NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_presale_bids_presale_id ON presale_bids(presale_id);
    CREATE INDEX IF NOT EXISTS idx_presale_bids_token_address ON presale_bids(token_address);
    CREATE INDEX IF NOT EXISTS idx_presale_bids_wallet_address ON presale_bids(wallet_address);
    CREATE INDEX IF NOT EXISTS idx_presale_bids_transaction_signature ON presale_bids(transaction_signature);
    CREATE INDEX IF NOT EXISTS idx_presale_bids_created_at ON presale_bids(created_at DESC);

    -- Add verification fields if they don't exist (for existing databases)
    ALTER TABLE presale_bids ADD COLUMN IF NOT EXISTS block_time INTEGER;
    ALTER TABLE presale_bids ADD COLUMN IF NOT EXISTS slot BIGINT;
    ALTER TABLE presale_bids ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP WITH TIME ZONE;

    -- Validation function for emission splits total
    CREATE OR REPLACE FUNCTION validate_emission_splits_total()
    RETURNS TRIGGER AS $$
    DECLARE
      total_percentage DECIMAL(5,2);
    BEGIN
      SELECT COALESCE(SUM(split_percentage), 0) INTO total_percentage
      FROM emission_splits
      WHERE token_address = NEW.token_address;

      IF total_percentage > 100.00 THEN
        RAISE EXCEPTION 'Total emission splits exceed 100%% (currently: %%)', total_percentage;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    -- Create trigger for emission splits validation
    DROP TRIGGER IF EXISTS check_splits_total ON emission_splits;
    CREATE TRIGGER check_splits_total
      AFTER INSERT OR UPDATE ON emission_splits
      FOR EACH ROW
      EXECUTE FUNCTION validate_emission_splits_total();

    -- Note: No automatic backfill. Emission splits are opt-in via PR/admin configuration.
    -- The hasClaimRights() function falls back to creator_wallet for backwards compatibility.

    -- ICO Tables
    CREATE TABLE IF NOT EXISTS ico_sales (
      id SERIAL PRIMARY KEY,
      token_address TEXT NOT NULL UNIQUE,
      creator_wallet TEXT NOT NULL,
      token_metadata_url TEXT NOT NULL,
      total_tokens_for_sale BIGINT NOT NULL,
      token_price_sol TEXT NOT NULL,
      token_decimals INTEGER NOT NULL DEFAULT 9,
      status TEXT DEFAULT 'active' NOT NULL CHECK (status IN ('active', 'finalized')),
      escrow_pub_key TEXT,
      escrow_priv_key TEXT,
      vault_token_account TEXT,
      treasury_wallet TEXT,
      treasury_sol_amount BIGINT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ico_sales_token_address ON ico_sales(token_address);
    CREATE INDEX IF NOT EXISTS idx_ico_sales_creator_wallet ON ico_sales(creator_wallet);
    CREATE INDEX IF NOT EXISTS idx_ico_sales_status ON ico_sales(status);
    CREATE INDEX IF NOT EXISTS idx_ico_sales_created_at ON ico_sales(created_at DESC);

    -- Add token_decimals column if it doesn't exist (migration)
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'ico_sales' AND column_name = 'token_decimals'
      ) THEN
        ALTER TABLE ico_sales ADD COLUMN token_decimals INTEGER NOT NULL DEFAULT 9;
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS ico_purchases (
      id SERIAL PRIMARY KEY,
      ico_sale_id INTEGER NOT NULL REFERENCES ico_sales(id) ON DELETE CASCADE,
      wallet_address TEXT NOT NULL,
      sol_amount_lamports BIGINT NOT NULL,
      tokens_bought BIGINT NOT NULL,
      transaction_signature TEXT UNIQUE NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ico_purchases_ico_sale_id ON ico_purchases(ico_sale_id);
    CREATE INDEX IF NOT EXISTS idx_ico_purchases_wallet_address ON ico_purchases(wallet_address);
    CREATE INDEX IF NOT EXISTS idx_ico_purchases_transaction_signature ON ico_purchases(transaction_signature);
    CREATE INDEX IF NOT EXISTS idx_ico_purchases_created_at ON ico_purchases(created_at DESC);

    CREATE TABLE IF NOT EXISTS ico_claims (
      id SERIAL PRIMARY KEY,
      ico_sale_id INTEGER NOT NULL REFERENCES ico_sales(id) ON DELETE CASCADE,
      wallet_address TEXT NOT NULL,
      tokens_claimed BIGINT DEFAULT 0 NOT NULL,
      claim_transaction_signature TEXT,
      claimed_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
      UNIQUE(ico_sale_id, wallet_address)
    );

    CREATE INDEX IF NOT EXISTS idx_ico_claims_ico_sale_id ON ico_claims(ico_sale_id);
    CREATE INDEX IF NOT EXISTS idx_ico_claims_wallet_address ON ico_claims(wallet_address);
    CREATE INDEX IF NOT EXISTS idx_ico_claims_ico_sale_wallet ON ico_claims(ico_sale_id, wallet_address);
  `;

  try {
    await pool.query(createTableQuery);
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

// Cache management functions for mint transactions

export async function getCachedMintTransactions(
  tokenAddress: string
): Promise<MintTransaction[]> {
  const pool = getPool();

  const query = `
    SELECT id, signature, timestamp, token_address, wallet_address, amount, tx_data, created_at
    FROM mint_transactions
    WHERE token_address = $1
    ORDER BY timestamp ASC
  `;

  try {
    const result = await pool.query(query, [tokenAddress]);
    const transactions = result.rows.map(row => ({
      ...row,
      amount: BigInt(row.amount)
    }));

    // Special case: Filter out specific wallet for this token AFTER querying
    const SPECIAL_CASE_TOKEN = 'GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC';
    const IGNORED_WALLET = '3UwzWidPv4soJhGKdRXeXV4hwQ4vg6aZHhB6ZyP6x9X3';

    if (tokenAddress === SPECIAL_CASE_TOKEN) {
      return transactions.filter(tx => tx.wallet_address !== IGNORED_WALLET);
    }

    return transactions;
  } catch (error) {
    console.error('Error fetching cached mint transactions:', error);
    throw error;
  }
}

export async function storeMintTransaction(tx: Omit<MintTransaction, 'id' | 'created_at'>): Promise<void> {
  const pool = getPool();

  const query = `
    INSERT INTO mint_transactions (signature, timestamp, token_address, wallet_address, amount, tx_data)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (signature) DO NOTHING
  `;

  const values = [
    tx.signature,
    tx.timestamp,
    tx.token_address,
    tx.wallet_address,
    tx.amount.toString(), // Convert bigint to string for storage
    JSON.stringify(tx.tx_data)
  ];

  try {
    await pool.query(query, values);
  } catch (error) {
    console.error('Error storing mint transaction:', error);
    throw error;
  }
}

export async function batchStoreMintTransactions(transactions: Omit<MintTransaction, 'id' | 'created_at'>[]): Promise<void> {
  if (transactions.length === 0) return;

  const pool = getPool();

  // Build batch insert query
  const values: (string | number | bigint | Date)[] = [];
  const valueStrings: string[] = [];

  transactions.forEach((tx, index) => {
    const baseIndex = index * 6;
    valueStrings.push(`($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6})`);
    values.push(
      tx.signature,
      tx.timestamp,
      tx.token_address,
      tx.wallet_address,
      tx.amount.toString(),
      JSON.stringify(tx.tx_data)
    );
  });

  const query = `
    INSERT INTO mint_transactions (signature, timestamp, token_address, wallet_address, amount, tx_data)
    VALUES ${valueStrings.join(', ')}
    ON CONFLICT (signature) DO NOTHING
  `;

  try {
    await pool.query(query, values);
  } catch (error) {
    console.error('Error batch storing mint transactions:', error);
    throw error;
  }
}


export async function getTotalMintedFromCache(
  tokenAddress: string
): Promise<bigint> {
  const pool = getPool();

  const query = `
    SELECT wallet_address, COALESCE(SUM(amount::bigint), 0) as total
    FROM mint_transactions
    WHERE token_address = $1
    GROUP BY wallet_address
  `;

  try {
    const result = await pool.query(query, [tokenAddress]);

    // Special case: Filter out specific wallet for this token AFTER querying
    const SPECIAL_CASE_TOKEN = 'GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC';
    const IGNORED_WALLET = '3UwzWidPv4soJhGKdRXeXV4hwQ4vg6aZHhB6ZyP6x9X3';

    let totalMinted = BigInt(0);
    for (const row of result.rows) {
      // Skip ignored wallet for special case token
      if (tokenAddress === SPECIAL_CASE_TOKEN && row.wallet_address === IGNORED_WALLET) {
        continue;
      }
      totalMinted += BigInt(row.total);
    }

    return totalMinted;
  } catch (error) {
    console.error('Error calculating total minted from cache:', error);
    throw error;
  }
}

export async function getLatestCachedTransaction(): Promise<{ signature: string; timestamp: number } | null> {
  const pool = getPool();

  const query = `
    SELECT signature, timestamp
    FROM mint_transactions
    ORDER BY timestamp DESC
    LIMIT 1
  `;

  try {
    const result = await pool.query(query);
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Error fetching latest cached transaction:', error);
    throw error;
  }
}


/**
 * Check if ANY user has claimed this token within the specified time window
 * Returns true if a recent claim exists, false otherwise
 */
export async function hasRecentClaim(
  tokenAddress: string,
  minutesAgo: number = 360
): Promise<boolean> {
  const pool = getPool();

  const query = `
    SELECT COUNT(*) as count
    FROM claim_records
    WHERE token_address = $1
      AND confirmed_at > NOW() - INTERVAL '${minutesAgo} minutes'
  `;

  try {
    const result = await pool.query(query, [tokenAddress]);
    return parseInt(result.rows[0].count) > 0;
  } catch (error) {
    console.error('Error checking recent claims:', error);
    // Fail safe - if we can't check, assume they have claimed
    return true;
  }
}

/**
 * Check if a SPECIFIC wallet has claimed this token within the specified time window
 * Used for per-wallet claim cooldowns with emission splits
 * Returns true if wallet has a recent claim, false otherwise
 */
export async function hasRecentClaimByWallet(
  tokenAddress: string,
  walletAddress: string,
  minutesAgo: number = 360
): Promise<boolean> {
  const pool = getPool();

  const query = `
    SELECT COUNT(*) as count
    FROM claim_records
    WHERE token_address = $1
      AND wallet_address = $2
      AND confirmed_at > NOW() - INTERVAL '${minutesAgo} minutes'
  `;

  try {
    const result = await pool.query(query, [tokenAddress, walletAddress]);
    return parseInt(result.rows[0].count) > 0;
  } catch (error) {
    console.error('Error checking recent claims by wallet:', error);
    // Fail safe - if we can't check, assume they have claimed
    return true;
  }
}

/**
 * Get total amount claimed by a specific wallet for a token
 * Used to calculate remaining claimable amount with emission splits
 */
export async function getTotalClaimedByWallet(
  tokenAddress: string,
  walletAddress: string
): Promise<bigint> {
  const pool = getPool();

  const query = `
    SELECT COALESCE(SUM(CAST(amount AS BIGINT)), 0) as total
    FROM claim_records
    WHERE token_address = $1
      AND wallet_address = $2
      AND confirmed_at IS NOT NULL
  `;

  try {
    const result = await pool.query(query, [tokenAddress, walletAddress]);
    return BigInt(result.rows[0].total);
  } catch (error) {
    console.error('Error getting total claimed by wallet:', error);
    throw error;
  }
}

/**
 * Pre-record a claim attempt in the database with a placeholder signature
 * This prevents double-claiming by creating the DB record BEFORE signing
 * Returns a unique claim ID that can be used to update the record later
 */
export async function preRecordClaim(
  walletAddress: string,
  tokenAddress: string,
  amount: string
): Promise<string> {
  const pool = getPool();

  // Generate a unique placeholder signature
  const claimId = `PENDING_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

  const query = `
    INSERT INTO claim_records (wallet_address, token_address, amount, transaction_signature)
    VALUES ($1, $2, $3, $4)
    RETURNING id
  `;

  try {
    await pool.query(query, [walletAddress, tokenAddress, amount, claimId]);
    return claimId;
  } catch (error) {
    console.error('Error pre-recording claim:', error);
    // MUST throw to block the transaction
    throw new Error('Failed to pre-record claim - blocking transaction for safety');
  }
}

/**
 * Update a pre-recorded claim with the actual transaction signature
 */
export async function updateClaimSignature(
  claimId: string,
  transactionSignature: string
): Promise<void> {
  const pool = getPool();

  const query = `
    UPDATE claim_records
    SET transaction_signature = $1, confirmed_at = NOW()
    WHERE transaction_signature = $2
  `;

  try {
    await pool.query(query, [transactionSignature, claimId]);
  } catch (error) {
    console.error('Error updating claim signature:', error);
    // Log but don't throw - claim was already submitted successfully
  }
}

/**
 * Remove a failed pre-recorded claim
 */
export async function removeFailedClaim(claimId: string): Promise<void> {
  const pool = getPool();

  const query = `
    DELETE FROM claim_records
    WHERE transaction_signature = $1 AND transaction_signature LIKE 'PENDING_%'
  `;

  try {
    await pool.query(query, [claimId]);
  } catch (error) {
    console.error('Error removing failed claim:', error);
    // Log but don't throw
  }
}

// Token Holders Management Functions

export async function getTokenHolders(tokenAddress: string): Promise<TokenHolder[]> {
  // Use mock database if enabled
  if (shouldUseMockDatabase()) {
    return getMockDb().getTokenHolders(tokenAddress);
  }

  const pool = getPool();

  const query = `
    SELECT * FROM token_holders
    WHERE token_address = $1
    ORDER BY token_balance DESC
  `;

  try {
    const result = await pool.query(query, [tokenAddress]);
    return result.rows;
  } catch (error) {
    console.error('Error fetching token holders:', error);
    throw error;
  }
}

export async function upsertTokenHolder(holder: Omit<TokenHolder, 'id' | 'created_at' | 'updated_at'>): Promise<TokenHolder> {
  // Use mock database if enabled
  if (shouldUseMockDatabase()) {
    return getMockDb().upsertTokenHolder(holder);
  }

  const pool = getPool();

  const query = `
    INSERT INTO token_holders (
      token_address, wallet_address, token_balance, staked_balance,
      telegram_username, x_username, discord_username, custom_label, last_sync_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (token_address, wallet_address)
    DO UPDATE SET
      token_balance = EXCLUDED.token_balance,
      staked_balance = EXCLUDED.staked_balance,
      last_sync_at = EXCLUDED.last_sync_at,
      telegram_username = COALESCE(token_holders.telegram_username, EXCLUDED.telegram_username),
      x_username = COALESCE(token_holders.x_username, EXCLUDED.x_username),
      discord_username = COALESCE(token_holders.discord_username, EXCLUDED.discord_username),
      custom_label = COALESCE(token_holders.custom_label, EXCLUDED.custom_label)
    RETURNING *
  `;

  const values = [
    holder.token_address,
    holder.wallet_address,
    holder.token_balance,
    holder.staked_balance || '0',
    holder.telegram_username || null,
    holder.x_username || null,
    holder.discord_username || null,
    holder.custom_label || null,
    holder.last_sync_at || new Date()
  ];

  try {
    const result = await pool.query(query, values);
    return result.rows[0];
  } catch (error) {
    console.error('Error upserting token holder:', error);
    throw error;
  }
}

export async function batchUpsertTokenHolders(
  tokenAddress: string,
  holders: Array<{
    wallet_address: string;
    token_balance: string;
    staked_balance?: string;
  }>
): Promise<void> {
  if (holders.length === 0) return;

  // Use mock database if enabled
  if (shouldUseMockDatabase()) {
    return getMockDb().batchUpsertTokenHolders(tokenAddress, holders);
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const syncTime = new Date();

    // First, mark all existing holders as potentially stale
    await client.query(
      'UPDATE token_holders SET last_sync_at = $1 WHERE token_address = $2 AND last_sync_at != $1',
      [new Date(0), tokenAddress]
    );

    // Then upsert all current holders
    for (const holder of holders) {
      const query = `
        INSERT INTO token_holders (
          token_address, wallet_address, token_balance, staked_balance, last_sync_at
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (token_address, wallet_address)
        DO UPDATE SET
          token_balance = EXCLUDED.token_balance,
          staked_balance = EXCLUDED.staked_balance,
          last_sync_at = EXCLUDED.last_sync_at
        `;

      await client.query(query, [
        tokenAddress,
        holder.wallet_address,
        holder.token_balance,
        holder.staked_balance || '0',
        syncTime
      ]);
    }

    // Update holders who no longer have tokens to balance 0 (preserving labels)
    await client.query(
      'UPDATE token_holders SET token_balance = $3, staked_balance = $4 WHERE token_address = $1 AND last_sync_at = $2',
      [tokenAddress, new Date(0), '0', '0']
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error batch upserting token holders:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function updateTokenHolderLabels(
  tokenAddress: string,
  walletAddress: string,
  labels: {
    telegram_username?: string | null;
    x_username?: string | null;
    discord_username?: string | null;
    custom_label?: string | null;
  }
): Promise<TokenHolder | null> {
  // Use mock database if enabled
  if (shouldUseMockDatabase()) {
    return getMockDb().updateTokenHolderLabels(tokenAddress, walletAddress, labels);
  }

  const pool = getPool();

  const query = `
    UPDATE token_holders
    SET
      telegram_username = COALESCE($3, telegram_username),
      x_username = COALESCE($4, x_username),
      discord_username = COALESCE($5, discord_username),
      custom_label = COALESCE($6, custom_label)
    WHERE token_address = $1 AND wallet_address = $2
    RETURNING *
  `;

  try {
    const result = await pool.query(query, [
      tokenAddress,
      walletAddress,
      labels.telegram_username,
      labels.x_username,
      labels.discord_username,
      labels.custom_label
    ]);

    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Error updating token holder labels:', error);
    throw error;
  }
}

export async function getTokenHolderStats(tokenAddress: string): Promise<{
  totalHolders: number;
  totalBalance: string;
  lastSyncTime: Date | null;
}> {
  // Use mock database if enabled
  if (shouldUseMockDatabase()) {
    return getMockDb().getTokenHolderStats(tokenAddress);
  }

  const pool = getPool();

  const query = `
    SELECT
      COUNT(*) as total_holders,
      COALESCE(SUM(token_balance), 0) as total_balance,
      MAX(last_sync_at) as last_sync_time
    FROM token_holders
    WHERE token_address = $1
  `;

  try {
    const result = await pool.query(query, [tokenAddress]);
    const row = result.rows[0];

    return {
      totalHolders: parseInt(row.total_holders),
      totalBalance: row.total_balance || '0',
      lastSyncTime: row.last_sync_time
    };
  } catch (error) {
    console.error('Error fetching token holder stats:', error);
    throw error;
  }
}

export async function createDesignatedClaim(
  tokenAddress: string,
  originalLauncher: string,
  designatedTwitter?: string,
  designatedGithub?: string
): Promise<DesignatedClaim> {
  const pool = getPool();

  const query = `
    INSERT INTO designated_claims (
      token_address,
      original_launcher,
      designated_twitter,
      designated_github
    ) VALUES ($1, $2, $3, $4)
    ON CONFLICT (token_address) DO UPDATE SET
      designated_twitter = COALESCE(EXCLUDED.designated_twitter, designated_claims.designated_twitter),
      designated_github = COALESCE(EXCLUDED.designated_github, designated_claims.designated_github)
    RETURNING *
  `;

  try {
    const result = await pool.query(query, [
      tokenAddress,
      originalLauncher,
      designatedTwitter || null,
      designatedGithub || null
    ]);
    return result.rows[0];
  } catch (error) {
    console.error('Error creating designated claim:', error);
    throw error;
  }
}

export async function getDesignatedClaimByToken(tokenAddress: string): Promise<DesignatedClaim | null> {
  const pool = getPool();

  const query = `
    SELECT * FROM designated_claims
    WHERE token_address = $1
    LIMIT 1
  `;

  try {
    const result = await pool.query(query, [tokenAddress]);
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Error fetching designated claim:', error);
    throw error;
  }
}

export async function getDesignatedClaimsBySocials(
  twitterUsername?: string,
  githubUsername?: string
): Promise<DesignatedClaim[]> {
  const pool = getPool();

  if (!twitterUsername && !githubUsername) {
    return [];
  }

  const conditions: string[] = [];
  const values: string[] = [];
  let paramCount = 0;

  if (twitterUsername) {
    // Match multiple URL formats for Twitter
    const urlVariations = [
      `https://twitter.com/${twitterUsername}`,
      `https://x.com/${twitterUsername}`,
      `twitter.com/${twitterUsername}`,
      `x.com/${twitterUsername}`
    ];

    const orConditions = urlVariations.map(() => {
      paramCount++;
      return `designated_twitter = $${paramCount}`;
    }).join(' OR ');

    conditions.push(`(${orConditions})`);
    values.push(...urlVariations);
  }

  if (githubUsername) {
    // Match multiple URL formats for GitHub
    const githubVariations = [
      `https://github.com/${githubUsername}`,
      `github.com/${githubUsername}`
    ];

    const orConditions = githubVariations.map(() => {
      paramCount++;
      return `designated_github = $${paramCount}`;
    }).join(' OR ');

    conditions.push(`(${orConditions})`);
    values.push(...githubVariations);
  }

  const query = `
    SELECT * FROM designated_claims
    WHERE ${conditions.join(' OR ')}
    AND verified_wallet IS NULL
  `;

  try {
    const result = await pool.query(query, values);
    return result.rows;
  } catch (error) {
    console.error('Error fetching designated claims by socials:', error);
    throw error;
  }
}

export async function verifyDesignatedClaim(
  tokenAddress: string,
  verifiedWallet: string,
  embeddedWallet?: string
): Promise<DesignatedClaim | null> {
  const pool = getPool();

  const query = `
    UPDATE designated_claims
    SET
      verified_wallet = $2,
      verified_embedded_wallet = $3,
      verified_at = NOW()
    WHERE token_address = $1
    RETURNING *
  `;

  try {
    const result = await pool.query(query, [
      tokenAddress,
      verifiedWallet,
      embeddedWallet || null
    ]);
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Error verifying designated claim:', error);
    throw error;
  }
}

export async function getVerifiedClaimWallets(tokenAddress: string): Promise<{
  verifiedWallet: string | null;
  embeddedWallet: string | null;
  originalLauncher: string | null;
}> {
  const pool = getPool();

  const query = `
    SELECT verified_wallet, verified_embedded_wallet, original_launcher
    FROM designated_claims
    WHERE token_address = $1
  `;

  try {
    const result = await pool.query(query, [tokenAddress]);
    if (result.rows.length === 0) {
      return { verifiedWallet: null, embeddedWallet: null, originalLauncher: null };
    }

    return {
      verifiedWallet: result.rows[0].verified_wallet,
      embeddedWallet: result.rows[0].verified_embedded_wallet,
      originalLauncher: result.rows[0].original_launcher
    };
  } catch (error) {
    console.error('Error fetching verified claim wallets:', error);
    throw error;
  }
}

// Security-enhanced verification functions

export async function createVerificationChallenge(
  walletAddress: string,
  challengeNonce: string,
  challengeMessage: string,
  expiresAt: Date
): Promise<{ id: number }> {
  const pool = getPool();

  const query = `
    INSERT INTO verification_challenges (
      wallet_address,
      challenge_nonce,
      challenge_message,
      expires_at
    ) VALUES ($1, $2, $3, $4)
    RETURNING id
  `;

  try {
    const result = await pool.query(query, [
      walletAddress,
      challengeNonce,
      challengeMessage,
      expiresAt
    ]);
    return result.rows[0];
  } catch (error) {
    console.error('Error creating verification challenge:', error);
    throw error;
  }
}

export async function getVerificationChallenge(
  challengeNonce: string
): Promise<VerificationChallenge | null> {
  const pool = getPool();

  const query = `
    SELECT * FROM verification_challenges
    WHERE challenge_nonce = $1
      AND expires_at > NOW()
      AND used = FALSE
  `;

  try {
    const result = await pool.query(query, [challengeNonce]);
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Error fetching verification challenge:', error);
    throw error;
  }
}

export async function markChallengeUsed(challengeNonce: string): Promise<void> {
  const pool = getPool();

  const query = `
    UPDATE verification_challenges
    SET used = TRUE
    WHERE challenge_nonce = $1
  `;

  try {
    await pool.query(query, [challengeNonce]);
  } catch (error) {
    console.error('Error marking challenge as used:', error);
    throw error;
  }
}

export async function acquireVerificationLockDB(
  tokenAddress: string,
  lockDurationMs = 30000
): Promise<boolean> {
  const pool = getPool();

  const query = `
    UPDATE designated_claims
    SET verification_lock_until = NOW() + ($2::INTEGER * INTERVAL '1 millisecond')
    WHERE token_address = $1
      AND (verification_lock_until IS NULL OR verification_lock_until < NOW())
    RETURNING token_address
  `;

  try {
    const result = await pool.query(query, [tokenAddress, lockDurationMs]);
    return result.rows.length > 0;
  } catch (error) {
    console.error('Error acquiring verification lock:', error);
    throw error;
  }
}

export async function releaseVerificationLockDB(tokenAddress: string): Promise<void> {
  const pool = getPool();

  const query = `
    UPDATE designated_claims
    SET verification_lock_until = NULL
    WHERE token_address = $1
  `;

  try {
    await pool.query(query, [tokenAddress]);
  } catch (error) {
    console.error('Error releasing verification lock:', error);
    throw error;
  }
}

export async function incrementVerificationAttempts(tokenAddress: string): Promise<void> {
  const pool = getPool();

  const query = `
    UPDATE designated_claims
    SET
      verification_attempts = COALESCE(verification_attempts, 0) + 1,
      last_verification_attempt = NOW()
    WHERE token_address = $1
  `;

  try {
    await pool.query(query, [tokenAddress]);
  } catch (error) {
    console.error('Error incrementing verification attempts:', error);
    throw error;
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// Presale Management Functions

// ============================================================================
// Presale Functions (delegated to presales module)
// ============================================================================

export async function createPresale(presale: Omit<Presale, 'id' | 'created_at' | 'status'>): Promise<Presale> {
  return presalesModule.createPresale(getPool(), presale);
}

export async function getPresaleByTokenAddress(tokenAddress: string): Promise<Presale | null> {
  // Use mock database if enabled
  if (shouldUseMockDatabase()) {
    return getMockDb().getPresaleByTokenAddress(tokenAddress);
  }
  return presalesModule.getPresaleByTokenAddress(getPool(), tokenAddress);
}

export async function updatePresaleStatus(
  tokenAddress: string,
  status: string,
  baseMintAddress?: string,
  tokensBought?: string
): Promise<Presale | null> {
  return presalesModule.updatePresaleStatus(getPool(), tokenAddress, status, baseMintAddress, tokensBought);
}

export async function getPresalesByCreatorWallet(creatorWallet: string, limit = 100): Promise<Presale[]> {
  // Use mock database if enabled
  if (shouldUseMockDatabase()) {
    // Filter mock presales by creator wallet
    const { MOCK_PRESALES } = await import('./mock/mockData');
    return MOCK_PRESALES.filter(p => p.creator_wallet === creatorWallet).slice(0, limit);
  }

  return presalesModule.getPresalesByCreatorWallet(getPool(), creatorWallet, limit);
}

export async function recordPresaleBid(bid: Omit<PresaleBid, 'id' | 'created_at'>): Promise<PresaleBid> {
  return presalesModule.recordPresaleBid(getPool(), bid);
}

export async function getPresaleBidBySignature(transactionSignature: string): Promise<PresaleBid | null> {
  return presalesModule.getPresaleBidBySignature(getPool(), transactionSignature);
}

export async function getPresaleBids(tokenAddress: string): Promise<PresaleBid[]> {
  // Use mock database if enabled
  if (shouldUseMockDatabase()) {
    return getMockDb().getPresaleBids(tokenAddress);
  }
  return presalesModule.getPresaleBids(getPool(), tokenAddress);
}

export async function getTotalPresaleBids(tokenAddress: string): Promise<{
  totalBids: number;
  totalAmount: bigint;
}> {
  // Use mock database if enabled
  if (shouldUseMockDatabase()) {
    return getMockDb().getTotalPresaleBids(tokenAddress);
  }
  return presalesModule.getTotalPresaleBids(getPool(), tokenAddress);
}

export async function getUserPresaleContribution(
  tokenAddress: string,
  walletAddress: string
): Promise<bigint> {
  // Use mock database if enabled
  if (shouldUseMockDatabase()) {
    return getMockDb().getUserPresaleContribution(tokenAddress, walletAddress);
  }
  return presalesModule.getUserPresaleContribution(getPool(), tokenAddress, walletAddress);
}

export async function updatePresaleTokensBought(
  tokenAddress: string,
  tokensBought: string
): Promise<void> {
  return presalesModule.updatePresaleTokensBought(getPool(), tokenAddress, tokensBought);
}

export async function getPresaleClaimByWallet(
  presaleId: number,
  walletAddress: string
): Promise<PresaleClaim | null> {
  return presalesModule.getPresaleClaimByWallet(getPool(), presaleId, walletAddress);
}

export async function createOrUpdatePresaleClaim(
  claim: Omit<PresaleClaim, 'id' | 'created_at' | 'updated_at' | 'tokens_claimed' | 'last_claim_at'>
): Promise<PresaleClaim> {
  return presalesModule.createOrUpdatePresaleClaim(getPool(), claim);
}

export async function recordPresaleClaimTransaction(
  transaction: Omit<PresaleClaimTransaction, 'id' | 'created_at'>
): Promise<PresaleClaimTransaction> {
  return presalesModule.recordPresaleClaimTransaction(getPool(), transaction);
}

export async function updatePresaleClaimAmount(
  presaleId: number,
  walletAddress: string,
  amountClaimed: string
): Promise<void> {
  return presalesModule.updatePresaleClaimAmount(getPool(), presaleId, walletAddress, amountClaimed);
}

export async function getPresaleClaimsByPresale(presaleId: number): Promise<PresaleClaim[]> {
  return presalesModule.getPresaleClaimsByPresale(getPool(), presaleId);
}

// ========================================
// Emission Splits Functions
// ========================================

/**
 * Create emission splits for a token
 * Called during token launch to configure multiple claimers
 * @param tokenAddress - The token address
 * @param splits - Array of split configurations
 * @returns Array of created emission splits
 */
// ============================================================================
// Emission Splits Functions (delegated to emission-splits module)
// ============================================================================

export async function createEmissionSplits(
  tokenAddress: string,
  splits: Array<{
    recipient_wallet: string;
    split_percentage: number;
    label?: string;
  }>
): Promise<EmissionSplit[]> {
  return emissionSplitsModule.createEmissionSplits(getPool(), tokenAddress, splits);
}

export async function getEmissionSplits(tokenAddress: string): Promise<EmissionSplit[]> {
  return emissionSplitsModule.getEmissionSplits(getPool(), tokenAddress);
}

export async function getWalletEmissionSplit(
  tokenAddress: string,
  walletAddress: string
): Promise<EmissionSplit | null> {
  return emissionSplitsModule.getWalletEmissionSplit(getPool(), tokenAddress, walletAddress);
}

export async function hasClaimRights(
  tokenAddress: string,
  walletAddress: string
): Promise<boolean> {
  return emissionSplitsModule.hasClaimRights(
    getPool(),
    tokenAddress,
    walletAddress,
    getTokenLaunchByAddress
  );
}

export async function getTokensWithClaimRights(walletAddress: string): Promise<TokenLaunch[]> {
  return emissionSplitsModule.getTokensWithClaimRights(getPool(), walletAddress);
}

// Contributions
export async function getContributions(): Promise<Contribution[]> {
  const pool = getPool();

  const query = `
    SELECT
      id,
      discord_id,
      pr,
      reward_zc,
      reward_usd,
      time,
      created_at
    FROM zc_contributions
    ORDER BY time DESC
  `;

  try {
    const result = await pool.query(query);
    return result.rows;
  } catch (error) {
    console.error('Error fetching contributions:', error);
    throw error;
  }
}

// ============================================================================
// ICO Functions (delegated to ico module)
// ============================================================================

export async function createIcoSale(
  sale: Omit<IcoSale, 'id' | 'created_at' | 'status'>
): Promise<IcoSale> {
  return icoModule.createIcoSale(getPool(), sale);
}

export async function isPurchaseSignatureProcessed(signature: string): Promise<boolean> {
  return icoModule.isPurchaseSignatureProcessed(getPool(), signature);
}

export async function isClaimSignatureProcessed(signature: string): Promise<boolean> {
  return icoModule.isClaimSignatureProcessed(getPool(), signature);
}

export async function getIcoSaleByTokenAddress(tokenAddress: string): Promise<icoModule.IcoSaleWithStats | null> {
  return icoModule.getIcoSaleByTokenAddress(getPool(), tokenAddress);
}

export async function getIcoSaleById(id: number): Promise<icoModule.IcoSaleWithStats | null> {
  return icoModule.getIcoSaleById(getPool(), id);
}

export async function updateIcoSaleStatus(
  tokenAddress: string,
  status: 'active' | 'finalized'
): Promise<IcoSale | null> {
  return icoModule.updateIcoSaleStatus(getPool(), tokenAddress, status);
}

export async function recordIcoPurchase(
  purchase: Omit<IcoPurchase, 'id' | 'created_at'>
): Promise<IcoPurchase> {
  return icoModule.recordIcoPurchase(getPool(), purchase);
}

export async function getIcoPurchasesByWallet(
  tokenAddress: string,
  walletAddress: string
): Promise<IcoPurchase[]> {
  return icoModule.getIcoPurchasesByWallet(getPool(), tokenAddress, walletAddress);
}

export async function getAllIcoPurchases(tokenAddress: string): Promise<IcoPurchase[]> {
  return icoModule.getAllIcoPurchases(getPool(), tokenAddress);
}

export async function getIcoClaimByWallet(
  tokenAddress: string,
  walletAddress: string
): Promise<IcoClaim | null> {
  return icoModule.getIcoClaimByWallet(getPool(), tokenAddress, walletAddress);
}

export async function updateIcoClaim(
  icoSaleId: number,
  walletAddress: string,
  tokensClaimed: bigint,
  claimSignature: string
): Promise<IcoClaim | null> {
  return icoModule.updateIcoClaim(getPool(), icoSaleId, walletAddress, tokensClaimed, claimSignature);
}

export async function getAllIcoClaims(tokenAddress: string): Promise<IcoClaim[]> {
  return icoModule.getAllIcoClaims(getPool(), tokenAddress);
}