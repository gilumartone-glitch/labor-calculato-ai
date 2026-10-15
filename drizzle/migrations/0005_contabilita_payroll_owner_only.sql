CREATE OR REPLACE FUNCTION public.is_salary_owner(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = _user_id AND lower(email) = 'gilumartone@gmail.com')
$$;
GRANT EXECUTE ON FUNCTION public.is_salary_owner(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.contabilita_payroll_keys()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['salaries','hoursLog','salaryCalc','salaryRates','salariesProcessed','salaryPayDates','salaryPayDays','cashView']
$$;

CREATE OR REPLACE FUNCTION public.can_use_contabilita(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_uid,'admin'::app_role)
    OR public.has_permission(_uid,'contabilita','read'::permission_level)
    OR public.has_permission(_uid,'contabilita','write'::permission_level)
    OR public.is_amministrazione(_uid)
$$;

DROP POLICY IF EXISTS "Contabilita users can view shared state" ON public.contabilita_state;
DROP POLICY IF EXISTS "Contabilita users can create shared state" ON public.contabilita_state;
DROP POLICY IF EXISTS "Contabilita users can update shared state" ON public.contabilita_state;
DROP POLICY IF EXISTS "Admins can delete shared contabilita state" ON public.contabilita_state;
CREATE POLICY "Salary owner reads contabilita state" ON public.contabilita_state FOR SELECT TO authenticated USING (public.is_salary_owner(auth.uid()));
CREATE POLICY "Salary owner inserts contabilita state" ON public.contabilita_state FOR INSERT TO authenticated WITH CHECK (public.is_salary_owner(auth.uid()));
CREATE POLICY "Salary owner updates contabilita state" ON public.contabilita_state FOR UPDATE TO authenticated USING (public.is_salary_owner(auth.uid())) WITH CHECK (public.is_salary_owner(auth.uid()));
CREATE POLICY "Salary owner deletes contabilita state" ON public.contabilita_state FOR DELETE TO authenticated USING (public.is_salary_owner(auth.uid()));

DROP POLICY IF EXISTS "Contabilita users can view snapshots" ON public.contabilita_state_snapshots;
DROP POLICY IF EXISTS "Contabilita writers can insert snapshots" ON public.contabilita_state_snapshots;
DROP POLICY IF EXISTS "Admins can delete snapshots" ON public.contabilita_state_snapshots;
CREATE POLICY "Salary owner reads snapshots" ON public.contabilita_state_snapshots FOR SELECT TO authenticated USING (public.is_salary_owner(auth.uid()));
CREATE POLICY "Salary owner inserts snapshots" ON public.contabilita_state_snapshots FOR INSERT TO authenticated WITH CHECK (public.is_salary_owner(auth.uid()));
CREATE POLICY "Salary owner deletes snapshots" ON public.contabilita_state_snapshots FOR DELETE TO authenticated USING (public.is_salary_owner(auth.uid()));

-- Lettura per gli altri utenti: tutto tranne stipendi e ore
CREATE OR REPLACE FUNCTION public.get_contabilita_state_public(_key text)
RETURNS TABLE(data jsonb, updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE k text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_use_contabilita(auth.uid()) THEN RAISE EXCEPTION 'Non autorizzato'; END IF;
  RETURN QUERY SELECT (s.data - public.contabilita_payroll_keys()), s.updated_at FROM public.contabilita_state s WHERE s.key = _key;
END $$;
GRANT EXECUTE ON FUNCTION public.get_contabilita_state_public(text) TO authenticated;

-- Scrittura per gli altri utenti: stipendi e ore restano quelli già salvati
CREATE OR REPLACE FUNCTION public.save_contabilita_state_public(_key text, _data jsonb)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old jsonb; v_keep jsonb := '{}'::jsonb; v_new jsonb; v_at timestamptz; k text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_use_contabilita(auth.uid()) THEN RAISE EXCEPTION 'Non autorizzato'; END IF;
  SELECT s.data INTO v_old FROM public.contabilita_state s WHERE s.key = _key FOR UPDATE;
  IF v_old IS NOT NULL THEN
    FOREACH k IN ARRAY public.contabilita_payroll_keys() LOOP
      IF v_old ? k THEN v_keep := v_keep || jsonb_build_object(k, v_old->k); END IF;
    END LOOP;
  END IF;
  v_new := (COALESCE(_data,'{}'::jsonb) - public.contabilita_payroll_keys()) || v_keep;
  INSERT INTO public.contabilita_state(key, data, updated_by) VALUES (_key, v_new, auth.uid())
  ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()
  RETURNING contabilita_state.updated_at INTO v_at;
  RETURN v_at;
END $$;
GRANT EXECUTE ON FUNCTION public.save_contabilita_state_public(text, jsonb) TO authenticated;

-- Contanti da consegnare: solo il riepilogo pubblicato dal titolare
DROP FUNCTION IF EXISTS public.get_contabilita_cash_only();
CREATE OR REPLACE FUNCTION public.get_contabilita_cash_only(_key text DEFAULT 'main')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_use_contabilita(auth.uid()) THEN RAISE EXCEPTION 'Non autorizzato'; END IF;
  SELECT s.data->'cashView' INTO v FROM public.contabilita_state s WHERE s.key = _key;
  RETURN COALESCE(v, '{}'::jsonb);
END $$;
GRANT EXECUTE ON FUNCTION public.get_contabilita_cash_only(text) TO authenticated;