-- Add optional monthly EMI support for Loan/EMI bank_accounts.
-- Run this before expecting Monthly EMI Amount saves to persist in live Supabase.

ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS monthly_emi_amount numeric;

ALTER TABLE bank_accounts
  DROP CONSTRAINT IF EXISTS bank_accounts_monthly_emi_amount_nonnegative;

ALTER TABLE bank_accounts
  ADD CONSTRAINT bank_accounts_monthly_emi_amount_nonnegative
  CHECK (monthly_emi_amount IS NULL OR monthly_emi_amount >= 0);
