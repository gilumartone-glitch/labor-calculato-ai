-- Tabella per stati per-utente (calcolatore, montaggi, falegnameria, ecc.)
CREATE TABLE public.user_workspaces (
  user_id uuid NOT NULL,
  key text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

ALTER TABLE public.user_workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "uw_select_own" ON public.user_workspaces
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "uw_insert_own" ON public.user_workspaces
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "uw_update_own" ON public.user_workspaces
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "uw_delete_own" ON public.user_workspaces
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_user_workspaces_updated_at
  BEFORE UPDATE ON public.user_workspaces
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.user_workspaces;
ALTER TABLE public.user_workspaces REPLICA IDENTITY FULL;