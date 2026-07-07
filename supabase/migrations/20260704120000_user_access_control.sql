-- Time-limited user access + admin-managed accounts

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS access_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by_admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin'::public.app_role)
$$;

CREATE OR REPLACE FUNCTION public.user_has_active_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.is_admin(_user_id) THEN true
    ELSE COALESCE(
      (SELECT p.access_expires_at > now() FROM public.profiles p WHERE p.id = _user_id),
      false
    )
  END
$$;

CREATE OR REPLACE FUNCTION public.extend_user_access(_user_id uuid, _until timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  IF _until IS NULL THEN
    RAISE EXCEPTION 'Expiry time required';
  END IF;
  UPDATE public.profiles
  SET access_expires_at = _until, updated_at = now()
  WHERE id = _user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;
  RETURN _until;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_has_active_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_has_active_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.extend_user_access(uuid, timestamptz) TO authenticated;

-- Profiles: admins can view/update all for dashboard
CREATE POLICY "admins view all profiles"
  ON public.profiles FOR SELECT
  USING (public.is_admin(auth.uid()) OR auth.uid() = id);

DROP POLICY IF EXISTS "view own profile" ON public.profiles;

CREATE POLICY "admins update access on profiles"
  ON public.profiles FOR UPDATE
  USING (public.is_admin(auth.uid()) OR auth.uid() = id);

DROP POLICY IF EXISTS "update own profile" ON public.profiles;

-- Existing users: bootstrap admin first, then grant others 1 year access
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role
FROM auth.users
WHERE lower(email) = lower('hello@iankatana.com')
ON CONFLICT (user_id, role) DO NOTHING;

UPDATE public.profiles
SET access_expires_at = NULL
WHERE id = (SELECT id FROM auth.users WHERE lower(email) = lower('hello@iankatana.com') LIMIT 1);

UPDATE public.profiles p
SET access_expires_at = now() + interval '365 days'
WHERE p.access_expires_at IS NULL
  AND NOT public.is_admin(p.id);

-- Email data: require active access (admins always pass via user_has_active_access)
DROP POLICY IF EXISTS "own accounts select" ON public.email_accounts;
DROP POLICY IF EXISTS "own accounts insert" ON public.email_accounts;
DROP POLICY IF EXISTS "own accounts update" ON public.email_accounts;
DROP POLICY IF EXISTS "own accounts delete" ON public.email_accounts;

CREATE POLICY "own accounts select" ON public.email_accounts FOR SELECT
  USING (auth.uid() = user_id AND public.user_has_active_access(auth.uid()));
CREATE POLICY "own accounts insert" ON public.email_accounts FOR INSERT
  WITH CHECK (auth.uid() = user_id AND public.user_has_active_access(auth.uid()));
CREATE POLICY "own accounts update" ON public.email_accounts FOR UPDATE
  USING (auth.uid() = user_id AND public.user_has_active_access(auth.uid()));
CREATE POLICY "own accounts delete" ON public.email_accounts FOR DELETE
  USING (auth.uid() = user_id AND public.user_has_active_access(auth.uid()));

DROP POLICY IF EXISTS "own threads select" ON public.email_threads;
DROP POLICY IF EXISTS "own threads insert" ON public.email_threads;
DROP POLICY IF EXISTS "own threads update" ON public.email_threads;
DROP POLICY IF EXISTS "own threads delete" ON public.email_threads;

CREATE POLICY "own threads select" ON public.email_threads FOR SELECT
  USING (auth.uid() = user_id AND public.user_has_active_access(auth.uid()));
CREATE POLICY "own threads insert" ON public.email_threads FOR INSERT
  WITH CHECK (auth.uid() = user_id AND public.user_has_active_access(auth.uid()));
CREATE POLICY "own threads update" ON public.email_threads FOR UPDATE
  USING (auth.uid() = user_id AND public.user_has_active_access(auth.uid()));
CREATE POLICY "own threads delete" ON public.email_threads FOR DELETE
  USING (auth.uid() = user_id AND public.user_has_active_access(auth.uid()));

DROP POLICY IF EXISTS "own emails select" ON public.emails;
DROP POLICY IF EXISTS "own emails insert" ON public.emails;
DROP POLICY IF EXISTS "own emails update" ON public.emails;
DROP POLICY IF EXISTS "own emails delete" ON public.emails;

CREATE POLICY "own emails select" ON public.emails FOR SELECT
  USING (auth.uid() = user_id AND public.user_has_active_access(auth.uid()));
CREATE POLICY "own emails insert" ON public.emails FOR INSERT
  WITH CHECK (auth.uid() = user_id AND public.user_has_active_access(auth.uid()));
CREATE POLICY "own emails update" ON public.emails FOR UPDATE
  USING (auth.uid() = user_id AND public.user_has_active_access(auth.uid()));
CREATE POLICY "own emails delete" ON public.emails FOR DELETE
  USING (auth.uid() = user_id AND public.user_has_active_access(auth.uid()));

DROP POLICY IF EXISTS "contacts select own" ON public.contacts;
DROP POLICY IF EXISTS "contacts insert own" ON public.contacts;
DROP POLICY IF EXISTS "contacts update own" ON public.contacts;
DROP POLICY IF EXISTS "contacts delete own" ON public.contacts;

CREATE POLICY "contacts select own" ON public.contacts FOR SELECT
  USING (auth.uid() = user_id AND public.user_has_active_access(auth.uid()));
CREATE POLICY "contacts insert own" ON public.contacts FOR INSERT
  WITH CHECK (auth.uid() = user_id AND public.user_has_active_access(auth.uid()));
CREATE POLICY "contacts update own" ON public.contacts FOR UPDATE
  USING (auth.uid() = user_id AND public.user_has_active_access(auth.uid()));
CREATE POLICY "contacts delete own" ON public.contacts FOR DELETE
  USING (auth.uid() = user_id AND public.user_has_active_access(auth.uid()));

DROP POLICY IF EXISTS "own push subs select" ON public.push_subscriptions;
DROP POLICY IF EXISTS "own push subs insert" ON public.push_subscriptions;
DROP POLICY IF EXISTS "own push subs update" ON public.push_subscriptions;
DROP POLICY IF EXISTS "own push subs delete" ON public.push_subscriptions;

CREATE POLICY "own push subs select" ON public.push_subscriptions FOR SELECT
  USING (auth.uid() = user_id AND public.user_has_active_access(auth.uid()));
CREATE POLICY "own push subs insert" ON public.push_subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id AND public.user_has_active_access(auth.uid()));
CREATE POLICY "own push subs update" ON public.push_subscriptions FOR UPDATE
  USING (auth.uid() = user_id AND public.user_has_active_access(auth.uid()));
CREATE POLICY "own push subs delete" ON public.push_subscriptions FOR DELETE
  USING (auth.uid() = user_id AND public.user_has_active_access(auth.uid()));
