-- Migration: Atomic Bank Account Deletion with Cascade
-- This function ensures that bank account deletion and related transactions
-- are deleted atomically (all or nothing) to prevent partial state.

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

  -- First, delete all related transactions
  -- This handles foreign key constraints from transactions table
  DELETE FROM transactions 
  WHERE user_id = p_user_id
  AND (
    from_account_id = p_account_id 
    OR to_account_id = p_account_id 
    OR account_id = p_account_id
  );
  
  -- Then, delete the bank account itself
  DELETE FROM bank_accounts 
  WHERE id = p_account_id 
  AND user_id = p_user_id;
  
  -- If we reach here, both operations succeeded
  -- PostgreSQL will commit the transaction automatically
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION delete_bank_account_cascade(uuid, uuid) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION delete_bank_account_cascade IS 
'Atomically deletes a bank account and all its related transactions. Ensures data consistency by performing both operations in a single transaction.';
