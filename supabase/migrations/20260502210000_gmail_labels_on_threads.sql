ALTER TABLE public.email_threads
ADD COLUMN IF NOT EXISTS gmail_label_ids text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS idx_email_threads_gmail_labels ON public.email_threads USING GIN (gmail_label_ids);

COMMENT ON COLUMN public.email_threads.gmail_label_ids IS 'Gmail API labelIds merged across messages in this thread (Gmail accounts only).';
