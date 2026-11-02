DO $$ DECLARE definition text; oldblock text; newblock text; BEGIN
SELECT pg_get_functiondef('public.reconcile_bank_transactions(jsonb)'::regprocedure) INTO definition;
oldblock:=substring(definition FROM position('   FOR m IN SELECT e.value' IN definition) FOR position('   IF NOT found_m' IN definition)-position('   FOR m IN SELECT e.value' IN definition));
newblock:=$block$   SELECT e.value INTO m FROM jsonb_array_elements(rows) e WHERE e.value->>'id'=comp LIMIT 1;
   found_m:=FOUND;
   IF found_m THEN
    IF m->>'status'<>'previsto' OR m->>'type'<>direction THEN RAISE EXCEPTION 'Voce di competenza non compatibile'; END IF;
    advance:=least((m->>'amount')::numeric,greatest(0,coalesce((m->>'acconto')::numeric,0)));
    IF (item->>'expected_amount') IS NULL OR (m->>'amount')::numeric<>(item->>'expected_amount')::numeric OR advance IS DISTINCT FROM (item->>'expected_acconto')::numeric THEN RAISE EXCEPTION 'La voce è cambiata: aggiorna e riprova'; END IF;
    remaining:=(m->>'amount')::numeric-advance;
    IF value>remaining THEN RAISE EXCEPTION 'Importo superiore al residuo in competenza'; END IF;
    cash:=m; stamp:=greatest(stamp,coalesce((m->>'_u')::numeric,0)+1);
    SELECT coalesce(jsonb_agg(CASE WHEN e.value->>'id'<>comp THEN e.value WHEN remaining>value THEN m||jsonb_build_object('amount',(m->>'amount')::numeric-value,'_u',stamp) ELSE m||jsonb_build_object('amount',advance,'status','cassa','acconto',0,'_u',stamp) END ORDER BY e.ord),'[]'::jsonb) INTO newrows FROM jsonb_array_elements(rows) WITH ORDINALITY e(value,ord) WHERE e.value->>'id'<>comp OR remaining>value OR advance>0;
    IF remaining=value AND advance=0 THEN
     del:=coalesce(v->'deletedIds','{}');
     v:=jsonb_set(v,'{deletedIds}',del||jsonb_build_object('movements',coalesce(del->'movements','[]')||jsonb_build_array(comp)));
    END IF;
   END IF;
$block$;
IF oldblock IS NULL OR length(oldblock)<100 THEN RAISE EXCEPTION 'Expected batch block not found'; END IF;
definition:=replace(definition,oldblock,newblock); EXECUTE definition;
END $$;