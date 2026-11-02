CREATE OR REPLACE FUNCTION public.reconcile_bank_transactions(_entries jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item jsonb; b public.bank_transactions%ROWTYPE; existing public.bank_allocations%ROWTYPE;
 k text; states jsonb:='{}'; v jsonb; rows jsonb; newrows jsonb; m jsonb; cash jsonb; del jsonb;
 request uuid; comp text; value numeric; remaining numeric; advance numeric; left_bank numeric; stamp numeric; cash_id text; direction text; found_m boolean; changed text[]:='{}'; results jsonb:='[]';
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_reconcile_bank(auth.uid()) THEN RAISE EXCEPTION 'Non autorizzato'; END IF;
 IF jsonb_typeof(_entries) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Elenco associazioni non valido'; END IF;
 IF jsonb_array_length(_entries) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Seleziona da 1 a 2000 associazioni'; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(_entries) e WHERE jsonb_typeof(e)<>'object' OR e->>'transaction_id' IS NULL OR e->>'request_id' IS NULL OR e->>'amount' IS NULL) THEN RAISE EXCEPTION 'Associazione incompleta'; END IF;
 IF (SELECT count(DISTINCT e->>'request_id') FROM jsonb_array_elements(_entries) e)<>jsonb_array_length(_entries) THEN RAISE EXCEPTION 'Conferma ripetuta nel gruppo'; END IF;
 PERFORM id FROM public.bank_transactions WHERE id IN (SELECT (e->>'transaction_id')::uuid FROM jsonb_array_elements(_entries) e) ORDER BY id FOR UPDATE;
 FOR k,v IN SELECT s.key,s.data FROM public.contabilita_state s WHERE s.key IN (SELECT CASE WHEN extract(year FROM booking_date)=2026 THEN 'main' ELSE 'main-'||extract(year FROM booking_date)::integer END FROM public.bank_transactions WHERE id IN (SELECT (e->>'transaction_id')::uuid FROM jsonb_array_elements(_entries) e)) ORDER BY s.key FOR UPDATE LOOP
  states:=jsonb_set(states,ARRAY[k],v);
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(_entries) LOOP
  request:=(item->>'request_id')::uuid; value:=(item->>'amount')::numeric; comp:=item->>'competence_id';
  IF value IS NULL OR value<=0 OR value<>round(value,2) OR value>999999999 THEN RAISE EXCEPTION 'Importo non valido'; END IF;
  SELECT * INTO b FROM public.bank_transactions WHERE id=(item->>'transaction_id')::uuid AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Movimento bancario non trovato'; END IF;
  IF b.status<>'BOOK' THEN RAISE EXCEPTION 'I movimenti in sospeso non possono essere portati in cassa'; END IF;
  SELECT * INTO existing FROM public.bank_allocations WHERE id=request;
  IF FOUND THEN
   IF existing.transaction_id<>b.id OR existing.competence_id IS DISTINCT FROM comp OR existing.amount<>value THEN RAISE EXCEPTION 'Conferma già utilizzata'; END IF;
   results:=results||jsonb_build_array(jsonb_build_object('accounting_key',existing.accounting_key,'cash_movement_id',existing.cash_movement_id)); CONTINUE;
  END IF;
  SELECT abs(b.amount)-coalesce(sum(amount),0) INTO left_bank FROM public.bank_allocations WHERE transaction_id=b.id;
  IF value>left_bank THEN RAISE EXCEPTION 'Importo già associato oppure superiore al residuo bancario'; END IF;
  IF extract(year FROM b.booking_date) NOT IN (2026,2027) THEN RAISE EXCEPTION 'Anno non disponibile in contabilità'; END IF;
  k:=CASE WHEN extract(year FROM b.booking_date)=2026 THEN 'main' ELSE 'main-'||extract(year FROM b.booking_date)::integer END;
  v:=states->k;
  IF v IS NULL THEN RAISE EXCEPTION 'Apri prima la contabilità dell’anno del movimento bancario'; END IF;
  direction:=CASE WHEN b.amount>0 THEN 'entrata' ELSE 'uscita' END;
  rows:=coalesce(v->'movements','[]'); stamp:=ceil(extract(epoch FROM clock_timestamp())*1000); newrows:='[]'; found_m:=false;
  IF comp IS NOT NULL THEN
   FOR m IN SELECT e.value FROM jsonb_array_elements(rows) e LOOP
    IF m->>'id'=comp THEN
     found_m:=true;
     IF m->>'status'<>'previsto' OR m->>'type'<>direction THEN RAISE EXCEPTION 'Voce di competenza non compatibile'; END IF;
     advance:=least((m->>'amount')::numeric,greatest(0,coalesce((m->>'acconto')::numeric,0)));
     IF (item->>'expected_amount') IS NULL OR (m->>'amount')::numeric<>(item->>'expected_amount')::numeric OR advance IS DISTINCT FROM (item->>'expected_acconto')::numeric THEN RAISE EXCEPTION 'La voce è cambiata: aggiorna e riprova'; END IF;
     remaining:=(m->>'amount')::numeric-advance;
     IF value>remaining THEN RAISE EXCEPTION 'Importo superiore al residuo in competenza'; END IF;
     cash:=m; stamp:=greatest(stamp,coalesce((m->>'_u')::numeric,0)+1);
     IF remaining>value THEN
      newrows:=newrows||jsonb_build_array(m||jsonb_build_object('amount',(m->>'amount')::numeric-value,'_u',stamp));
     ELSIF advance>0 THEN
      newrows:=newrows||jsonb_build_array(m||jsonb_build_object('amount',advance,'status','cassa','acconto',0,'_u',stamp));
     ELSE
      del:=coalesce(v->'deletedIds','{}');
      v:=jsonb_set(v,'{deletedIds}',del||jsonb_build_object('movements',coalesce(del->'movements','[]')||jsonb_build_array(comp)));
     END IF;
    ELSE newrows:=newrows||jsonb_build_array(m); END IF;
   END LOOP;
   IF NOT found_m THEN RAISE EXCEPTION 'Voce di competenza non trovata'; END IF;
  ELSE
   IF length(trim(coalesce(item->>'description',''))) NOT BETWEEN 1 AND 2000 OR length(coalesce(item->>'category',''))>200 THEN RAISE EXCEPTION 'Inserisci una causale valida'; END IF;
   newrows:=rows; cash:=jsonb_build_object('description',upper(trim(item->>'description')),'category',upper(coalesce(item->>'category','')));
  END IF;
  cash_id:='bank-'||request;
  cash:=(cash-'additions'-'gestitoAcconti')||jsonb_build_object('id',cash_id,'date',b.booking_date::text,'amount',value,'acconto',0,'status','cassa','type',direction,'paymentMethod','B','bankTransactionId',b.id,'bank',b.bank,'_u',stamp);
  v:=jsonb_set(v,'{movements}',newrows||jsonb_build_array(cash)); states:=jsonb_set(states,ARRAY[k],v);
  IF NOT k=ANY(changed) THEN changed:=array_append(changed,k); END IF;
  INSERT INTO public.bank_allocations(id,transaction_id,accounting_key,competence_id,cash_movement_id,amount,created_by) VALUES(request,b.id,k,comp,cash_id,value,auth.uid());
  results:=results||jsonb_build_array(jsonb_build_object('accounting_key',k,'cash_movement_id',cash_id));
 END LOOP;
 FOREACH k IN ARRAY changed LOOP
  UPDATE public.contabilita_state SET data=states->k,updated_by=auth.uid(),updated_at=clock_timestamp() WHERE key=k;
 END LOOP;
 IF cardinality(changed)>0 THEN PERFORM public.log_audit_action('bank_reconcile_batch','bank_allocations',NULL,'Associazione multipla movimenti bancari',NULL,jsonb_build_object('count',jsonb_array_length(_entries),'results',results)); END IF;
 RETURN jsonb_build_object('count',jsonb_array_length(_entries),'results',results);
END;
$$;
REVOKE ALL ON FUNCTION public.reconcile_bank_transactions(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reconcile_bank_transactions(jsonb) TO authenticated;