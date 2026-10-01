DROP POLICY IF EXISTS montaggi_planning_select_priv ON public.montaggi_planning;
CREATE POLICY montaggi_planning_select_priv ON public.montaggi_planning FOR SELECT TO authenticated
USING (public.is_approved(auth.uid()) OR public.has_role(auth.uid(), 'admin'::app_role));