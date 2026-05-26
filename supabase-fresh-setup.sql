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
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

ALTER TABLE bank_accounts
  ALTER COLUMN account_type SET DEFAULT 'savings',
  ALTER COLUMN starting_balance SET DEFAULT 0,
  ALTER COLUMN balance SET DEFAULT 0,
  ALTER COLUMN credit_limit SET DEFAULT 0,
  ALTER COLUMN loan_total SET DEFAULT 0,
  ALTER COLUMN upi_ids SET DEFAULT '{}';

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
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, last_4_digits)
);

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
