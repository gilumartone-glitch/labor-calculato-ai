
CREATE TABLE public.design_draft_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES public.design_drafts(id) ON DELETE CASCADE,
  shared_with uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(draft_id, shared_with)
);

GRANT SELECT, INSERT, DELETE ON public.design_draft_shares TO authenticated;
GRANT ALL ON public.design_draft_shares TO service_role;

CREATE INDEX idx_dds_shared_with ON public.design_draft_shares(shared_with);
CREATE INDEX idx_dds_draft ON public.design_draft_shares(draft_id);

CREATE OR REPLACE FUNCTION public.is_draft_shared_with(_draft uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM public.design_draft_shares WHERE draft_id=_draft AND shared_with=_user);
$$;

CREATE OR REPLACE FUNCTION public.is_draft_owner(_draft uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM public.design_drafts WHERE id=_draft AND user_id=_user);
$$;

ALTER TABLE public.design_draft_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manages shares" ON public.design_draft_shares
  FOR ALL TO authenticated
  USING (public.is_draft_owner(draft_id, auth.uid()))
  WITH CHECK (public.is_draft_owner(draft_id, auth.uid()) AND created_by = auth.uid());

CREATE POLICY "Shared user sees own share" ON public.design_draft_shares
  FOR SELECT TO authenticated
  USING (shared_with = auth.uid());

-- Estendi le RLS di design_drafts per includere gli utenti con cui è condiviso
DROP POLICY IF EXISTS "Users can view their own drafts" ON public.design_drafts;
CREATE POLICY "Users can view own or shared drafts" ON public.design_drafts
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_draft_shared_with(id, auth.uid()));

DROP POLICY IF EXISTS "Users can update their own drafts" ON public.design_drafts;
CREATE POLICY "Users can update own or shared drafts" ON public.design_drafts
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.is_draft_shared_with(id, auth.uid()))
  WITH CHECK (auth.uid() = user_id OR public.is_draft_shared_with(id, auth.uid()));

-- Versioni: consenti la lettura anche agli utenti con cui la draft è condivisa
DROP POLICY IF EXISTS "Users read versions of own drafts" ON public.design_draft_versions;
DROP POLICY IF EXISTS "Users can view versions of their drafts" ON public.design_draft_versions;
CREATE POLICY "View versions of own or shared drafts" ON public.design_draft_versions
  FOR SELECT TO authenticated
  USING (
    EXISTS(SELECT 1 FROM public.design_drafts d WHERE d.id = design_draft_versions.draft_id
      AND (d.user_id = auth.uid() OR public.is_draft_shared_with(d.id, auth.uid())))
  );
