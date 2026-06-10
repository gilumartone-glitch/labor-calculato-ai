
CREATE TABLE public.material_dependencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_pattern text NOT NULL,
  produced_by_dept text NOT NULL,
  consumer_dept text,
  mode text NOT NULL DEFAULT 'blocking' CHECK (mode IN ('blocking','autonomous','ignore')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

GRANT SELECT ON public.material_dependencies TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.material_dependencies TO authenticated;
GRANT ALL ON public.material_dependencies TO service_role;

ALTER TABLE public.material_dependencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read material_dependencies"
  ON public.material_dependencies FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "admin write material_dependencies"
  ON public.material_dependencies FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_material_deps_updated_at
  BEFORE UPDATE ON public.material_dependencies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_material_deps_lookup
  ON public.material_dependencies (produced_by_dept, consumer_dept);
