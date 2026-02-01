-- OpenClaw Hosted Platform - AWS ECS Infrastructure
-- Replaces DigitalOcean with AWS ECS for instance provisioning

-- Drop DO-specific columns
ALTER TABLE public.instances DROP COLUMN IF EXISTS do_app_id;
ALTER TABLE public.instances DROP COLUMN IF EXISTS do_component_name;

-- Add provider column (AWS only for now, but extensible)
ALTER TABLE public.instances
  ADD COLUMN provider TEXT DEFAULT 'aws'
  CHECK (provider IN ('aws'));

-- Add generic provider resource ID
ALTER TABLE public.instances
  ADD COLUMN provider_resource_id TEXT;

-- Add AWS-specific columns
ALTER TABLE public.instances
  ADD COLUMN aws_service_arn TEXT,
  ADD COLUMN aws_target_group_arn TEXT,
  ADD COLUMN aws_rule_arn TEXT;

-- Create index for provider-based queries
CREATE INDEX IF NOT EXISTS idx_instances_provider ON public.instances(provider);

-- Add comments for documentation
COMMENT ON COLUMN public.instances.provider IS 'Infrastructure provider (aws)';
COMMENT ON COLUMN public.instances.provider_resource_id IS 'Primary resource ID (ECS service ARN)';
COMMENT ON COLUMN public.instances.aws_service_arn IS 'AWS ECS Service ARN';
COMMENT ON COLUMN public.instances.aws_target_group_arn IS 'AWS ALB Target Group ARN';
COMMENT ON COLUMN public.instances.aws_rule_arn IS 'AWS ALB Listener Rule ARN';
