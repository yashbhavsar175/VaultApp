-- Task 28B: Payment app to account mapping foundation.
-- User-confirmed mappings are medium/low confidence hints only.
-- They must never override bank SMS/notification evidence.

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
