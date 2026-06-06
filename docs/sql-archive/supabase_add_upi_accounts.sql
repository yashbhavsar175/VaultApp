-- Add upi_accounts column to profiles table
-- Run this in Supabase SQL Editor

ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS upi_accounts jsonb DEFAULT '[]';

-- Add comment to explain the structure
COMMENT ON COLUMN profiles.upi_accounts IS 'Array of user UPI accounts: [{"bankName": "Slice", "upiId": "yash@okaxis", "accountLast4": "5235"}]';

-- Verify the column was added
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'profiles' 
AND column_name = 'upi_accounts';
