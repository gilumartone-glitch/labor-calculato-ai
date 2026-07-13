DROP POLICY IF EXISTS porders_insert_writer ON public.production_orders;
CREATE POLICY porders_insert_writer
ON public.production_orders
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'coordinatore'::public.app_role)
    OR public.has_permission(auth.uid(), 'produzione'::text, 'write'::public.permission_level)
    OR public.has_permission(auth.uid(), 'preventivi'::text, 'write'::public.permission_level)
    OR public.has_permission(auth.uid(), 'progettazione'::text, 'write'::public.permission_level)
    OR public.has_permission(auth.uid(), 'flow'::text, 'write'::public.permission_level)
    OR public.has_permission(auth.uid(), 'falegnameria'::text, 'write'::public.permission_level)
    OR public.has_permission(auth.uid(), 'montaggi'::text, 'write'::public.permission_level)
  )
);

DROP POLICY IF EXISTS porders_update_writer ON public.production_orders;
CREATE POLICY porders_update_flow_writer
ON public.production_orders
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'coordinatore'::public.app_role)
  OR public.has_permission(auth.uid(), 'produzione'::text, 'write'::public.permission_level)
  OR public.has_permission(auth.uid(), 'preventivi'::text, 'write'::public.permission_level)
  OR public.has_permission(auth.uid(), 'progettazione'::text, 'write'::public.permission_level)
  OR public.has_permission(auth.uid(), 'flow'::text, 'write'::public.permission_level)
  OR public.has_permission(auth.uid(), 'falegnameria'::text, 'write'::public.permission_level)
  OR public.has_permission(auth.uid(), 'montaggi'::text, 'write'::public.permission_level)
  OR public.can_view_order(auth.uid(), id)
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'coordinatore'::public.app_role)
  OR public.has_permission(auth.uid(), 'produzione'::text, 'write'::public.permission_level)
  OR public.has_permission(auth.uid(), 'preventivi'::text, 'write'::public.permission_level)
  OR public.has_permission(auth.uid(), 'progettazione'::text, 'write'::public.permission_level)
  OR public.has_permission(auth.uid(), 'flow'::text, 'write'::public.permission_level)
  OR public.has_permission(auth.uid(), 'falegnameria'::text, 'write'::public.permission_level)
  OR public.has_permission(auth.uid(), 'montaggi'::text, 'write'::public.permission_level)
);