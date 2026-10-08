ALTER TABLE public.design_drafts ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE OR REPLACE FUNCTION public.reopen_project_draft(_draft uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _owner uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'coordinatore')) THEN
    RAISE EXCEPTION 'Solo un responsabile può modificare il progetto';
  END IF;
  SELECT user_id INTO _owner FROM public.design_drafts WHERE id = _draft;
  IF _owner IS NULL THEN RAISE EXCEPTION 'Progetto non trovato'; END IF;
  UPDATE public.design_drafts SET archived_at = NULL WHERE id = _draft;
  IF _owner <> auth.uid() AND NOT EXISTS (SELECT 1 FROM public.design_draft_shares WHERE draft_id = _draft AND shared_with = auth.uid()) THEN
    INSERT INTO public.design_draft_shares (draft_id, shared_with, created_by) VALUES (_draft, auth.uid(), auth.uid());
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.reopen_project_draft(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reopen_project_draft(uuid) TO authenticated;