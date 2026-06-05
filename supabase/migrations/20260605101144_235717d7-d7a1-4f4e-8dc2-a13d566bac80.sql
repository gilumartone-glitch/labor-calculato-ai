CREATE OR REPLACE FUNCTION public.cleanup_montaggi_planning_on_draft_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.montaggi_planning WHERE commessa_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_planning_on_draft_delete ON public.design_drafts;
CREATE TRIGGER trg_cleanup_planning_on_draft_delete
BEFORE DELETE ON public.design_drafts
FOR EACH ROW EXECUTE FUNCTION public.cleanup_montaggi_planning_on_draft_delete();