-- Migration: Add DAO management tables
-- Run with: psql $DB_URL -f scripts/migrations/002_daos.sql

-- Key registry: tracks managed wallet key indices
CREATE TABLE IF NOT EXISTS cmb_key_registry (
  id SERIAL PRIMARY KEY,
  key_idx INTEGER NOT NULL UNIQUE,
  public_key TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL,  -- 'dao_parent', 'dao_child'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cmb_key_registry_idx ON cmb_key_registry(key_idx);
CREATE INDEX IF NOT EXISTS idx_cmb_key_registry_public_key ON cmb_key_registry(public_key);

-- DAOs table: tracks all DAOs created via this API
CREATE TABLE IF NOT EXISTS cmb_daos (
  id SERIAL PRIMARY KEY,

  -- On-chain identifiers
  dao_pda TEXT NOT NULL UNIQUE,
  dao_name TEXT NOT NULL,
  moderator_pda TEXT,

  -- Ownership
  owner_wallet TEXT NOT NULL,  -- Client who "owns" this DAO (logical)
  admin_key_idx INTEGER NOT NULL REFERENCES cmb_key_registry(key_idx),
  admin_wallet TEXT NOT NULL,  -- Public key of managed wallet

  -- Token/Pool config
  token_mint TEXT NOT NULL,
  pool_address TEXT NOT NULL,
  pool_type TEXT NOT NULL CHECK (pool_type IN ('damm', 'dlmm')),
  quote_mint TEXT NOT NULL,

  -- Multisigs (from Squads)
  treasury_multisig TEXT NOT NULL,
  mint_auth_multisig TEXT NOT NULL,
  treasury_cosigner TEXT NOT NULL,  -- Client's cosigner key

  -- Hierarchy
  parent_dao_id INTEGER REFERENCES cmb_daos(id),
  dao_type TEXT NOT NULL CHECK (dao_type IN ('parent', 'child')),

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cmb_daos_owner ON cmb_daos(owner_wallet);
CREATE INDEX IF NOT EXISTS idx_cmb_daos_pda ON cmb_daos(dao_pda);
CREATE INDEX IF NOT EXISTS idx_cmb_daos_parent ON cmb_daos(parent_dao_id);
CREATE INDEX IF NOT EXISTS idx_cmb_daos_token ON cmb_daos(token_mint);
CREATE INDEX IF NOT EXISTS idx_cmb_daos_moderator ON cmb_daos(moderator_pda);
CREATE INDEX IF NOT EXISTS idx_cmb_daos_type ON cmb_daos(dao_type);

-- Proposer whitelist (off-chain enforcement)
CREATE TABLE IF NOT EXISTS cmb_dao_proposers (
  id SERIAL PRIMARY KEY,
  dao_id INTEGER NOT NULL REFERENCES cmb_daos(id) ON DELETE CASCADE,
  proposer_wallet TEXT NOT NULL,
  added_by TEXT NOT NULL,  -- Owner wallet who added this proposer
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,

  UNIQUE(dao_id, proposer_wallet)
);

CREATE INDEX IF NOT EXISTS idx_cmb_dao_proposers_dao ON cmb_dao_proposers(dao_id);
CREATE INDEX IF NOT EXISTS idx_cmb_dao_proposers_wallet ON cmb_dao_proposers(proposer_wallet);

-- Update key_registry to link to daos after daos table exists
ALTER TABLE cmb_key_registry ADD COLUMN IF NOT EXISTS dao_id INTEGER REFERENCES cmb_daos(id);

-- Verify installation
\echo 'DAOs migration completed successfully!'
\echo 'Verifying installation...'
SELECT
  'cmb_key_registry table' AS object,
  CASE WHEN COUNT(*) > 0 THEN 'EXISTS' ELSE 'MISSING' END AS status
FROM information_schema.tables
WHERE table_name = 'cmb_key_registry'
UNION ALL
SELECT
  'cmb_daos table' AS object,
  CASE WHEN COUNT(*) > 0 THEN 'EXISTS' ELSE 'MISSING' END AS status
FROM information_schema.tables
WHERE table_name = 'cmb_daos'
UNION ALL
SELECT
  'cmb_dao_proposers table' AS object,
  CASE WHEN COUNT(*) > 0 THEN 'EXISTS' ELSE 'MISSING' END AS status
FROM information_schema.tables
WHERE table_name = 'cmb_dao_proposers';
