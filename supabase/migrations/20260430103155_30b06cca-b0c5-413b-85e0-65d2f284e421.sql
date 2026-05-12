-- Tabella per bozze di progettazione (multi-tab per utente)
CREATE TABLE public.design_drafts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  name text NOT NULL DEFAULT 'Progetto',
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ordine integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.design_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own drafts"
ON public.design_drafts FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own drafts"
ON public.design_drafts FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own drafts"
ON public.design_drafts FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own drafts"
ON public.design_drafts FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE TRIGGER trg_design_drafts_updated_at
BEFORE UPDATE ON public.design_drafts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_design_drafts_user_ordine ON public.design_drafts(user_id, ordine);