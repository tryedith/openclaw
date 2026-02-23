-- OpenClaw Hosted Platform - Super Admin Portal
-- Adds admin identity, audit logging, and platform-wide usage summary.

-- ============================================================================
-- admin_users: who has super admin access
-- ============================================================================

CREATE TABLE public.admin_users (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'super_admin' CHECK (role IN ('super_admin', 'support')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- Only admins can see other admins
CREATE POLICY admin_users_select ON public.admin_users
  FOR SELECT USING (auth.uid() IN (SELECT user_id FROM public.admin_users));

-- ============================================================================
-- admin_audit_log: tracks every admin write action
-- ============================================================================

CREATE TABLE public.admin_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_user_id UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Admins can read all audit entries
CREATE POLICY audit_log_admin_select ON public.admin_audit_log
  FOR SELECT USING (auth.uid() IN (SELECT user_id FROM public.admin_users));

CREATE INDEX idx_audit_log_created ON public.admin_audit_log (created_at DESC);
CREATE INDEX idx_audit_log_target ON public.admin_audit_log (target_type, target_id);

-- ============================================================================
-- get_admin_usage_summary: platform-wide usage (cloned from get_usage_summary)
-- Removes auth.uid() filter, adds optional p_user_id param.
-- Verifies caller is an admin inside the function body.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_admin_usage_summary(
  p_period TEXT DEFAULT 'month',
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  period TEXT,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  total_cost_usd NUMERIC,
  total_requests BIGINT,
  total_input_tokens BIGINT,
  total_output_tokens BIGINT,
  total_cache_read_tokens BIGINT,
  total_cache_write_tokens BIGINT,
  total_prompt_tokens BIGINT,
  by_model JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_period TEXT := LOWER(COALESCE(NULLIF(p_period, ''), 'month'));
  v_start TIMESTAMPTZ;
BEGIN
  -- Verify caller is an admin
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden: caller is not an admin';
  END IF;

  IF v_period NOT IN ('day', 'week', 'month', 'all') THEN
    v_period := 'month';
  END IF;

  IF v_period = 'day' THEN
    v_start := date_trunc('day', v_now);
  ELSIF v_period = 'week' THEN
    v_start := v_now - INTERVAL '7 days';
  ELSIF v_period = 'all' THEN
    v_start := to_timestamp(0);
  ELSE
    v_start := date_trunc('month', v_now);
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT
      ue.model_id,
      ue.input_tokens,
      ue.output_tokens,
      COALESCE(ue.cache_read_tokens, 0) AS cache_read_tokens,
      COALESCE(ue.cache_write_tokens, 0) AS cache_write_tokens,
      ue.cost_usd
    FROM public.usage_events ue
    WHERE ue.created_at >= v_start
      AND (p_user_id IS NULL OR ue.user_id = p_user_id)
  ),
  totals AS (
    SELECT
      ROUND(COALESCE(SUM(f.cost_usd), 0)::NUMERIC, 6) AS total_cost_usd,
      COALESCE(COUNT(*), 0)::BIGINT AS total_requests,
      COALESCE(SUM(f.cache_read_tokens), 0)::BIGINT AS total_cache_read_tokens,
      COALESCE(SUM(f.cache_write_tokens), 0)::BIGINT AS total_cache_write_tokens,
      COALESCE(SUM(f.input_tokens), 0)::BIGINT AS total_prompt_tokens,
      COALESCE(
        SUM(GREATEST(0, f.input_tokens - f.cache_read_tokens - f.cache_write_tokens)),
        0
      )::BIGINT AS total_input_tokens,
      COALESCE(SUM(f.output_tokens), 0)::BIGINT AS total_output_tokens
    FROM filtered f
  ),
  model_totals AS (
    SELECT
      f.model_id,
      COUNT(*)::BIGINT AS requests,
      COALESCE(SUM(f.cache_read_tokens), 0)::BIGINT AS cache_read_tokens,
      COALESCE(SUM(f.cache_write_tokens), 0)::BIGINT AS cache_write_tokens,
      COALESCE(SUM(f.input_tokens), 0)::BIGINT AS prompt_tokens,
      COALESCE(
        SUM(GREATEST(0, f.input_tokens - f.cache_read_tokens - f.cache_write_tokens)),
        0
      )::BIGINT AS input_tokens,
      COALESCE(SUM(f.output_tokens), 0)::BIGINT AS output_tokens,
      ROUND(COALESCE(SUM(f.cost_usd), 0)::NUMERIC, 6) AS cost_usd
    FROM filtered f
    GROUP BY f.model_id
  ),
  model_json AS (
    SELECT
      COALESCE(
        jsonb_object_agg(
          mt.model_id,
          jsonb_build_object(
            'requests', mt.requests,
            'inputTokens', mt.input_tokens,
            'outputTokens', mt.output_tokens,
            'cacheReadTokens', mt.cache_read_tokens,
            'cacheWriteTokens', mt.cache_write_tokens,
            'promptTokens', mt.prompt_tokens,
            'totalTokens', mt.prompt_tokens + mt.output_tokens,
            'costUsd', mt.cost_usd
          )
        ),
        '{}'::jsonb
      ) AS payload
    FROM model_totals mt
  )
  SELECT
    v_period,
    v_start,
    v_now,
    t.total_cost_usd,
    t.total_requests,
    t.total_input_tokens,
    t.total_output_tokens,
    t.total_cache_read_tokens,
    t.total_cache_write_tokens,
    t.total_prompt_tokens,
    mj.payload
  FROM totals t
  CROSS JOIN model_json mj;
END;
$$;

COMMENT ON FUNCTION public.get_admin_usage_summary(TEXT, UUID)
  IS 'Returns platform-wide aggregated usage totals. Restricted to admin users.';

GRANT EXECUTE ON FUNCTION public.get_admin_usage_summary(TEXT, UUID) TO authenticated;
