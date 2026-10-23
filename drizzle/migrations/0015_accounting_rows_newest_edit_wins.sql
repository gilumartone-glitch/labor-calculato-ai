CREATE OR REPLACE FUNCTION public.contabilita_merge_list(_new jsonb, _old jsonb, _deleted jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE incoming jsonb := CASE WHEN jsonb_typeof(_new)='array' THEN _new ELSE '[]'::jsonb END; existing jsonb := CASE WHEN jsonb_typeof(_old)='array' THEN _old ELSE '[]'::jsonb END; dead jsonb; known jsonb; old_by_id jsonb; kept_new jsonb; kept_old jsonb;
BEGIN
 SELECT COALESCE(jsonb_object_agg(value,true),'{}'::jsonb) INTO dead FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(_deleted)='array' THEN _deleted ELSE '[]'::jsonb END);
 IF incoming=existing THEN
  SELECT COALESCE(jsonb_agg(value),'[]'::jsonb) INTO kept_new FROM jsonb_array_elements(incoming) WHERE value->>'id' IS NULL OR NOT dead ? (value->>'id');
  RETURN kept_new;
 END IF;
 SELECT COALESCE(jsonb_object_agg(value->>'id',value) FILTER (WHERE value->>'id' IS NOT NULL),'{}'::jsonb) INTO old_by_id FROM jsonb_array_elements(existing);
 -- Same row in both copies: keep the most recently edited one (_u, ms). Ties go to the incoming copy.
 SELECT COALESCE(jsonb_agg(
   CASE WHEN value->>'id' IS NOT NULL AND old_by_id ? (value->>'id')
         AND COALESCE((old_by_id->(value->>'id')->>'_u')::numeric,0) > COALESCE((value->>'_u')::numeric,0)
        THEN old_by_id->(value->>'id') ELSE value END
   ORDER BY ord),'[]'::jsonb) INTO kept_new
 FROM jsonb_array_elements(incoming) WITH ORDINALITY AS e(value, ord)
 WHERE value->>'id' IS NULL OR NOT dead ? (value->>'id');
 SELECT COALESCE(jsonb_object_agg(value->>'id',true) FILTER (WHERE value->>'id' IS NOT NULL),'{}'::jsonb) INTO known FROM jsonb_array_elements(incoming);
 SELECT COALESCE(jsonb_agg(value),'[]'::jsonb) INTO kept_old FROM jsonb_array_elements(existing) WHERE value ? 'id' AND NOT known ? (value->>'id') AND NOT dead ? (value->>'id');
 RETURN kept_new || kept_old;
END $f$;