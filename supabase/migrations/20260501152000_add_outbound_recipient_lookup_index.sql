CREATE INDEX IF NOT EXISTS idx_emails_account_outbound_recipient_sent
ON public.emails (account_id, direction, sent_at DESC, lower(recipient));
