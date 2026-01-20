-- Add proposer holding period column for time-weighted token balance requirements
-- When set, users must have held on average at least the threshold amount over this period to propose

ALTER TABLE cmb_daos
ADD COLUMN IF NOT EXISTS proposer_holding_period_hours INTEGER
CHECK (proposer_holding_period_hours IS NULL OR proposer_holding_period_hours > 0);
