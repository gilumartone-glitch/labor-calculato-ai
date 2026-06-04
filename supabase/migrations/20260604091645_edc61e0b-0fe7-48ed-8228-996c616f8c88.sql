
ALTER TABLE public.montaggi_planning
  ADD COLUMN IF NOT EXISTS reparto text NOT NULL DEFAULT 'montaggi'
  CHECK (reparto IN ('montaggi','laboratorio','tappezzeria','falegnameria','altro'));

CREATE INDEX IF NOT EXISTS montaggi_planning_reparto_idx ON public.montaggi_planning(reparto);
