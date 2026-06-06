-- Tighten marketing_categories INSERT
DROP POLICY IF EXISTS "auth insert marketing_categories" ON public.marketing_categories;
CREATE POLICY "marketing_categories_insert_priv"
ON public.marketing_categories
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = created_by
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_permission(auth.uid(), 'marketing'::text, 'write'::permission_level)
  )
);

-- Tighten marketing_contacts INSERT
DROP POLICY IF EXISTS "auth insert marketing_contacts" ON public.marketing_contacts;
CREATE POLICY "marketing_contacts_insert_priv"
ON public.marketing_contacts
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = created_by
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_permission(auth.uid(), 'marketing'::text, 'write'::permission_level)
  )
);

-- Tighten marketing_newsletters UPDATE
DROP POLICY IF EXISTS "auth update marketing_newsletters" ON public.marketing_newsletters;
CREATE POLICY "marketing_newsletters_update_priv"
ON public.marketing_newsletters
FOR UPDATE
TO authenticated
USING (
  auth.uid() = created_by
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_permission(auth.uid(), 'marketing'::text, 'write'::permission_level)
)
WITH CHECK (
  auth.uid() = created_by
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_permission(auth.uid(), 'marketing'::text, 'write'::permission_level)
);