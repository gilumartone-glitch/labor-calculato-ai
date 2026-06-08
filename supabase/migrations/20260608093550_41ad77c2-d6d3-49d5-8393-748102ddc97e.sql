
-- catalogs: restrict insert/update to flow write or admin
DROP POLICY IF EXISTS "auth insert catalogs" ON public.catalogs;
DROP POLICY IF EXISTS "auth update catalogs" ON public.catalogs;
CREATE POLICY "auth insert catalogs" ON public.catalogs
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'flow', 'write'));
CREATE POLICY "auth update catalogs" ON public.catalogs
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'flow', 'write'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'flow', 'write'));

-- commesse: restrict update
DROP POLICY IF EXISTS "auth update commesse" ON public.commesse;
CREATE POLICY "auth update commesse" ON public.commesse
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'flow', 'write'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'flow', 'write'));

-- marketing_activity_log: restrict insert/delete to marketing write or admin
DROP POLICY IF EXISTS "auth insert marketing_activity_log" ON public.marketing_activity_log;
DROP POLICY IF EXISTS "auth delete marketing_activity_log" ON public.marketing_activity_log;
CREATE POLICY "auth insert marketing_activity_log" ON public.marketing_activity_log
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by AND (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'marketing', 'write')));
CREATE POLICY "auth delete marketing_activity_log" ON public.marketing_activity_log
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'marketing', 'write'));

-- marketing_newsletters: add permission check on insert
DROP POLICY IF EXISTS "auth insert marketing_newsletters" ON public.marketing_newsletters;
CREATE POLICY "auth insert marketing_newsletters" ON public.marketing_newsletters
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by AND (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'marketing', 'write')));
