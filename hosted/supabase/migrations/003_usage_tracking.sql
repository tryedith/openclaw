-- OpenClaw Hosted Platform - Usage Tracking
-- Tracks API usage per user for billing with shared Anthropic API key

-- Create usage_events table to store per-request token usage
CREATE TABLE public.usage_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  instance_id UUID REFERENCES public.instances(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,

  -- Model information
  model_id TEXT NOT NULL,  -- e.g., "claude-sonnet-4-20250514"

  -- Token counts from Anthropic response
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,

  -- Price at request time (USD per 1M tokens) - fetched from OpenRouter
  input_price_per_million DECIMAL(10, 4) NOT NULL,
  output_price_per_million DECIMAL(10, 4) NOT NULL,

  -- Derived column: cost auto-calculated by PostgreSQL
  cost_usd DECIMAL(12, 6) GENERATED ALWAYS AS (
    (input_tokens::numeric / 1000000.0) * input_price_per_million +
    (output_tokens::numeric / 1000000.0) * output_price_per_million
  ) STORED,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast queries
CREATE INDEX idx_usage_events_user_date ON public.usage_events(user_id, created_at);
CREATE INDEX idx_usage_events_instance ON public.usage_events(instance_id);
CREATE INDEX idx_usage_events_model ON public.usage_events(model_id);

-- Row Level Security: Users can only see their own usage
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY usage_events_select_own ON public.usage_events
  FOR SELECT USING (user_id = auth.uid());

-- Service role can insert (for API endpoint that receives events)
CREATE POLICY usage_events_insert_service ON public.usage_events
  FOR INSERT WITH CHECK (true);

-- Add comments for documentation
COMMENT ON TABLE public.usage_events IS 'Per-request API usage tracking for billing';
COMMENT ON COLUMN public.usage_events.model_id IS 'Anthropic model ID (e.g., claude-sonnet-4-20250514)';
COMMENT ON COLUMN public.usage_events.input_tokens IS 'Number of input tokens from Anthropic response';
COMMENT ON COLUMN public.usage_events.output_tokens IS 'Number of output tokens from Anthropic response';
COMMENT ON COLUMN public.usage_events.input_price_per_million IS 'USD price per 1M input tokens at request time';
COMMENT ON COLUMN public.usage_events.output_price_per_million IS 'USD price per 1M output tokens at request time';
COMMENT ON COLUMN public.usage_events.cost_usd IS 'Calculated cost in USD (auto-computed)';
