
-- Realtime: REPLICA IDENTITY FULL + add to publication
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'commesse',
    'commessa_assegnatari',
    'production_orders',
    'production_sub_orders',
    'production_sub_checklist',
    'inventory_items',
    'inventory_scrap_pieces',
    'inventory_reservations',
    'prod_notifications',
    'prod_chat_channels',
    'prod_chat_messages',
    'design_drafts',
    'catalogs'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END LOOP;
END $$;
