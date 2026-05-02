CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text,
  company text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contacts_email_nonempty CHECK (length(trim(email)) > 0)
);

CREATE UNIQUE INDEX contacts_user_email_lower_idx ON public.contacts (user_id, lower(trim(email)));

CREATE INDEX idx_contacts_user_updated ON public.contacts (user_id, updated_at DESC);

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contacts select own" ON public.contacts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "contacts insert own" ON public.contacts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "contacts update own" ON public.contacts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "contacts delete own" ON public.contacts FOR DELETE USING (auth.uid() = user_id);
