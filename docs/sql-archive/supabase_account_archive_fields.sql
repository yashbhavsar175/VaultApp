-- Additive archive/hide support for bank accounts and credit cards.
-- Run this in Supabase SQL Editor before enabling the hide flow in production.

ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE credit_cards
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_bank_accounts_user_archived
  ON bank_accounts(user_id, is_archived);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_user_archived_created
  ON bank_accounts(user_id, is_archived, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_cards_user_archived
  ON credit_cards(user_id, is_archived);

CREATE INDEX IF NOT EXISTS idx_credit_cards_user_archived_created
  ON credit_cards(user_id, is_archived, created_at DESC);
