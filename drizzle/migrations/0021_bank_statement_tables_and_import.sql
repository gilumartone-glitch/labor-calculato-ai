CREATE OR REPLACE FUNCTION public.can_reconcile_bank(_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT public.is_approved(_uid) AND (public.has_role(_uid,'admin'::public.app_role) OR public.has_permission(_uid,'contabilita','write'::public.permission_level) OR public.is_amministrazione(_uid)); $$;
REVOKE ALL ON FUNCTION public.can_reconcile_bank(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_reconcile_bank(uuid) TO authenticated, service_role;
CREATE TABLE public.bank_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bank text NOT NULL CHECK(bank IN ('Credem','BNL')), account_ref text NOT NULL CHECK(length(account_ref) BETWEEN 1 AND 100), external_id text NOT NULL CHECK(length(external_id) BETWEEN 1 AND 250), booking_date date NOT NULL, description text NOT NULL CHECK(length(description) BETWEEN 1 AND 2000), amount numeric(14,2) NOT NULL CHECK(amount <> 0), currency text NOT NULL DEFAULT 'EUR' CHECK(currency='EUR'), source text NOT NULL DEFAULT 'csv', created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(bank,account_ref,external_id));
GRANT SELECT ON public.bank_transactions TO authenticated;
GRANT ALL ON public.bank_transactions TO service_role;
ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY bank_transactions_read ON public.bank_transactions FOR SELECT TO authenticated USING(public.is_approved(auth.uid()) AND public.can_use_contabilita(auth.uid()));
CREATE INDEX bank_transactions_booking_idx ON public.bank_transactions(booking_date DESC);
CREATE TABLE public.bank_allocations (id uuid PRIMARY KEY, transaction_id uuid NOT NULL REFERENCES public.bank_transactions(id), accounting_key text NOT NULL, competence_id text, cash_movement_id text NOT NULL UNIQUE, amount numeric(14,2) NOT NULL CHECK(amount>0), created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.bank_allocations TO authenticated;
GRANT ALL ON public.bank_allocations TO service_role;
ALTER TABLE public.bank_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY bank_allocations_read ON public.bank_allocations FOR SELECT TO authenticated USING(public.is_approved(auth.uid()) AND public.can_use_contabilita(auth.uid()));
CREATE INDEX bank_allocations_transaction_idx ON public.bank_allocations(transaction_id);
CREATE OR REPLACE FUNCTION public.import_bank_transactions(_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r jsonb; n integer:=0; inserted integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_reconcile_bank(auth.uid()) THEN RAISE EXCEPTION 'Non autorizzato'; END IF;
 IF _rows IS NULL OR jsonb_typeof(_rows)<>'array' OR jsonb_array_length(_rows)>2000 THEN RAISE EXCEPTION 'Importazione non valida (massimo 2000 righe)'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(_rows) LOOP
  IF coalesce(r->>'bank','') NOT IN ('Credem','BNL') OR coalesce(r->>'currency','')<>'EUR' OR coalesce(r->>'booking_date','') !~ '^\d{4}-\d{2}-\d{2}$' OR coalesce(r->>'account_ref','')='' OR coalesce(r->>'external_id','')='' OR coalesce(r->>'description','')='' OR coalesce(r->>'amount','') !~ '^-?[0-9]+(\.[0-9]{1,2})?$' THEN RAISE EXCEPTION 'Movimento bancario non valido'; END IF;
  INSERT INTO public.bank_transactions(bank,account_ref,external_id,booking_date,description,amount,currency,source,created_by) VALUES(r->>'bank',r->>'account_ref',r->>'external_id',(r->>'booking_date')::date,r->>'description',(r->>'amount')::numeric,'EUR','csv',auth.uid()) ON CONFLICT(bank,account_ref,external_id) DO NOTHING;
  GET DIAGNOSTICS inserted=ROW_COUNT; n:=n+inserted;
 END LOOP;
 RETURN n;
END; $$;
REVOKE ALL ON FUNCTION public.import_bank_transactions(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.import_bank_transactions(jsonb) TO authenticated;