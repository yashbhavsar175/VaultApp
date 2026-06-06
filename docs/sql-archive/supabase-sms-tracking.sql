-- Add SMS tracking columns to transactions table
ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS sms_source TEXT CHECK (sms_source IN ('bank', 'upi', 'sms', 'manual', 'notification')),
ADD COLUMN IF NOT EXISTS sms_sender TEXT,
ADD COLUMN IF NOT EXISTS raw_sms TEXT,
ADD COLUMN IF NOT EXISTS reference_number TEXT,
ADD COLUMN IF NOT EXISTS balance DECIMAL(12,2);

-- Keep existing databases aligned with every source value the app can write.
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_sms_source_check;
ALTER TABLE transactions 
ADD CONSTRAINT transactions_sms_source_check 
CHECK (sms_source IS NULL OR sms_source IN ('bank', 'upi', 'sms', 'manual', 'notification'));

-- Create index for duplicate detection (amount + timestamp)
CREATE INDEX IF NOT EXISTS idx_transactions_duplicate_check 
ON transactions(user_id, amount, created_at DESC);

-- Create index for reference number lookups
CREATE INDEX IF NOT EXISTS idx_transactions_reference 
ON transactions(reference_number) WHERE reference_number IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN transactions.sms_source IS 'Entry source: bank, upi, sms, manual, or notification';
COMMENT ON COLUMN transactions.sms_sender IS 'SMS sender ID (e.g., AD-HDFCBK, VK-PAYTMB)';
COMMENT ON COLUMN transactions.raw_sms IS 'Original SMS body for debugging';
COMMENT ON COLUMN transactions.reference_number IS 'UPI Reference/UTR/Transaction ID';
COMMENT ON COLUMN transactions.balance IS 'Account balance after transaction';
