ALTER TABLE public.montaggi_lavorazioni
  ADD COLUMN IF NOT EXISTS operatore_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

UPDATE public.montaggi_lavorazioni
  SET operatore_ids = ARRAY[operatore_id]
  WHERE operatore_id IS NOT NULL
    AND (operatore_ids IS NULL OR array_length(operatore_ids, 1) IS NULL);