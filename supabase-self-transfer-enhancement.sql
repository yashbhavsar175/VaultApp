-- Enhancement for Self-Transfer Detection
-- Add columns to support transfer tracking between user's own accounts

-- Add transfer-related columns to transactions table
ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS from_account_id UUID REFERENCES bank_accounts(id),
ADD COLUMN IF NOT EXISTS to_account_id UUID REFERENCES bank_accounts(id),
ADD COLUMN IF NOT EXISTS account_last4 TEXT,
ADD COLUMN IF NOT EXISTS is_transfer_pending BOOLEAN DEFAULT FALSE;

-- Update the type check constraint to include 'transfer'
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE transactions 
ADD CONSTRAINT transactions_type_check 
CHECK (type IN ('income', 'expense', 'investment', 'emi', 'lent', 'borrowed', 'transfer'));

-- Create index for transfer matching (amount + reference + time window)
CREATE INDEX IF NOT EXISTS idx_transactions_transfer_match 
ON transactions(user_id, amount, reference_number, created_at DESC) 
WHERE reference_number IS NOT NULL;

-- Create index for pending transfer detection
CREATE INDEX IF NOT EXISTS idx_transactions_pending_transfers 
ON transactions(user_id, amount, type, created_at DESC) 
WHERE is_transfer_pending = TRUE;

-- Create index for account last 4 digits lookup
CREATE INDEX IF NOT EXISTS idx_transactions_account_last4 
ON transactions(account_last4) 
WHERE account_last4 IS NOT NULL;

-- Create index for bank_accounts last 4 digits lookup
CREATE INDEX IF NOT EXISTS idx_bank_accounts_last4 
ON bank_accounts(account_last4);

-- Add comments for documentation
COMMENT ON COLUMN transactions.from_account_id IS 'Source bank account for transfers';
COMMENT ON COLUMN transactions.to_account_id IS 'Destination bank account for transfers';
COMMENT ON COLUMN transactions.account_last4 IS 'Last 4 digits of account mentioned in SMS';
COMMENT ON COLUMN transactions.is_transfer_pending IS 'True if waiting for matching transfer SMS';

-- Function to update bank account balances on transfer
CREATE OR REPLACE FUNCTION update_bank_balances_on_transfer()
RETURNS TRIGGER AS $$
BEGIN
  -- Only process if it's a transfer with both accounts
  IF NEW.type = 'transfer' AND NEW.from_account_id IS NOT NULL AND NEW.to_account_id IS NOT NULL THEN
    
    -- Decrease balance from source account
    UPDATE bank_accounts 
    SET balance = balance - NEW.amount
    WHERE id = NEW.from_account_id;
    
    -- Increase balance in destination account
    UPDATE bank_accounts 
    SET balance = balance + NEW.amount
    WHERE id = NEW.to_account_id;
    
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic balance updates
DROP TRIGGER IF EXISTS trigger_update_balances_on_transfer ON transactions;
CREATE TRIGGER trigger_update_balances_on_transfer
  AFTER INSERT ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_bank_balances_on_transfer();

-- Verification query
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'transactions' 
AND column_name IN ('from_account_id', 'to_account_id', 'account_last4', 'is_transfer_pending');
