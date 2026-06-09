
-- 1) Catalogs: drop broad permissive policies
DROP POLICY IF EXISTS "Authenticated users can insert catalogs" ON public.catalogs;
DROP POLICY IF EXISTS "Authenticated users can update catalogs" ON public.catalogs;

-- 2) Commesse: drop broad UPDATE policy
DROP POLICY IF EXISTS "Authenticated users can update commesse" ON public.commesse;

-- 3) Audit log: replace direct INSERT with SECURITY DEFINER RPC
DROP POLICY IF EXISTS audit_insert_self ON public.audit_log;

CREATE OR REPLACE FUNCTION public.log_audit_action(
  _action text,
  _entity_type text,
  _entity_id text DEFAULT NULL,
  _detail text DEFAULT NULL,
  _prev_state jsonb DEFAULT NULL,
  _new_state jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Non autenticato';
  END IF;
  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, detail, prev_state, new_state)
  VALUES (v_uid, _action, _entity_type, _entity_id, _detail, _prev_state, _new_state)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

GRANT EXECUTE ON FUNCTION public.log_audit_action(text, text, text, text, jsonb, jsonb) TO authenticated;

-- 4) Dipendenti: remove self-access branch to avoid salary leak via profile_id
DROP POLICY IF EXISTS dipendenti_select_priv ON public.dipendenti;
CREATE POLICY dipendenti_select_priv ON public.dipendenti
  FOR SELECT
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_permission(auth.uid(), 'flow'::text, 'read'::permission_level)
    OR has_permission(auth.uid(), 'flow'::text, 'write'::permission_level)
    OR has_permission(auth.uid(), 'dipendenti'::text, 'read'::permission_level)
    OR has_permission(auth.uid(), 'dipendenti'::text, 'write'::permission_level)
  );

-- 5) Fix mutable search_path on pgmq wrapper functions
CREATE OR REPLACE FUNCTION public.enqueue_email(queue_name text, payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq
AS $function$
BEGIN
  RETURN pgmq.send(queue_name, payload);
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN pgmq.send(queue_name, payload);
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_email(queue_name text, message_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq
AS $function$
BEGIN
  RETURN pgmq.delete(queue_name, message_id);
EXCEPTION WHEN undefined_table THEN
  RETURN FALSE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.read_email_batch(queue_name text, batch_size integer, vt integer)
RETURNS TABLE(msg_id bigint, read_ct integer, message jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq
AS $function$
BEGIN
  RETURN QUERY SELECT r.msg_id, r.read_ct, r.message FROM pgmq.read(queue_name, vt, batch_size) r;
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN;
END;
$function$;

CREATE OR REPLACE FUNCTION public.move_to_dlq(source_queue text, dlq_name text, message_id bigint, payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq
AS $function$
DECLARE new_id BIGINT;
BEGIN
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  PERFORM pgmq.delete(source_queue, message_id);
  RETURN new_id;
EXCEPTION WHEN undefined_table THEN
  BEGIN
    PERFORM pgmq.create(dlq_name);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  BEGIN
    PERFORM pgmq.delete(source_queue, message_id);
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;
  RETURN new_id;
END;
$function$;
