-- Manual migration: make self-transfer accounting reversible and user-scoped.
-- Run this in the Supabase SQL Editor before enabling Review Queue self-transfer posting.
-- Constraints are NOT VALID so existing legacy rows remain compatible.

BEGIN;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS from_account_id uuid REFERENCES bank_accounts(id),
  ADD COLUMN IF NOT EXISTS to_account_id uuid REFERENCES bank_accounts(id),
  ADD COLUMN IF NOT EXISTS account_last4 text,
  ADD COLUMN IF NOT EXISTS is_transfer_pending boolean DEFAULT false;

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_type_check
  CHECK (type IN ('income', 'expense', 'investment', 'emi', 'lent', 'borrowed', 'transfer', 'refund'));

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_transfer_amount_positive;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_transfer_amount_positive
  CHECK (type <> 'transfer' OR amount > 0) NOT VALID;

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_transfer_distinct_accounts;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_transfer_distinct_accounts
  CHECK (
    type <> 'transfer'
    OR from_account_id IS NULL
    OR to_account_id IS NULL
    OR from_account_id <> to_account_id
  ) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_transactions_transfer_match
  ON transactions(user_id, amount, reference_number, created_at DESC)
  WHERE reference_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_transfer_accounts
  ON transactions(user_id, from_account_id, to_account_id, amount, created_at DESC)
  WHERE type = 'transfer';

CREATE INDEX IF NOT EXISTS idx_transactions_pending_transfers
  ON transactions(user_id, amount, type, created_at DESC)
  WHERE is_transfer_pending = true;

CREATE OR REPLACE FUNCTION update_bank_balances_on_transfer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owned_count integer;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE')
    AND OLD.type = 'transfer'
    AND COALESCE(OLD.is_transfer_pending, false) = false
    AND OLD.from_account_id IS NOT NULL
    AND OLD.to_account_id IS NOT NULL
  THEN
    UPDATE bank_accounts
    SET balance = COALESCE(balance, starting_balance) + OLD.amount
    WHERE id = OLD.from_account_id
      AND user_id = OLD.user_id;

    UPDATE bank_accounts
    SET balance = COALESCE(balance, starting_balance) - OLD.amount
    WHERE id = OLD.to_account_id
      AND user_id = OLD.user_id;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE')
    AND NEW.type = 'transfer'
    AND COALESCE(NEW.is_transfer_pending, false) = false
  THEN
    IF NEW.amount <= 0 THEN
      RAISE EXCEPTION 'Transfer amount must be positive'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.from_account_id IS NULL OR NEW.to_account_id IS NULL THEN
      RAISE EXCEPTION 'Transfer requires source and destination accounts'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.from_account_id = NEW.to_account_id THEN
      RAISE EXCEPTION 'Transfer source and destination must be different accounts'
        USING ERRCODE = '23514';
    END IF;

    SELECT COUNT(*) INTO v_owned_count
    FROM bank_accounts
    WHERE user_id = NEW.user_id
      AND id IN (NEW.from_account_id, NEW.to_account_id);

    IF v_owned_count <> 2 THEN
      RAISE EXCEPTION 'Transfer accounts must belong to the transaction user'
        USING ERRCODE = '42501';
    END IF;

    UPDATE bank_accounts
    SET balance = COALESCE(balance, starting_balance) - NEW.amount
    WHERE id = NEW.from_account_id
      AND user_id = NEW.user_id;

    UPDATE bank_accounts
    SET balance = COALESCE(balance, starting_balance) + NEW.amount
    WHERE id = NEW.to_account_id
      AND user_id = NEW.user_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_balances_on_transfer ON transactions;
CREATE TRIGGER trigger_update_balances_on_transfer
AFTER INSERT OR UPDATE OR DELETE ON transactions
FOR EACH ROW
EXECUTE FUNCTION update_bank_balances_on_transfer();

COMMIT;
