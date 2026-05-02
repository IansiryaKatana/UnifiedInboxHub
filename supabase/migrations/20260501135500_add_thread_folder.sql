ALTER TABLE public.email_threads
ADD COLUMN IF NOT EXISTS folder TEXT NOT NULL DEFAULT 'inbox';

ALTER TABLE public.email_threads
DROP CONSTRAINT IF EXISTS email_threads_folder_check;

ALTER TABLE public.email_threads
ADD CONSTRAINT email_threads_folder_check
CHECK (folder IN ('inbox', 'archive', 'trash'));

CREATE INDEX IF NOT EXISTS idx_threads_user_folder_last
ON public.email_threads(user_id, folder, last_message_at DESC);
