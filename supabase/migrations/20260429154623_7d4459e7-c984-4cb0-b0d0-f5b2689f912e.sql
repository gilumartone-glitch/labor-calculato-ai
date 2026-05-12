DO $$ BEGIN
  CREATE TYPE public.checklist_item_status AS ENUM ('todo', 'done', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.production_sub_checklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_id uuid NOT NULL REFERENCES public.production_sub_orders(id) ON DELETE CASCADE,
  ordine integer NOT NULL DEFAULT 0,
  label text NOT NULL,
  status public.checklist_item_status NOT NULL DEFAULT 'todo',
  note text,
  done_by uuid,
  done_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_psub_checklist_sub ON public.production_sub_checklist(sub_id, ordine);

ALTER TABLE public.production_sub_checklist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "checklist_select_all" ON public.production_sub_checklist;
CREATE POLICY "checklist_select_all"
ON public.production_sub_checklist FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "checklist_cud_writer" ON public.production_sub_checklist;
CREATE POLICY "checklist_cud_writer"
ON public.production_sub_checklist FOR ALL TO authenticated
USING (public.has_permission(auth.uid(), 'produzione', 'write') OR public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_permission(auth.uid(), 'produzione', 'write') OR public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS trg_psub_checklist_updated ON public.production_sub_checklist;
CREATE TRIGGER trg_psub_checklist_updated
BEFORE UPDATE ON public.production_sub_checklist
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();