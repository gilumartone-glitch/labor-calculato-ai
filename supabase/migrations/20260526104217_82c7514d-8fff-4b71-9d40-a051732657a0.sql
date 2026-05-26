
-- 1) Restrict audit_log SELECT to admins only (was: true for all auth)
DROP POLICY IF EXISTS audit_select_all ON public.audit_log;
CREATE POLICY audit_select_admin ON public.audit_log
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 2) Restrict marketing_contacts SELECT to users with marketing permission OR the creator
DROP POLICY IF EXISTS "auth view marketing_contacts" ON public.marketing_contacts;
CREATE POLICY "marketing_contacts_select_permitted" ON public.marketing_contacts
  FOR SELECT TO authenticated
  USING (
    auth.uid() = created_by
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_permission(auth.uid(), 'marketing'::text, 'read'::permission_level)
    OR has_permission(auth.uid(), 'marketing'::text, 'write'::permission_level)
  );

-- 3) Restrict marketing_newsletters SELECT similarly
DROP POLICY IF EXISTS "auth view marketing_newsletters" ON public.marketing_newsletters;
CREATE POLICY "marketing_newsletters_select_permitted" ON public.marketing_newsletters
  FOR SELECT TO authenticated
  USING (
    auth.uid() = created_by
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_permission(auth.uid(), 'marketing'::text, 'read'::permission_level)
    OR has_permission(auth.uid(), 'marketing'::text, 'write'::permission_level)
  );

-- 4) Tighten prod_notifications INSERT: the inserter must be the target user
--    OR have produzione write OR be admin/coordinatore. Prevents arbitrary
--    notification forging to other users.
DROP POLICY IF EXISTS notif_insert_auth ON public.prod_notifications;
CREATE POLICY notif_insert_priv ON public.prod_notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'coordinatore'::app_role)
    OR has_permission(auth.uid(), 'produzione'::text, 'write'::permission_level)
  );

-- 5) Restrict user_roles SELECT to own row or admin (prevents role enumeration).
--    A SECURITY DEFINER helper exposes only the list of admin user ids needed by
--    application code for notification fan-out.
DROP POLICY IF EXISTS "Authenticated users can view roles" ON public.user_roles;
CREATE POLICY user_roles_select_self_or_admin ON public.user_roles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.get_admin_user_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id FROM public.user_roles WHERE role = 'admin'::app_role;
$$;

REVOKE ALL ON FUNCTION public.get_admin_user_ids() FROM public;
GRANT EXECUTE ON FUNCTION public.get_admin_user_ids() TO authenticated;
