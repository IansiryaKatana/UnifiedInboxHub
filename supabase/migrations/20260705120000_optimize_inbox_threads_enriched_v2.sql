-- Inbox RPC: paginate threads first, aggregate emails only for that page, skip disconnected accounts.

CREATE OR REPLACE FUNCTION public.get_inbox_threads_enriched(
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (result jsonb)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  WITH uid AS (SELECT auth.uid() AS id),
  page_threads AS (
    SELECT t.*
    FROM public.email_threads t
    INNER JOIN public.email_accounts a
      ON a.id = t.account_id
     AND a.user_id = (SELECT id FROM uid)
    WHERE t.user_id = (SELECT id FROM uid)
      AND a.sync_status IS DISTINCT FROM 'disconnected'::public.sync_status
    ORDER BY t.last_message_at DESC NULLS LAST
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 500), 500))
    OFFSET GREATEST(0, COALESCE(p_offset, 0))
  ),
  email_stats AS (
    SELECT
      e.thread_id,
      bool_or(e.is_starred) FILTER (WHERE e.is_starred) AS has_starred,
      bool_or(e.direction = 'outbound') AS has_outbound,
      (array_agg(e.sender ORDER BY e.sent_at DESC) FILTER (WHERE e.direction = 'inbound'))[1]
        AS latest_inbound_sender,
      (array_agg(e.sender_name ORDER BY e.sent_at DESC) FILTER (WHERE e.direction = 'inbound'))[1]
        AS latest_inbound_sender_name
    FROM public.emails e
    INNER JOIN page_threads pt ON pt.id = e.thread_id
    GROUP BY e.thread_id
  )
  SELECT
    jsonb_build_object(
      'id', t.id,
      'account_id', t.account_id,
      'subject', t.subject,
      'snippet', t.snippet,
      'last_message_at', t.last_message_at,
      'unread_count', t.unread_count,
      'message_count', t.message_count,
      'participants', t.participants,
      'folder', t.folder,
      'gmail_label_ids', t.gmail_label_ids,
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
  FROM page_threads t
  LEFT JOIN public.email_accounts a
    ON a.id = t.account_id
   AND a.user_id = (SELECT id FROM uid)
  LEFT JOIN email_stats em ON em.thread_id = t.id
  ORDER BY t.last_message_at DESC NULLS LAST;
$$;
