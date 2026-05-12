-- 1. Estendi enum prod_dept con i nuovi reparti
ALTER TYPE public.prod_dept ADD VALUE IF NOT EXISTS 'grafica';
ALTER TYPE public.prod_dept ADD VALUE IF NOT EXISTS 'stampa_3d';
ALTER TYPE public.prod_dept ADD VALUE IF NOT EXISTS 'falegnameria';

-- 2. Enum settori utente (lista canonica)
DO $$ BEGIN
  CREATE TYPE public.app_settore AS ENUM (
    'grafica', 'stampa', 'taglio', 'tappezzeria', 'stampa_3d', 'falegnameria', 'altro'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Aggiungi settori[] su profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS settori public.app_settore[] NOT NULL DEFAULT '{}'::public.app_settore[];

-- 4. Dipendenza tra sub-ordini (sequenza lineare)
ALTER TABLE public.production_sub_orders
  ADD COLUMN IF NOT EXISTS depends_on uuid REFERENCES public.production_sub_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_psub_depends_on ON public.production_sub_orders(depends_on);

-- 5. Storage bucket allegati produzione
INSERT INTO storage.buckets (id, name, public)
VALUES ('prod-files', 'prod-files', false)
ON CONFLICT (id) DO NOTHING;

-- 6. Policy storage: lettura per autenticati
DROP POLICY IF EXISTS "prod_files_select_auth" ON storage.objects;
CREATE POLICY "prod_files_select_auth"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'prod-files');

-- Scrittura solo per writer produzione o admin
DROP POLICY IF EXISTS "prod_files_insert_writer" ON storage.objects;
CREATE POLICY "prod_files_insert_writer"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'prod-files'
  AND (public.has_permission(auth.uid(), 'produzione', 'write') OR public.has_role(auth.uid(), 'admin'))
);

DROP POLICY IF EXISTS "prod_files_update_writer" ON storage.objects;
CREATE POLICY "prod_files_update_writer"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'prod-files'
  AND (public.has_permission(auth.uid(), 'produzione', 'write') OR public.has_role(auth.uid(), 'admin'))
);

DROP POLICY IF EXISTS "prod_files_delete_writer" ON storage.objects;
CREATE POLICY "prod_files_delete_writer"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'prod-files'
  AND (public.has_permission(auth.uid(), 'produzione', 'write') OR public.has_role(auth.uid(), 'admin'))
);