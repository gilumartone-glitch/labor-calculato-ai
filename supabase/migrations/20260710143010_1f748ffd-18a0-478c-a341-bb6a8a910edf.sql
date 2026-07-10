
ALTER TABLE public.prod_chat_messages ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Storage RLS: authenticated users can manage files in prod-chat-attachments
CREATE POLICY "chat attachments read authenticated"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'prod-chat-attachments');

CREATE POLICY "chat attachments upload authenticated"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'prod-chat-attachments' AND owner = auth.uid());

CREATE POLICY "chat attachments delete own"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'prod-chat-attachments' AND owner = auth.uid());
