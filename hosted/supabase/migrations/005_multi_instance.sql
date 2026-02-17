-- OpenClaw Hosted Platform - Multi-Instance Support
-- Allows users to create and manage multiple named bot instances.
-- The existing UNIQUE(user_id, name) constraint already supports this;
-- the 1-instance limit was enforced in API code, not the schema.

-- Add optional description column for user-provided instance annotations
ALTER TABLE public.instances ADD COLUMN IF NOT EXISTS description TEXT;

COMMENT ON COLUMN public.instances.description IS 'User-provided description of this bot instance';
