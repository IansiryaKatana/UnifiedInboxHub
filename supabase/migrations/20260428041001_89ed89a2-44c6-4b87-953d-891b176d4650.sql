
-- Track Gmail history & IMAP UID for incremental sync
ALTER TABLE public.email_accounts
  ADD COLUMN IF NOT EXISTS history_id TEXT,
  ADD COLUMN IF NOT EXISTS imap_last_uid INTEGER,
  ADD COLUMN IF NOT EXISTS imap_host TEXT,
  ADD COLUMN IF NOT EXISTS imap_port INTEGER,
  ADD COLUMN IF NOT EXISTS imap_username TEXT,
  ADD COLUMN IF NOT EXISTS imap_use_tls BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS smtp_host TEXT,
  ADD COLUMN IF NOT EXISTS smtp_port INTEGER,
  ADD COLUMN IF NOT EXISTS smtp_username TEXT,
  ADD COLUMN IF NOT EXISTS imap_password_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS smtp_password_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS last_sync_error TEXT;

-- Idempotency: prevent duplicate emails per provider message
CREATE UNIQUE INDEX IF NOT EXISTS emails_account_provider_msg_uniq
  ON public.emails (account_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS threads_account_provider_uniq
  ON public.email_threads (account_id, provider_thread_id)
  WHERE provider_thread_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS emails_thread_sent_idx ON public.emails (thread_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS threads_user_last_idx ON public.email_threads (user_id, last_message_at DESC);

-- pg_cron + pg_net for background polling
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
