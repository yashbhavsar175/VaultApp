-- Dev seed-data guard for transactions.
-- Run once in Supabase SQL Editor before using Settings > Developer seed tools.

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS is_seed boolean DEFAULT false;

ALTER TABLE transactions
  ALTER COLUMN is_seed SET DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_transactions_user_seed
  ON transactions(user_id, is_seed)
  WHERE is_seed = true;
