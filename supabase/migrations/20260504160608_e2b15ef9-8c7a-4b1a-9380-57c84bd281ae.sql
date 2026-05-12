CREATE TABLE public.design_draft_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL DEFAULT 'Progetto',
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ddv_draft ON public.design_draft_versions(draft_id, created_at DESC);
CREATE INDEX idx_ddv_user ON public.design_draft_versions(user_id, created_at DESC);

ALTER TABLE public.design_draft_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own draft versions"
  ON public.design_draft_versions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own draft versions"
  ON public.design_draft_versions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own draft versions"
  ON public.design_draft_versions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);