-- Update DAO withdrawal percentage cap from 50% to 99%.
-- Run with: psql $DB_URL -f scripts/migrations/003_withdrawal_percentage_cap_99.sql

ALTER TABLE cmb_daos
  ALTER COLUMN withdrawal_percentage SET DEFAULT 50;

ALTER TABLE cmb_daos
  DROP CONSTRAINT IF EXISTS cmb_daos_withdrawal_percentage_check;

ALTER TABLE cmb_daos
  DROP CONSTRAINT IF EXISTS chk_withdrawal_percentage;

ALTER TABLE cmb_daos
  ADD CONSTRAINT chk_withdrawal_percentage
  CHECK (withdrawal_percentage >= 1 AND withdrawal_percentage <= 99);
