-- OpenClaw Hosted Platform - Persist cache token buckets for usage breakdowns

ALTER TABLE public.usage_events
  ADD COLUMN IF NOT EXISTS cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cache_write_tokens INTEGER NOT NULL DEFAULT 0;

-- Drop existing function (return type changed, cannot use CREATE OR REPLACE)
DROP FUNCTION IF EXISTS public.get_usage_summary(TEXT, UUID);

-- Extend summary function with cache-aware totals and per-model breakdown fields.
CREATE FUNCTION public.get_usage_summary(
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
      COALESCE(cache_read_tokens, 0) AS cache_read_tokens,
      COALESCE(cache_write_tokens, 0) AS cache_write_tokens,
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
      COALESCE(SUM(cache_read_tokens), 0)::BIGINT AS total_cache_read_tokens,
      COALESCE(SUM(cache_write_tokens), 0)::BIGINT AS total_cache_write_tokens,
      COALESCE(SUM(input_tokens), 0)::BIGINT AS total_prompt_tokens,
      COALESCE(
        SUM(
          GREATEST(0, input_tokens - cache_read_tokens - cache_write_tokens)
        ),
        0
      )::BIGINT AS total_input_tokens,
      COALESCE(SUM(output_tokens), 0)::BIGINT AS total_output_tokens
    FROM filtered
  ),
  model_totals AS (
    SELECT
      model_id,
      COUNT(*)::BIGINT AS requests,
      COALESCE(SUM(cache_read_tokens), 0)::BIGINT AS cache_read_tokens,
      COALESCE(SUM(cache_write_tokens), 0)::BIGINT AS cache_write_tokens,
      COALESCE(SUM(input_tokens), 0)::BIGINT AS prompt_tokens,
      COALESCE(
        SUM(
          GREATEST(0, input_tokens - cache_read_tokens - cache_write_tokens)
        ),
        0
      )::BIGINT AS input_tokens,
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
            'cacheReadTokens', cache_read_tokens,
            'cacheWriteTokens', cache_write_tokens,
            'promptTokens', prompt_tokens,
            'totalTokens', prompt_tokens + output_tokens,
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
    totals.total_cache_read_tokens,
    totals.total_cache_write_tokens,
    totals.total_prompt_tokens,
    model_json.payload
  FROM totals
  CROSS JOIN model_json;
END;
$$;

COMMENT ON FUNCTION public.get_usage_summary(TEXT, UUID)
  IS 'Returns aggregated usage totals and per-model breakdown (including cache token buckets) for the authenticated user.';

GRANT EXECUTE ON FUNCTION public.get_usage_summary(TEXT, UUID) TO authenticated;
 