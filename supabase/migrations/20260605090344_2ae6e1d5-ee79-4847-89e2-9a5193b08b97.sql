CREATE OR REPLACE FUNCTION public.cleanup_montaggi_planning_on_commessa_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.montaggi_planning WHERE commessa_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_planning_on_commessa_delete ON public.commesse;
CREATE TRIGGER trg_cleanup_planning_on_commessa_delete
AFTER DELETE ON public.commesse
FOR EACH ROW EXECUTE FUNCTION public.cleanup_montaggi_planning_on_commessa_delete();

CREATE OR REPLACE FUNCTION public.cleanup_montaggi_planning_on_order_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.source_commessa_id IS NOT NULL THEN
    DELETE FROM public.montaggi_planning WHERE commessa_id = OLD.source_commessa_id;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_planning_on_order_delete ON public.production_orders;
CREATE TRIGGER trg_cleanup_planning_on_order_delete
AFTER DELETE ON public.production_orders
FOR EACH ROW EXECUTE FUNCTION public.cleanup_montaggi_planning_on_order_delete();