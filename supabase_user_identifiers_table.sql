-- Enhanced user_accounts table for storing multiple identifier types
-- Supports: account numbers, UPI IDs, and phone numbers

CREATE TABLE IF NOT EXISTS user_accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  identifier_type TEXT NOT NULL CHECK (identifier_type IN ('account', 'upi', 'phone')),
  identifier_value TEXT NOT NULL,
  bank_name TEXT,
  account_nickname TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, identifier_type, identifier_value)
);

-- Enable RLS
ALTER TABLE user_accounts ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view own accounts" ON user_accounts;
CREATE POLICY "Users can view own accounts"
  ON user_accounts FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own accounts" ON user_accounts;
CREATE POLICY "Users can insert own accounts"
  ON user_accounts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own accounts" ON user_accounts;
CREATE POLICY "Users can update own accounts"
  ON user_accounts FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own accounts" ON user_accounts;
CREATE POLICY "Users can delete own accounts"
  ON user_accounts FOR DELETE
  USING (auth.uid() = user_id);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_user_accounts_user_id ON user_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_accounts_identifier ON user_accounts(identifier_value);
CREATE INDEX IF NOT EXISTS idx_user_accounts_type ON user_accounts(identifier_type);

-- Migration: If old table exists, migrate data
-- Run this only if you have existing data in the old format
/*
INSERT INTO user_accounts (user_id, identifier_type, identifier_value, bank_name, account_nickname, created_at)
SELECT user_id, 'account', account_last_digits, bank_name, account_nickname, created_at
FROM user_accounts_old
ON CONFLICT DO NOTHING;
*/
