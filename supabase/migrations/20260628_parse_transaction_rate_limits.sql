-- Bug #H4: Per-user rate limiting for parse-transaction edge function.
-- Prevents a single authenticated user from exhausting OpenAI credits.

CREATE TABLE IF NOT EXISTS public.parse_transaction_rate_limits (
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  call_count  INTEGER     NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id)
);

-- Only the service role (edge function) may read or write this table.
-- Authenticated users must not be able to manipulate their own counters.
ALTER TABLE public.parse_transaction_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parse_transaction_rate_limits FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parse_rate_limits_service_only ON public.parse_transaction_rate_limits;
CREATE POLICY parse_rate_limits_service_only
  ON public.parse_transaction_rate_limits
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
