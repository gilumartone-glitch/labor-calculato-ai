CREATE TABLE public.bank_provider_connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bank text NOT NULL CHECK (bank IN ('Credem','BNL')), user_id uuid NOT NULL, state uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(), status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes', consent_expires_at timestamptz, session_id text, accounts jsonb NOT NULL DEFAULT '[]'::jsonb, last_sync_at timestamptz, last_error text, sync_lock_until timestamptz
);
GRANT ALL ON public.bank_provider_connections TO service_role;
ALTER TABLE public.bank_provider_connections ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.bank_provider_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK (id), costs_verified boolean NOT NULL DEFAULT false, monthly_cost_eur numeric, commercial_evidence text, verified_at timestamptz, sync_enabled boolean NOT NULL DEFAULT false
);
GRANT ALL ON public.bank_provider_settings TO service_role;
ALTER TABLE public.bank_provider_settings ENABLE ROW LEVEL SECURITY;
CREATE INDEX bank_provider_connections_bank_status_idx ON public.bank_provider_connections(bank,status);
CREATE OR REPLACE FUNCTION public.get_bank_provider_connections() RETURNS TABLE(id uuid,bank text,status text,consent_expires_at timestamptz,last_sync_at timestamptz,last_error text,account_count integer) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_use_contabilita(auth.uid()) THEN RAISE EXCEPTION 'Non autorizzato'; END IF;
 RETURN QUERY SELECT c.id,c.bank,c.status,c.consent_expires_at,c.last_sync_at,c.last_error,jsonb_array_length(c.accounts) FROM public.bank_provider_connections c WHERE c.status <> 'pending' ORDER BY c.created_at DESC;
END; $$;
REVOKE ALL ON FUNCTION public.get_bank_provider_connections() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_bank_provider_connections() TO authenticated,service_role;