DROP POLICY IF EXISTS porders_select_assigned_or_coordinator ON public.production_orders;
DROP POLICY IF EXISTS porders_insert_flow_approved_writer ON public.production_orders;
DROP POLICY IF EXISTS porders_update_flow_writer ON public.production_orders;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_orders TO authenticated;
GRANT ALL ON public.production_orders TO service_role;

CREATE POLICY porders_select_assigned_or_coordinator
ON public.production_orders
FOR SELECT
TO authenticated
USING (
  created_by = auth.uid()
  OR coordinator_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'coordinatore'::public.app_role)
  OR public.has_permission(auth.uid(), 'flow'::text, 'write'::public.permission_level)
  OR public.has_permission(auth.uid(), 'produzione'::text, 'write'::public.permission_level)
  OR public.has_permission(auth.uid(), 'preventivi'::text, 'write'::public.permission_level)
  OR public.has_permission(auth.uid(), 'progettazione'::text, 'write'::public.permission_level)
  OR public.has_permission(auth.uid(), 'falegnameria'::text, 'write'::public.permission_level)
  OR public.has_permission(auth.uid(), 'montaggi'::text, 'write'::public.permission_level)
  OR public.can_view_order(auth.uid(), id)
);

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
    OR public.has_permission(auth.uid(), 'falegnameria'::text, 'write'::public.permission_level)
    OR public.has_permission(auth.uid(), 'montaggi'::text, 'write'::public.permission_level)
  )
  AND (coordinator_id IS NULL OR coordinator_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'coordinatore'::public.app_role))
);

CREATE POLICY porders_update_flow_writer
ON public.production_orders
FOR UPDATE
TO authenticated
USING (
  created_by = auth.uid()
  OR coordinator_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
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
  created_by = auth.uid()
  OR coordinator_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'coordinatore'::public.app_role)
  OR public.has_permission(auth.uid(), 'produzione'::text, 'write'::public.permission_level)
  OR public.has_permission(auth.uid(), 'preventivi'::text, 'write'::public.permission_level)
  OR public.has_permission(auth.uid(), 'progettazione'::text, 'write'::public.permission_level)
  OR public.has_permission(auth.uid(), 'flow'::text, 'write'::public.permission_level)
  OR public.has_permission(auth.uid(), 'falegnameria'::text, 'write'::public.permission_level)
  OR public.has_permission(auth.uid(), 'montaggi'::text, 'write'::public.permission_level)
);