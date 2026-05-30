-- Task 28B: Transaction evidence foundation.
-- Stores privacy-safe payment/bank evidence for future reconciliation.
-- Redacted metadata only. Never raw SMS, notification body, OTP, phone,
-- address, full account/card number, or raw payment app payload text.

CREATE TABLE IF NOT EXISTS transaction_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signal_id text NOT NULL,
  transaction_id uuid REFERENCES transactions(id) ON DELETE SET NULL,
  source_type text NOT NULL CHECK (source_type IN ('sms', 'notification', 'accessibility', 'manual', 'imported')),
  source_package text,
  source_app text,
  sender text,
  amount numeric,
  direction text CHECK (direction IS NULL OR direction IN ('debit', 'credit', 'transfer', 'unknown')),
  captured_at timestamptz NOT NULL DEFAULT now(),
  reference_number text,
  merchant_or_person text,
  bank_name text,
  account_last4 text CHECK (account_last4 IS NULL OR account_last4 ~ '^[0-9]{4}$'),
  card_last4 text CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$'),
  instrument_hint text CHECK (
    instrument_hint IS NULL
    OR instrument_hint IN ('bank_account', 'debit_card', 'credit_card', 'wallet', 'loan', 'unknown')
  ),
  upi_id_masked text,
  upi_id_hash text,
  confidence_level text NOT NULL DEFAULT 'low' CHECK (confidence_level IN ('exact', 'high', 'medium', 'low')),
  match_status text NOT NULL DEFAULT 'unlinked' CHECK (
    match_status IN ('unlinked', 'linked', 'ambiguous', 'review_required', 'ignored')
  ),
  match_reason_code text,
  raw_source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN transaction_evidence.raw_source_metadata IS
  'Redacted metadata only. Allowed examples: len/length, hash, source, sender, package, kind, reasons, parserVersion. Never raw SMS, notification body, OTP, phone, address, full account/card number, raw UPI ID, or raw payload JSON.';
COMMENT ON COLUMN transaction_evidence.upi_id_masked IS
  'Masked UPI ID only, for example yash***@oksbi or ****@ybl. Do not store a full raw UPI ID here.';
COMMENT ON COLUMN transaction_evidence.account_last4 IS
  'Last four digits only. Do not store full account numbers.';
COMMENT ON COLUMN transaction_evidence.card_last4 IS
  'Last four digits only. Do not store full card numbers.';

ALTER TABLE transaction_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own transaction evidence" ON transaction_evidence;
CREATE POLICY "Users manage own transaction evidence"
  ON transaction_evidence FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transaction_evidence_user_signal
  ON transaction_evidence(user_id, signal_id);
CREATE INDEX IF NOT EXISTS idx_transaction_evidence_transaction
  ON transaction_evidence(user_id, transaction_id)
  WHERE transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transaction_evidence_reference
  ON transaction_evidence(user_id, reference_number)
  WHERE reference_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transaction_evidence_amount_captured
  ON transaction_evidence(user_id, amount, captured_at);
CREATE INDEX IF NOT EXISTS idx_transaction_evidence_account_last4
  ON transaction_evidence(user_id, account_last4)
  WHERE account_last4 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transaction_evidence_card_last4
  ON transaction_evidence(user_id, card_last4)
  WHERE card_last4 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transaction_evidence_match_status
  ON transaction_evidence(user_id, match_status);
CREATE INDEX IF NOT EXISTS idx_transaction_evidence_source_package_captured
  ON transaction_evidence(user_id, source_package, captured_at DESC)
  WHERE source_package IS NOT NULL;

CREATE OR REPLACE FUNCTION set_transaction_evidence_updated_at()
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

DROP TRIGGER IF EXISTS trigger_set_transaction_evidence_updated_at ON transaction_evidence;
CREATE TRIGGER trigger_set_transaction_evidence_updated_at
  BEFORE UPDATE ON transaction_evidence
  FOR EACH ROW
  EXECUTE FUNCTION set_transaction_evidence_updated_at();

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS account_match_status text DEFAULT 'unlinked',
  ADD COLUMN IF NOT EXISTS account_match_confidence text,
  ADD COLUMN IF NOT EXISTS account_match_reason text,
  ADD COLUMN IF NOT EXISTS primary_evidence_id uuid;

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_account_match_status_check;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_account_match_status_check
  CHECK (
    account_match_status IS NULL
    OR account_match_status IN ('unlinked', 'linked', 'ambiguous', 'review_required', 'ignored', 'manual_confirmed')
  );

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_account_match_confidence_check;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_account_match_confidence_check
  CHECK (
    account_match_confidence IS NULL
    OR account_match_confidence IN ('exact', 'high', 'medium', 'low')
  );

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_primary_evidence_id_fkey;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_primary_evidence_id_fkey
  FOREIGN KEY (primary_evidence_id) REFERENCES transaction_evidence(id) ON DELETE SET NULL NOT VALID;

CREATE INDEX IF NOT EXISTS idx_transactions_account_match_status
  ON transactions(user_id, account_match_status);
CREATE INDEX IF NOT EXISTS idx_transactions_primary_evidence
  ON transactions(user_id, primary_evidence_id)
  WHERE primary_evidence_id IS NOT NULL;
