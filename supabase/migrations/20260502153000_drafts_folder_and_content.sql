-- Drafts mailbox + JSON payload for compose drafts saved locally
ALTER TABLE public.email_threads
DROP CONSTRAINT IF EXISTS email_threads_folder_check;

ALTER TABLE public.email_threads
ADD CONSTRAINT email_threads_folder_check
CHECK (folder IN ('inbox', 'archive', 'trash', 'drafts'));

ALTER TABLE public.email_threads
ADD COLUMN IF NOT EXISTS draft_content JSONB;

CREATE INDEX IF NOT EXISTS idx_threads_user_drafts
ON public.email_threads(user_id, folder)
WHERE folder = 'drafts';
