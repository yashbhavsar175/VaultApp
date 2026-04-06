-- Add account_id column to transactions table for UI compatibility
-- This column stores the primary account associated with the transaction

ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES bank_accounts(id);

-- Create index for account_id lookups
CREATE INDEX IF NOT EXISTS idx_transactions_account_id 
ON transactions(account_id) 
WHERE account_id IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN transactions.account_id IS 'Primary bank account associated with this transaction (for UI compatibility)';

-- For existing transactions, populate account_id from from_account_id or to_account_id
UPDATE transactions
SET account_id = COALESCE(from_account_id, to_account_id)
WHERE account_id IS NULL 
  AND (from_account_id IS NOT NULL OR to_account_id IS NOT NULL);
