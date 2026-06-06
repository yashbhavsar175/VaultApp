-- Migration script to upgrade user_accounts table to support multiple identifier types
-- Run this if you already have the old user_accounts table

-- Step 1: Drop existing policies
DROP POLICY IF EXISTS "Users can view own accounts" ON user_accounts;
DROP POLICY IF EXISTS "Users can insert own accounts" ON user_accounts;
DROP POLICY IF EXISTS "Users can update own accounts" ON user_accounts;
DROP POLICY IF EXISTS "Users can delete own accounts" ON user_accounts;

-- Step 2: Backup existing data (if any)
CREATE TEMP TABLE user_accounts_backup AS 
SELECT * FROM user_accounts;

-- Step 3: Drop old table
DROP TABLE IF EXISTS user_accounts CASCADE;

-- Step 4: Create new table with enhanced schema
CREATE TABLE user_accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  identifier_type TEXT NOT NULL CHECK (identifier_type IN ('account', 'upi', 'phone')),
  identifier_value TEXT NOT NULL,
  bank_name TEXT,
  account_nickname TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, identifier_type, identifier_value)
);

-- Step 5: Enable RLS
ALTER TABLE user_accounts ENABLE ROW LEVEL SECURITY;

-- Step 6: Create RLS Policies
CREATE POLICY "Users can view own accounts"
  ON user_accounts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own accounts"
  ON user_accounts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own accounts"
  ON user_accounts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own accounts"
  ON user_accounts FOR DELETE
  USING (auth.uid() = user_id);

-- Step 7: Create indexes
CREATE INDEX idx_user_accounts_user_id ON user_accounts(user_id);
CREATE INDEX idx_user_accounts_identifier ON user_accounts(identifier_value);
CREATE INDEX idx_user_accounts_type ON user_accounts(identifier_type);

-- Step 8: Migrate old data (if backup table has data)
-- This converts old account_last_digits to new identifier_type='account' format
INSERT INTO user_accounts (user_id, identifier_type, identifier_value, bank_name, account_nickname, created_at)
SELECT 
  user_id, 
  'account' as identifier_type,
  account_last_digits as identifier_value,
  bank_name,
  account_nickname,
  created_at
FROM user_accounts_backup
WHERE EXISTS (SELECT 1 FROM user_accounts_backup LIMIT 1)
ON CONFLICT (user_id, identifier_type, identifier_value) DO NOTHING;

-- Step 9: Drop backup table
DROP TABLE IF EXISTS user_accounts_backup;

-- Done! Now you can add UPI IDs and phone numbers
-- Example:
-- INSERT INTO user_accounts (user_id, identifier_type, identifier_value, bank_name) VALUES
-- ('your-user-id', 'account', '1447', 'Kotak Bank'),
-- ('your-user-id', 'account', '5235', 'Slice'),
-- ('your-user-id', 'upi', '6351330811@superyes', 'Slice'),
-- ('your-user-id', 'phone', '6351330811', NULL);
