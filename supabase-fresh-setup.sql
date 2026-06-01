-- SpendSense / VaultApp fresh Supabase setup
-- Source of truth for a new Supabase project.
-- Run this single file in the Supabase SQL Editor instead of the older fragmented
-- root SQL files. The older files are retained as historical patch scripts.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Profiles -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  phone text,
  monthly_budget numeric,
  currency text DEFAULT 'INR',
  upi_accounts jsonb DEFAULT '[]'::jsonb,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS monthly_budget numeric,
  ADD COLUMN IF NOT EXISTS currency text DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS upi_accounts jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own profile" ON profiles;
CREATE POLICY "Users can manage own profile"
  ON profiles FOR ALL
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Debt Freedom settings -------------------------------------------------------

CREATE TABLE IF NOT EXISTS debt_freedom_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  confirmed_monthly_income numeric(14,2) CHECK (confirmed_monthly_income IS NULL OR confirmed_monthly_income >= 0),
  essential_monthly_expenses numeric(14,2) CHECK (essential_monthly_expenses IS NULL OR essential_monthly_expenses >= 0),
  emergency_contribution numeric(14,2) NOT NULL DEFAULT 0 CHECK (emergency_contribution >= 0),
  target_monthly_income numeric(14,2) CHECK (target_monthly_income IS NULL OR target_monthly_income >= 0),
  planned_monthly_debt_payment numeric(14,2) CHECK (planned_monthly_debt_payment IS NULL OR planned_monthly_debt_payment >= 0),
  target_debt_free_months integer CHECK (target_debt_free_months IS NULL OR (target_debt_free_months > 0 AND target_debt_free_months <= 600)),
  strategy text NOT NULL DEFAULT 'balanced' CHECK (strategy IN ('balanced', 'snowball', 'avalanche')),
  income_mode text NOT NULL DEFAULT 'auto' CHECK (income_mode IN ('auto', 'confirmed', 'manual_estimate')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE debt_freedom_settings
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS confirmed_monthly_income numeric(14,2),
  ADD COLUMN IF NOT EXISTS essential_monthly_expenses numeric(14,2),
  ADD COLUMN IF NOT EXISTS emergency_contribution numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS target_monthly_income numeric(14,2),
  ADD COLUMN IF NOT EXISTS planned_monthly_debt_payment numeric(14,2),
  ADD COLUMN IF NOT EXISTS target_debt_free_months integer,
  ADD COLUMN IF NOT EXISTS strategy text NOT NULL DEFAULT 'balanced',
  ADD COLUMN IF NOT EXISTS income_mode text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE debt_freedom_settings
  ALTER COLUMN emergency_contribution SET DEFAULT 0,
  ALTER COLUMN strategy SET DEFAULT 'balanced',
  ALTER COLUMN income_mode SET DEFAULT 'auto';

ALTER TABLE debt_freedom_settings
  ALTER COLUMN user_id SET NOT NULL,
  ALTER COLUMN emergency_contribution SET NOT NULL,
  ALTER COLUMN strategy SET NOT NULL,
  ALTER COLUMN income_mode SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE debt_freedom_settings DROP CONSTRAINT IF EXISTS debt_freedom_settings_user_id_key;
ALTER TABLE debt_freedom_settings
  ADD CONSTRAINT debt_freedom_settings_user_id_key UNIQUE(user_id);

ALTER TABLE debt_freedom_settings DROP CONSTRAINT IF EXISTS debt_freedom_settings_confirmed_monthly_income_check;
ALTER TABLE debt_freedom_settings
  ADD CONSTRAINT debt_freedom_settings_confirmed_monthly_income_check
  CHECK (confirmed_monthly_income IS NULL OR confirmed_monthly_income >= 0);

ALTER TABLE debt_freedom_settings DROP CONSTRAINT IF EXISTS debt_freedom_settings_essential_monthly_expenses_check;
ALTER TABLE debt_freedom_settings
  ADD CONSTRAINT debt_freedom_settings_essential_monthly_expenses_check
  CHECK (essential_monthly_expenses IS NULL OR essential_monthly_expenses >= 0);

ALTER TABLE debt_freedom_settings DROP CONSTRAINT IF EXISTS debt_freedom_settings_emergency_contribution_check;
ALTER TABLE debt_freedom_settings
  ADD CONSTRAINT debt_freedom_settings_emergency_contribution_check
  CHECK (emergency_contribution >= 0);

ALTER TABLE debt_freedom_settings DROP CONSTRAINT IF EXISTS debt_freedom_settings_target_monthly_income_check;
ALTER TABLE debt_freedom_settings
  ADD CONSTRAINT debt_freedom_settings_target_monthly_income_check
  CHECK (target_monthly_income IS NULL OR target_monthly_income >= 0);

ALTER TABLE debt_freedom_settings DROP CONSTRAINT IF EXISTS debt_freedom_settings_planned_monthly_debt_payment_check;
ALTER TABLE debt_freedom_settings
  ADD CONSTRAINT debt_freedom_settings_planned_monthly_debt_payment_check
  CHECK (planned_monthly_debt_payment IS NULL OR planned_monthly_debt_payment >= 0);

ALTER TABLE debt_freedom_settings DROP CONSTRAINT IF EXISTS debt_freedom_settings_target_debt_free_months_check;
ALTER TABLE debt_freedom_settings
  ADD CONSTRAINT debt_freedom_settings_target_debt_free_months_check
  CHECK (target_debt_free_months IS NULL OR (target_debt_free_months > 0 AND target_debt_free_months <= 600));

ALTER TABLE debt_freedom_settings DROP CONSTRAINT IF EXISTS debt_freedom_settings_strategy_check;
ALTER TABLE debt_freedom_settings
  ADD CONSTRAINT debt_freedom_settings_strategy_check
  CHECK (strategy IN ('balanced', 'snowball', 'avalanche'));

ALTER TABLE debt_freedom_settings DROP CONSTRAINT IF EXISTS debt_freedom_settings_income_mode_check;
ALTER TABLE debt_freedom_settings
  ADD CONSTRAINT debt_freedom_settings_income_mode_check
  CHECK (income_mode IN ('auto', 'confirmed', 'manual_estimate'));

COMMENT ON TABLE debt_freedom_settings IS
  'User-owned Debt Freedom Coach planning settings. Numeric planning targets only; never raw SMS, notification body, UPI, phone, address, profile object, or full account/card number.';

ALTER TABLE debt_freedom_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can select own debt freedom settings" ON debt_freedom_settings;
CREATE POLICY "Users can select own debt freedom settings"
  ON debt_freedom_settings FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own debt freedom settings" ON debt_freedom_settings;
CREATE POLICY "Users can insert own debt freedom settings"
  ON debt_freedom_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own debt freedom settings" ON debt_freedom_settings;
CREATE POLICY "Users can update own debt freedom settings"
  ON debt_freedom_settings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own debt freedom settings" ON debt_freedom_settings;
CREATE POLICY "Users can delete own debt freedom settings"
  ON debt_freedom_settings FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_debt_freedom_settings_user_id
  ON debt_freedom_settings(user_id);

CREATE OR REPLACE FUNCTION set_debt_freedom_settings_updated_at()
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

DROP TRIGGER IF EXISTS trigger_set_debt_freedom_settings_updated_at ON debt_freedom_settings;
CREATE TRIGGER trigger_set_debt_freedom_settings_updated_at
  BEFORE UPDATE ON debt_freedom_settings
  FOR EACH ROW
  EXECUTE FUNCTION set_debt_freedom_settings_updated_at();

-- Bank accounts ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  bank_name text NOT NULL,
  account_last4 text NOT NULL,
  account_type text NOT NULL DEFAULT 'savings',
  starting_balance numeric NOT NULL DEFAULT 0,
  balance numeric NOT NULL DEFAULT 0,
  credit_limit numeric NOT NULL DEFAULT 0,
  loan_total numeric NOT NULL DEFAULT 0,
  upi_ids text[] DEFAULT '{}',
  is_archived boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS account_last4 text,
  ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'savings',
  ADD COLUMN IF NOT EXISTS starting_balance numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_limit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loan_total numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS upi_ids text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

ALTER TABLE bank_accounts
  ALTER COLUMN account_type SET DEFAULT 'savings',
  ALTER COLUMN starting_balance SET DEFAULT 0,
  ALTER COLUMN balance SET DEFAULT 0,
  ALTER COLUMN credit_limit SET DEFAULT 0,
  ALTER COLUMN loan_total SET DEFAULT 0,
  ALTER COLUMN upi_ids SET DEFAULT '{}',
  ALTER COLUMN is_archived SET DEFAULT false;

UPDATE bank_accounts
SET account_type = 'current'
WHERE account_type = 'checking';

ALTER TABLE bank_accounts DROP CONSTRAINT IF EXISTS bank_accounts_account_type_check;
ALTER TABLE bank_accounts
  ADD CONSTRAINT bank_accounts_account_type_check
  CHECK (account_type IN ('savings', 'current', 'credit_card', 'loan'));

ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own banks" ON bank_accounts;
CREATE POLICY "Users manage own banks"
  ON bank_accounts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS bank_accounts_user_id_idx ON bank_accounts(user_id);
CREATE INDEX IF NOT EXISTS bank_accounts_last4_idx ON bank_accounts(account_last4);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_user_archived ON bank_accounts(user_id, is_archived);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_user_archived_created ON bank_accounts(user_id, is_archived, created_at DESC);

-- Transactions ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  amount numeric NOT NULL,
  type text NOT NULL,
  note text NOT NULL,
  category text DEFAULT 'general',
  account_id uuid REFERENCES bank_accounts(id),
  account_last4 text,
  sms_source text,
  sms_sender text,
  upi_id text,
  reference_number text,
  raw_sms text,
  balance numeric(12, 2),
  from_account_id uuid REFERENCES bank_accounts(id),
  to_account_id uuid REFERENCES bank_accounts(id),
  is_transfer_pending boolean DEFAULT false,
  refund_of_transaction_id uuid,
  merchant text,
  account_match_status text DEFAULT 'unlinked',
  account_match_confidence text,
  account_match_reason text,
  primary_evidence_id uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS amount numeric,
  ADD COLUMN IF NOT EXISTS type text,
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS category text DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES bank_accounts(id),
  ADD COLUMN IF NOT EXISTS account_last4 text,
  ADD COLUMN IF NOT EXISTS sms_source text,
  ADD COLUMN IF NOT EXISTS sms_sender text,
  ADD COLUMN IF NOT EXISTS upi_id text,
  ADD COLUMN IF NOT EXISTS reference_number text,
  ADD COLUMN IF NOT EXISTS raw_sms text,
  ADD COLUMN IF NOT EXISTS balance numeric(12, 2),
  ADD COLUMN IF NOT EXISTS from_account_id uuid REFERENCES bank_accounts(id),
  ADD COLUMN IF NOT EXISTS to_account_id uuid REFERENCES bank_accounts(id),
  ADD COLUMN IF NOT EXISTS is_transfer_pending boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS refund_of_transaction_id uuid,
  ADD COLUMN IF NOT EXISTS merchant text,
  ADD COLUMN IF NOT EXISTS account_match_status text DEFAULT 'unlinked',
  ADD COLUMN IF NOT EXISTS account_match_confidence text,
  ADD COLUMN IF NOT EXISTS account_match_reason text,
  ADD COLUMN IF NOT EXISTS primary_evidence_id uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_refund_of_transaction_id_fkey;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_refund_of_transaction_id_fkey
  FOREIGN KEY (refund_of_transaction_id) REFERENCES transactions(id) NOT VALID;

ALTER TABLE transactions
  ALTER COLUMN is_transfer_pending SET DEFAULT false,
  ALTER COLUMN category SET DEFAULT 'general';

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

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_sms_source_check;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_sms_source_check
  CHECK (
    sms_source IS NULL
    OR sms_source IN ('bank', 'upi', 'sms', 'manual', 'notification', 'voice')
  );

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

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own transactions" ON transactions;
CREATE POLICY "Users can view their own transactions"
  ON transactions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own transactions" ON transactions;
CREATE POLICY "Users can insert their own transactions"
  ON transactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own transactions" ON transactions;
CREATE POLICY "Users can update their own transactions"
  ON transactions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own transactions" ON transactions;
CREATE POLICY "Users can delete their own transactions"
  ON transactions FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_transactions_user_created
  ON transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_duplicate_check
  ON transactions(user_id, amount, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_reference
  ON transactions(reference_number) WHERE reference_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_upi_id
  ON transactions(upi_id) WHERE upi_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_account_id
  ON transactions(account_id) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_account_last4
  ON transactions(account_last4) WHERE account_last4 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_merchant
  ON transactions(merchant) WHERE merchant IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_transfer_match
  ON transactions(user_id, amount, reference_number, created_at DESC)
  WHERE reference_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_transfer_accounts
  ON transactions(user_id, from_account_id, to_account_id, amount, created_at DESC)
  WHERE type = 'transfer';
CREATE INDEX IF NOT EXISTS idx_transactions_pending_transfers
  ON transactions(user_id, amount, type, created_at DESC)
  WHERE is_transfer_pending = true;
CREATE INDEX IF NOT EXISTS idx_transactions_refund_link
  ON transactions(user_id, refund_of_transaction_id)
  WHERE refund_of_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_refund_reference
  ON transactions(user_id, refund_of_transaction_id, amount, reference_number)
  WHERE type = 'refund' AND reference_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_refund_duplicate
  ON transactions(user_id, refund_of_transaction_id, amount, created_at DESC)
  WHERE type = 'refund';
CREATE INDEX IF NOT EXISTS idx_transactions_account_match_status
  ON transactions(user_id, account_match_status);
CREATE INDEX IF NOT EXISTS idx_transactions_primary_evidence
  ON transactions(user_id, primary_evidence_id)
  WHERE primary_evidence_id IS NOT NULL;

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

UPDATE transactions
SET account_id = COALESCE(from_account_id, to_account_id)
WHERE account_id IS NULL
  AND (from_account_id IS NOT NULL OR to_account_id IS NOT NULL);

-- Transaction evidence --------------------------------------------------------

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

CREATE OR REPLACE FUNCTION validate_transaction_evidence_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.transaction_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM transactions t
      WHERE t.id = NEW.transaction_id
        AND t.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'Linked transaction evidence must belong to the same user'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_transaction_evidence_owner ON transaction_evidence;
CREATE TRIGGER trigger_validate_transaction_evidence_owner
  BEFORE INSERT OR UPDATE OF transaction_id, user_id ON transaction_evidence
  FOR EACH ROW
  EXECUTE FUNCTION validate_transaction_evidence_owner();

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_primary_evidence_id_fkey;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_primary_evidence_id_fkey
  FOREIGN KEY (primary_evidence_id) REFERENCES transaction_evidence(id) ON DELETE SET NULL NOT VALID;

CREATE OR REPLACE FUNCTION validate_transaction_primary_evidence_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.primary_evidence_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM transaction_evidence te
      WHERE te.id = NEW.primary_evidence_id
        AND te.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'Primary transaction evidence must belong to the same user'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_transaction_primary_evidence_owner ON transactions;
CREATE TRIGGER trigger_validate_transaction_primary_evidence_owner
  BEFORE INSERT OR UPDATE OF primary_evidence_id, user_id ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION validate_transaction_primary_evidence_owner();

-- Income Review decisions -----------------------------------------------------

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

ALTER TABLE income_review_decisions
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS transaction_id uuid REFERENCES transactions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS evidence_id uuid REFERENCES transaction_evidence(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS signal_hash text,
  ADD COLUMN IF NOT EXISTS decision text,
  ADD COLUMN IF NOT EXISTS income_source_type text,
  ADD COLUMN IF NOT EXISTS confidence text NOT NULL DEFAULT 'user_confirmed',
  ADD COLUMN IF NOT EXISTS reason_code text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE income_review_decisions
  ALTER COLUMN user_id SET NOT NULL,
  ALTER COLUMN decision SET NOT NULL,
  ALTER COLUMN confidence SET NOT NULL,
  ALTER COLUMN reviewed_at SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE income_review_decisions DROP CONSTRAINT IF EXISTS income_review_decisions_target_check;
ALTER TABLE income_review_decisions
  ADD CONSTRAINT income_review_decisions_target_check
  CHECK (transaction_id IS NOT NULL OR evidence_id IS NOT NULL OR signal_hash IS NOT NULL);

ALTER TABLE income_review_decisions DROP CONSTRAINT IF EXISTS income_review_decisions_decision_check;
ALTER TABLE income_review_decisions
  ADD CONSTRAINT income_review_decisions_decision_check
  CHECK (decision IN ('count_as_income', 'not_income', 'needs_review'));

ALTER TABLE income_review_decisions DROP CONSTRAINT IF EXISTS income_review_decisions_income_source_type_check;
ALTER TABLE income_review_decisions
  ADD CONSTRAINT income_review_decisions_income_source_type_check
  CHECK (income_source_type IN ('salary', 'gig_work', 'freelance', 'business', 'cash_deposit', 'other'));

ALTER TABLE income_review_decisions DROP CONSTRAINT IF EXISTS income_review_decisions_confidence_check;
ALTER TABLE income_review_decisions
  ADD CONSTRAINT income_review_decisions_confidence_check
  CHECK (confidence IN ('user_confirmed', 'system_suggested'));

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


-- User identifiers ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  identifier_type text NOT NULL CHECK (identifier_type IN ('account', 'upi', 'phone')),
  identifier_value text NOT NULL,
  bank_name text,
  account_nickname text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, identifier_type, identifier_value)
);

ALTER TABLE user_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own accounts" ON user_accounts;
CREATE POLICY "Users can view own accounts"
  ON user_accounts FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own accounts" ON user_accounts;
CREATE POLICY "Users can insert own accounts"
  ON user_accounts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own accounts" ON user_accounts;
CREATE POLICY "Users can update own accounts"
  ON user_accounts FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own accounts" ON user_accounts;
CREATE POLICY "Users can delete own accounts"
  ON user_accounts FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_user_accounts_user_id ON user_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_accounts_identifier ON user_accounts(identifier_value);
CREATE INDEX IF NOT EXISTS idx_user_accounts_type ON user_accounts(identifier_type);

-- Credit cards ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS credit_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  bank_name text NOT NULL,
  card_name text,
  last_4_digits text NOT NULL,
  credit_limit numeric(12, 2) NOT NULL DEFAULT 0,
  current_outstanding numeric(12, 2) NOT NULL DEFAULT 0,
  due_date integer NOT NULL CHECK (due_date >= 1 AND due_date <= 31),
  billing_cycle_date integer NOT NULL CHECK (billing_cycle_date >= 1 AND billing_cycle_date <= 31),
  is_archived boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, last_4_digits)
);

