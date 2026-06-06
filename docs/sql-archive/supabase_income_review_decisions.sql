-- Income Review decisions for Debt Freedom Coach -----------------------------

CREATE TABLE IF NOT EXISTS income_review_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_id uuid REFERENCES transactions(id) ON DELETE CASCADE,
  evidence_id uuid REFERENCES transaction_evidence(id) ON DELETE CASCADE,
  signal_hash text,
  decision text NOT NULL CHECK (decision IN ('count_as_income', 'not_income', 'needs_review')),
  income_source_type text CHECK (income_source_type IN ('salary', 'gig_work', 'freelance', 'business', 'cash_deposit', 'other')),
  confidence text NOT NULL DEFAULT 'user_confirmed' CHECK (confidence IN ('user_confirmed', 'system_suggested')),
  reason_code text,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT income_review_decisions_target_check
    CHECK (transaction_id IS NOT NULL OR evidence_id IS NOT NULL OR signal_hash IS NOT NULL)
);

COMMENT ON TABLE income_review_decisions IS
  'User-owned income review decisions only. Stores transaction/evidence identifiers, safe signal hash, decision, source type, and reason code. Never raw SMS, notification body, UPI, phone, address, raw note, raw payloads, or full account/card number.';

ALTER TABLE income_review_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can select own income review decisions" ON income_review_decisions;
CREATE POLICY "Users can select own income review decisions"
  ON income_review_decisions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own income review decisions" ON income_review_decisions;
CREATE POLICY "Users can insert own income review decisions"
  ON income_review_decisions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own income review decisions" ON income_review_decisions;
CREATE POLICY "Users can update own income review decisions"
  ON income_review_decisions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own income review decisions" ON income_review_decisions;
CREATE POLICY "Users can delete own income review decisions"
  ON income_review_decisions FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_income_review_decisions_user_id
  ON income_review_decisions(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_income_review_decisions_user_transaction
  ON income_review_decisions(user_id, transaction_id)
  WHERE transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_income_review_decisions_user_evidence
  ON income_review_decisions(user_id, evidence_id)
  WHERE evidence_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_income_review_decisions_user_signal_hash
  ON income_review_decisions(user_id, signal_hash)
  WHERE signal_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION set_income_review_decisions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_set_income_review_decisions_updated_at ON income_review_decisions;
CREATE TRIGGER trigger_set_income_review_decisions_updated_at
  BEFORE UPDATE ON income_review_decisions
  FOR EACH ROW
  EXECUTE FUNCTION set_income_review_decisions_updated_at();

CREATE OR REPLACE FUNCTION validate_income_review_decision_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.transaction_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM transactions t
      WHERE t.id = NEW.transaction_id
        AND t.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'Income review transaction must belong to the same user'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.evidence_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM transaction_evidence te
      WHERE te.id = NEW.evidence_id
        AND te.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'Income review evidence must belong to the same user'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_income_review_decision_owner ON income_review_decisions;
CREATE TRIGGER trigger_validate_income_review_decision_owner
  BEFORE INSERT OR UPDATE OF user_id, transaction_id, evidence_id ON income_review_decisions
  FOR EACH ROW
  EXECUTE FUNCTION validate_income_review_decision_owner();
