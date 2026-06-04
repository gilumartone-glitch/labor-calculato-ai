
-- 1) dipendenti: restrict SELECT
DROP POLICY IF EXISTS "dipendenti_select_auth" ON public.dipendenti;
CREATE POLICY "dipendenti_select_priv" ON public.dipendenti
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_permission(auth.uid(), 'flow'::text, 'read'::permission_level)
    OR has_permission(auth.uid(), 'flow'::text, 'write'::permission_level)
    OR has_permission(auth.uid(), 'dipendenti'::text, 'read'::permission_level)
    OR has_permission(auth.uid(), 'dipendenti'::text, 'write'::permission_level)
    OR profile_id = auth.uid()
  );

-- 2) marketing_contact_categories: restrict write/manage
DROP POLICY IF EXISTS "auth manage marketing_contact_categories" ON public.marketing_contact_categories;
DROP POLICY IF EXISTS "auth view marketing_contact_categories" ON public.marketing_contact_categories;

CREATE POLICY "mcc_select_marketing" ON public.marketing_contact_categories
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_permission(auth.uid(), 'marketing'::text, 'read'::permission_level)
    OR has_permission(auth.uid(), 'marketing'::text, 'write'::permission_level)
  );

CREATE POLICY "mcc_write_marketing" ON public.marketing_contact_categories
  FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_permission(auth.uid(), 'marketing'::text, 'write'::permission_level)
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_permission(auth.uid(), 'marketing'::text, 'write'::permission_level)
  );

-- 3) prod_chat_channels: restrict to production users
DROP POLICY IF EXISTS "chan_select_all" ON public.prod_chat_channels;
DROP POLICY IF EXISTS "chan_insert_auth" ON public.prod_chat_channels;
DROP POLICY IF EXISTS "chan_update_member_admin" ON public.prod_chat_channels;
DROP POLICY IF EXISTS "chan_delete_admin" ON public.prod_chat_channels;

CREATE POLICY "chan_select_prod" ON public.prod_chat_channels
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'coordinatore'::app_role)
    OR has_permission(auth.uid(), 'produzione'::text, 'read'::permission_level)
    OR has_permission(auth.uid(), 'produzione'::text, 'write'::permission_level)
  );

CREATE POLICY "chan_insert_prod" ON public.prod_chat_channels
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'coordinatore'::app_role)
    OR has_permission(auth.uid(), 'produzione'::text, 'write'::permission_level)
  );

CREATE POLICY "chan_update_prod" ON public.prod_chat_channels
  FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'coordinatore'::app_role)
    OR has_permission(auth.uid(), 'produzione'::text, 'write'::permission_level)
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'coordinatore'::app_role)
    OR has_permission(auth.uid(), 'produzione'::text, 'write'::permission_level)
  );

CREATE POLICY "chan_delete_admin" ON public.prod_chat_channels
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 4) prod_chat_messages: restrict SELECT/INSERT to production users
DROP POLICY IF EXISTS "msg_select_all" ON public.prod_chat_messages;
DROP POLICY IF EXISTS "msg_insert_self" ON public.prod_chat_messages;

CREATE POLICY "msg_select_prod" ON public.prod_chat_messages
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'coordinatore'::app_role)
    OR has_permission(auth.uid(), 'produzione'::text, 'read'::permission_level)
    OR has_permission(auth.uid(), 'produzione'::text, 'write'::permission_level)
  );

CREATE POLICY "msg_insert_prod" ON public.prod_chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'coordinatore'::app_role)
      OR has_permission(auth.uid(), 'produzione'::text, 'write'::permission_level)
    )
  );
