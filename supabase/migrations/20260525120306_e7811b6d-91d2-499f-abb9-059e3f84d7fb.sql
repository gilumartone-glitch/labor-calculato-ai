CREATE TABLE public.marketing_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL,
  type TEXT NOT NULL,
  channel TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  status TEXT NOT NULL DEFAULT 'success',
  recipients_count INTEGER NOT NULL DEFAULT 0,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_marketing_activity_log_created_at ON public.marketing_activity_log(created_at DESC);
CREATE INDEX idx_marketing_activity_log_type ON public.marketing_activity_log(type);

ALTER TABLE public.marketing_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view all activity log"
ON public.marketing_activity_log FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert activity log"
ON public.marketing_activity_log FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can delete their own activity log"
ON public.marketing_activity_log FOR DELETE
TO authenticated
USING (auth.uid() = created_by);