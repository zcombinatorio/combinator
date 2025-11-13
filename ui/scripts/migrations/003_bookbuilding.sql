-- Migration: Add bookbuilding tables for open bidding mechanism
-- Run with: psql $DB_URL -f scripts/migrations/003_bookbuilding.sql

-- Create bookbuildings table
CREATE TABLE IF NOT EXISTS bookbuildings (
  id SERIAL PRIMARY KEY,
  token_address TEXT NOT NULL UNIQUE,
  token_supply BIGINT NOT NULL,
  token_decimals INT NOT NULL,
  creator_wallet TEXT NOT NULL,
  contribution_token_mint TEXT NOT NULL,
  contribution_token_decimals INT NOT NULL,
  vesting_duration_seconds BIGINT NOT NULL,
  vesting_cliff_seconds BIGINT DEFAULT 0,
  clearing_fdv BIGINT,
  amm_pool_address TEXT,
  escrow_public_key TEXT NOT NULL,
  escrow_priv_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
  launched_at TIMESTAMP WITH TIME ZONE,

  CHECK(status IN ('pending', 'launched')),
  CHECK(vesting_duration_seconds > 0),
  CHECK(vesting_cliff_seconds >= 0),
  CHECK(vesting_cliff_seconds < vesting_duration_seconds)
);

COMMENT ON TABLE bookbuildings IS 'Bookbuilding sales with open bidding mechanism';
COMMENT ON COLUMN bookbuildings.token_address IS 'Token mint address (created beforehand by protocol)';
COMMENT ON COLUMN bookbuildings.token_supply IS 'Total token supply (e.g., 1000000000 for 1B)';
COMMENT ON COLUMN bookbuildings.escrow_priv_key IS 'Encrypted escrow private key (for contribution tokens)';
COMMENT ON COLUMN bookbuildings.status IS 'Status: pending (bidding open) or launched (closed)';

CREATE INDEX IF NOT EXISTS idx_bookbuildings_token_address ON bookbuildings(token_address);
CREATE INDEX IF NOT EXISTS idx_bookbuildings_creator_wallet ON bookbuildings(creator_wallet);
CREATE INDEX IF NOT EXISTS idx_bookbuildings_status ON bookbuildings(status);

-- Create bookbuilding_bids table
CREATE TABLE IF NOT EXISTS bookbuilding_bids (
  id SERIAL PRIMARY KEY,
  bookbuilding_id INT NOT NULL REFERENCES bookbuildings(id) ON DELETE CASCADE,
  user_wallet TEXT NOT NULL,
  bid_amount BIGINT NOT NULL,
  max_fdv BIGINT NOT NULL,
  transaction_signature TEXT NOT NULL UNIQUE,
  withdrawn BOOLEAN DEFAULT false,
  withdrawal_signature TEXT,
  qualifying BOOLEAN,
  tokens_allocated BIGINT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,

  CHECK(bid_amount > 0),
  CHECK(max_fdv > 0)
);

COMMENT ON TABLE bookbuilding_bids IS 'User bids for bookbuilding sales';
COMMENT ON COLUMN bookbuilding_bids.bid_amount IS 'Contribution amount in token smallest units (not lamports)';
COMMENT ON COLUMN bookbuilding_bids.max_fdv IS 'Maximum acceptable FDV in contribution token smallest units';
COMMENT ON COLUMN bookbuilding_bids.qualifying IS 'Whether this bid qualifies at chosen clearing FDV (set at launch)';

CREATE INDEX IF NOT EXISTS idx_bookbuilding_bids_bookbuilding_id ON bookbuilding_bids(bookbuilding_id);
CREATE INDEX IF NOT EXISTS idx_bookbuilding_bids_user_wallet ON bookbuilding_bids(user_wallet);
CREATE INDEX IF NOT EXISTS idx_bookbuilding_bids_withdrawn ON bookbuilding_bids(withdrawn);
CREATE INDEX IF NOT EXISTS idx_bookbuilding_bids_qualifying ON bookbuilding_bids(qualifying);
CREATE INDEX IF NOT EXISTS idx_bookbuilding_bids_transaction_signature ON bookbuilding_bids(transaction_signature);

-- Create bookbuilding_claims table
CREATE TABLE IF NOT EXISTS bookbuilding_claims (
  id SERIAL PRIMARY KEY,
  bookbuilding_id INT NOT NULL REFERENCES bookbuildings(id) ON DELETE CASCADE,
  user_wallet TEXT NOT NULL,
  tokens_allocated BIGINT NOT NULL,
  tokens_claimed BIGINT DEFAULT 0,
  vesting_start_at TIMESTAMP WITH TIME ZONE NOT NULL,
  last_claim_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,

  UNIQUE(bookbuilding_id, user_wallet),
  CHECK(tokens_allocated > 0),
  CHECK(tokens_claimed >= 0),
  CHECK(tokens_claimed <= tokens_allocated)
);

COMMENT ON TABLE bookbuilding_claims IS 'Vesting claims for qualifying bookbuilding participants';
COMMENT ON COLUMN bookbuilding_claims.tokens_allocated IS 'Total tokens allocated to user (vested over time)';
COMMENT ON COLUMN bookbuilding_claims.tokens_claimed IS 'Tokens already claimed by user';

CREATE INDEX IF NOT EXISTS idx_bookbuilding_claims_bookbuilding_id ON bookbuilding_claims(bookbuilding_id);
CREATE INDEX IF NOT EXISTS idx_bookbuilding_claims_user_wallet ON bookbuilding_claims(user_wallet);

-- Verify installation
\echo 'Bookbuilding migration completed successfully!'
\echo 'Verifying installation...'
SELECT
  'bookbuildings table' AS object,
  CASE WHEN COUNT(*) > 0 THEN 'EXISTS' ELSE 'MISSING' END AS status
FROM information_schema.tables
WHERE table_name = 'bookbuildings'
UNION ALL
SELECT
  'bookbuilding_bids table' AS object,
  CASE WHEN COUNT(*) > 0 THEN 'EXISTS' ELSE 'MISSING' END AS status
FROM information_schema.tables
WHERE table_name = 'bookbuilding_bids'
UNION ALL
SELECT
  'bookbuilding_claims table' AS object,
  CASE WHEN COUNT(*) > 0 THEN 'EXISTS' ELSE 'MISSING' END AS status
FROM information_schema.tables
WHERE table_name = 'bookbuilding_claims';
