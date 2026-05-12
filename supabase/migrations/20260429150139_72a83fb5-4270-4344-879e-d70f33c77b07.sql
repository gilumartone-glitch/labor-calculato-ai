-- Stato dei singoli pezzi di sfrido
DO $$ BEGIN
  CREATE TYPE public.scrap_piece_status AS ENUM ('libero','riservato','usato');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.inventory_scrap_pieces (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  inventory_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  w_mm NUMERIC NOT NULL CHECK (w_mm > 0),
  h_mm NUMERIC NOT NULL CHECK (h_mm > 0),
  thickness_mm NUMERIC,
  posizione TEXT,
  note TEXT,
  status public.scrap_piece_status NOT NULL DEFAULT 'libero',
  reserved_for_order UUID,
  reserved_for_sub UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID
);

CREATE INDEX IF NOT EXISTS idx_scrap_pieces_inventory ON public.inventory_scrap_pieces(inventory_id);
CREATE INDEX IF NOT EXISTS idx_scrap_pieces_status ON public.inventory_scrap_pieces(status);

ALTER TABLE public.inventory_scrap_pieces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scrap_select_all"
  ON public.inventory_scrap_pieces FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "scrap_cud_writer"
  ON public.inventory_scrap_pieces FOR ALL
  TO authenticated
  USING (public.has_permission(auth.uid(),'produzione','write') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_permission(auth.uid(),'produzione','write') OR public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_scrap_pieces_updated_at
  BEFORE UPDATE ON public.inventory_scrap_pieces
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();