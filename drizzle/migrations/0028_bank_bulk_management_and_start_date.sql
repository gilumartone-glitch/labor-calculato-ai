ALTER TABLE public.bank_transactions ADD COLUMN deleted_at timestamptz, ADD COLUMN manual_updated_at timestamptz, ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE OR REPLACE FUNCTION public.guard_bank_transaction_start() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN IF NEW.booking_date<DATE '2026-10-24' THEN RETURN NULL; END IF; RETURN NEW; END; $$;
CREATE TRIGGER bank_transaction_start_date BEFORE INSERT ON public.bank_transactions FOR EACH ROW EXECUTE FUNCTION public.guard_bank_transaction_start();
CREATE OR REPLACE FUNCTION public.manage_bank_transactions(_action text,_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item jsonb; b public.bank_transactions%ROWTYPE; ids uuid[]; n integer:=0; dt date; amt numeric; descr text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_reconcile_bank(auth.uid()) THEN RAISE EXCEPTION 'Non autorizzato'; END IF;
 IF _action NOT IN ('edit','delete') OR jsonb_typeof(_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(_rows) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Seleziona da 1 a 500 movimenti'; END IF;
 SELECT array_agg((r->>'id')::uuid ORDER BY (r->>'id')::uuid) INTO ids FROM jsonb_array_elements(_rows) r;
 IF cardinality(ids)<>(SELECT count(DISTINCT x) FROM unnest(ids) x) THEN RAISE EXCEPTION 'Movimenti duplicati'; END IF;
 PERFORM id FROM public.bank_transactions WHERE id=ANY(ids) ORDER BY id FOR UPDATE;
 FOR item IN SELECT value FROM jsonb_array_elements(_rows) LOOP
  SELECT * INTO b FROM public.bank_transactions WHERE id=(item->>'id')::uuid AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Movimento non disponibile: aggiorna elenco'; END IF;
  IF item->>'updated_at' IS NULL OR b.updated_at IS DISTINCT FROM (item->>'updated_at')::timestamptz THEN RAISE EXCEPTION 'Un movimento è cambiato: aggiorna elenco e riprova'; END IF;
  IF EXISTS(SELECT 1 FROM public.bank_allocations WHERE transaction_id=b.id) THEN RAISE EXCEPTION 'Movimento già associato alla cassa: non modificabile o eliminabile'; END IF;
  IF _action='delete' THEN UPDATE public.bank_transactions SET deleted_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=b.id;
  ELSE
   IF coalesce(item->>'booking_date','') !~ '^\d{4}-\d{2}-\d{2}$' OR coalesce(item->>'amount','') !~ '^-?\d+(\.\d{1,2})?$' THEN RAISE EXCEPTION 'Data o importo non valido'; END IF;
   dt:=(item->>'booking_date')::date; amt:=(item->>'amount')::numeric; descr:=upper(trim(coalesce(item->>'description','')));
   IF dt<DATE '2026-10-24' OR amt=0 OR abs(amt)>999999999 OR length(descr) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Usa date dal 24/10/2026, importi non nulli e una causale valida'; END IF;
   UPDATE public.bank_transactions SET booking_date=dt,amount=amt,description=descr,manual_updated_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=b.id;
  END IF;
  n:=n+1;
 END LOOP;
 RETURN n;
END; $$;
REVOKE ALL ON FUNCTION public.manage_bank_transactions(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manage_bank_transactions(text,jsonb) TO authenticated,service_role;
DO $$ DECLARE definition text; p record; BEGIN
 SELECT pg_get_functiondef('public.store_bank_transactions(jsonb,text,uuid)'::regprocedure) INTO definition;
 definition:=replace(definition,'ar:=r->>''account_ref'';', 'IF (r->>''booking_date'')::date<DATE ''2026-10-24'' THEN CONTINUE; END IF;'||chr(10)||'  ar:=r->>''account_ref'';');
 definition:=replace(definition,'IF hit IS NOT NULL THEN'||chr(10)||'   IF _source', 'IF hit IS NOT NULL THEN'||chr(10)||'   IF existing.deleted_at IS NOT NULL OR existing.manual_updated_at IS NOT NULL THEN CONTINUE; END IF;'||chr(10)||'   IF _source');
 EXECUTE definition;
 SELECT pg_get_functiondef('public.reconcile_bank_transaction(uuid,uuid,text,numeric,text,text,numeric,numeric)'::regprocedure) INTO definition;
 definition:=replace(definition,'WHERE id=_transaction_id FOR UPDATE;', 'WHERE id=_transaction_id AND deleted_at IS NULL FOR UPDATE;');
 EXECUTE definition;
 FOR p IN SELECT policyname,qual FROM pg_policies WHERE schemaname='public' AND tablename='bank_transactions' AND cmd='SELECT' LOOP
  EXECUTE format('ALTER POLICY %I ON public.bank_transactions USING ((%s) AND deleted_at IS NULL)',p.policyname,p.qual);
 END LOOP;
END; $$;