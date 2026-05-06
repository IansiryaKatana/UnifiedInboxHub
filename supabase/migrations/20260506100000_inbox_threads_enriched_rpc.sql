-- One round-trip inbox load: threads + account badge + latest inbound sender + flags.
-- SECURITY INVOKER respects RLS on email_threads, emails, and email_accounts.

CREATE OR REPLACE FUNCTION public.get_inbox_threads_enriched()
RETURNS TABLE (result jsonb)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH uid AS (SELECT auth.uid() AS id)
  SELECT
    to_jsonb(t)
      || jsonb_build_object(
        'account',
          CASE
            WHEN a.id IS NULL THEN NULL
            ELSE jsonb_build_object('email_address', a.email_address, 'color', a.color)
          END,
        'latest_sender', em.latest_inbound_sender,
        'latest_sender_name', em.latest_inbound_sender_name,
        'has_starred', coalesce(em.has_starred, false),
        'has_outbound', coalesce(em.has_outbound, false)
      )
  FROM public.email_threads t
  LEFT JOIN public.email_accounts a
    ON a.id = t.account_id
   AND a.user_id = (SELECT id FROM uid)
  LEFT JOIN LATERAL (
    SELECT
      bool_or(e.is_starred) FILTER (WHERE e.is_starred) AS has_starred,
      bool_or(e.direction = 'outbound') AS has_outbound,
      (array_agg(e.sender ORDER BY e.sent_at DESC) FILTER (WHERE e.direction = 'inbound'))[1] AS latest_inbound_sender,
      (array_agg(e.sender_name ORDER BY e.sent_at DESC) FILTER (WHERE e.direction = 'inbound'))[1] AS latest_inbound_sender_name
    FROM public.emails e
    WHERE e.thread_id = t.id
      AND e.user_id = (SELECT id FROM uid)
  ) em ON true
  WHERE t.user_id = (SELECT id FROM uid)
  ORDER BY t.last_message_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_inbox_threads_enriched() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_inbox_threads_enriched() TO authenticated;
