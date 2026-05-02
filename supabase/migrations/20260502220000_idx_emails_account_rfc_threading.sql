-- Speed up IMAP/Gmail threading lookups by parent Message-ID
CREATE INDEX IF NOT EXISTS idx_emails_account_rfc_msg
ON public.emails (account_id, rfc_message_id)
WHERE rfc_message_id IS NOT NULL;
