GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_orders TO authenticated;
GRANT ALL ON public.production_orders TO service_role;

DROP POLICY IF EXISTS porders_insert_approved ON public.production_orders;
CREATE POLICY porders_insert_flow_approved_writer
ON public.production_orders
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND (
    public.is_approved(auth.uid())
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'coordinatore'::public.app_role)
    OR public.has_permission(auth.uid(), 'flow'::text, 'write'::public.permission_level)
    OR public.has_permission(auth.uid(), 'produzione'::text, 'write'::public.permission_level)
    OR public.has_permission(auth.uid(), 'preventivi'::text, 'write'::public.permission_level)
    OR public.has_permission(auth.uid(), 'progettazione'::text, 'write'::public.permission_level)
  )
);