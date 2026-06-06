-- Create people_ledger table
CREATE TABLE IF NOT EXISTS people_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  person_name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('lent', 'borrowed')),
  total_amount NUMERIC NOT NULL CHECK (total_amount > 0),
  paid_amount NUMERIC NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  remaining_amount NUMERIC GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
  repayment_type TEXT NOT NULL CHECK (repayment_type IN ('one_time', 'installment')),
  due_date DATE,
  installment_amount NUMERIC CHECK (installment_amount > 0),
  installment_days TEXT[],
  start_date DATE,
  notes TEXT,
  is_settled BOOLEAN NOT NULL DEFAULT false,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE people_ledger
ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;

-- Create people_ledger_payments table
CREATE TABLE IF NOT EXISTS people_ledger_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES people_ledger(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  paid_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_people_ledger_user_id ON people_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_people_ledger_is_settled ON people_ledger(is_settled);
CREATE INDEX IF NOT EXISTS idx_people_ledger_payments_ledger_id ON people_ledger_payments(ledger_id);

-- Enable Row Level Security
ALTER TABLE people_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE people_ledger_payments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for people_ledger
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
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own ledger entries" ON people_ledger;
CREATE POLICY "Users can delete their own ledger entries"
  ON people_ledger FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for people_ledger_payments
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

-- Function to automatically update paid_amount when payment is added
CREATE OR REPLACE FUNCTION update_ledger_paid_amount()
RETURNS TRIGGER AS $$
DECLARE
  v_ledger_id UUID;
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
$$ LANGUAGE plpgsql;

-- Trigger to update paid_amount on payment insert
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

-- Trigger to update paid_amount on payment delete
DROP TRIGGER IF EXISTS trigger_update_paid_amount_on_delete ON people_ledger_payments;
CREATE TRIGGER trigger_update_paid_amount_on_delete
AFTER DELETE ON people_ledger_payments
FOR EACH ROW
EXECUTE FUNCTION update_ledger_paid_amount();
