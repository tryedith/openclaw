-- OpenClaw Hosted Platform - Usage Summary Aggregation
-- Moves usage summary aggregation into PostgreSQL for lower API latency/cost.

-- Optional index to accelerate user+instance+date summary filters.
CREATE INDEX IF NOT EXISTS idx_usage_events_user_instance_date
  ON public.usage_events (user_id, instance_id, created_at DESC);

-- Returns aggregated usage for the authenticated user.
CREATE OR REPLACE FUNCTION public.get_usage_summary(
  p_period TEXT DEFAULT 'month',
  p_instance_id UUID DEFAULT NULL
)
RETURNS TABLE (
  period TEXT,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  total_cost_usd NUMERIC,
  total_requests BIGINT,
  total_input_tokens BIGINT,
  total_output_tokens BIGINT,
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
      model_id,
      input_tokens,
      output_tokens,
      cost_usd
    FROM public.usage_events
    WHERE user_id = auth.uid()
      AND created_at >= v_start
      AND (p_instance_id IS NULL OR instance_id = p_instance_id)
  ),
  totals AS (
    SELECT
      ROUND(COALESCE(SUM(cost_usd), 0)::NUMERIC, 6) AS total_cost_usd,
      COALESCE(COUNT(*), 0)::BIGINT AS total_requests,
      COALESCE(SUM(input_tokens), 0)::BIGINT AS total_input_tokens,
      COALESCE(SUM(output_tokens), 0)::BIGINT AS total_output_tokens
    FROM filtered
  ),
  model_totals AS (
    SELECT
      model_id,
      COUNT(*)::BIGINT AS requests,
      COALESCE(SUM(input_tokens), 0)::BIGINT AS input_tokens,
      COALESCE(SUM(output_tokens), 0)::BIGINT AS output_tokens,
      ROUND(COALESCE(SUM(cost_usd), 0)::NUMERIC, 6) AS cost_usd
    FROM filtered
    GROUP BY model_id
  ),
  model_json AS (
    SELECT
      COALESCE(
        jsonb_object_agg(
          model_id,
          jsonb_build_object(
            'requests', requests,
            'inputTokens', input_tokens,
            'outputTokens', output_tokens,
            'costUsd', cost_usd
          )
        ),
        '{}'::jsonb
      ) AS payload
    FROM model_totals
  )
  SELECT
    v_period,
    v_start,
    v_now,
    totals.total_cost_usd,
    totals.total_requests,
    totals.total_input_tokens,
    totals.total_output_tokens,
    model_json.payload
  FROM totals
  CROSS JOIN model_json;
END;
$$;

COMMENT ON FUNCTION public.get_usage_summary(TEXT, UUID)
  IS 'Returns aggregated usage totals and per-model breakdown for the authenticated user.';

GRANT EXECUTE ON FUNCTION public.get_usage_summary(TEXT, UUID) TO authenticated;
