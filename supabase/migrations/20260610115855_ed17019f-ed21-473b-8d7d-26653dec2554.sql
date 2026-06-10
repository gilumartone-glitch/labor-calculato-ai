
DROP POLICY IF EXISTS dipendenti_select_priv ON public.dipendenti;
CREATE POLICY dipendenti_select_priv ON public.dipendenti
FOR SELECT TO authenticated
USING (
  profile_id = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_permission(auth.uid(), 'flow'::text, 'read'::permission_level)
  OR has_permission(auth.uid(), 'flow'::text, 'write'::permission_level)
  OR has_permission(auth.uid(), 'dipendenti'::text, 'read'::permission_level)
  OR has_permission(auth.uid(), 'dipendenti'::text, 'write'::permission_level)
);

DROP POLICY IF EXISTS montaggi_planning_select_auth ON public.montaggi_planning;
CREATE POLICY montaggi_planning_select_priv ON public.montaggi_planning
FOR SELECT TO authenticated
USING (
  auth.uid() = created_by
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'coordinatore'::app_role)
  OR has_permission(auth.uid(), 'flow'::text, 'read'::permission_level)
  OR has_permission(auth.uid(), 'flow'::text, 'write'::permission_level)
  OR has_permission(auth.uid(), 'produzione'::text, 'read'::permission_level)
  OR has_permission(auth.uid(), 'produzione'::text, 'write'::permission_level)
  OR has_permission(auth.uid(), 'montaggi'::text, 'read'::permission_level)
  OR has_permission(auth.uid(), 'montaggi'::text, 'write'::permission_level)
);
