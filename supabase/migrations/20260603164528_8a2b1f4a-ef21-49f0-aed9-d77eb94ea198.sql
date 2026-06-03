
CREATE TABLE public.montaggi_planning (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commessa_id uuid NULL,
  cantiere_label text NOT NULL DEFAULT '',
  operator_id uuid NOT NULL,
  date date NOT NULL,
  start_time time NULL,
  end_time time NULL,
  hours numeric NOT NULL DEFAULT 8,
  role text NULL,
  notes text NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX montaggi_planning_date_idx ON public.montaggi_planning (date);
CREATE INDEX montaggi_planning_operator_idx ON public.montaggi_planning (operator_id, date);
CREATE INDEX montaggi_planning_commessa_idx ON public.montaggi_planning (commessa_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.montaggi_planning TO authenticated;
GRANT ALL ON public.montaggi_planning TO service_role;

ALTER TABLE public.montaggi_planning ENABLE ROW LEVEL SECURITY;

CREATE POLICY "montaggi_planning_select_auth"
ON public.montaggi_planning FOR SELECT TO authenticated
USING (true);

CREATE POLICY "montaggi_planning_insert_priv"
ON public.montaggi_planning FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = created_by AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'coordinatore'::app_role)
    OR has_permission(auth.uid(), 'flow', 'write'::permission_level)
    OR has_permission(auth.uid(), 'produzione', 'write'::permission_level)
  )
);

CREATE POLICY "montaggi_planning_update_priv"
ON public.montaggi_planning FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'coordinatore'::app_role)
  OR has_permission(auth.uid(), 'flow', 'write'::permission_level)
  OR has_permission(auth.uid(), 'produzione', 'write'::permission_level)
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'coordinatore'::app_role)
  OR has_permission(auth.uid(), 'flow', 'write'::permission_level)
  OR has_permission(auth.uid(), 'produzione', 'write'::permission_level)
);

CREATE POLICY "montaggi_planning_delete_priv"
ON public.montaggi_planning FOR DELETE TO authenticated
USING (
  auth.uid() = created_by
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'coordinatore'::app_role)
  OR has_permission(auth.uid(), 'flow', 'write'::permission_level)
);

CREATE TRIGGER montaggi_planning_updated_at
BEFORE UPDATE ON public.montaggi_planning
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.montaggi_planning;
