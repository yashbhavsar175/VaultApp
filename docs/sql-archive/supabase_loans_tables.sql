-- Loans Table
CREATE TABLE IF NOT EXISTS loans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  loan_name TEXT NOT NULL,
  lender_name TEXT NOT NULL,
  principal_amount DECIMAL(12, 2) NOT NULL,
  current_outstanding DECIMAL(12, 2) NOT NULL,
  emi_amount DECIMAL(12, 2) NOT NULL,
  emi_due_date INTEGER NOT NULL CHECK (emi_due_date >= 1 AND emi_due_date <= 31),
  interest_rate DECIMAL(5, 2),
  tenure_months INTEGER NOT NULL,
  start_date DATE NOT NULL,
  loan_type TEXT NOT NULL CHECK (loan_type IN ('Home', 'Car', 'Personal', 'Education', 'Other')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- EMI Payments Table
CREATE TABLE IF NOT EXISTS emi_payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  loan_id UUID REFERENCES loans(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  amount_paid DECIMAL(12, 2) NOT NULL,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  principal_component DECIMAL(12, 2),
  interest_component DECIMAL(12, 2),
  reference_number TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE emi_payments
  ADD COLUMN IF NOT EXISTS reference_number TEXT;

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

-- Enable RLS
ALTER TABLE loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE emi_payments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for loans
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
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own loans" ON loans;
CREATE POLICY "Users can delete own loans"
  ON loans FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for emi_payments
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
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own emi payments" ON emi_payments;
CREATE POLICY "Users can delete own emi payments"
  ON emi_payments FOR DELETE
  USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_loans_user_id ON loans(user_id);
CREATE INDEX IF NOT EXISTS idx_loans_lender_name ON loans(lender_name);
CREATE INDEX IF NOT EXISTS idx_emi_payments_user_id ON emi_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_emi_payments_loan_id ON emi_payments(loan_id);
CREATE INDEX IF NOT EXISTS idx_emi_payments_date ON emi_payments(payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_emi_payments_reference
  ON emi_payments(user_id, loan_id, reference_number)
  WHERE reference_number IS NOT NULL;

-- Function to update outstanding balance on EMI payment
CREATE OR REPLACE FUNCTION update_loan_outstanding()
RETURNS TRIGGER AS $$
DECLARE
  v_old_principal DECIMAL;
  v_new_principal DECIMAL;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new_principal := COALESCE(NEW.principal_component, NEW.amount_paid);

    UPDATE loans 
    SET current_outstanding = GREATEST(current_outstanding - v_new_principal, 0),
        updated_at = NOW()
    WHERE id = NEW.loan_id
      AND user_id = NEW.user_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    v_old_principal := COALESCE(OLD.principal_component, OLD.amount_paid);

    UPDATE loans 
    SET current_outstanding = current_outstanding + v_old_principal,
        updated_at = NOW()
    WHERE id = OLD.loan_id
      AND user_id = OLD.user_id;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old_principal := COALESCE(OLD.principal_component, OLD.amount_paid);
    v_new_principal := COALESCE(NEW.principal_component, NEW.amount_paid);

    UPDATE loans 
    SET current_outstanding = current_outstanding + v_old_principal,
        updated_at = NOW()
    WHERE id = OLD.loan_id
      AND user_id = OLD.user_id;

    UPDATE loans 
    SET current_outstanding = GREATEST(current_outstanding - v_new_principal, 0),
        updated_at = NOW()
    WHERE id = NEW.loan_id
      AND user_id = NEW.user_id;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update outstanding balance
DROP TRIGGER IF EXISTS trigger_update_loan_outstanding ON emi_payments;
CREATE TRIGGER trigger_update_loan_outstanding
AFTER INSERT OR UPDATE OR DELETE ON emi_payments
FOR EACH ROW
EXECUTE FUNCTION update_loan_outstanding();

-- Function to calculate EMI components (principal vs interest)
CREATE OR REPLACE FUNCTION calculate_emi_components(
  p_outstanding DECIMAL,
  p_interest_rate DECIMAL,
  p_emi_amount DECIMAL
) RETURNS TABLE(principal_component DECIMAL, interest_component DECIMAL) AS $$
DECLARE
  v_monthly_rate DECIMAL;
  v_interest DECIMAL;
  v_principal DECIMAL;
BEGIN
  -- Calculate monthly interest rate
  v_monthly_rate := p_interest_rate / 12 / 100;
  
  -- Calculate interest component
  v_interest := p_outstanding * v_monthly_rate;
  
  -- Calculate principal component
  v_principal := p_emi_amount - v_interest;
  
  -- Ensure principal doesn't exceed outstanding
  IF v_principal > p_outstanding THEN
    v_principal := p_outstanding;
    v_interest := p_emi_amount - v_principal;
  END IF;
  
  RETURN QUERY SELECT v_principal, v_interest;
END;
$$ LANGUAGE plpgsql;
