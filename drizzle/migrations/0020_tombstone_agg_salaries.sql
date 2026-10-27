CREATE OR REPLACE FUNCTION public.contabilita_agg_tombstones(_del jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT COALESCE(jsonb_agg(DISTINCT x),'[]'::jsonb) FROM (
    SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(_del)='array' THEN _del ELSE '[]'::jsonb END) x
    UNION SELECT 'agg-' || g FROM generate_series(0,11) g
  ) t
$$;

CREATE OR REPLACE FUNCTION public.save_contabilita_state_public(_key text, _data jsonb)
 RETURNS timestamp with time zone LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_old jsonb; v_keep jsonb := '{}'::jsonb; v_new jsonb; v_at timestamptz; k text; v_owner boolean; v_del jsonb := '{}'::jsonb; lk text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_use_contabilita(auth.uid()) THEN RAISE EXCEPTION 'Non autorizzato'; END IF;
 v_owner := public.is_salary_owner(auth.uid());
 SELECT s.data INTO v_old FROM public.contabilita_state s WHERE s.key = _key FOR UPDATE;
 IF v_owner THEN
  v_new := COALESCE(_data,'{}'::jsonb);
  IF jsonb_typeof(v_new->'salaries')='array' THEN
   v_new := jsonb_set(v_new,'{salaries}',(SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM jsonb_array_elements(v_new->'salaries') x WHERE COALESCE(x->>'id','') NOT LIKE 'agg-%'));
  END IF;
  v_new := jsonb_set(v_new,'{deletedIds}',COALESCE(v_new->'deletedIds','{}'::jsonb) || jsonb_build_object('salaries', public.contabilita_agg_tombstones(v_new->'deletedIds'->'salaries')));
 ELSE
  IF v_old IS NOT NULL THEN
   FOREACH k IN ARRAY public.contabilita_payroll_keys() LOOP
    IF v_old ? k THEN v_keep := v_keep || jsonb_build_object(k,v_old->k); END IF;
   END LOOP;
  END IF;
  v_new := (COALESCE(_data,'{}'::jsonb) - public.contabilita_payroll_keys()) || v_keep;
 END IF;
 IF v_old IS NOT NULL THEN
  FOREACH lk IN ARRAY ARRAY['movements','fixedExpenses','contacts'] LOOP
   v_del := v_del || jsonb_build_object(lk, (
    SELECT COALESCE(jsonb_agg(DISTINCT x),'[]'::jsonb) FROM (
     SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(v_old->'deletedIds'->lk)='array' THEN v_old->'deletedIds'->lk ELSE '[]'::jsonb END) x
     UNION SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(v_new->'deletedIds'->lk)='array' THEN v_new->'deletedIds'->lk ELSE '[]'::jsonb END)
    ) t));
   IF v_new ? lk OR v_old ? lk THEN v_new := jsonb_set(v_new,ARRAY[lk],public.contabilita_merge_list(v_new->lk,v_old->lk,v_del->lk)); END IF;
  END LOOP;
  v_new := jsonb_set(v_new,'{deletedIds}',COALESCE(v_new->'deletedIds','{}'::jsonb) || v_del);
 END IF;
 IF v_new ? 'hoursLog' OR v_old ? 'hoursLog' THEN
  v_new := jsonb_set(v_new,'{hoursLog}',public.contabilita_merge_hours(v_new->'hoursLog',v_old->'hoursLog'));
 END IF;
 INSERT INTO public.contabilita_state(key,data,updated_by) VALUES (_key,v_new,auth.uid())
 ON CONFLICT (key) DO UPDATE SET data=EXCLUDED.data,updated_by=EXCLUDED.updated_by,updated_at=now()
 RETURNING contabilita_state.updated_at INTO v_at;
 RETURN v_at;
END $function$;

UPDATE public.contabilita_state
SET data = jsonb_set(data,'{deletedIds}',COALESCE(data->'deletedIds','{}'::jsonb) || jsonb_build_object('salaries', public.contabilita_agg_tombstones(data->'deletedIds'->'salaries')))
WHERE key LIKE 'main%';