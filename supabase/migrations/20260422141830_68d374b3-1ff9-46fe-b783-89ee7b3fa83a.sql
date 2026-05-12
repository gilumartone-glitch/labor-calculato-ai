ALTER TABLE public.commesse
  ADD COLUMN IF NOT EXISTS snapshot jsonb;