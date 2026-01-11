-- Migration: Add funding_signature column to cmb_daos for anti-drainage protection
-- Run with: psql $DB_URL -f scripts/migrations/004_dao_funding_signature.sql

-- Add funding_signature column to track the SOL transfer transaction that funded DAO creation
-- This prevents replay attacks where the same funding tx is used for multiple DAOs
ALTER TABLE cmb_daos ADD COLUMN IF NOT EXISTS funding_signature TEXT;

-- Create unique index to prevent duplicate funding signatures
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmb_daos_funding_signature ON cmb_daos(funding_signature) WHERE funding_signature IS NOT NULL;

-- Verify installation
\echo 'Funding signature migration completed successfully!'
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'cmb_daos' AND column_name = 'funding_signature';
