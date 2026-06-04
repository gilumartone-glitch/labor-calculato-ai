
-- Add macro_reparto and operator_ids to production_sub_orders & commesse
ALTER TABLE public.production_sub_orders
  ADD COLUMN IF NOT EXISTS macro_reparto text,
  ADD COLUMN IF NOT EXISTS operator_ids uuid[] NOT NULL DEFAULT '{}';

ALTER TABLE public.commesse
  ADD COLUMN IF NOT EXISTS macro_reparto text,
  ADD COLUMN IF NOT EXISTS responsabile_id uuid,
  ADD COLUMN IF NOT EXISTS operator_ids uuid[] NOT NULL DEFAULT '{}';

-- Trigger: when a sub-order is completed, unlock sub-orders that depend on it
-- (depends_on is a single uuid today). If all predecessors of a blocked sub
-- are completato, move it from 'bloccato' to 'in_attesa' and notify assignee.
CREATE OR REPLACE FUNCTION public.unlock_dependent_subs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF NEW.status = 'completato' AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    FOR r IN
      SELECT s.* FROM public.production_sub_orders s
      WHERE s.depends_on = NEW.id
        AND s.status = 'bloccato'
    LOOP
      UPDATE public.production_sub_orders
        SET status = 'in_attesa', updated_at = now()
      WHERE id = r.id;
      IF r.assignee_id IS NOT NULL THEN
        INSERT INTO public.prod_notifications (user_id, type, message, order_id, link, is_urgent)
        VALUES (
          r.assignee_id, 'sub_sbloccato',
          concat('Lavorazione ', r.code, ' sbloccata: pu&ograve; partire'),
          r.order_id, concat('/produzione/board?sub=', r.id::text), false
        );
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_unlock_dependent_subs ON public.production_sub_orders;
CREATE TRIGGER trg_unlock_dependent_subs
AFTER UPDATE OF status ON public.production_sub_orders
FOR EACH ROW EXECUTE FUNCTION public.unlock_dependent_subs();
