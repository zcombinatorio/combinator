-- Migration: Add withdrawal_percentage to DAOs
-- Run with: psql $DB_URL -f scripts/migrations/003_dao_withdrawal_percentage.sql

-- Add withdrawal_percentage column with default of 12%
-- Valid range: 1-50 (enforced at application level)
ALTER TABLE cmb_daos
ADD COLUMN IF NOT EXISTS withdrawal_percentage INTEGER NOT NULL DEFAULT 12;

-- Add constraint to ensure valid percentage range (5-50%)
ALTER TABLE cmb_daos
ADD CONSTRAINT chk_withdrawal_percentage
CHECK (withdrawal_percentage >= 5 AND withdrawal_percentage <= 50);

-- Verify installation
\echo 'Withdrawal percentage migration completed successfully!'
SELECT
  column_name,
  data_type,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'cmb_daos'
  AND column_name = 'withdrawal_percentage';
