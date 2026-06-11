-- Catalogo template/causali di montaggio
CREATE TABLE public.montaggi_lavorazione_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  descrizione text,
  ore_stimate numeric NOT NULL DEFAULT 0,
  costo_orario_default numeric NOT NULL DEFAULT 0,
  materiali jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.montaggi_lavorazione_templates TO authenticated;
GRANT ALL ON public.montaggi_lavorazione_templates TO service_role;

ALTER TABLE public.montaggi_lavorazione_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read templates"
  ON public.montaggi_lavorazione_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert templates"
  ON public.montaggi_lavorazione_templates FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Authenticated can update templates"
  ON public.montaggi_lavorazione_templates FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete templates"
  ON public.montaggi_lavorazione_templates FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_templates_updated_at
  BEFORE UPDATE ON public.montaggi_lavorazione_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Lavorazioni di montaggio (per progetto/draft)
CREATE TABLE public.montaggi_lavorazioni (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id text NOT NULL,
  template_id uuid REFERENCES public.montaggi_lavorazione_templates(id) ON DELETE SET NULL,
  causale text NOT NULL,
  descrizione text,
  source_kind text NOT NULL DEFAULT 'manuale',
  source_ref jsonb,
  ore numeric NOT NULL DEFAULT 0,
  costo_orario numeric NOT NULL DEFAULT 0,
  operatore_id uuid,
  stato text NOT NULL DEFAULT 'da_fare' CHECK (stato IN ('da_fare','in_corso','fatto')),
  note text,
  ordine integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_montaggi_lavorazioni_draft ON public.montaggi_lavorazioni(draft_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.montaggi_lavorazioni TO authenticated;
GRANT ALL ON public.montaggi_lavorazioni TO service_role;

ALTER TABLE public.montaggi_lavorazioni ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read lavorazioni"
  ON public.montaggi_lavorazioni FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert lavorazioni"
  ON public.montaggi_lavorazioni FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Authenticated can update lavorazioni"
  ON public.montaggi_lavorazioni FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete lavorazioni"
  ON public.montaggi_lavorazioni FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_lavorazioni_updated_at
  BEFORE UPDATE ON public.montaggi_lavorazioni
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();