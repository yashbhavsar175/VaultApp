-- Credit Cards Table
CREATE TABLE IF NOT EXISTS credit_cards (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  bank_name TEXT NOT NULL,
  card_name TEXT,
  last_4_digits TEXT NOT NULL,
  credit_limit DECIMAL(12, 2) NOT NULL DEFAULT 0,
  current_outstanding DECIMAL(12, 2) NOT NULL DEFAULT 0,
  due_date INTEGER NOT NULL CHECK (due_date >= 1 AND due_date <= 31),
  billing_cycle_date INTEGER NOT NULL CHECK (billing_cycle_date >= 1 AND billing_cycle_date <= 31),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, last_4_digits)
);

-- Credit Card Transactions Table
CREATE TABLE IF NOT EXISTS cc_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  card_id UUID REFERENCES credit_cards(id) ON DELETE CASCADE NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  description TEXT,
  category TEXT,
  transaction_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  type TEXT NOT NULL CHECK (type IN ('spend', 'payment', 'cashback', 'reversal')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE credit_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for credit_cards
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
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own credit cards" ON credit_cards;
CREATE POLICY "Users can delete own credit cards"
  ON credit_cards FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for cc_transactions
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
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own cc transactions" ON cc_transactions;
CREATE POLICY "Users can delete own cc transactions"
  ON cc_transactions FOR DELETE
  USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_credit_cards_user_id ON credit_cards(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_cards_last_4_digits ON credit_cards(last_4_digits);
CREATE INDEX IF NOT EXISTS idx_cc_transactions_user_id ON cc_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_cc_transactions_card_id ON cc_transactions(card_id);
CREATE INDEX IF NOT EXISTS idx_cc_transactions_date ON cc_transactions(transaction_date DESC);

-- Function to update outstanding balance
CREATE OR REPLACE FUNCTION update_card_outstanding()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.type = 'spend' THEN
      UPDATE credit_cards 
      SET current_outstanding = current_outstanding + NEW.amount,
          updated_at = NOW()
      WHERE id = NEW.card_id;
    ELSIF NEW.type IN ('payment', 'cashback', 'reversal') THEN
      UPDATE credit_cards 
      SET current_outstanding = GREATEST(current_outstanding - NEW.amount, 0),
          updated_at = NOW()
      WHERE id = NEW.card_id;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.type = 'spend' THEN
      UPDATE credit_cards 
      SET current_outstanding = GREATEST(current_outstanding - OLD.amount, 0),
          updated_at = NOW()
      WHERE id = OLD.card_id;
    ELSIF OLD.type IN ('payment', 'cashback', 'reversal') THEN
      UPDATE credit_cards 
      SET current_outstanding = current_outstanding + OLD.amount,
          updated_at = NOW()
      WHERE id = OLD.card_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update outstanding balance
DROP TRIGGER IF EXISTS trigger_update_card_outstanding ON cc_transactions;
CREATE TRIGGER trigger_update_card_outstanding
AFTER INSERT OR DELETE ON cc_transactions
FOR EACH ROW
EXECUTE FUNCTION update_card_outstanding();
