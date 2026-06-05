CREATE OR REPLACE FUNCTION public.return_order_to_revision(_order_id uuid, _sub_order_id uuid, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order public.production_orders%ROWTYPE;
  v_sub public.production_sub_orders%ROWTYPE;
  v_actor uuid := auth.uid();
  v_draft_id uuid;
  v_next_order integer;
  v_revision_snapshot jsonb;
  v_orig_titolo text;
  v_freed_shifts integer := 0;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Utente non autenticato'; END IF;
  IF length(trim(coalesce(_reason, ''))) < 5 THEN RAISE EXCEPTION 'Motivo revisione troppo breve'; END IF;
  IF NOT (public.has_permission(v_actor, 'produzione', 'write') OR public.has_role(v_actor, 'admin')) THEN
    RAISE EXCEPTION 'Non autorizzato';
  END IF;

  SELECT * INTO v_order FROM public.production_orders WHERE id = _order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordine non trovato'; END IF;
  SELECT * INTO v_sub FROM public.production_sub_orders WHERE id = _sub_order_id AND order_id = _order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lavorazione non trovata'; END IF;

  SELECT coalesce(max(ordine), -1) + 1 INTO v_next_order
  FROM public.design_drafts WHERE user_id = v_order.created_by;

  v_revision_snapshot := coalesce(v_order.snapshot->'designState', v_order.snapshot, '{}'::jsonb);
  v_orig_titolo := coalesce(
    NULLIF(v_revision_snapshot->>'jobName', ''),
    NULLIF(v_order.snapshot->>'jobName', ''),
    NULLIF(v_order.production_name, ''),
    v_order.cliente
  );
  v_revision_snapshot := jsonb_set(v_revision_snapshot, '{jobName}', to_jsonb(v_orig_titolo), true);
  v_revision_snapshot := jsonb_set(v_revision_snapshot, '{_revisionCliente}', to_jsonb(v_order.cliente), true);
  v_revision_snapshot := jsonb_set(v_revision_snapshot, '{_revisionTitolo}', to_jsonb(v_orig_titolo), true);
  v_revision_snapshot := jsonb_set(
    v_revision_snapshot, '{revision}',
    jsonb_build_object(
      'order_id', v_order.id, 'order_code', v_order.code,
      'sub_order_id', v_sub.id, 'sub_code', v_sub.code,
      'dept', v_sub.dept::text, 'reason', trim(_reason),
      'rejected_by', v_actor, 'rejected_at', now(),
      'cliente', v_order.cliente, 'titolo', v_orig_titolo
    ), true
  );

  INSERT INTO public.design_drafts (user_id, name, snapshot, ordine, active)
  VALUES (v_order.created_by,
    concat(coalesce(v_order.cliente, 'Progetto'), ' — revisione ', v_order.code),
    v_revision_snapshot, v_next_order, true)
  RETURNING id INTO v_draft_id;

  UPDATE public.design_drafts SET active = false
  WHERE user_id = v_order.created_by AND id <> v_draft_id;

  UPDATE public.production_orders
  SET status = 'annullato',
      note = concat(coalesce(note || chr(10), ''), '↩ ', to_char(now(), 'YYYY-MM-DD'),
        ' Revisionato in progettazione (', v_sub.code, '/', v_sub.dept::text, '): ', trim(_reason))
  WHERE id = v_order.id;

  UPDATE public.production_sub_orders
  SET status = 'rimandato', rejection_reason = trim(_reason),
      rejected_to = v_order.created_by, rejected_by = v_actor, rejected_at = now()
  WHERE order_id = v_order.id AND status <> 'completato';

  -- Libera le pianificazioni dei montaggi/lavorazioni collegate alla commessa di origine
  IF v_order.source_commessa_id IS NOT NULL THEN
    WITH d AS (
      DELETE FROM public.montaggi_planning WHERE commessa_id = v_order.source_commessa_id RETURNING 1
    )
    SELECT count(*) INTO v_freed_shifts FROM d;
  END IF;

  INSERT INTO public.prod_notifications (user_id, type, message, order_id, link, is_urgent)
  VALUES (v_order.created_by, 'ordine_rimandato',
    concat('Il progetto ', v_order.cliente, ' è tornato in revisione: ', trim(_reason),
      CASE WHEN v_freed_shifts > 0 THEN concat(' — liberati ', v_freed_shifts, ' turni in calendario') ELSE '' END),
    v_order.id, concat('/?draft=', v_draft_id::text), true);

  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, detail, prev_state, new_state)
  VALUES (v_actor, 'ORDINE_REVISIONE', 'production_order', v_order.id::text,
    concat(v_order.code, ' tornato in revisione — motivo: ', trim(_reason),
      CASE WHEN v_freed_shifts > 0 THEN concat(' — liberati ', v_freed_shifts, ' turni') ELSE '' END),
    jsonb_build_object('status', v_order.status),
    jsonb_build_object('status', 'annullato', 'draft_id', v_draft_id, 'reason', trim(_reason), 'freed_shifts', v_freed_shifts));

  RETURN v_draft_id;
END;
$function$;

-- Libera anche le pianificazioni di ordini già rimandati in passato che hanno turni orfani
DELETE FROM public.montaggi_planning mp
USING public.production_orders po
WHERE mp.commessa_id = po.source_commessa_id
  AND po.status = 'annullato'
  AND po.note ILIKE '%Revisionato in progettazione%';