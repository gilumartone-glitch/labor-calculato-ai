ALTER TABLE public.production_sub_orders ADD COLUMN IF NOT EXISTS assignee_id uuid;
CREATE INDEX IF NOT EXISTS idx_production_sub_orders_assignee ON public.production_sub_orders(assignee_id);