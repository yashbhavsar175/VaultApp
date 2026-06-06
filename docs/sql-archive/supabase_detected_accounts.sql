-- Task 26B: Detected accounts/cards foundation.
-- Stores review candidates before the user confirms, merges, or ignores them.

CREATE TABLE IF NOT EXISTS detected_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  detection_type text NOT NULL CHECK (detection_type IN ('bank_account', 'credit_card', 'debit_card', 'loan')),
  detected_bank_name text,
  account_last4 text CHECK (account_last4 IS NULL OR account_last4 ~ '^[0-9]{1,4}$'),
  card_last4 text CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{1,4}$'),
  account_type_hint text,
  balance_amount numeric CHECK (balance_amount IS NULL OR balance_amount >= 0),
  balance_kind text CHECK (
    balance_kind IS NULL OR balance_kind IN (
      'available_balance',
      'current_balance',
      'outstanding',
      'available_limit',
      'credit_limit',
      'due_amount',
      'minimum_due',
      'loan_outstanding'
    )
  ),
  source text NOT NULL CHECK (source IN ('sms', 'notification', 'manual', 'import')),
  confidence text NOT NULL CHECK (confidence IN ('exact', 'estimated', 'low')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'merged', 'ignored')),
  matched_owner_type text CHECK (
    matched_owner_type IS NULL OR matched_owner_type IN (
      'bank_account',
      'credit_card',
      'debit_card',
      'loan',
      'cash',
      'detected_account',
      'detected_card'
    )
  ),
  matched_owner_id uuid,
  source_sender_or_package text,
  raw_source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN detected_accounts.raw_source_metadata IS
  'Redacted metadata only. Never store raw SMS, notification body, OTP, phone, address, or full account/card number.';

ALTER TABLE detected_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own detected accounts" ON detected_accounts;
CREATE POLICY "Users manage own detected accounts"
  ON detected_accounts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_detected_accounts_status_type
  ON detected_accounts(user_id, status, detection_type);
CREATE INDEX IF NOT EXISTS idx_detected_accounts_account_last4
  ON detected_accounts(user_id, account_last4)
  WHERE account_last4 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_detected_accounts_card_last4
  ON detected_accounts(user_id, card_last4)
  WHERE card_last4 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_detected_accounts_last_seen
  ON detected_accounts(user_id, last_seen_at DESC);
