-- Backfill baseWidth/dimUnit on lastre inventory items by matching against
-- the catalogs.data JSON (materials array).
WITH cat AS (
  SELECT
    c.dept AS reparto,
    lower(m->>'name') AS name_l,
    lower(coalesce(m->>'color','')) AS color_l,
    coalesce(m->>'height','') AS height,
    m->>'baseWidth' AS base_width,
    coalesce(NULLIF(m->>'dimUnit',''), m->>'heightUnit', 'cm') AS dim_unit
  FROM public.catalogs c,
       jsonb_array_elements(coalesce(c.data->'materials','[]'::jsonb)) AS m
  WHERE coalesce(m->>'format','') = 'lastra'
    AND coalesce(m->>'baseWidth','') <> ''
)
UPDATE public.inventory_items inv
SET material_attrs = inv.material_attrs
  || jsonb_build_object(
       'baseWidth', cat.base_width,
       'dimUnit',   cat.dim_unit,
       'format',    'lastra'
     )
FROM cat
WHERE inv.reparto = cat.reparto
  AND lower(inv.material_name) = cat.name_l
  AND lower(coalesce(inv.material_color,'')) = cat.color_l
  AND coalesce(inv.material_height,'') = cat.height
  AND coalesce(inv.material_attrs->>'format','') = 'lastra'
  AND coalesce(NULLIF(inv.material_attrs->>'baseWidth',''), '') = '';
