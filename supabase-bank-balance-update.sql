-- RPC Function to Update Bank Account Balance
-- This function safely updates bank account balances after SMS transactions
-- Prevents race conditions by using atomic operations

CREATE OR REPLACE FUNCTION update_bank_balance(
  p_account_id UUID,
  p_amount NUMERIC,
  p_transaction_type TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Validate transaction type
  IF p_transaction_type NOT IN ('debit', 'credit') THEN
    RAISE EXCEPTION 'Invalid transaction type: %', p_transaction_type;
  END IF;

  -- Update balance based on transaction type
  IF p_transaction_type = 'debit' THEN
    -- Debit: subtract from balance
    UPDATE bank_accounts
    SET balance = COALESCE(balance, starting_balance) - p_amount
    WHERE id = p_account_id;
  ELSE
    -- Credit: add to balance
    UPDATE bank_accounts
    SET balance = COALESCE(balance, starting_balance) + p_amount
    WHERE id = p_account_id;
  END IF;

  -- Check if update affected any rows
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bank account not found: %', p_account_id;
  END IF;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION update_bank_balance(UUID, NUMERIC, TEXT) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION update_bank_balance IS 'Updates bank account balance after SMS transaction processing. Handles both debit and credit transactions atomically.';
