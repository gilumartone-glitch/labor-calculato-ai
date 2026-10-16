CREATE OR REPLACE FUNCTION public.get_contabilita_state_public(_key text)
RETURNS TABLE(data jsonb, updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_data jsonb; v_at timestamptz; v_agg jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_use_contabilita(auth.uid()) THEN RAISE EXCEPTION 'Non autorizzato'; END IF;
  SELECT s.data, s.updated_at INTO v_data, v_at FROM public.contabilita_state s WHERE s.key = _key;
  IF v_data IS NULL THEN RETURN; END IF;
  -- Totali mensili anonimi: servono per cassa e previsioni, senza nomi né importi per persona
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', 'agg-' || m, 'name', 'Stipendi', 'month', m,
      'totale', tot, 'bonifico', bon, 'contanti', con, 'sc', true,
      'cassaBanca', cb, 'cassaContanti', cc) ORDER BY m), '[]'::jsonb)
  INTO v_agg
  FROM (
    SELECT (e->>'month')::int AS m,
      SUM(COALESCE((e->>'totale')::numeric,0)) tot,
      SUM(COALESCE((e->>'bonifico')::numeric,0)) bon,
      SUM(COALESCE((e->>'contanti')::numeric,0)) con,
      SUM(COALESCE((e->>'cassaBanca')::numeric,0)) cb,
      SUM(COALESCE((e->>'cassaContanti')::numeric,0)) cc
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_data->'salaries')='array' THEN v_data->'salaries' ELSE '[]'::jsonb END) e
    WHERE e ? 'month'
    GROUP BY 1
  ) t;
  data := (v_data - public.contabilita_payroll_keys())
    || jsonb_build_object('salaries', v_agg)
    || CASE WHEN v_data ? 'salariesProcessed' THEN jsonb_build_object('salariesProcessed', v_data->'salariesProcessed') ELSE '{}'::jsonb END
    || CASE WHEN v_data ? 'salaryPayDates' THEN jsonb_build_object('salaryPayDates', v_data->'salaryPayDates') ELSE '{}'::jsonb END
    || CASE WHEN v_data ? 'salaryPayDays' THEN jsonb_build_object('salaryPayDays', v_data->'salaryPayDays') ELSE '{}'::jsonb END;
  updated_at := v_at;
  RETURN NEXT;
END $$;