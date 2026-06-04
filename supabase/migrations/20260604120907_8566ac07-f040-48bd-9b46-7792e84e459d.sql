
CREATE TABLE public.dipendenti (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  nome text NOT NULL,
  funzione text,
  email text,
  telefono text,
  macro_reparti text[] NOT NULL DEFAULT '{}',
  reparti text[] NOT NULL DEFAULT '{}',
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  hourly_rate numeric NOT NULL DEFAULT 0,
  ral numeric NOT NULL DEFAULT 0,
  inps_pct numeric NOT NULL DEFAULT 30,
  inail_pct numeric NOT NULL DEFAULT 3,
  tfr_pct numeric NOT NULL DEFAULT 8.33,
  extra_costs numeric NOT NULL DEFAULT 0,
  annual_hours numeric NOT NULL DEFAULT 1720,
  attivo boolean NOT NULL DEFAULT true,
  note text
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dipendenti TO authenticated;
GRANT ALL ON public.dipendenti TO service_role;

ALTER TABLE public.dipendenti ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dipendenti_select_auth" ON public.dipendenti
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "dipendenti_insert_priv" ON public.dipendenti
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND (has_role(auth.uid(),'admin'::app_role) OR has_permission(auth.uid(),'flow'::text,'write'::permission_level))
  );

CREATE POLICY "dipendenti_update_priv" ON public.dipendenti
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_permission(auth.uid(),'flow'::text,'write'::permission_level))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_permission(auth.uid(),'flow'::text,'write'::permission_level));

CREATE POLICY "dipendenti_delete_priv" ON public.dipendenti
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_permission(auth.uid(),'flow'::text,'write'::permission_level));

CREATE TRIGGER trg_dipendenti_updated_at
  BEFORE UPDATE ON public.dipendenti
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.app_pages (key, label, ordine, description)
VALUES ('dipendenti', 'Dipendenti', 95, 'Anagrafica dipendenti officina con reparti e costi')
ON CONFLICT (key) DO NOTHING;

-- Concedi accesso pieno agli admin esistenti sulla nuova pagina
INSERT INTO public.user_permissions (user_id, page_key, level)
SELECT ur.user_id, 'dipendenti', 'write'::permission_level
FROM public.user_roles ur
WHERE ur.role = 'admin'::app_role
ON CONFLICT DO NOTHING;
