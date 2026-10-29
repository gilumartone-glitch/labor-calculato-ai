CREATE OR REPLACE FUNCTION public.reconcile_bank_transaction(_transaction_id uuid,_request_id uuid,_competence_id text,_amount numeric,_description text,_category text,_expected_amount numeric DEFAULT NULL,_expected_acconto numeric DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b public.bank_transactions%ROWTYPE; existing public.bank_allocations%ROWTYPE; k text; v jsonb; rows jsonb; m jsonb; cash jsonb; left_bank numeric; remaining numeric; advance numeric; stamp numeric; cash_id text; found_m boolean:=false; newrows jsonb:='[]'::jsonb; del jsonb; direction text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_reconcile_bank(auth.uid()) THEN RAISE EXCEPTION 'Non autorizzato'; END IF;
 IF _request_id IS NULL OR _amount IS NULL OR _amount<=0 OR _amount<>round(_amount,2) OR _amount>999999999 THEN RAISE EXCEPTION 'Importo non valido'; END IF;
 SELECT * INTO b FROM public.bank_transactions WHERE id=_transaction_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Movimento bancario non trovato'; END IF;
 SELECT * INTO existing FROM public.bank_allocations WHERE id=_request_id;
 IF FOUND THEN
  IF existing.transaction_id<>_transaction_id OR existing.competence_id IS DISTINCT FROM _competence_id OR existing.amount<>_amount THEN RAISE EXCEPTION 'Conferma già utilizzata'; END IF;
  RETURN jsonb_build_object('accounting_key',existing.accounting_key,'cash_movement_id',existing.cash_movement_id);
 END IF;
 SELECT abs(b.amount)-coalesce(sum(amount),0) INTO left_bank FROM public.bank_allocations WHERE transaction_id=b.id;
 IF _amount>left_bank THEN RAISE EXCEPTION 'Importo già associato oppure superiore al residuo bancario'; END IF;
 IF extract(year from b.booking_date) NOT IN (2026,2027) THEN RAISE EXCEPTION 'Anno non disponibile in contabilità'; END IF;
 k:=CASE WHEN extract(year from b.booking_date)=2026 THEN 'main' ELSE 'main-'||extract(year from b.booking_date)::integer END;
 direction:=CASE WHEN b.amount>0 THEN 'entrata' ELSE 'uscita' END;
 SELECT data INTO v FROM public.contabilita_state WHERE key=k FOR UPDATE;
 IF v IS NULL THEN RAISE EXCEPTION 'Apri prima la contabilità dell’anno del movimento bancario'; END IF;
 rows:=coalesce(v->'movements','[]'::jsonb);
 stamp:=ceil(extract(epoch from clock_timestamp())*1000);
 IF _competence_id IS NOT NULL THEN
  FOR m IN SELECT value FROM jsonb_array_elements(rows) LOOP
   IF m->>'id'=_competence_id THEN
    found_m:=true;
    IF m->>'status'<>'previsto' OR m->>'type'<>direction THEN RAISE EXCEPTION 'Voce di competenza non compatibile'; END IF;
    advance:=least((m->>'amount')::numeric,greatest(0,coalesce((m->>'acconto')::numeric,0)));
    IF _expected_amount IS NULL OR (m->>'amount')::numeric<>_expected_amount OR advance IS DISTINCT FROM _expected_acconto THEN RAISE EXCEPTION 'La voce è cambiata: aggiorna e riprova'; END IF;
    remaining:=(m->>'amount')::numeric-advance;
    IF _amount>remaining THEN RAISE EXCEPTION 'Importo superiore al residuo in competenza'; END IF;
    cash:=m;
    stamp:=greatest(stamp,coalesce((m->>'_u')::numeric,0)+1);
    IF remaining>_amount THEN
     newrows:=newrows||jsonb_build_array(m||jsonb_build_object('amount',(m->>'amount')::numeric-_amount,'_u',stamp));
    ELSIF advance>0 THEN
     newrows:=newrows||jsonb_build_array(m||jsonb_build_object('amount',advance,'status','cassa','acconto',0,'_u',stamp));
    ELSE
     del:=coalesce(v->'deletedIds','{}'::jsonb);
     v:=jsonb_set(v,'{deletedIds}',del||jsonb_build_object('movements',coalesce(del->'movements','[]'::jsonb)||jsonb_build_array(_competence_id)));
    END IF;
   ELSE newrows:=newrows||jsonb_build_array(m); END IF;
  END LOOP;
  IF NOT found_m THEN RAISE EXCEPTION 'Voce di competenza non trovata'; END IF;
 ELSE
  IF length(trim(coalesce(_description,''))) NOT BETWEEN 1 AND 2000 OR length(coalesce(_category,''))>200 THEN RAISE EXCEPTION 'Inserisci una causale valida'; END IF;
  newrows:=rows; cash:=jsonb_build_object('description',upper(trim(_description)),'category',upper(coalesce(_category,'')));
 END IF;
 cash_id:='bank-'||_request_id;
 cash:=(cash-'additions'-'gestitoAcconti')||jsonb_build_object('id',cash_id,'date',b.booking_date::text,'amount',_amount,'acconto',0,'status','cassa','type',direction,'paymentMethod','B','bankTransactionId',b.id,'bank',b.bank,'_u',stamp);
 v:=jsonb_set(v,'{movements}',newrows||jsonb_build_array(cash));
 UPDATE public.contabilita_state SET data=v,updated_by=auth.uid(),updated_at=clock_timestamp() WHERE key=k;
 INSERT INTO public.bank_allocations(id,transaction_id,accounting_key,competence_id,cash_movement_id,amount,created_by) VALUES(_request_id,b.id,k,_competence_id,cash_id,_amount,auth.uid());
 PERFORM public.log_audit_action('bank_reconciled','bank_transaction',b.id::text,'Associato movimento bancario',NULL,jsonb_build_object('cash_movement_id',cash_id,'amount',_amount,'competence_id',_competence_id));
 RETURN jsonb_build_object('accounting_key',k,'cash_movement_id',cash_id);
END; $$;
REVOKE ALL ON FUNCTION public.reconcile_bank_transaction(uuid,uuid,text,numeric,text,text,numeric,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reconcile_bank_transaction(uuid,uuid,text,numeric,text,text,numeric,numeric) TO authenticated;