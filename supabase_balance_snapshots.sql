-- Task 26B: Balance snapshots foundation.
-- Stores balance history/provenance without raw SMS or notification text.

CREATE TABLE IF NOT EXISTS balance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_type text NOT NULL CHECK (
    owner_type IN (
      'bank_account',
      'credit_card',
      'debit_card',
      'loan',
      'cash',
      'detected_account',
      'detected_card'
    )
  ),
  owner_id uuid,
  detected_bank_name text,
  account_last4 text CHECK (account_last4 IS NULL OR account_last4 ~ '^[0-9]{1,4}$'),
  card_last4 text CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{1,4}$'),
  balance_kind text NOT NULL CHECK (
    balance_kind IN (
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
  amount numeric NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'INR',
  source text NOT NULL CHECK (source IN ('sms', 'notification', 'calculated', 'manual', 'review', 'import')),
  confidence text NOT NULL CHECK (confidence IN ('exact', 'estimated', 'low')),
  detected_at timestamptz NOT NULL DEFAULT now(),
  source_sender_or_package text,
  raw_source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN balance_snapshots.raw_source_metadata IS
  'Redacted metadata only. Allowed examples: len/length, hash, source, sender, package, kind. Never raw SMS, notification body, OTP, phone, address, or full account/card number.';

ALTER TABLE balance_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own balance snapshots" ON balance_snapshots;
CREATE POLICY "Users manage own balance snapshots"
  ON balance_snapshots FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_balance_snapshots_owner_latest
  ON balance_snapshots(user_id, owner_type, owner_id, balance_kind, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_balance_snapshots_account_last4
  ON balance_snapshots(user_id, account_last4)
  WHERE account_last4 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_balance_snapshots_card_last4
  ON balance_snapshots(user_id, card_last4)
  WHERE card_last4 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_balance_snapshots_source
  ON balance_snapshots(user_id, source);
