CREATE OR REPLACE FUNCTION public.contabilita_merge_list(_new jsonb, _old jsonb, _deleted jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE incoming jsonb := CASE WHEN jsonb_typeof(_new)='array' THEN _new ELSE '[]'::jsonb END; existing jsonb := CASE WHEN jsonb_typeof(_old)='array' THEN _old ELSE '[]'::jsonb END; dead jsonb; known jsonb; kept_new jsonb; kept_old jsonb;
BEGIN
 SELECT COALESCE(jsonb_object_agg(value,true),'{}'::jsonb) INTO dead FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(_deleted)='array' THEN _deleted ELSE '[]'::jsonb END);
 SELECT COALESCE(jsonb_object_agg(value->>'id',true) FILTER (WHERE value->>'id' IS NOT NULL),'{}'::jsonb) INTO known FROM jsonb_array_elements(incoming);
 SELECT COALESCE(jsonb_agg(value),'[]'::jsonb) INTO kept_new FROM jsonb_array_elements(incoming) WHERE value->>'id' IS NULL OR NOT dead ? (value->>'id');
 SELECT COALESCE(jsonb_agg(value),'[]'::jsonb) INTO kept_old FROM jsonb_array_elements(existing) WHERE value ? 'id' AND NOT known ? (value->>'id') AND NOT dead ? (value->>'id');
 RETURN kept_new || kept_old;
END $f$;