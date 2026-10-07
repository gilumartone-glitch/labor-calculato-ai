CREATE OR REPLACE FUNCTION public.sync_planning_to_subs()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT x.commessa_id, x.reparto FROM (
      SELECT NEW.commessa_id, NEW.reparto WHERE TG_OP <> 'DELETE'
      UNION SELECT OLD.commessa_id, OLD.reparto WHERE TG_OP <> 'INSERT'
    ) x(commessa_id, reparto) WHERE x.commessa_id IS NOT NULL
  LOOP
    UPDATE public.production_sub_orders s
    SET start_date = p.mn, end_date = p.mx
    FROM (SELECT min(date) mn, max(date) mx FROM public.montaggi_planning
          WHERE commessa_id = r.commessa_id AND reparto = r.reparto) p
    WHERE p.mn IS NOT NULL
      AND s.dept::text = r.reparto
      AND s.order_id IN (SELECT id FROM public.production_orders WHERE source_commessa_id = r.commessa_id);
  END LOOP;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_sync_planning_to_subs ON public.montaggi_planning;
CREATE TRIGGER trg_sync_planning_to_subs AFTER INSERT OR UPDATE OF date, reparto, commessa_id OR DELETE ON public.montaggi_planning
FOR EACH ROW EXECUTE FUNCTION public.sync_planning_to_subs();