ALTER TABLE credit_cards
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE credit_cards
  ALTER COLUMN is_archived SET DEFAULT false;

CREATE TABLE IF NOT EXISTS cc_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  card_id uuid REFERENCES credit_cards(id) ON DELETE CASCADE NOT NULL,
  amount numeric(12, 2) NOT NULL,
  description text,
  category text,
  transaction_date timestamptz DEFAULT now(),
  type text NOT NULL CHECK (type IN ('spend', 'payment', 'cashback', 'reversal')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE credit_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own credit cards" ON credit_cards;
CREATE POLICY "Users can view own credit cards"
  ON credit_cards FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own credit cards" ON credit_cards;
CREATE POLICY "Users can insert own credit cards"
  ON credit_cards FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own credit cards" ON credit_cards;
CREATE POLICY "Users can update own credit cards"
  ON credit_cards FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own credit cards" ON credit_cards;
CREATE POLICY "Users can delete own credit cards"
  ON credit_cards FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own cc transactions" ON cc_transactions;
CREATE POLICY "Users can view own cc transactions"
  ON cc_transactions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own cc transactions" ON cc_transactions;
CREATE POLICY "Users can insert own cc transactions"
  ON cc_transactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own cc transactions" ON cc_transactions;
CREATE POLICY "Users can update own cc transactions"
  ON cc_transactions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own cc transactions" ON cc_transactions;
CREATE POLICY "Users can delete own cc transactions"
  ON cc_transactions FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_credit_cards_user_id ON credit_cards(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_cards_last_4_digits ON credit_cards(last_4_digits);
CREATE INDEX IF NOT EXISTS idx_credit_cards_user_archived ON credit_cards(user_id, is_archived);
CREATE INDEX IF NOT EXISTS idx_credit_cards_user_archived_created ON credit_cards(user_id, is_archived, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cc_transactions_user_id ON cc_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_cc_transactions_card_id ON cc_transactions(card_id);
CREATE INDEX IF NOT EXISTS idx_cc_transactions_date ON cc_transactions(transaction_date DESC);

-- Loans ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  loan_name text NOT NULL,
  lender_name text NOT NULL,
  principal_amount numeric(12, 2) NOT NULL,
  current_outstanding numeric(12, 2) NOT NULL,
  emi_amount numeric(12, 2) NOT NULL,
  emi_due_date integer NOT NULL CHECK (emi_due_date >= 1 AND emi_due_date <= 31),
  interest_rate numeric(5, 2),
  tenure_months integer NOT NULL,
  start_date date NOT NULL,
  loan_type text NOT NULL CHECK (loan_type IN ('Home', 'Car', 'Personal', 'Education', 'Other')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emi_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid REFERENCES loans(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  amount_paid numeric(12, 2) NOT NULL,
  payment_date date NOT NULL DEFAULT current_date,
  principal_component numeric(12, 2),
  interest_component numeric(12, 2),
  reference_number text,
  created_at timestamptz DEFAULT now()
);

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

ALTER TABLE loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE emi_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own loans" ON loans;
CREATE POLICY "Users can view own loans"
  ON loans FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own loans" ON loans;
CREATE POLICY "Users can insert own loans"
  ON loans FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own loans" ON loans;
CREATE POLICY "Users can update own loans"
  ON loans FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own loans" ON loans;
CREATE POLICY "Users can delete own loans"
  ON loans FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own emi payments" ON emi_payments;
CREATE POLICY "Users can view own emi payments"
  ON emi_payments FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own emi payments" ON emi_payments;
CREATE POLICY "Users can insert own emi payments"
  ON emi_payments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own emi payments" ON emi_payments;
CREATE POLICY "Users can update own emi payments"
  ON emi_payments FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own emi payments" ON emi_payments;
CREATE POLICY "Users can delete own emi payments"
  ON emi_payments FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_loans_user_id ON loans(user_id);
CREATE INDEX IF NOT EXISTS idx_loans_lender_name ON loans(lender_name);
CREATE INDEX IF NOT EXISTS idx_emi_payments_user_id ON emi_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_emi_payments_loan_id ON emi_payments(loan_id);
CREATE INDEX IF NOT EXISTS idx_emi_payments_date ON emi_payments(payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_emi_payments_reference
  ON emi_payments(user_id, loan_id, reference_number)
  WHERE reference_number IS NOT NULL;

-- People ledger --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS people_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  person_name text NOT NULL,
  type text NOT NULL CHECK (type IN ('lent', 'borrowed')),
  total_amount numeric NOT NULL CHECK (total_amount > 0),
  paid_amount numeric NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  remaining_amount numeric GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
  repayment_type text NOT NULL CHECK (repayment_type IN ('one_time', 'installment')),
  due_date date,
  installment_amount numeric CHECK (installment_amount > 0),
  installment_days text[],
  start_date date,
  notes text,
  is_settled boolean NOT NULL DEFAULT false,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE people_ledger
  ADD COLUMN IF NOT EXISTS settled_at timestamptz;

CREATE TABLE IF NOT EXISTS people_ledger_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id uuid NOT NULL REFERENCES people_ledger(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  paid_date date NOT NULL DEFAULT current_date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE people_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE people_ledger_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own ledger entries" ON people_ledger;
CREATE POLICY "Users can view their own ledger entries"
  ON people_ledger FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own ledger entries" ON people_ledger;
CREATE POLICY "Users can insert their own ledger entries"
  ON people_ledger FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own ledger entries" ON people_ledger;
CREATE POLICY "Users can update their own ledger entries"
  ON people_ledger FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own ledger entries" ON people_ledger;
CREATE POLICY "Users can delete their own ledger entries"
  ON people_ledger FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view payments for their ledger entries" ON people_ledger_payments;
CREATE POLICY "Users can view payments for their ledger entries"
  ON people_ledger_payments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM people_ledger
      WHERE people_ledger.id = people_ledger_payments.ledger_id
        AND people_ledger.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert payments for their ledger entries" ON people_ledger_payments;
CREATE POLICY "Users can insert payments for their ledger entries"
  ON people_ledger_payments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM people_ledger
      WHERE people_ledger.id = people_ledger_payments.ledger_id
        AND people_ledger.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update payments for their ledger entries" ON people_ledger_payments;
CREATE POLICY "Users can update payments for their ledger entries"
  ON people_ledger_payments FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM people_ledger
      WHERE people_ledger.id = people_ledger_payments.ledger_id
        AND people_ledger.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM people_ledger
      WHERE people_ledger.id = people_ledger_payments.ledger_id
        AND people_ledger.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete payments for their ledger entries" ON people_ledger_payments;
CREATE POLICY "Users can delete payments for their ledger entries"
  ON people_ledger_payments FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM people_ledger
      WHERE people_ledger.id = people_ledger_payments.ledger_id
        AND people_ledger.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_people_ledger_user_id ON people_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_people_ledger_is_settled ON people_ledger(is_settled);
CREATE INDEX IF NOT EXISTS idx_people_ledger_payments_ledger_id ON people_ledger_payments(ledger_id);

-- Places and Vault -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN ('shop', 'ev_charging', 'cafe', 'atm', 'mechanic', 'other')),
  note text,
  latitude double precision,
  longitude double precision,
  address text,
  photo_uri text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE places ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own places" ON places;
CREATE POLICY "Users can manage own places"
  ON places FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_places_user_id ON places(user_id);
CREATE INDEX IF NOT EXISTS idx_places_category ON places(category);

CREATE TABLE IF NOT EXISTS vault_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  category text NOT NULL,
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE vault_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own vault items" ON vault_items;
CREATE POLICY "Users can manage their own vault items"
  ON vault_items FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_vault_items_user_id ON vault_items(user_id);

-- Balance snapshots ----------------------------------------------------------

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

-- Debit cards ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS debit_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bank_account_id uuid REFERENCES bank_accounts(id) ON DELETE SET NULL,
  bank_name text,
  card_last4 text NOT NULL CHECK (card_last4 ~ '^[0-9]{4}$'),
  card_network text,
  card_label text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'replaced', 'detected')),
  detected_confidence text DEFAULT 'low' CHECK (detected_confidence IN ('exact', 'estimated', 'low')),
  source_sender_or_package text,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN debit_cards.card_last4 IS
  'Last four digits only. Do not store full card numbers.';

ALTER TABLE debit_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own debit cards" ON debit_cards;
CREATE POLICY "Users manage own debit cards"
  ON debit_cards FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_debit_cards_unique_bank_card
  ON debit_cards(user_id, bank_account_id, card_last4)
  WHERE bank_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_debit_cards_user_id
  ON debit_cards(user_id);
CREATE INDEX IF NOT EXISTS idx_debit_cards_bank_account_id
  ON debit_cards(user_id, bank_account_id)
  WHERE bank_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_debit_cards_card_last4
  ON debit_cards(user_id, card_last4);

CREATE OR REPLACE FUNCTION validate_debit_card_bank_account_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.bank_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM bank_accounts
    WHERE id = NEW.bank_account_id
      AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Debit card bank account must belong to the same user'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_debit_card_bank_account_owner ON debit_cards;
CREATE TRIGGER trigger_validate_debit_card_bank_account_owner
  BEFORE INSERT OR UPDATE ON debit_cards
  FOR EACH ROW
  EXECUTE FUNCTION validate_debit_card_bank_account_owner();

-- Account app mappings --------------------------------------------------------

CREATE TABLE IF NOT EXISTS account_app_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_package text NOT NULL,
  app_label text,
  payment_method_hash text,
  payment_method_masked text,
  owner_type text NOT NULL CHECK (owner_type IN ('bank_account', 'credit_card', 'debit_card', 'wallet')),
  owner_id uuid NOT NULL,
  account_last4 text CHECK (account_last4 IS NULL OR account_last4 ~ '^[0-9]{4}$'),
  card_last4 text CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$'),
  bank_name text,
  confidence_level text NOT NULL DEFAULT 'medium' CHECK (confidence_level IN ('medium', 'low')),
  use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  last_confirmed_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE account_app_mappings IS
  'User-confirmed payment app mappings. Medium/low confidence hint only; never overrides bank SMS evidence.';
COMMENT ON COLUMN account_app_mappings.payment_method_masked IS
  'Masked payment method only. Do not store raw UPI IDs or full account/card numbers.';
COMMENT ON COLUMN account_app_mappings.payment_method_hash IS
  'Hash of the payment method token. Do not store raw UPI IDs here.';

ALTER TABLE account_app_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own account app mappings" ON account_app_mappings;
CREATE POLICY "Users manage own account app mappings"
  ON account_app_mappings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_account_app_mappings_package_status
  ON account_app_mappings(user_id, app_package, status);
CREATE INDEX IF NOT EXISTS idx_account_app_mappings_payment_hash
  ON account_app_mappings(user_id, payment_method_hash)
  WHERE payment_method_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_account_app_mappings_owner
  ON account_app_mappings(user_id, owner_type, owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_app_mappings_active_unique
  ON account_app_mappings(
    user_id,
    app_package,
    COALESCE(payment_method_hash, '__none__'),
    owner_type,
    owner_id
  )
  WHERE status = 'active';

CREATE OR REPLACE FUNCTION validate_account_app_mapping_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.owner_type = 'bank_account' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM bank_accounts
      WHERE id = NEW.owner_id
        AND user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'Mapped bank account must belong to the same user'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.owner_type = 'credit_card' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM credit_cards
      WHERE id = NEW.owner_id
        AND user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'Mapped credit card must belong to the same user'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.owner_type = 'debit_card' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM debit_cards
      WHERE id = NEW.owner_id
        AND user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'Mapped debit card must belong to the same user'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.owner_type = 'wallet' THEN
    RAISE EXCEPTION 'Wallet mappings are not supported until a wallet owner table exists'
      USING ERRCODE = '0A000';
  ELSE
    RAISE EXCEPTION 'Unsupported mapping owner type'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_account_app_mapping_owner ON account_app_mappings;
CREATE TRIGGER trigger_validate_account_app_mapping_owner
  BEFORE INSERT OR UPDATE ON account_app_mappings
  FOR EACH ROW
  EXECUTE FUNCTION validate_account_app_mapping_owner();

CREATE OR REPLACE FUNCTION set_account_app_mapping_updated_at()
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

DROP TRIGGER IF EXISTS trigger_set_account_app_mapping_updated_at ON account_app_mappings;
CREATE TRIGGER trigger_set_account_app_mapping_updated_at
  BEFORE UPDATE ON account_app_mappings
  FOR EACH ROW
  EXECUTE FUNCTION set_account_app_mapping_updated_at();

-- Detected accounts ----------------------------------------------------------

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

-- Credit card statements -----------------------------------------------------

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

-- RPCs and triggers ----------------------------------------------------------

CREATE OR REPLACE FUNCTION update_bank_balance(
  p_account_id uuid,
  p_amount numeric,
  p_transaction_type text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_transaction_type NOT IN ('debit', 'credit') THEN
    RAISE EXCEPTION 'Invalid transaction type: %', p_transaction_type;
  END IF;

  IF p_transaction_type = 'debit' THEN
    UPDATE bank_accounts
    SET balance = COALESCE(balance, starting_balance) - p_amount
    WHERE id = p_account_id
      AND user_id = auth.uid();
  ELSE
    UPDATE bank_accounts
    SET balance = COALESCE(balance, starting_balance) + p_amount
    WHERE id = p_account_id
      AND user_id = auth.uid();
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bank account not found or not authorized: %', p_account_id
      USING ERRCODE = '42501';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION update_bank_balance(uuid, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION delete_bank_account_cascade(
  p_account_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to delete this bank account'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM transactions
  WHERE user_id = p_user_id
    AND (
      from_account_id = p_account_id
      OR to_account_id = p_account_id
      OR account_id = p_account_id
    );

  DELETE FROM bank_accounts
  WHERE id = p_account_id
    AND user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_bank_account_cascade(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION update_card_outstanding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.type = 'spend' THEN
      UPDATE credit_cards
      SET current_outstanding = current_outstanding + NEW.amount,
          updated_at = now()
      WHERE id = NEW.card_id
        AND user_id = NEW.user_id;
    ELSIF NEW.type IN ('payment', 'cashback', 'reversal') THEN
      UPDATE credit_cards
      SET current_outstanding = GREATEST(current_outstanding - NEW.amount, 0),
          updated_at = now()
      WHERE id = NEW.card_id
        AND user_id = NEW.user_id;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.type = 'spend' THEN
    UPDATE credit_cards
    SET current_outstanding = GREATEST(current_outstanding - OLD.amount, 0),
        updated_at = now()
    WHERE id = OLD.card_id
      AND user_id = OLD.user_id;
  ELSIF OLD.type IN ('payment', 'cashback', 'reversal') THEN
    UPDATE credit_cards
    SET current_outstanding = current_outstanding + OLD.amount,
        updated_at = now()
    WHERE id = OLD.card_id
      AND user_id = OLD.user_id;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_card_outstanding ON cc_transactions;
CREATE TRIGGER trigger_update_card_outstanding
AFTER INSERT OR DELETE ON cc_transactions
FOR EACH ROW
EXECUTE FUNCTION update_card_outstanding();

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

CREATE OR REPLACE FUNCTION calculate_emi_components(
  p_outstanding numeric,
  p_interest_rate numeric,
  p_emi_amount numeric
) RETURNS TABLE(principal_component numeric, interest_component numeric)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_monthly_rate numeric;
  v_interest numeric;
  v_principal numeric;
BEGIN
  v_monthly_rate := p_interest_rate / 12 / 100;
  v_interest := p_outstanding * v_monthly_rate;
  v_principal := p_emi_amount - v_interest;

  IF v_principal > p_outstanding THEN
    v_principal := p_outstanding;
    v_interest := p_emi_amount - v_principal;
  END IF;

  RETURN QUERY SELECT v_principal, v_interest;
END;
$$;

CREATE OR REPLACE FUNCTION update_ledger_paid_amount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ledger_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_ledger_id := OLD.ledger_id;
  ELSE
    v_ledger_id := NEW.ledger_id;
  END IF;

  UPDATE people_ledger
  SET paid_amount = (
    SELECT COALESCE(SUM(amount), 0)
    FROM people_ledger_payments
    WHERE ledger_id = v_ledger_id
  )
  WHERE id = v_ledger_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_paid_amount_on_insert ON people_ledger_payments;
CREATE TRIGGER trigger_update_paid_amount_on_insert
AFTER INSERT ON people_ledger_payments
FOR EACH ROW
EXECUTE FUNCTION update_ledger_paid_amount();

DROP TRIGGER IF EXISTS trigger_update_paid_amount_on_update ON people_ledger_payments;
CREATE TRIGGER trigger_update_paid_amount_on_update
AFTER UPDATE ON people_ledger_payments
FOR EACH ROW
EXECUTE FUNCTION update_ledger_paid_amount();

DROP TRIGGER IF EXISTS trigger_update_paid_amount_on_delete ON people_ledger_payments;
CREATE TRIGGER trigger_update_paid_amount_on_delete
AFTER DELETE ON people_ledger_payments
FOR EACH ROW
EXECUTE FUNCTION update_ledger_paid_amount();

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

-- Storage --------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'place-photos',
  'place-photos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Anyone can view place photos" ON storage.objects;
CREATE POLICY "Anyone can view place photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'place-photos');

DROP POLICY IF EXISTS "Users can upload own place photos" ON storage.objects;
CREATE POLICY "Users can upload own place photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'place-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can update own place photos" ON storage.objects;
CREATE POLICY "Users can update own place photos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'place-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'place-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can delete own place photos" ON storage.objects;
CREATE POLICY "Users can delete own place photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'place-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Verification summary -------------------------------------------------------

SELECT 'SpendSense fresh Supabase setup complete' AS status;
