CREATE OR REPLACE FUNCTION public.contabilita_merge_hours(_new jsonb, _old jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $f$
DECLARE result jsonb := '{}'::jsonb; mk text; nm jsonb; om jsonb; dead jsonb; rows_map jsonb; row_data jsonb; previous jsonb; identity text; dk text; merged_days jsonb; times jsonb; nt numeric; ot numeric; cell jsonb;
BEGIN
 FOR mk IN SELECT key FROM jsonb_object_keys(COALESCE(_new,'{}'::jsonb) || COALESCE(_old,'{}'::jsonb)) AS keys(key) LOOP
  nm := COALESCE(_new->mk,'{}'::jsonb); om := COALESCE(_old->mk,'{}'::jsonb);
  SELECT COALESCE(jsonb_agg(DISTINCT x),'[]'::jsonb) INTO dead FROM jsonb_array_elements_text(COALESCE(nm->'deletedRowIds','[]'::jsonb) || COALESCE(om->'deletedRowIds','[]'::jsonb)) x;
  rows_map := '{}'::jsonb;
  FOR row_data IN SELECT value FROM jsonb_array_elements(COALESCE(om->'rows','[]'::jsonb)) LOOP
   IF dead ? (row_data->>'id') THEN CONTINUE; END IF;
   identity := CASE WHEN NULLIF(row_data->>'dipendenteId','') IS NOT NULL THEN 'employee:' || (row_data->>'dipendenteId') ELSE 'free:' || (row_data->>'id') END;
   rows_map := jsonb_set(rows_map, ARRAY[identity], row_data);
  END LOOP;
  FOR row_data IN SELECT value FROM jsonb_array_elements(COALESCE(nm->'rows','[]'::jsonb)) LOOP
   IF dead ? (row_data->>'id') THEN CONTINUE; END IF;
   identity := CASE WHEN NULLIF(row_data->>'dipendenteId','') IS NOT NULL THEN 'employee:' || (row_data->>'dipendenteId') ELSE 'free:' || (row_data->>'id') END;
   previous := rows_map->identity;
   IF previous IS NOT NULL THEN
    merged_days := '{}'::jsonb; times := '{}'::jsonb;
    FOR dk IN SELECT key FROM jsonb_object_keys(COALESCE(row_data->'days','{}'::jsonb) || COALESCE(previous->'days','{}'::jsonb)) AS keys(key) LOOP
     nt := COALESCE((row_data->'dayUpdatedAt'->>dk)::numeric,0); ot := COALESCE((previous->'dayUpdatedAt'->>dk)::numeric,0);
     cell := CASE WHEN nt >= ot THEN COALESCE(row_data->'days'->dk,previous->'days'->dk) ELSE COALESCE(previous->'days'->dk,row_data->'days'->dk) END;
     merged_days := jsonb_set(merged_days,ARRAY[dk],cell);
     times := jsonb_set(times,ARRAY[dk],to_jsonb(GREATEST(nt,ot)));
    END LOOP;
    row_data := previous || row_data || jsonb_build_object('days',merged_days,'dayUpdatedAt',times);
   END IF;
   rows_map := jsonb_set(rows_map,ARRAY[identity],row_data);
  END LOOP;
  result := jsonb_set(result,ARRAY[mk],jsonb_build_object('rows',(SELECT COALESCE(jsonb_agg(value),'[]'::jsonb) FROM jsonb_each(rows_map)),'deletedRowIds',dead));
 END LOOP;
 RETURN result;
END $f$;
REVOKE ALL ON FUNCTION public.contabilita_merge_hours(jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contabilita_merge_hours(jsonb,jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_contabilita_state_public(_key text, _data jsonb)
 RETURNS timestamp with time zone LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $function$
DECLARE v_old jsonb; v_keep jsonb := '{}'::jsonb; v_new jsonb; v_at timestamptz; k text; v_owner boolean; v_del jsonb := '{}'::jsonb; lk text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_use_contabilita(auth.uid()) THEN RAISE EXCEPTION 'Non autorizzato'; END IF;
 v_owner := public.is_salary_owner(auth.uid());
 SELECT s.data INTO v_old FROM public.contabilita_state s WHERE s.key = _key FOR UPDATE;
 IF v_owner THEN v_new := COALESCE(_data,'{}'::jsonb);
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