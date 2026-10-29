DO $$ DECLARE c record; BEGIN
FOR c IN SELECT conrelid::regclass t, conname FROM pg_constraint WHERE conrelid IN ('public.bank_transactions'::regclass,'public.bank_provider_connections'::regclass) AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%Credem%' LOOP
EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.t, c.conname); END LOOP; END $$;
ALTER TABLE public.bank_transactions ADD CONSTRAINT bank_transactions_bank_check CHECK (bank IN ('Credem','BNL','PayPal'));
ALTER TABLE public.bank_provider_connections ADD CONSTRAINT bank_provider_connections_bank_check CHECK (bank IN ('Credem','BNL','PayPal'));
CREATE OR REPLACE FUNCTION public.import_bank_transactions(_rows jsonb)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r jsonb; n integer:=0; inserted integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_reconcile_bank(auth.uid()) THEN RAISE EXCEPTION 'Non autorizzato'; END IF;
 IF _rows IS NULL OR jsonb_typeof(_rows)<>'array' OR jsonb_array_length(_rows)>2000 THEN RAISE EXCEPTION 'Importazione non valida (massimo 2000 righe)'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(_rows) LOOP
  IF coalesce(r->>'bank','') NOT IN ('Credem','BNL','PayPal') OR coalesce(r->>'currency','')<>'EUR' OR coalesce(r->>'booking_date','') !~ '^\d{4}-\d{2}-\d{2}$' OR coalesce(r->>'account_ref','')='' OR coalesce(r->>'external_id','')='' OR coalesce(r->>'description','')='' OR coalesce(r->>'amount','') !~ '^-?[0-9]+(\.[0-9]{1,2})?$' THEN RAISE EXCEPTION 'Movimento bancario non valido'; END IF;
  INSERT INTO public.bank_transactions(bank,account_ref,external_id,booking_date,description,amount,currency,source,created_by) VALUES(r->>'bank',r->>'account_ref',r->>'external_id',(r->>'booking_date')::date,r->>'description',(r->>'amount')::numeric,'EUR','csv',auth.uid()) ON CONFLICT(bank,account_ref,external_id) DO NOTHING;
  GET DIAGNOSTICS inserted=ROW_COUNT; n:=n+inserted;
 END LOOP;
 RETURN n;
END; $function$;