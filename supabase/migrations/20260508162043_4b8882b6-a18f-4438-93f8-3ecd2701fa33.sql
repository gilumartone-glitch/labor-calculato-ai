ALTER TABLE public.production_orders ADD COLUMN IF NOT EXISTS production_name text;
ALTER TABLE public.production_sub_orders ADD COLUMN IF NOT EXISTS supplier_name text;