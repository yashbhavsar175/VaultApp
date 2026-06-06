-- Task 26B: Credit card statement foundation.
-- Stores statement/due metadata without raw SMS or notification text.

CREATE TABLE IF NOT EXISTS credit_card_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credit_card_id uuid NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
  statement_date date,
  period_start date,
  period_end date,
  total_due numeric CHECK (total_due IS NULL OR total_due >= 0),
  minimum_due numeric CHECK (minimum_due IS NULL OR minimum_due >= 0),
  payment_due_date date,
  statement_balance numeric CHECK (statement_balance IS NULL OR statement_balance >= 0),
  source_snapshot_id uuid REFERENCES balance_snapshots(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'partial', 'overdue', 'unknown')),
  source text CHECK (source IS NULL OR source IN ('sms', 'notification', 'manual', 'import')),
  confidence text CHECK (confidence IS NULL OR confidence IN ('exact', 'estimated', 'low')),
  raw_source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN credit_card_statements.raw_source_metadata IS
  'Redacted metadata only. Never store raw SMS, notification body, OTP, phone, address, or full account/card number.';

ALTER TABLE credit_card_statements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own credit card statements" ON credit_card_statements;
CREATE POLICY "Users manage own credit card statements"
  ON credit_card_statements FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_credit_card_statements_user_id
  ON credit_card_statements(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_card_statements_card_id
  ON credit_card_statements(user_id, credit_card_id);
CREATE INDEX IF NOT EXISTS idx_credit_card_statements_due_date
  ON credit_card_statements(user_id, payment_due_date)
  WHERE payment_due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_credit_card_statements_status
  ON credit_card_statements(user_id, status);

CREATE OR REPLACE FUNCTION validate_credit_card_statement_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM credit_cards
    WHERE id = NEW.credit_card_id
      AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Credit card statement card must belong to the same user'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.source_snapshot_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM balance_snapshots
    WHERE id = NEW.source_snapshot_id
      AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Credit card statement source snapshot must belong to the same user'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_credit_card_statement_owner ON credit_card_statements;
CREATE TRIGGER trigger_validate_credit_card_statement_owner
  BEFORE INSERT OR UPDATE ON credit_card_statements
  FOR EACH ROW
  EXECUTE FUNCTION validate_credit_card_statement_owner();
