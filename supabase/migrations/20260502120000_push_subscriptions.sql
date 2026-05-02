-- Web Push subscriptions (VAPID) for new-email notifications
CREATE TABLE public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT push_subscriptions_endpoint_unique UNIQUE (endpoint)
);

CREATE INDEX idx_push_subscriptions_user_id ON public.push_subscriptions(user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own push subs select"
  ON public.push_subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "own push subs insert"
  ON public.push_subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own push subs update"
  ON public.push_subscriptions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "own push subs delete"
  ON public.push_subscriptions FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_push_subscriptions_updated
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
