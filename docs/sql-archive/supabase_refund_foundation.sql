-- Refund foundation for linked expense reversals.
-- Run this before enabling any UI or Review Queue refund posting.

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS refund_of_transaction_id uuid;

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_refund_of_transaction_id_fkey;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_refund_of_transaction_id_fkey
  FOREIGN KEY (refund_of_transaction_id) REFERENCES transactions(id) NOT VALID;

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_type_check
  CHECK (type IN ('income', 'expense', 'investment', 'emi', 'lent', 'borrowed', 'transfer', 'refund'));

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_refund_amount_positive;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_refund_amount_positive
  CHECK (type <> 'refund' OR amount > 0) NOT VALID;

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_refund_requires_link;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_refund_requires_link
  CHECK (type <> 'refund' OR refund_of_transaction_id IS NOT NULL) NOT VALID;

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_refund_link_only_for_refund;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_refund_link_only_for_refund
  CHECK (type = 'refund' OR refund_of_transaction_id IS NULL) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_transactions_refund_link
  ON transactions(user_id, refund_of_transaction_id)
  WHERE refund_of_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_refund_reference
  ON transactions(user_id, refund_of_transaction_id, amount, reference_number)
  WHERE type = 'refund' AND reference_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_refund_duplicate
  ON transactions(user_id, refund_of_transaction_id, amount, created_at DESC)
  WHERE type = 'refund';

CREATE OR REPLACE FUNCTION validate_refund_transaction_link()
RETURNS trigger AS $$
DECLARE
  v_original_user uuid;
  v_original_type text;
BEGIN
  IF NEW.type = 'refund' THEN
    IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
      RAISE EXCEPTION 'Refund amount must be positive';
    END IF;

    IF NEW.refund_of_transaction_id IS NULL THEN
      RAISE EXCEPTION 'Refund transactions must link to an original expense';
    END IF;

    SELECT user_id, type
    INTO v_original_user, v_original_type
    FROM transactions
    WHERE id = NEW.refund_of_transaction_id;

    IF v_original_user IS NULL THEN
      RAISE EXCEPTION 'Refund original transaction does not exist';
    END IF;

    IF v_original_user <> NEW.user_id THEN
      RAISE EXCEPTION 'Refund original transaction must belong to the transaction user';
    END IF;

    IF v_original_type <> 'expense' THEN
      RAISE EXCEPTION 'Refund original transaction must be an expense';
    END IF;
  ELSIF NEW.refund_of_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only refund transactions can link to an original transaction';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_validate_refund_transaction_link ON transactions;
CREATE TRIGGER trigger_validate_refund_transaction_link
BEFORE INSERT OR UPDATE ON transactions
FOR EACH ROW
EXECUTE FUNCTION validate_refund_transaction_link();
