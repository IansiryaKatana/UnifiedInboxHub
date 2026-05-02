-- RFC Message-ID / References for correct threading (Gmail + IMAP/SMTP)
ALTER TABLE public.emails
ADD COLUMN IF NOT EXISTS rfc_message_id TEXT;

ALTER TABLE public.emails
ADD COLUMN IF NOT EXISTS references_header TEXT;

CREATE INDEX IF NOT EXISTS idx_emails_thread_sent ON public.emails(thread_id, sent_at);

COMMENT ON COLUMN public.emails.rfc_message_id IS 'RFC 5322 Message-ID (angle brackets normalized)';
COMMENT ON COLUMN public.emails.references_header IS 'Raw References header from inbound mail; used to build replies';

-- Full-text search (invoker reads respect RLS)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE public.emails
ADD COLUMN IF NOT EXISTS search_tsv tsvector
GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', coalesce(subject, '')), 'A')
  || setweight(to_tsvector('simple', coalesce(body_text, '')), 'B')
  || setweight(to_tsvector('simple', coalesce(snippet, '')), 'C')
) STORED;

CREATE INDEX IF NOT EXISTS idx_emails_search_tsv ON public.emails USING GIN (search_tsv);

ALTER TABLE public.email_threads
ADD COLUMN IF NOT EXISTS search_tsv tsvector
GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', coalesce(subject, '')), 'A')
  || setweight(to_tsvector('simple', coalesce(snippet, '')), 'B')
) STORED;

CREATE INDEX IF NOT EXISTS idx_email_threads_search_tsv ON public.email_threads USING GIN (search_tsv);

-- Populate generated columns for existing rows
UPDATE public.emails SET subject = subject WHERE id IS NOT NULL;
UPDATE public.email_threads SET subject = subject WHERE id IS NOT NULL;

-- Private bucket for outbound/large attachments (paths: {user_id}/...)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('email-attachments', 'email-attachments', false, 26214400, NULL)
ON CONFLICT (id) DO UPDATE SET file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS "email_attachments_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "email_attachments_select_own" ON storage.objects;
DROP POLICY IF EXISTS "email_attachments_delete_own" ON storage.objects;
DROP POLICY IF EXISTS "email_attachments_update_own" ON storage.objects;

CREATE POLICY "email_attachments_insert_own"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'email-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "email_attachments_select_own"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'email-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "email_attachments_delete_own"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'email-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "email_attachments_update_own"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'email-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
