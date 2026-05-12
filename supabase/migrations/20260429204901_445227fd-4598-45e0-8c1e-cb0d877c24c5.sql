-- Backfill baseWidth/dimUnit in inventory_items.material_attrs for existing 'lastra' rows
-- by joining via material_key with the catalogs table.
UPDATE public.inventory_items inv
SET material_attrs = COALESCE(inv.material_attrs, '{}'::jsonb)
  || jsonb_build_object(
       'baseWidth', COALESCE(m->>'baseWidth', ''),
       'dimUnit',   COALESCE(m->>'dimUnit', m->>'heightUnit', ''),
       'heightUnit',COALESCE(m->>'heightUnit', m->>'dimUnit', ''),
       'format',    COALESCE(m->>'format', inv.material_attrs->>'format', '')
     )
FROM public.catalogs c
CROSS JOIN LATERAL jsonb_array_elements(c.data->'materials') AS m
WHERE inv.reparto::text = c.dept
  AND inv.material_key IS NOT NULL
  AND lower(trim(concat_ws('|',
        m->>'name', m->>'color', m->>'height',
        COALESCE(m->>'thickness',''), COALESCE(m->>'fireproof',''), COALESCE(m->>'finish','')
      ))) = inv.material_key
  AND (
    COALESCE(inv.material_attrs->>'baseWidth','') = ''
    OR COALESCE(inv.material_attrs->>'dimUnit','') = ''
  );