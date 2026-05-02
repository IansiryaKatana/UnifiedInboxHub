-- Enable Realtime for inbox tables (used by client postgres_changes subscriptions).
ALTER PUBLICATION supabase_realtime ADD TABLE public.emails;
ALTER PUBLICATION supabase_realtime ADD TABLE public.email_threads;
