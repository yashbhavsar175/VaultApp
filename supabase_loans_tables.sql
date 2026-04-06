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
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE emi_payments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for loans
CREATE POLICY "Users can view own loans"
  ON loans FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own loans"
  ON loans FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own loans"
  ON loans FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own loans"
  ON loans FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for emi_payments
CREATE POLICY "Users can view own emi payments"
  ON emi_payments FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own emi payments"
  ON emi_payments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own emi payments"
  ON emi_payments FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own emi payments"
  ON emi_payments FOR DELETE
  USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX idx_loans_user_id ON loans(user_id);
CREATE INDEX idx_loans_lender_name ON loans(lender_name);
CREATE INDEX idx_emi_payments_user_id ON emi_payments(user_id);
CREATE INDEX idx_emi_payments_loan_id ON emi_payments(loan_id);
CREATE INDEX idx_emi_payments_date ON emi_payments(payment_date DESC);

-- Function to update outstanding balance on EMI payment
CREATE OR REPLACE FUNCTION update_loan_outstanding()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE loans 
    SET current_outstanding = GREATEST(current_outstanding - NEW.amount_paid, 0),
        updated_at = NOW()
    WHERE id = NEW.loan_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE loans 
    SET current_outstanding = current_outstanding + OLD.amount_paid,
        updated_at = NOW()
    WHERE id = OLD.loan_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update outstanding balance
CREATE TRIGGER trigger_update_loan_outstanding
AFTER INSERT OR DELETE ON emi_payments
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
