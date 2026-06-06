-- Migration: Force Delete Financial Owner Cascade
-- Deletes a financial owner and all its related dependencies (transactions, snapshots, etc.)

CREATE OR REPLACE FUNCTION force_delete_financial_owner_cascade(
  p_owner_type text,
  p_owner_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_last4 text;
  v_deleted_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_owner_type = 'bank_account' THEN
    SELECT ba.account_last4
    INTO v_last4
    FROM bank_accounts ba
    WHERE ba.id = p_owner_id
      AND ba.user_id = v_user_id
    FOR UPDATE;
  ELSIF p_owner_type = 'credit_card' THEN
    SELECT cc.last_4_digits
    INTO v_last4
    FROM credit_cards cc
    WHERE cc.id = p_owner_id
      AND cc.user_id = v_user_id
    FOR UPDATE;
  ELSIF p_owner_type = 'debit_card' THEN
    SELECT dc.card_last4
    INTO v_last4
    FROM debit_cards dc
    WHERE dc.id = p_owner_id
      AND dc.user_id = v_user_id
    FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'Unsupported account removal owner type' USING ERRCODE = '22023';
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account or card not found' USING ERRCODE = 'P0002';
  END IF;

  -- 1. Delete transactions
  DELETE FROM transactions t
  WHERE t.user_id = v_user_id
    AND (
      (
        p_owner_type = 'bank_account'
        AND (
          t.account_id = p_owner_id
          OR t.from_account_id = p_owner_id
          OR t.to_account_id = p_owner_id
        )
      )
      OR (
        t.account_match_owner_type = p_owner_type
        AND t.account_match_owner_id = p_owner_id
      )
    );

  -- 2. Delete transaction evidence
  IF v_last4 IS NOT NULL THEN
    DELETE FROM transaction_evidence te
    WHERE te.user_id = v_user_id
      AND (
        (p_owner_type = 'bank_account' AND te.account_last4 = v_last4)
        OR (p_owner_type <> 'bank_account' AND te.card_last4 = v_last4)
      );
  END IF;

  -- 3. Delete balance snapshots
  DELETE FROM balance_snapshots bs
  WHERE bs.user_id = v_user_id
    AND bs.owner_type = p_owner_type
    AND bs.owner_id = p_owner_id;

  -- 4. Delete credit card specifics
  IF p_owner_type = 'credit_card' THEN
    DELETE FROM credit_card_statements ccs
    WHERE ccs.user_id = v_user_id
      AND ccs.credit_card_id = p_owner_id;
      
    DELETE FROM cc_transactions cct
    WHERE cct.user_id = v_user_id
      AND cct.card_id = p_owner_id;
  END IF;

  -- 5. Delete bank account specifics (debit cards)
  IF p_owner_type = 'bank_account' THEN
    DELETE FROM debit_cards dc
    WHERE dc.user_id = v_user_id
      AND dc.bank_account_id = p_owner_id;
  END IF;

  -- 6. Delete account app mappings
  DELETE FROM account_app_mappings aam
  WHERE aam.user_id = v_user_id
    AND aam.owner_type = p_owner_type
    AND aam.owner_id = p_owner_id;

  -- 7. Reset detected accounts (we don't delete the detection, just unlink it so it can be re-reviewed if needed)
  UPDATE detected_accounts da
  SET status = 'pending',
      matched_owner_type = NULL,
      matched_owner_id = NULL,
      updated_at = now()
  WHERE da.user_id = v_user_id
    AND da.matched_owner_type = p_owner_type
    AND da.matched_owner_id = p_owner_id;

  -- 8. Delete the owner itself
  IF p_owner_type = 'bank_account' THEN
    DELETE FROM bank_accounts ba
    WHERE ba.id = p_owner_id
      AND ba.user_id = v_user_id;
  ELSIF p_owner_type = 'credit_card' THEN
    DELETE FROM credit_cards cc
    WHERE cc.id = p_owner_id
      AND cc.user_id = v_user_id;
  ELSE
    DELETE FROM debit_cards dc
    WHERE dc.id = p_owner_id
      AND dc.user_id = v_user_id;
  END IF;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  IF v_deleted_count <> 1 THEN
    RAISE EXCEPTION 'Account or card could not be deleted' USING ERRCODE = 'P0002';
  END IF;

  RETURN 'deleted';
END;
$$;

REVOKE ALL ON FUNCTION force_delete_financial_owner_cascade(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION force_delete_financial_owner_cascade(text, uuid) TO authenticated;
