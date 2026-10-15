CREATE OR REPLACE FUNCTION public.mark_salary_cash_paid(_key text, _comp_month int, _name text, _amount numeric, _paid boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb; sal jsonb; i int; found_idx int := -1; pay_month int; amt numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_use_contabilita(auth.uid()) THEN RAISE EXCEPTION 'Non autorizzato'; END IF;
  IF _comp_month < 0 OR _comp_month > 11 THEN RAISE EXCEPTION 'Mese non valido'; END IF;
  pay_month := CASE WHEN _comp_month = 11 THEN 0 ELSE _comp_month + 1 END;
  amt := CASE WHEN _paid THEN COALESCE(_amount,0) ELSE 0 END;
  SELECT data INTO v FROM public.contabilita_state WHERE key = _key FOR UPDATE;
  IF v IS NULL THEN RAISE EXCEPTION 'Contabilità non trovata'; END IF;
  sal := COALESCE(v->'salaries','[]'::jsonb);
  FOR i IN 0 .. jsonb_array_length(sal) - 1 LOOP
    IF (sal->i->>'month')::int = pay_month AND lower(trim(sal->i->>'name')) = lower(trim(_name)) THEN found_idx := i; EXIT; END IF;
  END LOOP;
  IF found_idx >= 0 THEN
    sal := jsonb_set(sal, ARRAY[found_idx::text,'cassaContanti'], to_jsonb(amt));
  ELSIF _paid THEN
    sal := sal || jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'name', _name, 'month', pay_month,
      'totale', 0, 'bonifico', 0, 'contanti', amt, 'cassaBanca', 0, 'cassaContanti', amt));
  END IF;
  v := jsonb_set(v, '{salaries}', sal);
  -- aggiorna subito il riepilogo contanti
  IF v ? 'cashView' AND v->'cashView' ? _comp_month::text THEN
    v := jsonb_set(v, ARRAY['cashView', _comp_month::text, 'rows'], COALESCE((
      SELECT jsonb_agg(CASE WHEN lower(trim(r->>'name')) = lower(trim(_name)) THEN r || jsonb_build_object('pagato', amt) ELSE r END)
      FROM jsonb_array_elements(v->'cashView'->_comp_month::text->'rows') r), '[]'::jsonb));
  END IF;
  UPDATE public.contabilita_state SET data = v, updated_by = auth.uid(), updated_at = now() WHERE key = _key;
  PERFORM public.log_audit_action(CASE WHEN _paid THEN 'contanti_pagati' ELSE 'contanti_annullati' END, 'stipendio', _name, _name || ' mese ' || pay_month || ' € ' || amt, NULL, NULL);
END $$;
GRANT EXECUTE ON FUNCTION public.mark_salary_cash_paid(text,int,text,numeric,boolean) TO authenticated;