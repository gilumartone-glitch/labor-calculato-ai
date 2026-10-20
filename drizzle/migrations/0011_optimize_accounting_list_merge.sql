CREATE OR REPLACE FUNCTION public.contabilita_merge_list(_new jsonb, _old jsonb, _deleted jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $function$
 WITH incoming AS (
  SELECT value item, ordinality position FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_new)='array' THEN _new ELSE '[]'::jsonb END) WITH ORDINALITY
 ), known AS (
  SELECT COALESCE(jsonb_object_agg(item->>'id',true) FILTER (WHERE item->>'id' IS NOT NULL),'{}'::jsonb) ids FROM incoming
 ), deleted AS (
  SELECT COALESCE(jsonb_object_agg(value,true),'{}'::jsonb) ids FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(_deleted)='array' THEN _deleted ELSE '[]'::jsonb END)
 ), kept AS (
  SELECT item, 0 source, position FROM incoming CROSS JOIN deleted WHERE NOT deleted.ids ? (item->>'id') OR item->>'id' IS NULL
  UNION ALL
  SELECT o.value item, 1 source, o.ordinality position
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_old)='array' THEN _old ELSE '[]'::jsonb END) WITH ORDINALITY o CROSS JOIN known CROSS JOIN deleted
  WHERE o.value ? 'id' AND NOT known.ids ? (o.value->>'id') AND NOT deleted.ids ? (o.value->>'id')
 ) SELECT COALESCE(jsonb_agg(item ORDER BY source,position),'[]'::jsonb) FROM kept
$function$;