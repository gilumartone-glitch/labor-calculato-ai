
-- 1. commessa_assegnatari: restrict writes
DROP POLICY IF EXISTS "Authenticated users can insert assignments" ON public.commessa_assegnatari;
DROP POLICY IF EXISTS "Authenticated users can update assignments" ON public.commessa_assegnatari;
DROP POLICY IF EXISTS "Authenticated users can delete assignments" ON public.commessa_assegnatari;

CREATE POLICY "assegnatari_insert_priv" ON public.commessa_assegnatari
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'coordinatore')
    OR public.has_permission(auth.uid(), 'flow', 'write')
  );

CREATE POLICY "assegnatari_update_priv" ON public.commessa_assegnatari
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'coordinatore')
    OR public.has_permission(auth.uid(), 'flow', 'write')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'coordinatore')
    OR public.has_permission(auth.uid(), 'flow', 'write')
  );

CREATE POLICY "assegnatari_delete_priv" ON public.commessa_assegnatari
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'coordinatore')
    OR public.has_permission(auth.uid(), 'flow', 'write')
  );

-- 2. marketing_activity_log: restrict SELECT
DROP POLICY IF EXISTS "Authenticated users can view all activity log" ON public.marketing_activity_log;
CREATE POLICY "marketing_activity_log_select_priv" ON public.marketing_activity_log
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_permission(auth.uid(), 'marketing', 'read')
    OR public.has_permission(auth.uid(), 'marketing', 'write')
  );

-- 3. marketing_categories: restrict UPDATE
DROP POLICY IF EXISTS "auth update marketing_categories" ON public.marketing_categories;
CREATE POLICY "marketing_categories_update_priv" ON public.marketing_categories
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = created_by
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_permission(auth.uid(), 'marketing', 'write')
  )
  WITH CHECK (
    auth.uid() = created_by
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_permission(auth.uid(), 'marketing', 'write')
  );

-- 4. marketing_contacts: restrict UPDATE
DROP POLICY IF EXISTS "auth update marketing_contacts" ON public.marketing_contacts;
CREATE POLICY "marketing_contacts_update_priv" ON public.marketing_contacts
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = created_by
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_permission(auth.uid(), 'marketing', 'write')
  )
  WITH CHECK (
    auth.uid() = created_by
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_permission(auth.uid(), 'marketing', 'write')
  );

-- 5. prod_notifications: only admins/coordinatori can target other users
DROP POLICY IF EXISTS "notif_insert_priv" ON public.prod_notifications;
CREATE POLICY "notif_insert_priv" ON public.prod_notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'coordinatore')
  );
