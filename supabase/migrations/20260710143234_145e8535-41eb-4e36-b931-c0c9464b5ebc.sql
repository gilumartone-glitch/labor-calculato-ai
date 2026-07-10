
ALTER TABLE public.prod_chat_channels
  ADD COLUMN IF NOT EXISTS members uuid[] NOT NULL DEFAULT ARRAY[]::uuid[];

CREATE INDEX IF NOT EXISTS prod_chat_channels_members_idx
  ON public.prod_chat_channels USING GIN (members);

CREATE OR REPLACE FUNCTION public.is_dm_member(_channel_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.prod_chat_channels
    WHERE id = _channel_id
      AND kind = 'diretto'
      AND _user_id = ANY(COALESCE(members, ARRAY[]::uuid[]))
  )
$$;

DROP POLICY IF EXISTS chan_select_dm ON public.prod_chat_channels;
CREATE POLICY chan_select_dm ON public.prod_chat_channels
FOR SELECT TO authenticated
USING (kind = 'diretto' AND auth.uid() = ANY(COALESCE(members, ARRAY[]::uuid[])));

DROP POLICY IF EXISTS chan_insert_dm ON public.prod_chat_channels;
CREATE POLICY chan_insert_dm ON public.prod_chat_channels
FOR INSERT TO authenticated
WITH CHECK (kind = 'diretto' AND auth.uid() = ANY(COALESCE(members, ARRAY[]::uuid[])));

DROP POLICY IF EXISTS chan_update_dm ON public.prod_chat_channels;
CREATE POLICY chan_update_dm ON public.prod_chat_channels
FOR UPDATE TO authenticated
USING (kind = 'diretto' AND auth.uid() = ANY(COALESCE(members, ARRAY[]::uuid[])))
WITH CHECK (kind = 'diretto' AND auth.uid() = ANY(COALESCE(members, ARRAY[]::uuid[])));

DROP POLICY IF EXISTS msg_select_dm ON public.prod_chat_messages;
CREATE POLICY msg_select_dm ON public.prod_chat_messages
FOR SELECT TO authenticated
USING (public.is_dm_member(channel_id, auth.uid()));

DROP POLICY IF EXISTS msg_insert_dm ON public.prod_chat_messages;
CREATE POLICY msg_insert_dm ON public.prod_chat_messages
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND public.is_dm_member(channel_id, auth.uid()));
