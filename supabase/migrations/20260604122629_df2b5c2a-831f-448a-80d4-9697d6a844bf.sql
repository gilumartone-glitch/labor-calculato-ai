
CREATE TABLE public.reparti_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('macro','micro')),
  key text NOT NULL,
  label text NOT NULL,
  macro_key text,
  ordine integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE(kind, key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reparti_config TO authenticated;
GRANT ALL ON public.reparti_config TO service_role;

ALTER TABLE public.reparti_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reparti_select_auth" ON public.reparti_config
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "reparti_insert_priv" ON public.reparti_config
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_permission(auth.uid(),'flow'::text,'write'::permission_level));

CREATE POLICY "reparti_update_priv" ON public.reparti_config
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_permission(auth.uid(),'flow'::text,'write'::permission_level))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_permission(auth.uid(),'flow'::text,'write'::permission_level));

CREATE POLICY "reparti_delete_priv" ON public.reparti_config
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_permission(auth.uid(),'flow'::text,'write'::permission_level));

CREATE TRIGGER trg_reparti_config_updated_at
  BEFORE UPDATE ON public.reparti_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed macros
INSERT INTO public.reparti_config (kind, key, label, ordine) VALUES
  ('macro','laboratorio','Laboratorio',1),
  ('macro','tappezzeria','Tappezzeria',2),
  ('macro','montaggi','Montaggi',3),
  ('macro','uffici','Uffici',4),
  ('macro','magazzino','Magazzino',5)
ON CONFLICT (kind, key) DO NOTHING;

-- Seed micros
INSERT INTO public.reparti_config (kind, key, label, macro_key, ordine) VALUES
  ('micro','grafica','Grafica','laboratorio',1),
  ('micro','stampa','Stampa','laboratorio',2),
  ('micro','taglio','Taglio','laboratorio',3),
  ('micro','confezione','Confezione','laboratorio',4),
  ('micro','taglio_tessuti','Taglio tessuti','tappezzeria',1),
  ('micro','cucito','Cucito','tappezzeria',2),
  ('micro','montaggio_tende','Montaggio tende','tappezzeria',3),
  ('micro','trasporto','Trasporto','montaggi',1),
  ('micro','installazione','Installazione','montaggi',2),
  ('micro','amministrazione','Amministrazione','uffici',1),
  ('micro','commerciale','Commerciale','uffici',2),
  ('micro','marketing','Marketing','uffici',3),
  ('micro','progettazione','Progettazione','uffici',4),
  ('micro','ricezione_merci','Ricezione merci','magazzino',1),
  ('micro','stoccaggio','Stoccaggio','magazzino',2),
  ('micro','spedizioni','Spedizioni','magazzino',3),
  ('micro','inventario','Inventario','magazzino',4)
ON CONFLICT (kind, key) DO NOTHING;
