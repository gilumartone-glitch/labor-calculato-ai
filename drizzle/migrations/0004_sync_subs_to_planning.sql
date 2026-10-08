CREATE OR REPLACE FUNCTION public.sync_subs_to_planning()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cid uuid; delta int;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NEW.start_date IS NULL OR OLD.start_date IS NULL OR NEW.start_date = OLD.start_date THEN RETURN NEW; END IF;
  SELECT source_commessa_id INTO cid FROM public.production_orders WHERE id = NEW.order_id;
  IF cid IS NULL THEN RETURN NEW; END IF;
  delta := NEW.start_date - OLD.start_date;
  UPDATE public.montaggi_planning SET date = date + delta
   WHERE commessa_id = cid AND reparto = NEW.dept::text;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sync_subs_to_planning ON public.production_sub_orders;
CREATE TRIGGER trg_sync_subs_to_planning AFTER UPDATE OF start_date ON public.production_sub_orders
FOR EACH ROW EXECUTE FUNCTION public.sync_subs_to_planning();