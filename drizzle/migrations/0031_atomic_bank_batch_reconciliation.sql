CREATE OR REPLACE FUNCTION public.reconcile_bank_transactions(_entries jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE item jsonb; results jsonb := '[]'::jsonb; result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_reconcile_bank(auth.uid()) THEN RAISE EXCEPTION 'Non autorizzato'; END IF;
  IF jsonb_typeof(_entries) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Elenco associazioni non valido'; END IF;
  IF jsonb_array_length(_entries) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Seleziona da 1 a 2000 associazioni'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_entries) e WHERE jsonb_typeof(e) <> 'object' OR e->>'transaction_id' IS NULL OR e->>'request_id' IS NULL OR e->>'amount' IS NULL) THEN RAISE EXCEPTION 'Associazione incompleta'; END IF;
  IF (SELECT count(DISTINCT e->>'request_id') FROM jsonb_array_elements(_entries) e) <> jsonb_array_length(_entries) THEN RAISE EXCEPTION 'Conferma ripetuta nel gruppo'; END IF;
  PERFORM b.id FROM public.bank_transactions b WHERE b.id IN (SELECT (e->>'transaction_id')::uuid FROM jsonb_array_elements(_entries) e) ORDER BY b.id FOR UPDATE;
  PERFORM s.key FROM public.contabilita_state s WHERE s.key IN (SELECT CASE WHEN extract(year FROM b.booking_date)=2026 THEN 'main' ELSE 'main-'||extract(year FROM b.booking_date)::integer END FROM public.bank_transactions b WHERE b.id IN (SELECT (e->>'transaction_id')::uuid FROM jsonb_array_elements(_entries) e)) ORDER BY s.key FOR UPDATE;
  FOR item IN SELECT value FROM jsonb_array_elements(_entries) LOOP
    result := public.reconcile_bank_transaction((item->>'transaction_id')::uuid,(item->>'request_id')::uuid,item->>'competence_id',(item->>'amount')::numeric,item->>'description',item->>'category',(item->>'expected_amount')::numeric,(item->>'expected_acconto')::numeric);
    results := results || jsonb_build_array(result);
  END LOOP;
  RETURN jsonb_build_object('count',jsonb_array_length(_entries),'results',results);
END;
$$;
REVOKE ALL ON FUNCTION public.reconcile_bank_transactions(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_bank_transactions(jsonb) TO authenticated;
COMMENT ON FUNCTION public.reconcile_bank_transactions(jsonb) IS 'Atomic ordered-lock batch of bank-to-cash allocations. Uses server booking dates, owner authorization and sequential optimistic competence balances; any failed allocation rolls back the whole batch.';