-- Manual migration: fix EMI outstanding accounting.
-- Run this in the Supabase SQL Editor before enabling Review Queue EMI posting.
-- It is intentionally compatible with existing rows by using NOT VALID checks.

BEGIN;

ALTER TABLE emi_payments
  ADD COLUMN IF NOT EXISTS reference_number text;

ALTER TABLE emi_payments DROP CONSTRAINT IF EXISTS emi_payments_amount_paid_positive;
ALTER TABLE emi_payments
  ADD CONSTRAINT emi_payments_amount_paid_positive
  CHECK (amount_paid > 0) NOT VALID;

ALTER TABLE emi_payments DROP CONSTRAINT IF EXISTS emi_payments_principal_non_negative;
ALTER TABLE emi_payments
  ADD CONSTRAINT emi_payments_principal_non_negative
  CHECK (principal_component IS NULL OR principal_component >= 0) NOT VALID;

ALTER TABLE emi_payments DROP CONSTRAINT IF EXISTS emi_payments_interest_non_negative;
ALTER TABLE emi_payments
  ADD CONSTRAINT emi_payments_interest_non_negative
  CHECK (interest_component IS NULL OR interest_component >= 0) NOT VALID;

ALTER TABLE emi_payments DROP CONSTRAINT IF EXISTS emi_payments_principal_lte_amount;
ALTER TABLE emi_payments
  ADD CONSTRAINT emi_payments_principal_lte_amount
  CHECK (principal_component IS NULL OR principal_component <= amount_paid) NOT VALID;

ALTER TABLE emi_payments DROP CONSTRAINT IF EXISTS emi_payments_interest_lte_amount;
ALTER TABLE emi_payments
  ADD CONSTRAINT emi_payments_interest_lte_amount
  CHECK (interest_component IS NULL OR interest_component <= amount_paid) NOT VALID;

ALTER TABLE emi_payments DROP CONSTRAINT IF EXISTS emi_payments_components_lte_amount;
ALTER TABLE emi_payments
  ADD CONSTRAINT emi_payments_components_lte_amount
  CHECK (
    principal_component IS NULL
    OR interest_component IS NULL
    OR principal_component + interest_component <= amount_paid + 0.01
  ) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_emi_payments_reference
  ON emi_payments(user_id, loan_id, reference_number)
  WHERE reference_number IS NOT NULL;

CREATE OR REPLACE FUNCTION update_loan_outstanding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_principal numeric;
  v_new_principal numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new_principal := COALESCE(NEW.principal_component, NEW.amount_paid);

    UPDATE loans
    SET current_outstanding = GREATEST(current_outstanding - v_new_principal, 0),
        updated_at = now()
    WHERE id = NEW.loan_id
      AND user_id = NEW.user_id;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old_principal := COALESCE(OLD.principal_component, OLD.amount_paid);
    v_new_principal := COALESCE(NEW.principal_component, NEW.amount_paid);

    UPDATE loans
    SET current_outstanding = current_outstanding + v_old_principal,
        updated_at = now()
    WHERE id = OLD.loan_id
      AND user_id = OLD.user_id;

    UPDATE loans
    SET current_outstanding = GREATEST(current_outstanding - v_new_principal, 0),
        updated_at = now()
    WHERE id = NEW.loan_id
      AND user_id = NEW.user_id;
    RETURN NEW;
  END IF;

  v_old_principal := COALESCE(OLD.principal_component, OLD.amount_paid);

  UPDATE loans
  SET current_outstanding = current_outstanding + v_old_principal,
      updated_at = now()
  WHERE id = OLD.loan_id
    AND user_id = OLD.user_id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_loan_outstanding ON emi_payments;
CREATE TRIGGER trigger_update_loan_outstanding
AFTER INSERT OR UPDATE OR DELETE ON emi_payments
FOR EACH ROW
EXECUTE FUNCTION update_loan_outstanding();

COMMIT;
