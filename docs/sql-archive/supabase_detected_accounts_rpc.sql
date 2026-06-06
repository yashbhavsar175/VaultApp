-- Task 26H: Atomic detected account/card confirmation and merge RPCs.
-- Run this file manually in the Supabase SQL Editor after the base financial
-- tables and Task 26B foundation tables are installed.

DROP FUNCTION IF EXISTS confirm_detected_bank_account(uuid, text, text, text);
DROP FUNCTION IF EXISTS confirm_detected_credit_card(uuid, text, text, text);
DROP FUNCTION IF EXISTS confirm_detected_credit_card(uuid, text, text, text, numeric, integer, integer);
DROP FUNCTION IF EXISTS confirm_detected_debit_card(uuid, uuid, text);
DROP FUNCTION IF EXISTS confirm_detected_debit_card(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS merge_detected_account(uuid, text, uuid);
DROP FUNCTION IF EXISTS ignore_detected_account_rpc(uuid);

CREATE OR REPLACE FUNCTION confirm_detected_bank_account(
  p_detection_id uuid,
  p_bank_name text,
  p_account_last4 text,
  p_account_type text
)
RETURNS TABLE(owner_id uuid, status text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_detection detected_accounts%ROWTYPE;
  v_bank_name text;
  v_bank_name_key text;
  v_account_last4 text;
  v_account_type text;
  v_existing bank_accounts%ROWTYPE;
  v_source_snapshot balance_snapshots%ROWTYPE;
  v_owner_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT *
  INTO v_detection
  FROM detected_accounts
  WHERE id = p_detection_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Detection was not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_detection.status IN ('confirmed', 'merged')
     AND v_detection.matched_owner_type = 'bank_account'
     AND v_detection.matched_owner_id IS NOT NULL THEN
    RETURN QUERY SELECT v_detection.matched_owner_id, v_detection.status;
    RETURN;
  END IF;

  IF v_detection.status <> 'pending' THEN
    RAISE EXCEPTION 'Detection has already been reviewed';
  END IF;

  IF v_detection.detection_type <> 'bank_account' THEN
    RAISE EXCEPTION 'Detection is not a bank account';
  END IF;

  v_bank_name := left(
    regexp_replace(coalesce(btrim(p_bank_name), ''), '[^[:alnum:] .&/-]', '', 'g'),
    64
  );
  IF nullif(v_bank_name, '') IS NULL THEN
    RAISE EXCEPTION 'Bank name is required';
  END IF;

  v_account_last4 := btrim(coalesce(p_account_last4, ''));
  IF v_account_last4 !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'Account last4 must be exactly four digits';
  END IF;

  v_account_type := lower(btrim(coalesce(p_account_type, '')));
  IF v_account_type NOT IN ('savings', 'current') THEN
    RAISE EXCEPTION 'Account type must be savings or current';
  END IF;

  v_bank_name_key := regexp_replace(lower(v_bank_name), '[^a-z0-9]', '', 'g');

  PERFORM pg_advisory_xact_lock(
    hashtext(v_user_id::text),
    hashtext('detected_bank_account:' || v_bank_name_key || ':' || v_account_last4)
  );

  SELECT bs.*
  INTO v_source_snapshot
  FROM balance_snapshots bs
  WHERE bs.user_id = v_user_id
    AND bs.owner_type = 'detected_account'
    AND bs.owner_id = v_detection.id
    AND bs.balance_kind = v_detection.balance_kind
    AND bs.amount = v_detection.balance_amount
    AND bs.source = v_detection.source
  ORDER BY bs.created_at DESC
  LIMIT 1;

  SELECT *
  INTO v_existing
  FROM bank_accounts
  WHERE user_id = v_user_id
    AND account_last4 = v_account_last4
    AND account_type NOT IN ('credit_card', 'loan')
    AND regexp_replace(lower(coalesce(bank_name, '')), '[^a-z0-9]', '', 'g') = v_bank_name_key
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_detection.balance_amount IS NOT NULL
       AND v_detection.balance_amount >= 0
       AND v_detection.balance_kind IN ('available_balance', 'current_balance')
       AND NOT EXISTS (
         SELECT 1
         FROM balance_snapshots bs
         WHERE bs.user_id = v_user_id
           AND bs.owner_type = 'bank_account'
           AND bs.owner_id = v_existing.id
           AND bs.balance_kind = v_detection.balance_kind
           AND bs.amount = v_detection.balance_amount
           AND bs.source = v_detection.source
           AND bs.detected_at = v_detection.last_seen_at
       ) THEN
      INSERT INTO balance_snapshots (
        user_id,
        owner_type,
        owner_id,
        detected_bank_name,
        account_last4,
        card_last4,
        balance_kind,
        amount,
        currency,
        source,
        confidence,
        detected_at,
        source_sender_or_package,
        raw_source_metadata
      ) VALUES (
        v_user_id,
        'bank_account',
        v_existing.id,
        nullif(v_existing.bank_name, ''),
        v_account_last4,
        NULL,
        v_detection.balance_kind,
        v_detection.balance_amount,
        'INR',
        v_detection.source,
        coalesce(v_source_snapshot.confidence, v_detection.confidence),
        v_detection.last_seen_at,
        v_detection.source_sender_or_package,
        jsonb_strip_nulls(jsonb_build_object(
          'source', v_detection.source,
          'kind', 'detected_account_confirmation',
          'hash', v_source_snapshot.raw_source_metadata->>'hash',
          'len', v_source_snapshot.raw_source_metadata->>'len'
        ))
      );
    END IF;

    UPDATE detected_accounts
    SET status = 'merged',
        matched_owner_type = 'bank_account',
        matched_owner_id = v_existing.id,
        updated_at = now()
    WHERE id = v_detection.id
      AND user_id = v_user_id;

    RETURN QUERY SELECT v_existing.id, 'merged'::text;
    RETURN;
  END IF;

  INSERT INTO bank_accounts (
    user_id,
    bank_name,
    account_last4,
    account_type,
    starting_balance,
    balance,
    credit_limit,
    loan_total,
    upi_ids
  ) VALUES (
    v_user_id,
    v_bank_name,
    v_account_last4,
    v_account_type,
    0,
    0,
    0,
    0,
    ARRAY[]::text[]
  )
  RETURNING id INTO v_owner_id;

  IF v_detection.balance_amount IS NOT NULL
     AND v_detection.balance_amount >= 0
     AND v_detection.balance_kind IN ('available_balance', 'current_balance')
     AND NOT EXISTS (
       SELECT 1
       FROM balance_snapshots bs
       WHERE bs.user_id = v_user_id
         AND bs.owner_type = 'bank_account'
         AND bs.owner_id = v_owner_id
         AND bs.balance_kind = v_detection.balance_kind
         AND bs.amount = v_detection.balance_amount
         AND bs.source = v_detection.source
         AND bs.detected_at = v_detection.last_seen_at
     ) THEN
    INSERT INTO balance_snapshots (
      user_id,
      owner_type,
      owner_id,
      detected_bank_name,
      account_last4,
      card_last4,
      balance_kind,
      amount,
      currency,
      source,
      confidence,
      detected_at,
      source_sender_or_package,
      raw_source_metadata
    ) VALUES (
      v_user_id,
      'bank_account',
      v_owner_id,
      v_bank_name,
      v_account_last4,
      NULL,
      v_detection.balance_kind,
      v_detection.balance_amount,
      'INR',
      v_detection.source,
      coalesce(v_source_snapshot.confidence, v_detection.confidence),
      v_detection.last_seen_at,
      v_detection.source_sender_or_package,
      jsonb_strip_nulls(jsonb_build_object(
        'source', v_detection.source,
        'kind', 'detected_account_confirmation',
        'hash', v_source_snapshot.raw_source_metadata->>'hash',
        'len', v_source_snapshot.raw_source_metadata->>'len'
      ))
    );
  END IF;

  UPDATE detected_accounts
  SET status = 'confirmed',
      matched_owner_type = 'bank_account',
      matched_owner_id = v_owner_id,
      updated_at = now()
  WHERE id = v_detection.id
    AND user_id = v_user_id;

  RETURN QUERY SELECT v_owner_id, 'confirmed'::text;
END;
$$;

CREATE OR REPLACE FUNCTION confirm_detected_credit_card(
  p_detection_id uuid,
  p_bank_name text,
  p_card_name text,
  p_card_last4 text,
  p_credit_limit numeric DEFAULT 0,
  p_due_date integer DEFAULT 1,
  p_billing_cycle_date integer DEFAULT 1
)
RETURNS TABLE(owner_id uuid, status text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_detection detected_accounts%ROWTYPE;
  v_bank_name text;
  v_card_name text;
  v_card_last4 text;
  v_credit_limit numeric;
  v_due_date integer;
  v_billing_cycle_date integer;
  v_existing credit_cards%ROWTYPE;
  v_owner_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT *
  INTO v_detection
  FROM detected_accounts
  WHERE id = p_detection_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Detection was not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_detection.status IN ('confirmed', 'merged')
     AND v_detection.matched_owner_type = 'credit_card'
     AND v_detection.matched_owner_id IS NOT NULL THEN
    RETURN QUERY SELECT v_detection.matched_owner_id, v_detection.status;
    RETURN;
  END IF;

  IF v_detection.status <> 'pending' THEN
    RAISE EXCEPTION 'Detection has already been reviewed';
  END IF;

  IF v_detection.detection_type <> 'credit_card' THEN
    RAISE EXCEPTION 'Detection is not a credit card';
  END IF;

  v_bank_name := left(
    regexp_replace(coalesce(btrim(p_bank_name), ''), '[^[:alnum:] .&/-]', '', 'g'),
    64
  );
  IF nullif(v_bank_name, '') IS NULL THEN
    RAISE EXCEPTION 'Bank name is required';
  END IF;

  v_card_last4 := btrim(coalesce(p_card_last4, ''));
  IF v_card_last4 !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'Card last4 must be exactly four digits';
  END IF;

  v_card_name := left(
    regexp_replace(coalesce(nullif(btrim(p_card_name), ''), v_bank_name || ' card ' || v_card_last4), '[^[:alnum:] .&/-]', '', 'g'),
    64
  );
  IF nullif(v_card_name, '') IS NULL THEN
    v_card_name := v_bank_name || ' card ' || v_card_last4;
  END IF;

  v_credit_limit := coalesce(p_credit_limit, 0);
  IF v_credit_limit < 0 THEN
    RAISE EXCEPTION 'Credit limit must be non-negative';
  END IF;

  v_due_date := coalesce(p_due_date, 1);
  v_billing_cycle_date := coalesce(p_billing_cycle_date, 1);
  IF v_due_date < 1 OR v_due_date > 31 OR v_billing_cycle_date < 1 OR v_billing_cycle_date > 31 THEN
    RAISE EXCEPTION 'Credit card dates must be between 1 and 31';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(v_user_id::text),
    hashtext('detected_credit_card:' || v_card_last4)
  );

  SELECT *
  INTO v_existing
  FROM credit_cards
  WHERE user_id = v_user_id
    AND last_4_digits = v_card_last4
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_detection.balance_amount IS NOT NULL
       AND v_detection.balance_amount >= 0
       AND v_detection.balance_kind IN ('outstanding', 'available_limit', 'credit_limit', 'due_amount', 'minimum_due')
       AND NOT EXISTS (
         SELECT 1
         FROM balance_snapshots bs
         WHERE bs.user_id = v_user_id
           AND bs.owner_type = 'credit_card'
           AND bs.owner_id = v_existing.id
           AND bs.balance_kind = v_detection.balance_kind
           AND bs.amount = v_detection.balance_amount
           AND bs.source = v_detection.source
           AND bs.detected_at = v_detection.last_seen_at
       ) THEN
      INSERT INTO balance_snapshots (
        user_id,
        owner_type,
        owner_id,
        detected_bank_name,
        account_last4,
        card_last4,
        balance_kind,
        amount,
        currency,
        source,
        confidence,
        detected_at,
        source_sender_or_package,
        raw_source_metadata
      ) VALUES (
        v_user_id,
        'credit_card',
        v_existing.id,
        nullif(v_existing.bank_name, ''),
        NULL,
        v_card_last4,
        v_detection.balance_kind,
        v_detection.balance_amount,
        'INR',
        v_detection.source,
        v_detection.confidence,
        v_detection.last_seen_at,
        v_detection.source_sender_or_package,
        jsonb_build_object('source', v_detection.source, 'kind', 'detected_account_confirmation')
      );
    END IF;

    UPDATE detected_accounts
    SET status = 'merged',
        matched_owner_type = 'credit_card',
        matched_owner_id = v_existing.id,
        updated_at = now()
    WHERE id = v_detection.id
      AND user_id = v_user_id;

    RETURN QUERY SELECT v_existing.id, 'merged'::text;
    RETURN;
  END IF;

  INSERT INTO credit_cards (
    user_id,
    bank_name,
    card_name,
    last_4_digits,
    credit_limit,
    current_outstanding,
    due_date,
    billing_cycle_date
  ) VALUES (
    v_user_id,
    v_bank_name,
    v_card_name,
    v_card_last4,
    v_credit_limit,
    0,
    v_due_date,
    v_billing_cycle_date
  )
  RETURNING id INTO v_owner_id;

  IF v_detection.balance_amount IS NOT NULL
     AND v_detection.balance_amount >= 0
     AND v_detection.balance_kind IN ('outstanding', 'available_limit', 'credit_limit', 'due_amount', 'minimum_due')
     AND NOT EXISTS (
       SELECT 1
       FROM balance_snapshots bs
       WHERE bs.user_id = v_user_id
         AND bs.owner_type = 'credit_card'
         AND bs.owner_id = v_owner_id
         AND bs.balance_kind = v_detection.balance_kind
         AND bs.amount = v_detection.balance_amount
         AND bs.source = v_detection.source
         AND bs.detected_at = v_detection.last_seen_at
     ) THEN
    INSERT INTO balance_snapshots (
      user_id,
      owner_type,
      owner_id,
      detected_bank_name,
      account_last4,
      card_last4,
      balance_kind,
      amount,
      currency,
      source,
      confidence,
      detected_at,
      source_sender_or_package,
      raw_source_metadata
    ) VALUES (
      v_user_id,
      'credit_card',
      v_owner_id,
      v_bank_name,
      NULL,
      v_card_last4,
      v_detection.balance_kind,
      v_detection.balance_amount,
      'INR',
      v_detection.source,
      v_detection.confidence,
      v_detection.last_seen_at,
      v_detection.source_sender_or_package,
      jsonb_build_object('source', v_detection.source, 'kind', 'detected_account_confirmation')
    );
  END IF;

  -- No credit_card_statements row is created here: detected_accounts does not
  -- contain a clear statement date or payment due date.

  UPDATE detected_accounts
  SET status = 'confirmed',
      matched_owner_type = 'credit_card',
      matched_owner_id = v_owner_id,
      updated_at = now()
  WHERE id = v_detection.id
    AND user_id = v_user_id;

  RETURN QUERY SELECT v_owner_id, 'confirmed'::text;
END;
$$;

CREATE OR REPLACE FUNCTION confirm_detected_debit_card(
  p_detection_id uuid,
  p_bank_account_id uuid,
  p_card_last4 text,
  p_card_label text DEFAULT NULL
)
RETURNS TABLE(owner_id uuid, status text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_detection detected_accounts%ROWTYPE;
  v_bank_account bank_accounts%ROWTYPE;
  v_card_last4 text;
  v_card_label text;
  v_existing debit_cards%ROWTYPE;
  v_owner_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT *
  INTO v_detection
  FROM detected_accounts
  WHERE id = p_detection_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Detection was not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_detection.status IN ('confirmed', 'merged')
     AND v_detection.matched_owner_type = 'debit_card'
     AND v_detection.matched_owner_id IS NOT NULL THEN
    RETURN QUERY SELECT v_detection.matched_owner_id, v_detection.status;
    RETURN;
  END IF;

  IF v_detection.status <> 'pending' THEN
    RAISE EXCEPTION 'Detection has already been reviewed';
  END IF;

  IF v_detection.detection_type <> 'debit_card' THEN
    RAISE EXCEPTION 'Detection is not a debit card';
  END IF;

  SELECT *
  INTO v_bank_account
  FROM bank_accounts
  WHERE id = p_bank_account_id
    AND user_id = v_user_id
    AND account_type NOT IN ('credit_card', 'loan')
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose a linked bank account first';
  END IF;

  v_card_last4 := btrim(coalesce(p_card_last4, ''));
  IF v_card_last4 !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'Debit card last4 must be exactly four digits';
  END IF;

  v_card_label := nullif(left(
    regexp_replace(coalesce(btrim(p_card_label), ''), '[^[:alnum:] .&/-]', '', 'g'),
    64
  ), '');

  PERFORM pg_advisory_xact_lock(
    hashtext(v_user_id::text),
    hashtext('detected_debit_card:' || p_bank_account_id::text || ':' || v_card_last4)
  );

  SELECT *
  INTO v_existing
  FROM debit_cards
  WHERE user_id = v_user_id
    AND bank_account_id = p_bank_account_id
    AND card_last4 = v_card_last4
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_detection.balance_amount IS NOT NULL
       AND v_detection.balance_amount >= 0
       AND v_detection.balance_kind IN ('available_balance', 'current_balance')
       AND NOT EXISTS (
         SELECT 1
         FROM balance_snapshots bs
         WHERE bs.user_id = v_user_id
           AND bs.owner_type = 'bank_account'
           AND bs.owner_id = p_bank_account_id
           AND bs.balance_kind = v_detection.balance_kind
           AND bs.amount = v_detection.balance_amount
           AND bs.source = v_detection.source
           AND bs.detected_at = v_detection.last_seen_at
       ) THEN
      INSERT INTO balance_snapshots (
        user_id,
        owner_type,
        owner_id,
        detected_bank_name,
        account_last4,
        card_last4,
        balance_kind,
        amount,
        currency,
        source,
        confidence,
        detected_at,
        source_sender_or_package,
        raw_source_metadata
      ) VALUES (
        v_user_id,
        'bank_account',
        p_bank_account_id,
        nullif(v_bank_account.bank_name, ''),
        v_bank_account.account_last4,
        v_card_last4,
        v_detection.balance_kind,
        v_detection.balance_amount,
        'INR',
        v_detection.source,
        v_detection.confidence,
        v_detection.last_seen_at,
        v_detection.source_sender_or_package,
        jsonb_build_object('source', v_detection.source, 'kind', 'detected_account_confirmation')
      );
    END IF;

    UPDATE detected_accounts
    SET status = 'merged',
        matched_owner_type = 'debit_card',
        matched_owner_id = v_existing.id,
        updated_at = now()
    WHERE id = v_detection.id
      AND user_id = v_user_id;

    RETURN QUERY SELECT v_existing.id, 'merged'::text;
    RETURN;
  END IF;

  INSERT INTO debit_cards (
    user_id,
    bank_account_id,
    bank_name,
    card_last4,
    card_network,
    card_label,
    status,
    detected_confidence,
    source_sender_or_package,
    last_seen_at,
    updated_at
  ) VALUES (
    v_user_id,
    p_bank_account_id,
    nullif(v_bank_account.bank_name, ''),
    v_card_last4,
    NULL,
    v_card_label,
    'active',
    v_detection.confidence,
    v_detection.source_sender_or_package,
    v_detection.last_seen_at,
    now()
  )
  RETURNING id INTO v_owner_id;

  IF v_detection.balance_amount IS NOT NULL
     AND v_detection.balance_amount >= 0
     AND v_detection.balance_kind IN ('available_balance', 'current_balance')
     AND NOT EXISTS (
       SELECT 1
       FROM balance_snapshots bs
       WHERE bs.user_id = v_user_id
         AND bs.owner_type = 'bank_account'
         AND bs.owner_id = p_bank_account_id
         AND bs.balance_kind = v_detection.balance_kind
         AND bs.amount = v_detection.balance_amount
         AND bs.source = v_detection.source
         AND bs.detected_at = v_detection.last_seen_at
     ) THEN
    INSERT INTO balance_snapshots (
      user_id,
      owner_type,
      owner_id,
      detected_bank_name,
      account_last4,
      card_last4,
      balance_kind,
      amount,
      currency,
      source,
      confidence,
      detected_at,
      source_sender_or_package,
      raw_source_metadata
    ) VALUES (
      v_user_id,
      'bank_account',
      p_bank_account_id,
      nullif(v_bank_account.bank_name, ''),
      v_bank_account.account_last4,
      v_card_last4,
      v_detection.balance_kind,
      v_detection.balance_amount,
      'INR',
      v_detection.source,
      v_detection.confidence,
      v_detection.last_seen_at,
      v_detection.source_sender_or_package,
      jsonb_build_object('source', v_detection.source, 'kind', 'detected_account_confirmation')
    );
  END IF;

  UPDATE detected_accounts
  SET status = 'confirmed',
      matched_owner_type = 'debit_card',
      matched_owner_id = v_owner_id,
      updated_at = now()
  WHERE id = v_detection.id
    AND user_id = v_user_id;

  RETURN QUERY SELECT v_owner_id, 'confirmed'::text;
END;
$$;

CREATE OR REPLACE FUNCTION merge_detected_account(
  p_detection_id uuid,
  p_owner_type text,
  p_owner_id uuid
)
RETURNS TABLE(owner_id uuid, status text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_detection detected_accounts%ROWTYPE;
  v_owner_type text := lower(btrim(coalesce(p_owner_type, '')));
  v_owner_exists boolean := false;
  v_snapshot_bank_name text;
  v_snapshot_account_last4 text;
  v_snapshot_card_last4 text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT *
  INTO v_detection
  FROM detected_accounts
  WHERE id = p_detection_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Detection was not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_detection.status = 'merged'
     AND v_detection.matched_owner_type = v_owner_type
     AND v_detection.matched_owner_id = p_owner_id THEN
    RETURN QUERY SELECT p_owner_id, 'merged'::text;
    RETURN;
  END IF;

  IF v_detection.status <> 'pending' THEN
    RAISE EXCEPTION 'Detection has already been reviewed';
  END IF;

  IF v_owner_type NOT IN ('bank_account', 'credit_card', 'debit_card') THEN
    RAISE EXCEPTION 'Unsupported owner type';
  END IF;

  IF (v_detection.detection_type = 'bank_account' AND v_owner_type <> 'bank_account')
     OR (v_detection.detection_type = 'credit_card' AND v_owner_type <> 'credit_card')
     OR (v_detection.detection_type = 'debit_card' AND v_owner_type <> 'debit_card')
     OR v_detection.detection_type = 'loan' THEN
    RAISE EXCEPTION 'This detection cannot be linked to the selected owner type';
  END IF;

  IF v_owner_type = 'bank_account' THEN
    SELECT true, bank_name, account_last4, NULL::text
    INTO v_owner_exists, v_snapshot_bank_name, v_snapshot_account_last4, v_snapshot_card_last4
    FROM bank_accounts
    WHERE id = p_owner_id
      AND user_id = v_user_id
      AND account_type NOT IN ('credit_card', 'loan')
    FOR UPDATE;
  ELSIF v_owner_type = 'credit_card' THEN
    SELECT true, bank_name, NULL::text, last_4_digits
    INTO v_owner_exists, v_snapshot_bank_name, v_snapshot_account_last4, v_snapshot_card_last4
    FROM credit_cards
    WHERE id = p_owner_id
      AND user_id = v_user_id
    FOR UPDATE;
  ELSE
    SELECT true, bank_name, NULL::text, card_last4
    INTO v_owner_exists, v_snapshot_bank_name, v_snapshot_account_last4, v_snapshot_card_last4
    FROM debit_cards
    WHERE id = p_owner_id
      AND user_id = v_user_id
    FOR UPDATE;
  END IF;

  IF NOT coalesce(v_owner_exists, false) THEN
    RAISE EXCEPTION 'Selected owner was not found';
  END IF;

  IF v_detection.balance_amount IS NOT NULL
     AND v_detection.balance_amount >= 0
     AND (
       (v_owner_type = 'bank_account' AND v_detection.balance_kind IN ('available_balance', 'current_balance'))
       OR (v_owner_type = 'credit_card' AND v_detection.balance_kind IN ('outstanding', 'available_limit', 'credit_limit', 'due_amount', 'minimum_due'))
       OR (v_owner_type = 'debit_card' AND v_detection.balance_kind IN ('available_balance', 'current_balance', 'outstanding', 'available_limit', 'credit_limit', 'due_amount', 'minimum_due'))
     )
     AND NOT EXISTS (
       SELECT 1
       FROM balance_snapshots bs
       WHERE bs.user_id = v_user_id
         AND bs.owner_type = v_owner_type
         AND bs.owner_id = p_owner_id
         AND bs.balance_kind = v_detection.balance_kind
         AND bs.amount = v_detection.balance_amount
         AND bs.source = v_detection.source
         AND bs.detected_at = v_detection.last_seen_at
     ) THEN
    INSERT INTO balance_snapshots (
      user_id,
      owner_type,
      owner_id,
      detected_bank_name,
      account_last4,
      card_last4,
      balance_kind,
      amount,
      currency,
      source,
      confidence,
      detected_at,
      source_sender_or_package,
      raw_source_metadata
    ) VALUES (
      v_user_id,
      v_owner_type,
      p_owner_id,
      nullif(v_snapshot_bank_name, ''),
      coalesce(v_snapshot_account_last4, v_detection.account_last4),
      coalesce(v_snapshot_card_last4, v_detection.card_last4),
      v_detection.balance_kind,
      v_detection.balance_amount,
      'INR',
      v_detection.source,
      v_detection.confidence,
      v_detection.last_seen_at,
      v_detection.source_sender_or_package,
      jsonb_build_object('source', v_detection.source, 'kind', 'detected_account_merge')
    );
  END IF;

  UPDATE detected_accounts
  SET status = 'merged',
      matched_owner_type = v_owner_type,
      matched_owner_id = p_owner_id,
      updated_at = now()
  WHERE id = v_detection.id
    AND user_id = v_user_id;

  RETURN QUERY SELECT p_owner_id, 'merged'::text;
END;
$$;

CREATE OR REPLACE FUNCTION ignore_detected_account_rpc(
  p_detection_id uuid
)
RETURNS TABLE(owner_id uuid, status text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_detection detected_accounts%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT *
  INTO v_detection
  FROM detected_accounts
  WHERE id = p_detection_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Detection was not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_detection.status = 'ignored' THEN
    RETURN QUERY SELECT NULL::uuid, 'ignored'::text;
    RETURN;
  END IF;

  IF v_detection.status <> 'pending' THEN
    RAISE EXCEPTION 'Detection has already been reviewed';
  END IF;

  UPDATE detected_accounts
  SET status = 'ignored',
      matched_owner_type = NULL,
      matched_owner_id = NULL,
      updated_at = now()
  WHERE id = v_detection.id
    AND user_id = v_user_id;

  RETURN QUERY SELECT NULL::uuid, 'ignored'::text;
END;
$$;

REVOKE ALL ON FUNCTION confirm_detected_bank_account(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION confirm_detected_credit_card(uuid, text, text, text, numeric, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION confirm_detected_debit_card(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION merge_detected_account(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ignore_detected_account_rpc(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION confirm_detected_bank_account(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_detected_credit_card(uuid, text, text, text, numeric, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_detected_debit_card(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION merge_detected_account(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ignore_detected_account_rpc(uuid) TO authenticated;
