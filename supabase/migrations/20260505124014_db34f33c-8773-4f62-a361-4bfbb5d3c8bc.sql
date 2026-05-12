ALTER TABLE public.marketing_newsletters
  ADD COLUMN IF NOT EXISTS blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

INSERT INTO storage.buckets (id, name, public)
VALUES ('marketing-attachments', 'marketing-attachments', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read marketing-attachments"
ON storage.objects FOR SELECT
USING (bucket_id = 'marketing-attachments');

CREATE POLICY "Auth upload marketing-attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'marketing-attachments');

CREATE POLICY "Auth delete marketing-attachments"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'marketing-attachments');