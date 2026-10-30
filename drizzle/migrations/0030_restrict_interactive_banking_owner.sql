CREATE OR REPLACE FUNCTION public.can_reconcile_bank(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
 SELECT public.is_approved(_uid) AND EXISTS (
   SELECT 1 FROM auth.users u WHERE u.id = _uid
   AND lower(u.email) = 'gmartone@tecnofra.it' AND u.email_confirmed_at IS NOT NULL
 );
$$;
REVOKE ALL ON FUNCTION public.can_reconcile_bank(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_reconcile_bank(uuid) TO authenticated, service_role;
ALTER POLICY bank_transactions_read ON public.bank_transactions
 USING (public.can_reconcile_bank(auth.uid()) AND deleted_at IS NULL);
ALTER POLICY bank_allocations_read ON public.bank_allocations
 USING (public.can_reconcile_bank(auth.uid()));
CREATE OR REPLACE FUNCTION public.get_bank_provider_connections()
RETURNS TABLE(id uuid, bank text, status text, consent_expires_at timestamptz, last_sync_at timestamptz, last_error text, account_count integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_reconcile_bank(auth.uid()) THEN RAISE EXCEPTION 'Non autorizzato'; END IF;
 RETURN QUERY SELECT c.id,c.bank,c.status,c.consent_expires_at,c.last_sync_at,c.last_error,jsonb_array_length(c.accounts) FROM public.bank_provider_connections c WHERE c.status <> 'pending' ORDER BY c.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.get_bank_provider_connections() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_bank_provider_connections() TO authenticated, service_role;