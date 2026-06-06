-- Task 31E: Debt Freedom Coach user-owned planning settings.
-- Stores numeric planning targets only. No raw transactions, SMS, notifications,
-- profile payloads, notes, UPI IDs, account numbers, or card numbers.

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
