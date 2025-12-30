-- Migration: Add proposer token threshold to DAOs
-- Run with: psql $DB_URL -f scripts/migrations/003_proposer_threshold.sql

-- Add proposer_token_threshold column to cmb_daos
-- This is the minimum token balance required to be eligible as a proposer
-- NULL means no token holding requirement (only wallet whitelist applies)
-- Each DAO (parent or child) has its own threshold, separate from parent
ALTER TABLE cmb_daos ADD COLUMN IF NOT EXISTS proposer_token_threshold TEXT;

-- Verify installation
\echo 'Proposer threshold migration completed successfully!'
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'cmb_daos'
  AND column_name = 'proposer_token_threshold';
