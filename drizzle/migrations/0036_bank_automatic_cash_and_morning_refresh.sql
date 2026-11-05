DO $$ DECLARE d text; BEGIN SELECT pg_get_functiondef('public.reconcile_bank_transactions(jsonb)'::regprocedure) INTO d; d:=replace(d,'reconcile_bank_transactions(_entries jsonb)','reconcile_bank_transactions_core(_entries jsonb, _actor uuid)'); d:=replace(d,'IF auth.uid() IS NULL OR NOT public.can_reconcile_bank(auth.uid())','IF _actor IS NULL OR NOT public.can_reconcile_bank(_actor)'); d:=replace(d,'auth.uid()','_actor'); d:=replace(d,$old$PERFORM public.log_audit_action('bank_reconcile_batch','bank_allocations',NULL,'Associazione multipla movimenti bancari',NULL,jsonb_build_object('count',jsonb_array_length(_entries),'results',results))$old$, $new$INSERT INTO public.audit_log(user_id,action,entity_type,detail,new_state) VALUES(_actor,'bank_reconcile_batch','bank_allocations','Associazione multipla movimenti bancari',jsonb_build_object('count',jsonb_array_length(_entries),'results',results))$new$); EXECUTE d; END $$;
REVOKE ALL ON FUNCTION public.reconcile_bank_transactions_core(jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.reconcile_bank_transactions(_entries jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN IF auth.uid() IS NULL OR NOT public.can_reconcile_bank(auth.uid()) THEN RAISE EXCEPTION 'Non autorizzato'; END IF; RETURN public.reconcile_bank_transactions_core(_entries,auth.uid()); END $$;
REVOKE ALL ON FUNCTION public.reconcile_bank_transactions(jsonb) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.reconcile_bank_transactions(jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.auto_register_bank_cash(_entries jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid; entry jsonb; b public.bank_transactions%ROWTYPE; residual numeric; planned jsonb:='[]';
BEGIN
 IF jsonb_typeof(_entries) IS DISTINCT FROM 'array' OR jsonb_array_length(_entries)>500 THEN RAISE EXCEPTION 'Elenco non valido'; END IF;
 SELECT p.id INTO actor FROM public.profiles p WHERE public.can_reconcile_bank(p.id) ORDER BY p.id LIMIT 1;
 IF actor IS NULL THEN RAISE EXCEPTION 'Proprietario autorizzato non disponibile'; END IF;
 PERFORM t.id FROM public.bank_transactions t WHERE t.id IN (SELECT (e.value->>'transaction_id')::uuid FROM jsonb_array_elements(_entries) e) ORDER BY t.id FOR UPDATE;
 FOR entry IN SELECT DISTINCT ON (e.value->>'transaction_id') e.value FROM jsonb_array_elements(_entries) e ORDER BY e.value->>'transaction_id' LOOP
  IF entry->>'description' NOT IN ('CARTA DI DEBITO','BANCA','GOOGLE') OR entry->>'description' IS NULL THEN RAISE EXCEPTION 'Causale automatica non consentita'; END IF;
  SELECT * INTO b FROM public.bank_transactions WHERE id=(entry->>'transaction_id')::uuid AND deleted_at IS NULL AND status='BOOK';
  IF NOT FOUND OR b.updated_at IS DISTINCT FROM (entry->>'expected_updated_at')::timestamptz THEN CONTINUE; END IF;
  IF extract(year FROM b.booking_date) NOT IN (2026,2027) OR NOT EXISTS(SELECT 1 FROM public.contabilita_state WHERE key=CASE WHEN extract(year FROM b.booking_date)=2026 THEN 'main' ELSE 'main-'||extract(year FROM b.booking_date)::integer END) THEN CONTINUE; END IF;
  SELECT abs(b.amount)-coalesce(sum(a.amount),0) INTO residual FROM public.bank_allocations a WHERE a.transaction_id=b.id;
  IF residual<=0 THEN CONTINUE; END IF;
  planned:=planned||jsonb_build_array(jsonb_build_object('transaction_id',b.id,'request_id',gen_random_uuid(),'amount',residual,'description',entry->>'description','category','','competence_id',NULL));
 END LOOP;
 IF jsonb_array_length(planned)=0 THEN RETURN jsonb_build_object('count',0,'results','[]'::jsonb); END IF;
 RETURN public.reconcile_bank_transactions_core(planned,actor);
END $$;
REVOKE ALL ON FUNCTION public.auto_register_bank_cash(jsonb) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.auto_register_bank_cash(jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.get_bank_schedule_status() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ BEGIN IF auth.uid() IS NULL OR NOT public.can_reconcile_bank(auth.uid()) THEN RAISE EXCEPTION 'Non autorizzato'; END IF; RETURN jsonb_build_object('enabled',coalesce((SELECT c.enabled AND s.sync_enabled FROM public.bank_schedule_config c CROSS JOIN public.bank_provider_settings s WHERE c.id=true AND s.id=true),false),'times',jsonb_build_array('08:30','15:00'),'bank_times',jsonb_build_array('08:30'),'paypal_times',jsonb_build_array('08:30','15:00'),'timezone','Europe/Rome'); END $$;
REVOKE ALL ON FUNCTION public.get_bank_schedule_status() FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.get_bank_schedule_status() TO authenticated;