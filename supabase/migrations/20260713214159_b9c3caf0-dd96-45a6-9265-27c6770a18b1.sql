
-- 1) Marketing attachments: drop public read
DROP POLICY IF EXISTS "Public read marketing-attachments" ON storage.objects;
CREATE POLICY "marketing_attachments_select_priv"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'marketing-attachments'
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_permission(auth.uid(), 'marketing', 'read'::permission_level)
    OR owner = auth.uid()
  )
);

-- 2) Production files: restrict SELECT
DROP POLICY IF EXISTS "prod_files_select_auth" ON storage.objects;
CREATE POLICY "prod_files_select_priv"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'prod-files'
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_permission(auth.uid(), 'produzione', 'read'::permission_level)
    OR owner = auth.uid()
  )
);

-- 3) Chat attachments: restrict SELECT to channel members / uploader
DROP POLICY IF EXISTS "chat attachments read authenticated" ON storage.objects;
CREATE POLICY "chat_attachments_select_members"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'prod-chat-attachments'
  AND (
    owner = auth.uid()
    OR has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1
      FROM public.prod_chat_channels c
      WHERE c.id = NULLIF((storage.foldername(name))[2], '')::uuid
        AND (
          (c.kind = 'diretto' AND auth.uid() = ANY(COALESCE(c.members, ARRAY[]::uuid[])))
          OR (c.kind <> 'diretto' AND has_permission(auth.uid(), 'produzione', 'read'::permission_level))
        )
    )
  )
);

-- 4) Profiles: require approved (or admin) to list all profiles
DROP POLICY IF EXISTS "Authenticated users can view all profiles" ON public.profiles;
CREATE POLICY "Approved users can view profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (
  auth.uid() = id
  OR has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.approved = true
  )
);
