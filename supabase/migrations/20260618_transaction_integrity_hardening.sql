-- Production hardening for offline transaction replay, user isolation, and RLS.

DO $$
DECLARE
  owner_table text;
  policy_name text;
BEGIN
  IF to_regclass('public.transactions') IS NOT NULL THEN
    ALTER TABLE public.transactions
      ADD COLUMN IF NOT EXISTS client_idempotency_key text;
    CREATE UNIQUE INDEX IF NOT EXISTS transactions_user_client_idempotency_key_uidx
      ON public.transactions (user_id, client_idempotency_key);
    ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.transactions FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS transactions_owner_all ON public.transactions;
    CREATE POLICY transactions_owner_all ON public.transactions
      FOR ALL TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF to_regclass('public.transaction_evidence') IS NOT NULL THEN
    ALTER TABLE public.transaction_evidence ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.transaction_evidence FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS transaction_evidence_owner_all ON public.transaction_evidence;
    CREATE POLICY transaction_evidence_owner_all ON public.transaction_evidence
      FOR ALL TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF to_regclass('public.balance_snapshots') IS NOT NULL THEN
    ALTER TABLE public.balance_snapshots ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.balance_snapshots FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS balance_snapshots_owner_all ON public.balance_snapshots;
    CREATE POLICY balance_snapshots_owner_all ON public.balance_snapshots
      FOR ALL TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF to_regclass('public.bank_accounts') IS NOT NULL THEN
    ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.bank_accounts FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS bank_accounts_owner_all ON public.bank_accounts;
    CREATE POLICY bank_accounts_owner_all ON public.bank_accounts
      FOR ALL TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF to_regclass('public.credit_cards') IS NOT NULL THEN
    ALTER TABLE public.credit_cards ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.credit_cards FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS credit_cards_owner_all ON public.credit_cards;
    CREATE POLICY credit_cards_owner_all ON public.credit_cards
      FOR ALL TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF to_regclass('public.debit_cards') IS NOT NULL THEN
    ALTER TABLE public.debit_cards ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.debit_cards FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS debit_cards_owner_all ON public.debit_cards;
    CREATE POLICY debit_cards_owner_all ON public.debit_cards
      FOR ALL TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF to_regclass('public.detected_accounts') IS NOT NULL THEN
    ALTER TABLE public.detected_accounts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.detected_accounts FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS detected_accounts_owner_all ON public.detected_accounts;
    CREATE POLICY detected_accounts_owner_all ON public.detected_accounts
      FOR ALL TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF to_regclass('public.account_app_mappings') IS NOT NULL THEN
    ALTER TABLE public.account_app_mappings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.account_app_mappings FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS account_app_mappings_owner_all ON public.account_app_mappings;
    CREATE POLICY account_app_mappings_owner_all ON public.account_app_mappings
      FOR ALL TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF to_regclass('public.vault_items') IS NOT NULL THEN
    ALTER TABLE public.vault_items ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.vault_items FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS vault_items_owner_all ON public.vault_items;
    CREATE POLICY vault_items_owner_all ON public.vault_items
      FOR ALL TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF to_regclass('public.profiles') IS NOT NULL THEN
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS profiles_owner_all ON public.profiles;
    CREATE POLICY profiles_owner_all ON public.profiles
      FOR ALL TO authenticated
      USING (id = auth.uid())
      WITH CHECK (id = auth.uid());
  END IF;

  FOREACH owner_table IN ARRAY ARRAY[
    'cc_transactions',
    'credit_card_statements',
    'debt_freedom_settings',
    'emi_payments',
    'income_review_decisions',
    'loans',
    'people_ledger',
    'places',
    'user_accounts'
  ] LOOP
    IF to_regclass(format('public.%I', owner_table)) IS NOT NULL THEN
      policy_name := owner_table || '_owner_all';
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', owner_table);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', owner_table);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, owner_table);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())',
        policy_name,
        owner_table
      );
    END IF;
  END LOOP;
END $$;
