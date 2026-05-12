CREATE OR REPLACE FUNCTION public.return_order_to_revision(
  _order_id uuid,
  _sub_order_id uuid,
  _reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.production_orders%ROWTYPE;
  v_sub public.production_sub_orders%ROWTYPE;
  v_actor uuid := auth.uid();
  v_draft_id uuid;
  v_next_order integer;
  v_revision_snapshot jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Utente non autenticato';
  END IF;

  IF length(trim(coalesce(_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Motivo revisione troppo breve';
  END IF;

  IF NOT (public.has_permission(v_actor, 'produzione', 'write') OR public.has_role(v_actor, 'admin')) THEN
    RAISE EXCEPTION 'Non autorizzato';
  END IF;

  SELECT * INTO v_order
  FROM public.production_orders
  WHERE id = _order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ordine non trovato';
  END IF;

  SELECT * INTO v_sub
  FROM public.production_sub_orders
  WHERE id = _sub_order_id AND order_id = _order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lavorazione non trovata';
  END IF;

  SELECT coalesce(max(ordine), -1) + 1 INTO v_next_order
  FROM public.design_drafts
  WHERE user_id = v_order.created_by;

  v_revision_snapshot := coalesce(v_order.snapshot->'designState', v_order.snapshot, '{}'::jsonb);
  v_revision_snapshot := jsonb_set(
    v_revision_snapshot,
    '{revision}',
    jsonb_build_object(
      'order_id', v_order.id,
      'order_code', v_order.code,
      'sub_order_id', v_sub.id,
      'sub_code', v_sub.code,
      'dept', v_sub.dept::text,
      'reason', trim(_reason),
      'rejected_by', v_actor,
      'rejected_at', now()
    ),
    true
  );

  INSERT INTO public.design_drafts (user_id, name, snapshot, ordine, active)
  VALUES (
    v_order.created_by,
    concat(v_order.cliente, ' — revisione ', v_order.code),
    v_revision_snapshot,
    v_next_order,
    true
  )
  RETURNING id INTO v_draft_id;

  UPDATE public.design_drafts
  SET active = false
  WHERE user_id = v_order.created_by
    AND id <> v_draft_id;

  UPDATE public.production_orders
  SET status = 'annullato',
      note = concat(coalesce(note || chr(10), ''), '↩ ', to_char(now(), 'YYYY-MM-DD'), ' Revisionato in progettazione (', v_sub.code, '/', v_sub.dept::text, '): ', trim(_reason))
  WHERE id = v_order.id;

  UPDATE public.production_sub_orders
  SET status = 'rimandato',
      rejection_reason = trim(_reason),
      rejected_to = v_order.created_by,
      rejected_by = v_actor,
      rejected_at = now()
  WHERE order_id = v_order.id
    AND status <> 'completato';

  INSERT INTO public.prod_notifications (user_id, type, message, order_id, link, is_urgent)
  VALUES (
    v_order.created_by,
    'ordine_rimandato',
    concat('Il progetto ', v_order.cliente, ' è tornato in revisione: ', trim(_reason)),
    v_order.id,
    concat('/?draft=', v_draft_id::text),
    true
  );

  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, detail, prev_state, new_state)
  VALUES (
    v_actor,
    'ORDINE_REVISIONE',
    'production_order',
    v_order.id::text,
    concat(v_order.code, ' tornato in revisione — motivo: ', trim(_reason)),
    jsonb_build_object('status', v_order.status),
    jsonb_build_object('status', 'annullato', 'draft_id', v_draft_id, 'reason', trim(_reason))
  );

  RETURN v_draft_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.return_order_to_revision(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.return_order_to_revision(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.return_order_to_revision(uuid, uuid, text) TO authenticated;