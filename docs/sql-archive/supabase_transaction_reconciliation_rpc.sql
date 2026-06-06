-- Task 28F: Atomic user-confirmed transaction account reconciliation.
-- Run manually after the transaction evidence and account app mapping foundations.
-- This RPC links existing rows only. It never creates financial rows or changes balances.

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS account_match_owner_type text,
  ADD COLUMN IF NOT EXISTS account_match_owner_id uuid;

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_account_match_owner_check;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_account_match_owner_check
  CHECK (
    (account_match_owner_type IS NULL AND account_match_owner_id IS NULL)
    OR (
      account_match_owner_type IN ('bank_account', 'credit_card', 'debit_card')
      AND account_match_owner_id IS NOT NULL
    )
  );

CREATE INDEX IF NOT EXISTS idx_transactions_account_match_owner
  ON transactions(user_id, account_match_owner_type, account_match_owner_id)
  WHERE account_match_owner_id IS NOT NULL;

CREATE OR REPLACE FUNCTION normalize_transaction_match_reference(
  p_reference text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reference text;
BEGIN
  v_reference := upper(btrim(coalesce(p_reference, '')));
  v_reference := regexp_replace(
    v_reference,
    '^(UPI[[:space:]]*)?(REF(ERENCE)?[[:space:]]*(NO)?|UTR|TXN[[:space:]]*ID|TXN|TRANSACTION|RRN)[:# -]*',
    '',
    'i'
  );
  v_reference := regexp_replace(v_reference, '[^A-Z0-9]', '', 'g');

  IF length(v_reference) < 6 OR v_reference ~ '^(91)?[6-9][0-9]{9}$' THEN
    RETURN NULL;
  END IF;

  RETURN v_reference;
END;
$$;

DROP FUNCTION IF EXISTS confirm_transaction_account_match(uuid, text, uuid, uuid[], text, text);

CREATE OR REPLACE FUNCTION confirm_transaction_account_match(
  p_transaction_id uuid,
  p_owner_type text,
  p_owner_id uuid,
  p_evidence_ids uuid[],
  p_confidence text,
  p_reason text
)
RETURNS TABLE(transaction_id uuid, status text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_transaction transactions%ROWTYPE;
  v_owner_type text := lower(btrim(coalesce(p_owner_type, '')));
  v_confidence text := lower(btrim(coalesce(p_confidence, '')));
  v_reason text := lower(btrim(coalesce(p_reason, '')));
  v_owner_last4 text;
  v_primary_evidence_id uuid;
  v_requested_evidence_count integer;
  v_owned_evidence_count integer;
  v_expected_direction text;
  v_has_owner_proof boolean := false;
  v_has_conflicting_proof boolean := false;
  v_has_exact_reference boolean := false;
  v_has_amount_time_proof boolean := false;
  v_all_evidence_already_linked boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF v_owner_type NOT IN ('bank_account', 'credit_card', 'debit_card') THEN
    RAISE EXCEPTION 'Unsupported owner type' USING ERRCODE = '22023';
  END IF;

  IF v_confidence NOT IN ('exact', 'high', 'medium') THEN
    RAISE EXCEPTION 'Confirmed match confidence must be exact, high, or medium'
      USING ERRCODE = '22023';
  END IF;

  IF v_reason !~ '^[a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'Match reason must be a safe reason token'
      USING ERRCODE = '22023';
  END IF;

  IF (v_confidence = 'exact' AND v_reason <> 'same_reference_bank_evidence')
     OR (v_confidence = 'high' AND v_reason <> 'amount_time_single_bank_evidence')
     OR (
       v_confidence = 'medium'
       AND v_reason NOT IN ('user_mapping_hint', 'manual_user_choice')
     ) THEN
    RAISE EXCEPTION 'Confidence and match reason are incompatible'
      USING ERRCODE = '22023';
  END IF;

  IF p_evidence_ids IS NULL
     OR cardinality(p_evidence_ids) = 0
     OR array_position(p_evidence_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'At least one evidence id is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT t.*
  INTO v_transaction
  FROM transactions t
  WHERE t.id = p_transaction_id
    AND t.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction was not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_transaction.type IN ('transfer', 'refund', 'emi') THEN
    RAISE EXCEPTION 'Protected transaction type requires separate review'
      USING ERRCODE = '22023';
  END IF;

  v_expected_direction := CASE
    WHEN v_transaction.type IN ('income', 'borrowed') THEN 'credit'
    WHEN v_transaction.type IN ('expense', 'investment', 'lent') THEN 'debit'
    ELSE NULL
  END;

  IF v_owner_type = 'bank_account' THEN
    SELECT ba.account_last4
    INTO v_owner_last4
    FROM bank_accounts ba
    WHERE ba.id = p_owner_id
      AND ba.user_id = v_user_id
      AND ba.account_type IN ('savings', 'current')
    FOR UPDATE;
  ELSIF v_owner_type = 'credit_card' THEN
    SELECT cc.last_4_digits
    INTO v_owner_last4
    FROM credit_cards cc
    WHERE cc.id = p_owner_id
      AND cc.user_id = v_user_id
    FOR UPDATE;
  ELSE
    SELECT dc.card_last4
    INTO v_owner_last4
    FROM debit_cards dc
    WHERE dc.id = p_owner_id
      AND dc.user_id = v_user_id
      AND dc.status IN ('active', 'detected')
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected owner was not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_owner_last4 !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'Selected owner requires a safe last4 value'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT requested.evidence_id)
  INTO v_requested_evidence_count
  FROM unnest(p_evidence_ids) WITH ORDINALITY AS requested(evidence_id, ordinal);

  SELECT requested.evidence_id
  INTO v_primary_evidence_id
  FROM unnest(p_evidence_ids) WITH ORDINALITY AS requested(evidence_id, ordinal)
  ORDER BY requested.ordinal
  LIMIT 1;

  PERFORM 1
  FROM transaction_evidence te
  WHERE te.user_id = v_user_id
    AND te.id = ANY(p_evidence_ids)
  ORDER BY te.id
  FOR UPDATE;

  SELECT count(DISTINCT te.id)
  INTO v_owned_evidence_count
  FROM transaction_evidence te
  WHERE te.user_id = v_user_id
    AND te.id = ANY(p_evidence_ids);

  IF v_owned_evidence_count <> v_requested_evidence_count THEN
    RAISE EXCEPTION 'Evidence was not found' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM transaction_evidence te
    WHERE te.user_id = v_user_id
      AND te.id = ANY(p_evidence_ids)
      AND te.transaction_id IS NOT NULL
      AND te.transaction_id <> v_transaction.id
  ) THEN
    RAISE EXCEPTION 'Evidence is already linked to a different transaction';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM transaction_evidence te
    WHERE te.user_id = v_user_id
      AND te.id = ANY(p_evidence_ids)
      AND NOT coalesce((
        te.transaction_id = v_transaction.id
        OR (
          normalize_transaction_match_reference(te.reference_number) IS NOT NULL
          AND normalize_transaction_match_reference(te.reference_number)
            = normalize_transaction_match_reference(v_transaction.reference_number)
        )
        OR (
          te.amount IS NOT NULL
          AND abs(te.amount - v_transaction.amount) <= 0.01
          AND te.captured_at BETWEEN
            v_transaction.created_at - interval '2 minutes'
            AND v_transaction.created_at + interval '2 minutes'
        )
      ), false)
  ) THEN
    RAISE EXCEPTION 'Evidence is not compatible with the selected transaction';
  END IF;

  IF v_expected_direction IS NOT NULL AND EXISTS (
    SELECT 1
    FROM transaction_evidence te
    WHERE te.user_id = v_user_id
      AND te.id = ANY(p_evidence_ids)
      AND te.direction IS NOT NULL
      AND te.direction <> 'unknown'
      AND te.direction <> v_expected_direction
  ) THEN
    RAISE EXCEPTION 'Evidence direction conflicts with the selected transaction';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM transaction_evidence te
    WHERE te.user_id = v_user_id
      AND te.id = ANY(p_evidence_ids)
      AND te.source_type = 'sms'
      AND (
        (v_owner_type = 'bank_account' AND te.account_last4 = v_owner_last4)
        OR (v_owner_type IN ('credit_card', 'debit_card') AND te.card_last4 = v_owner_last4)
      )
  )
  INTO v_has_owner_proof;

  SELECT EXISTS (
    SELECT 1
    FROM transaction_evidence te
    WHERE te.user_id = v_user_id
      AND te.id = ANY(p_evidence_ids)
      AND te.source_type = 'sms'
      AND (
        (
          v_owner_type = 'bank_account'
          AND (
            (te.account_last4 IS NOT NULL AND te.account_last4 <> v_owner_last4)
            OR te.card_last4 IS NOT NULL
          )
        )
        OR (
          v_owner_type IN ('credit_card', 'debit_card')
          AND (
            (te.card_last4 IS NOT NULL AND te.card_last4 <> v_owner_last4)
            OR te.account_last4 IS NOT NULL
          )
        )
      )
  )
  INTO v_has_conflicting_proof;

  IF NOT v_has_owner_proof THEN
    RAISE EXCEPTION 'Bank or card last4 proof required; UPI-only evidence cannot confirm an account match'
      USING ERRCODE = '22023';
  END IF;

  IF v_has_conflicting_proof THEN
    RAISE EXCEPTION 'Conflicting bank or card evidence requires manual review'
      USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM transaction_evidence proof
    WHERE proof.user_id = v_user_id
      AND proof.id = ANY(p_evidence_ids)
      AND proof.source_type = 'sms'
      AND (
        (v_owner_type = 'bank_account' AND proof.account_last4 = v_owner_last4)
        OR (v_owner_type IN ('credit_card', 'debit_card') AND proof.card_last4 = v_owner_last4)
      )
      AND normalize_transaction_match_reference(proof.reference_number) IS NOT NULL
      AND (
        normalize_transaction_match_reference(proof.reference_number)
          = normalize_transaction_match_reference(v_transaction.reference_number)
        OR EXISTS (
          SELECT 1
          FROM transaction_evidence corroborating
          WHERE corroborating.user_id = v_user_id
            AND corroborating.id = ANY(p_evidence_ids)
            AND corroborating.id <> proof.id
            AND normalize_transaction_match_reference(corroborating.reference_number)
              = normalize_transaction_match_reference(proof.reference_number)
        )
      )
  )
  INTO v_has_exact_reference;

  SELECT EXISTS (
    SELECT 1
    FROM transaction_evidence proof
    WHERE proof.user_id = v_user_id
      AND proof.id = ANY(p_evidence_ids)
      AND proof.source_type = 'sms'
      AND (
        (v_owner_type = 'bank_account' AND proof.account_last4 = v_owner_last4)
        OR (v_owner_type IN ('credit_card', 'debit_card') AND proof.card_last4 = v_owner_last4)
      )
      AND proof.amount IS NOT NULL
      AND abs(proof.amount - v_transaction.amount) <= 0.01
      AND proof.captured_at BETWEEN
        v_transaction.created_at - interval '2 minutes'
        AND v_transaction.created_at + interval '2 minutes'
  )
  INTO v_has_amount_time_proof;

  IF v_confidence = 'exact' AND NOT v_has_exact_reference THEN
    RAISE EXCEPTION 'Exact confidence requires same reference and bank or card last4 proof'
      USING ERRCODE = '22023';
  END IF;

  IF v_confidence = 'high' AND NOT v_has_amount_time_proof THEN
    RAISE EXCEPTION 'High confidence requires amount, time, and bank or card last4 proof'
      USING ERRCODE = '22023';
  END IF;

  IF v_transaction.account_match_owner_id IS NOT NULL
     AND (
       v_transaction.account_match_owner_type <> v_owner_type
       OR v_transaction.account_match_owner_id <> p_owner_id
     ) THEN
    RAISE EXCEPTION 'Transaction is linked to a different owner; manual review required';
  END IF;

  IF v_owner_type = 'bank_account'
     AND v_transaction.account_id IS NOT NULL
     AND v_transaction.account_id <> p_owner_id THEN
    RAISE EXCEPTION 'Transaction is linked to a different bank account; manual review required';
  END IF;

  IF v_owner_type <> 'bank_account' AND v_transaction.account_id IS NOT NULL THEN
    RAISE EXCEPTION 'Transaction already has a bank account; manual review required';
  END IF;

  IF v_transaction.account_match_status IN ('linked', 'manual_confirmed')
     AND v_transaction.account_match_owner_id IS NULL THEN
    RAISE EXCEPTION 'Existing account match requires manual review';
  END IF;

  SELECT NOT EXISTS (
    SELECT 1
    FROM transaction_evidence te
    WHERE te.user_id = v_user_id
      AND te.id = ANY(p_evidence_ids)
      AND (
        te.transaction_id IS DISTINCT FROM v_transaction.id
        OR te.match_status <> 'linked'
      )
  )
  INTO v_all_evidence_already_linked;

  IF v_transaction.account_match_owner_type = v_owner_type
     AND v_transaction.account_match_owner_id = p_owner_id
     AND v_all_evidence_already_linked THEN
    RETURN QUERY SELECT v_transaction.id, 'manual_confirmed'::text;
    RETURN;
  END IF;

  UPDATE transaction_evidence te
  SET transaction_id = v_transaction.id,
      match_status = 'linked',
      confidence_level = v_confidence,
      match_reason_code = v_reason
  WHERE te.user_id = v_user_id
    AND te.id = ANY(p_evidence_ids);

  UPDATE transactions t
  SET account_id = CASE
        WHEN v_owner_type = 'bank_account' THEN p_owner_id
        ELSE t.account_id
      END,
      account_last4 = v_owner_last4,
      account_match_status = 'manual_confirmed',
      account_match_confidence = v_confidence,
      account_match_reason = v_reason,
      account_match_owner_type = v_owner_type,
      account_match_owner_id = p_owner_id,
      primary_evidence_id = v_primary_evidence_id
  WHERE t.id = v_transaction.id
    AND t.user_id = v_user_id;

  RETURN QUERY SELECT v_transaction.id, 'manual_confirmed'::text;
END;
$$;

REVOKE ALL ON FUNCTION normalize_transaction_match_reference(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION confirm_transaction_account_match(uuid, text, uuid, uuid[], text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION normalize_transaction_match_reference(text) TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_transaction_account_match(uuid, text, uuid, uuid[], text, text) TO authenticated;
