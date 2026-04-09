-- Add merchant column to transactions table
-- This column stores the merchant/payee name extracted from SMS messages

ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS merchant TEXT;

-- Create index for merchant lookups (useful for analytics and filtering)
CREATE INDEX IF NOT EXISTS idx_transactions_merchant 
ON transactions(merchant) 
WHERE merchant IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN transactions.merchant IS 'Merchant or payee name extracted from SMS (e.g., AMAZON, SWIGGY, etc.)';

-- Verification query
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'transactions' 
AND column_name = 'merchant';
