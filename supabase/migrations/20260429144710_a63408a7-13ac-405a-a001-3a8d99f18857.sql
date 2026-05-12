-- Add dept enum value 'generale' compatibility: use TEXT for flexibility (we already have prod_dept enum but it's specific to sub-orders)
ALTER TABLE public.inventory_items
  ADD COLUMN reparto TEXT NOT NULL DEFAULT 'generale',
  ADD COLUMN material_key TEXT,
  ADD COLUMN material_name TEXT,
  ADD COLUMN material_color TEXT,
  ADD COLUMN material_height TEXT,
  ADD COLUMN material_attrs JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX idx_inv_reparto ON public.inventory_items(reparto);
CREATE INDEX idx_inv_repmat ON public.inventory_items(reparto, material_key);

-- Unique constraint to enable upsert on (reparto, material_key) — only when material_key is set
CREATE UNIQUE INDEX idx_inv_repmat_unique ON public.inventory_items(reparto, material_key) WHERE material_key IS NOT NULL;
