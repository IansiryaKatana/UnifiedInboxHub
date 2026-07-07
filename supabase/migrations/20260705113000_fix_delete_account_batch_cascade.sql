-- Fix batched delete: never delete threads while emails remain (CASCADE was timing out).

CREATE OR REPLACE FUNCTION public.delete_email_account_data_batch(
  p_account_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '20s'
AS $$
DECLARE
  v_emails_deleted int := 0;
  v_threads_deleted int := 0;
  v_has_emails boolean;
  v_has_threads boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.email_accounts
    WHERE id = p_account_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  DELETE FROM public.emails
  WHERE id IN (
    SELECT id FROM public.emails
    WHERE account_id = p_account_id
    ORDER BY id
    LIMIT 75
  );
  GET DIAGNOSTICS v_emails_deleted = ROW_COUNT;

  SELECT EXISTS (
    SELECT 1 FROM public.emails WHERE account_id = p_account_id LIMIT 1
  ) INTO v_has_emails;

  IF NOT v_has_emails THEN
    DELETE FROM public.email_threads
    WHERE id IN (
      SELECT id FROM public.email_threads
      WHERE account_id = p_account_id
      ORDER BY id
      LIMIT 200
    );
    GET DIAGNOSTICS v_threads_deleted = ROW_COUNT;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.email_threads WHERE account_id = p_account_id LIMIT 1
  ) INTO v_has_threads;

  RETURN jsonb_build_object(
    'emails_deleted', v_emails_deleted,
    'threads_deleted', v_threads_deleted,
    'remaining_emails', CASE WHEN v_has_emails THEN 1 ELSE 0 END,
    'remaining_threads', CASE WHEN v_has_threads THEN 1 ELSE 0 END,
    'has_more', v_has_emails OR v_has_threads
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_email_account_data_batch(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_email_account_data_batch(uuid, uuid) TO service_role;
