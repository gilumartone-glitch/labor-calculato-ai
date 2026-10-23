CREATE OR REPLACE FUNCTION public.contabilita_merge_hours(_new jsonb, _old jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE result jsonb := '{}'::jsonb; mk text; nm jsonb; om jsonb; dead jsonb; rows_map jsonb; ord jsonb; pos int; row_data jsonb; previous jsonb; identity text; dk text; merged_days jsonb; times jsonb; nt numeric; ot numeric; cell jsonb;
BEGIN
 IF COALESCE(_new,'{}'::jsonb) = COALESCE(_old,'{}'::jsonb) THEN RETURN COALESCE(_new,'{}'::jsonb); END IF;
 FOR mk IN SELECT key FROM jsonb_object_keys(COALESCE(_new,'{}'::jsonb) || COALESCE(_old,'{}'::jsonb)) AS keys(key) LOOP
  nm := COALESCE(_new->mk,'{}'::jsonb); om := COALESCE(_old->mk,'{}'::jsonb);
  -- Unchanged or one-sided months need no merge: keeps saves fast.
  IF nm = om OR om = '{}'::jsonb THEN result := jsonb_set(result, ARRAY[mk], nm); CONTINUE; END IF;
  IF nm = '{}'::jsonb THEN result := jsonb_set(result, ARRAY[mk], om); CONTINUE; END IF;
  SELECT COALESCE(jsonb_agg(DISTINCT x),'[]'::jsonb) INTO dead FROM jsonb_array_elements_text(COALESCE(nm->'deletedRowIds','[]'::jsonb) || COALESCE(om->'deletedRowIds','[]'::jsonb)) x;
  rows_map := '{}'::jsonb; ord := '{}'::jsonb; pos := 0;
  FOR row_data IN SELECT value FROM jsonb_array_elements(COALESCE(nm->'rows','[]'::jsonb)) LOOP
   identity := CASE WHEN NULLIF(row_data->>'dipendenteId','') IS NOT NULL THEN 'employee:' || (row_data->>'dipendenteId') ELSE 'free:' || (row_data->>'id') END;
   IF NOT ord ? identity THEN pos := pos + 1; ord := jsonb_set(ord, ARRAY[identity], to_jsonb(pos)); END IF;
  END LOOP;
  FOR row_data IN SELECT value FROM jsonb_array_elements(COALESCE(om->'rows','[]'::jsonb)) LOOP
   IF dead ? (row_data->>'id') THEN CONTINUE; END IF;
   identity := CASE WHEN NULLIF(row_data->>'dipendenteId','') IS NOT NULL THEN 'employee:' || (row_data->>'dipendenteId') ELSE 'free:' || (row_data->>'id') END;
   IF NOT ord ? identity THEN pos := pos + 1; ord := jsonb_set(ord, ARRAY[identity], to_jsonb(pos)); END IF;
   rows_map := jsonb_set(rows_map, ARRAY[identity], row_data);
  END LOOP;
  FOR row_data IN SELECT value FROM jsonb_array_elements(COALESCE(nm->'rows','[]'::jsonb)) LOOP
   IF dead ? (row_data->>'id') THEN CONTINUE; END IF;
   identity := CASE WHEN NULLIF(row_data->>'dipendenteId','') IS NOT NULL THEN 'employee:' || (row_data->>'dipendenteId') ELSE 'free:' || (row_data->>'id') END;
   previous := rows_map->identity;
   IF previous IS NOT NULL AND previous <> row_data THEN
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
  result := jsonb_set(result,ARRAY[mk],jsonb_build_object('rows',(SELECT COALESCE(jsonb_agg(e.value ORDER BY (ord->>e.key)::int),'[]'::jsonb) FROM jsonb_each(rows_map) e),'deletedRowIds',dead));
 END LOOP;
 RETURN result;
END $function$;