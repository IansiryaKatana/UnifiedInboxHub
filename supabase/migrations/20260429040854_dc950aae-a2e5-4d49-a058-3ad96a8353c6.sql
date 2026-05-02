ALTER TABLE public.email_accounts
  ADD COLUMN IF NOT EXISTS oauth_refresh_token text,
  ADD COLUMN IF NOT EXISTS oauth_access_token text,
  ADD COLUMN IF NOT EXISTS oauth_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS oauth_scope text;