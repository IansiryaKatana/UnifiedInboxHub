
-- Roles enum + table
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- Provider enum
CREATE TYPE public.provider_type AS ENUM ('gmail', 'imap');
CREATE TYPE public.sync_status AS ENUM ('idle', 'syncing', 'error', 'disconnected');
CREATE TYPE public.email_direction AS ENUM ('inbound', 'outbound');

CREATE TABLE public.email_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_address TEXT NOT NULL,
  display_name TEXT,
  provider_type provider_type NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  sync_status sync_status NOT NULL DEFAULT 'idle',
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, email_address)
);
CREATE INDEX idx_email_accounts_user ON public.email_accounts(user_id);

CREATE TABLE public.email_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.email_accounts(id) ON DELETE CASCADE,
  provider_thread_id TEXT,
  subject TEXT,
  participants TEXT[] DEFAULT '{}',
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  message_count INT NOT NULL DEFAULT 0,
  unread_count INT NOT NULL DEFAULT 0,
  snippet TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_threads_user_last ON public.email_threads(user_id, last_message_at DESC);
CREATE INDEX idx_threads_account ON public.email_threads(account_id);

CREATE TABLE public.emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.email_accounts(id) ON DELETE CASCADE,
  thread_id UUID REFERENCES public.email_threads(id) ON DELETE CASCADE,
  provider_message_id TEXT,
  direction email_direction NOT NULL DEFAULT 'inbound',
  sender TEXT NOT NULL,
  sender_name TEXT,
  recipient TEXT NOT NULL,
  cc TEXT[],
  bcc TEXT[],
  subject TEXT,
  snippet TEXT,
  body_html TEXT,
  body_text TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  is_starred BOOLEAN NOT NULL DEFAULT false,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_emails_thread ON public.emails(thread_id, sent_at);
CREATE INDEX idx_emails_user_sent ON public.emails(user_id, sent_at DESC);

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emails ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- user_roles: users can view their own; only admins can write
CREATE POLICY "view own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "admins manage roles" ON public.user_roles FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- email_accounts
CREATE POLICY "own accounts select" ON public.email_accounts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own accounts insert" ON public.email_accounts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own accounts update" ON public.email_accounts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own accounts delete" ON public.email_accounts FOR DELETE USING (auth.uid() = user_id);

-- threads
CREATE POLICY "own threads select" ON public.email_threads FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own threads insert" ON public.email_threads FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own threads update" ON public.email_threads FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own threads delete" ON public.email_threads FOR DELETE USING (auth.uid() = user_id);

-- emails
CREATE POLICY "own emails select" ON public.emails FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own emails insert" ON public.emails FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own emails update" ON public.emails FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own emails delete" ON public.emails FOR DELETE USING (auth.uid() = user_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_accounts_updated BEFORE UPDATE ON public.email_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
