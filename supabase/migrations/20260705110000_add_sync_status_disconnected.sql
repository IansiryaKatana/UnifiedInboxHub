-- Production DB was missing the disconnected enum value (defined in initial migration but never applied).

ALTER TYPE public.sync_status ADD VALUE IF NOT EXISTS 'disconnected';

-- Faster batched deletes for large mailboxes (~14k emails).
CREATE OR REPLACE FUNCTION public.delete_email_account_data_batch(p_account_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_emails_deleted int := 0;
  v_threads_deleted int := 0;
  v_remaining_emails int;
  v_remaining_threads int;
BEGIN
  SELECT user_id INTO v_owner
  FROM public.email_accounts
  WHERE id = p_account_id;

  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  DELETE FROM public.emails
  WHERE id IN (
    SELECT id FROM public.emails
    WHERE account_id = p_account_id
    LIMIT 500
  );
  GET DIAGNOSTICS v_emails_deleted = ROW_COUNT;

  DELETE FROM public.email_threads
  WHERE id IN (
    SELECT id FROM public.email_threads
    WHERE account_id = p_account_id
    LIMIT 500
  );
  GET DIAGNOSTICS v_threads_deleted = ROW_COUNT;

  SELECT count(*)::int INTO v_remaining_emails
  FROM public.emails
  WHERE account_id = p_account_id;

  SELECT count(*)::int INTO v_remaining_threads
  FROM public.email_threads
  WHERE account_id = p_account_id;

  RETURN jsonb_build_object(
    'emails_deleted', v_emails_deleted,
    'threads_deleted', v_threads_deleted,
    'remaining_emails', v_remaining_emails,
    'remaining_threads', v_remaining_threads
  );
END;
$$;
