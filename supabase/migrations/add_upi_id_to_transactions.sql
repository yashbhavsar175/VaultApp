-- Add upi_id column to transactions table
-- This stores the UPI ID used for the transaction (e.g., user@paytm, user@ybl)

ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS upi_id TEXT;

-- Add index for faster UPI ID lookups
CREATE INDEX IF NOT EXISTS idx_transactions_upi_id ON transactions(upi_id);

-- Add comment
COMMENT ON COLUMN transactions.upi_id IS 'UPI ID used for transaction (e.g., user@paytm, user@ybl)';
