-- Per-instance user API keys
-- Users can provide their own Anthropic, OpenAI, or Google keys per instance.
-- Keys are encrypted with AES-256-GCM before storage (same as gateway tokens).

CREATE TABLE public.instance_api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  instance_id UUID REFERENCES public.instances(id) ON DELETE CASCADE NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('anthropic', 'openai', 'google')),
  encrypted_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_provider_per_instance UNIQUE (instance_id, provider)
);

CREATE INDEX idx_instance_api_keys_instance ON public.instance_api_keys(instance_id);

ALTER TABLE public.instance_api_keys ENABLE ROW LEVEL SECURITY;

-- RLS: users can only manage keys for their own instances

CREATE POLICY instance_api_keys_select_own ON public.instance_api_keys
  FOR SELECT USING (
    instance_id IN (SELECT id FROM public.instances WHERE user_id = auth.uid())
  );

CREATE POLICY instance_api_keys_insert_own ON public.instance_api_keys
  FOR INSERT WITH CHECK (
    instance_id IN (SELECT id FROM public.instances WHERE user_id = auth.uid())
  );

CREATE POLICY instance_api_keys_update_own ON public.instance_api_keys
  FOR UPDATE USING (
    instance_id IN (SELECT id FROM public.instances WHERE user_id = auth.uid())
  );

CREATE POLICY instance_api_keys_delete_own ON public.instance_api_keys
  FOR DELETE USING (
    instance_id IN (SELECT id FROM public.instances WHERE user_id = auth.uid())
  );

-- Service role can manage keys via API routes
CREATE POLICY instance_api_keys_service_all ON public.instance_api_keys
  FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_instance_api_keys_updated_at
  BEFORE UPDATE ON public.instance_api_keys
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
