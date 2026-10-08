DO $$
DECLARE r record;
BEGIN
FOR r IN SELECT * FROM (VALUES
 ('montaggi_materiali','materiali_select_auth'),
 ('material_dependencies','auth read material_dependencies'),
 ('inventory_reservations','invres_select_all'),
 ('inventory_scrap_pieces','scrap_select_all'),
 ('commessa_assegnatari','Authenticated users can view assignments'),
 ('montaggi_lavorazione_templates','Authenticated can read templates'),
 ('reparti_config','reparti_select_auth'),
 ('montaggi_attrezzi','attrezzi_select_auth'),
 ('catalogs','Authenticated users can view catalogs'),
 ('app_pages','Authenticated can view app pages'),
 ('montaggi_assignment_items','assignitem_select_auth'),
 ('inventory_items','inv_select_all'),
 ('marketing_categories','auth view marketing_categories')
) v(t,p) LOOP
  EXECUTE format('ALTER POLICY %I ON public.%I USING (public.is_approved(auth.uid()))', r.p, r.t);
END LOOP;
END $$;