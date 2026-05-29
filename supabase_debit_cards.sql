-- Task 26B: Debit cards foundation.
-- Multiple debit cards can link to one bank account without storing full card numbers.

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
