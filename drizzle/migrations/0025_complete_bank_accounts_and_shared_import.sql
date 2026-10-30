CREATE TABLE public.bank_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), connection_id uuid REFERENCES public.bank_provider_connections(id), bank text NOT NULL CHECK(bank IN ('Credem','BNL','PayPal')), account_ref text NOT NULL, display_name text NOT NULL, iban_last4 text, currency text NOT NULL DEFAULT 'EUR', balance numeric(14,2), balance_date timestamptz, last_sync_at timestamptz, is_active boolean NOT NULL DEFAULT true, UNIQUE(bank,account_ref)
);
GRANT SELECT ON public.bank_accounts TO authenticated;
GRANT ALL ON public.bank_accounts TO service_role;
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY bank_accounts_read ON public.bank_accounts FOR SELECT TO authenticated USING(public.can_reconcile_bank(auth.uid()));
CREATE TABLE public.bank_sync_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid REFERENCES public.bank_accounts(id), bank text NOT NULL, outcome text NOT NULL CHECK(outcome IN ('success','error','blocked')), message text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.bank_sync_log TO authenticated;
GRANT ALL ON public.bank_sync_log TO service_role;
ALTER TABLE public.bank_sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY bank_sync_log_read ON public.bank_sync_log FOR SELECT TO authenticated USING(public.can_reconcile_bank(auth.uid()));
CREATE INDEX bank_sync_log_date_idx ON public.bank_sync_log(created_at DESC);
CREATE TABLE public.bank_schedule_config(id boolean PRIMARY KEY DEFAULT true CHECK(id), token text NOT NULL, job_id bigint, enabled boolean NOT NULL DEFAULT false, endpoint text NOT NULL);
GRANT ALL ON public.bank_schedule_config TO service_role;
ALTER TABLE public.bank_schedule_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transactions ADD COLUMN account_id uuid REFERENCES public.bank_accounts(id), ADD COLUMN value_date date, ADD COLUMN status text NOT NULL DEFAULT 'BOOK' CHECK(status IN ('BOOK','PDNG')), ADD COLUMN counterparty_name text, ADD COLUMN fingerprint text, ADD COLUMN reference_key text;
INSERT INTO public.bank_accounts(bank,account_ref,display_name) SELECT DISTINCT bank,account_ref,account_ref FROM public.bank_transactions;
UPDATE public.bank_transactions t SET account_id=a.id FROM public.bank_accounts a WHERE a.bank=t.bank AND a.account_ref=t.account_ref;
CREATE INDEX bank_transactions_account_idx ON public.bank_transactions(account_id,booking_date DESC);
CREATE INDEX bank_transactions_fingerprint_idx ON public.bank_transactions(bank,account_ref,fingerprint);
CREATE OR REPLACE FUNCTION public.bank_transaction_fingerprint(_date date,_amount numeric,_description text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public,extensions AS $$ SELECT encode(extensions.digest(_date::text||'|'||round(_amount,2)::text||'|'||upper(regexp_replace(trim(_description),'\s+',' ','g')),'sha256'),'hex'); $$;
UPDATE public.bank_transactions SET fingerprint=public.bank_transaction_fingerprint(booking_date,amount,description), reference_key=CASE WHEN external_id LIKE 'eb-%' THEN substring(external_id from 4) WHEN external_id LIKE 'csv-%' THEN NULL ELSE external_id END;
CREATE OR REPLACE FUNCTION public.store_bank_transactions(_rows jsonb,_source text,_actor uuid DEFAULT NULL) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r jsonb; n integer:=0; aid uuid; hit uuid; cnt integer; fp text; ref text; ar text; dt date; amt numeric; st text; existing public.bank_transactions%ROWTYPE;
BEGIN
 IF _source NOT IN ('csv','enable_banking') OR jsonb_typeof(_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(_rows)>2000 THEN RAISE EXCEPTION 'Importazione non valida'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(_rows) LOOP
  IF coalesce(r->>'bank','') NOT IN ('Credem','BNL','PayPal') OR coalesce(r->>'currency','')<>'EUR' OR length(coalesce(r->>'account_ref','')) NOT BETWEEN 1 AND 100 OR length(coalesce(r->>'external_id','')) NOT BETWEEN 1 AND 250 OR length(coalesce(r->>'description','')) NOT BETWEEN 1 AND 2000 OR coalesce(r->>'booking_date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Movimento bancario non valido'; END IF;
  ar:=r->>'account_ref'; dt:=(r->>'booking_date')::date; amt:=(r->>'amount')::numeric; st:=coalesce(r->>'status','BOOK');
  IF st NOT IN ('BOOK','PDNG') OR amt=0 OR abs(amt)>999999999 OR amt<>round(amt,2) OR (_source='csv' AND st<>'BOOK') THEN RAISE EXCEPTION 'Importo o stato non valido'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended((r->>'bank')||'|'||ar,0));
  INSERT INTO public.bank_accounts(bank,account_ref,display_name) VALUES(r->>'bank',ar,ar) ON CONFLICT(bank,account_ref) DO NOTHING;
  SELECT id INTO aid FROM public.bank_accounts WHERE bank=r->>'bank' AND account_ref=ar;
  fp:=public.bank_transaction_fingerprint(dt,amt,r->>'description'); ref:=nullif(r->>'reference_key','');
  IF ref IS NULL AND (r->>'external_id') NOT LIKE 'csv-%' AND (r->>'external_id') NOT LIKE 'hash-%' THEN ref:=regexp_replace(r->>'external_id','^eb-',''); END IF;
  SELECT * INTO existing FROM public.bank_transactions WHERE bank=r->>'bank' AND account_ref=ar AND (external_id=r->>'external_id' OR (ref IS NOT NULL AND reference_key=ref)) ORDER BY created_at LIMIT 1 FOR UPDATE;
  hit:=existing.id;
  IF hit IS NULL THEN
   SELECT count(*), (array_agg(id))[1] INTO cnt,hit FROM public.bank_transactions WHERE bank=r->>'bank' AND account_ref=ar AND fingerprint=fp AND source<>_source;
   IF cnt>1 THEN RAISE EXCEPTION 'Movimenti identici non distinguibili: importa il riferimento univoco della banca'; END IF;
   IF cnt=0 THEN hit:=NULL; END IF;
   IF hit IS NOT NULL THEN SELECT * INTO existing FROM public.bank_transactions WHERE id=hit FOR UPDATE; END IF;
  END IF;
  IF hit IS NOT NULL THEN
   IF (existing.amount<>amt OR existing.booking_date<>dt) AND EXISTS(SELECT 1 FROM public.bank_allocations WHERE transaction_id=hit) THEN RAISE EXCEPTION 'La banca ha modificato un movimento già associato: verifica manualmente'; END IF;
   IF existing.status='PDNG' AND st='BOOK' THEN
    UPDATE public.bank_transactions SET status='BOOK',booking_date=dt,value_date=nullif(r->>'value_date','')::date,amount=amt,description=r->>'description',fingerprint=fp,reference_key=coalesce(ref,reference_key),external_id=r->>'external_id' WHERE id=hit;
   ELSIF existing.status='BOOK' AND st='BOOK' AND existing.amount<>amt THEN RAISE EXCEPTION 'Riferimento già presente con importo diverso';
   END IF;
  ELSE
   INSERT INTO public.bank_transactions(bank,account_ref,account_id,external_id,reference_key,fingerprint,booking_date,value_date,description,counterparty_name,amount,currency,status,source,created_by) VALUES(r->>'bank',ar,aid,r->>'external_id',ref,fp,dt,nullif(r->>'value_date','')::date,r->>'description',left(r->>'counterparty_name',500),amt,'EUR',st,_source,_actor);
   n:=n+1;
  END IF;
 END LOOP;
 RETURN n;
END; $$;
REVOKE ALL ON FUNCTION public.store_bank_transactions(jsonb,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.store_bank_transactions(jsonb,text,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.import_bank_transactions(_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN IF auth.uid() IS NULL OR NOT public.can_reconcile_bank(auth.uid()) THEN RAISE EXCEPTION 'Non autorizzato'; END IF; RETURN public.store_bank_transactions(_rows,'csv',auth.uid()); END; $$;
CREATE OR REPLACE FUNCTION public.guard_pending_bank_allocation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.bank_transactions WHERE id=NEW.transaction_id AND status='BOOK') THEN RAISE EXCEPTION 'I movimenti in sospeso non possono essere portati in cassa'; END IF; RETURN NEW; END; $$;
CREATE TRIGGER bank_allocation_booked_only BEFORE INSERT ON public.bank_allocations FOR EACH ROW EXECUTE FUNCTION public.guard_pending_bank_allocation();
CREATE OR REPLACE FUNCTION public.dispatch_bank_schedule() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE c public.bank_schedule_config%ROWTYPE; BEGIN SELECT * INTO c FROM public.bank_schedule_config WHERE id=true AND enabled=true; IF NOT FOUND OR extract(hour from now() AT TIME ZONE 'Europe/Rome') NOT IN (7,14) THEN RETURN; END IF; IF NOT EXISTS(SELECT 1 FROM public.bank_provider_settings WHERE id=true AND costs_verified AND sync_enabled AND monthly_cost_eur IS NOT NULL AND length(trim(commercial_evidence))>0) THEN RETURN; END IF; PERFORM net.http_post(url:=c.endpoint,headers:=jsonb_build_object('Content-Type','application/json','x-bank-schedule-token',c.token),body:='{"action":"scheduled"}'::jsonb); END; $$;
REVOKE ALL ON FUNCTION public.dispatch_bank_schedule() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.prepare_bank_schedule(_token text,_endpoint text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE j bigint; BEGIN IF length(_token)<32 OR _endpoint !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/bank-sync$' THEN RAISE EXCEPTION 'Configurazione non valida'; END IF; INSERT INTO public.bank_schedule_config(id,token,endpoint) VALUES(true,_token,_endpoint) ON CONFLICT(id) DO UPDATE SET token=excluded.token,endpoint=excluded.endpoint; SELECT cron.schedule('bank-sync-rome','0 5,6,12,13 * * *','SELECT public.dispatch_bank_schedule()') INTO j; PERFORM cron.alter_job(j,active:=false); UPDATE public.bank_schedule_config SET job_id=j,enabled=false WHERE id=true; END; $$;
REVOKE ALL ON FUNCTION public.prepare_bank_schedule(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_bank_schedule(text,text) TO service_role;