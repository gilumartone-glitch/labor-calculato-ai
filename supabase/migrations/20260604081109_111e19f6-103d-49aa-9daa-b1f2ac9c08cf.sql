
-- Catalogo attrezzi condiviso
CREATE TABLE public.montaggi_attrezzi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  categoria text,
  descrizione text,
  unita text NOT NULL DEFAULT 'pz',
  note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.montaggi_attrezzi TO authenticated;
GRANT ALL ON public.montaggi_attrezzi TO service_role;
ALTER TABLE public.montaggi_attrezzi ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attrezzi_select_auth" ON public.montaggi_attrezzi
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "attrezzi_insert_auth" ON public.montaggi_attrezzi
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "attrezzi_update_priv" ON public.montaggi_attrezzi
  FOR UPDATE TO authenticated
  USING (auth.uid() = created_by OR has_role(auth.uid(), 'admin'::app_role) OR has_permission(auth.uid(), 'flow', 'write'::permission_level) OR has_permission(auth.uid(), 'produzione', 'write'::permission_level))
  WITH CHECK (auth.uid() = created_by OR has_role(auth.uid(), 'admin'::app_role) OR has_permission(auth.uid(), 'flow', 'write'::permission_level) OR has_permission(auth.uid(), 'produzione', 'write'::permission_level));
CREATE POLICY "attrezzi_delete_priv" ON public.montaggi_attrezzi
  FOR DELETE TO authenticated
  USING (auth.uid() = created_by OR has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_montaggi_attrezzi_updated
  BEFORE UPDATE ON public.montaggi_attrezzi
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Catalogo materiali condiviso
CREATE TABLE public.montaggi_materiali (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  categoria text,
  descrizione text,
  unita text NOT NULL DEFAULT 'pz',
  note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.montaggi_materiali TO authenticated;
GRANT ALL ON public.montaggi_materiali TO service_role;
ALTER TABLE public.montaggi_materiali ENABLE ROW LEVEL SECURITY;

CREATE POLICY "materiali_select_auth" ON public.montaggi_materiali
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "materiali_insert_auth" ON public.montaggi_materiali
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "materiali_update_priv" ON public.montaggi_materiali
  FOR UPDATE TO authenticated
  USING (auth.uid() = created_by OR has_role(auth.uid(), 'admin'::app_role) OR has_permission(auth.uid(), 'flow', 'write'::permission_level) OR has_permission(auth.uid(), 'produzione', 'write'::permission_level))
  WITH CHECK (auth.uid() = created_by OR has_role(auth.uid(), 'admin'::app_role) OR has_permission(auth.uid(), 'flow', 'write'::permission_level) OR has_permission(auth.uid(), 'produzione', 'write'::permission_level));
CREATE POLICY "materiali_delete_priv" ON public.montaggi_materiali
  FOR DELETE TO authenticated
  USING (auth.uid() = created_by OR has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_montaggi_materiali_updated
  BEFORE UPDATE ON public.montaggi_materiali
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Item assegnati a un cantiere (attrezzi o materiali con quantità)
CREATE TABLE public.montaggi_assignment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commessa_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('attrezzo','materiale')),
  ref_id uuid,
  ref_nome text NOT NULL,
  qty numeric NOT NULL DEFAULT 1,
  unita text NOT NULL DEFAULT 'pz',
  note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.montaggi_assignment_items TO authenticated;
GRANT ALL ON public.montaggi_assignment_items TO service_role;
ALTER TABLE public.montaggi_assignment_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "assignitem_select_auth" ON public.montaggi_assignment_items
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "assignitem_insert_priv" ON public.montaggi_assignment_items
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'coordinatore'::app_role) OR has_permission(auth.uid(), 'flow', 'write'::permission_level) OR has_permission(auth.uid(), 'produzione', 'write'::permission_level)));
CREATE POLICY "assignitem_update_priv" ON public.montaggi_assignment_items
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'coordinatore'::app_role) OR has_permission(auth.uid(), 'flow', 'write'::permission_level) OR has_permission(auth.uid(), 'produzione', 'write'::permission_level))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'coordinatore'::app_role) OR has_permission(auth.uid(), 'flow', 'write'::permission_level) OR has_permission(auth.uid(), 'produzione', 'write'::permission_level));
CREATE POLICY "assignitem_delete_priv" ON public.montaggi_assignment_items
  FOR DELETE TO authenticated
  USING (auth.uid() = created_by OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'coordinatore'::app_role));

CREATE TRIGGER trg_montaggi_assignment_items_updated
  BEFORE UPDATE ON public.montaggi_assignment_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_assignitem_commessa ON public.montaggi_assignment_items(commessa_id);
