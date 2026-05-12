-- Aggiungo nuovo valore enum (non posso rimuovere 'bloccato' senza migrazioni dati, lo mantengo per ora)
ALTER TYPE prod_sub_status ADD VALUE IF NOT EXISTS 'rimandato';

-- Campi per tracciare il rimando di un sub-ordine
ALTER TABLE public.production_sub_orders
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS rejected_to uuid,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid;

-- Collegamento opzionale ordine -> commessa Flow di origine
ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS source_commessa_id uuid;