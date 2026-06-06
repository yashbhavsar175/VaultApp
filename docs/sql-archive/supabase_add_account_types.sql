-- Add account type support for credit cards and loans
ALTER TABLE bank_accounts 
  ADD COLUMN IF NOT EXISTS account_type text DEFAULT 'savings' 
    CHECK (account_type IN ('savings', 'current', 'credit_card', 'loan'));

ALTER TABLE bank_accounts 
  ADD COLUMN IF NOT EXISTS credit_limit numeric DEFAULT 0;

ALTER TABLE bank_accounts     
  ADD COLUMN IF NOT EXISTS loan_total numeric DEFAULT 0;
