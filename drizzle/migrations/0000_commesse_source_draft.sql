ALTER TABLE public.commesse ADD COLUMN IF NOT EXISTS source_draft_id uuid REFERENCES public.design_drafts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS commesse_source_draft_idx ON public.commesse(source_draft_id);
UPDATE public.commesse c SET source_draft_id = d.id
FROM (SELECT DISTINCT ON (lower(trim(name))) id, lower(trim(name)) n FROM public.design_drafts ORDER BY lower(trim(name)), updated_at DESC) d
WHERE c.source_draft_id IS NULL AND (lower(trim(c.titolo)) = d.n OR lower(trim(split_part(c.titolo, ' · ', 1))) = d.n);