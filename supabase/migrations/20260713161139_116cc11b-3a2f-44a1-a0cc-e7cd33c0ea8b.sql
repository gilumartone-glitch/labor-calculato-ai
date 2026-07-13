DROP POLICY IF EXISTS psub_cud_assigned_or_coordinator ON public.production_sub_orders;
CREATE POLICY psub_cud_flow_writer
ON public.production_sub_orders
FOR ALL
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
  OR public.can_view_sub_order(auth.uid(), id)
  OR public.can_view_order(auth.uid(), order_id)
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
  OR public.can_view_order(auth.uid(), order_id)
);

DROP POLICY IF EXISTS notif_insert_priv ON public.prod_notifications;
CREATE POLICY notif_insert_flow_writer
ON public.prod_notifications
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'coordinatore'::public.app_role)
  OR (
    order_id IS NOT NULL
    AND (
      public.has_permission(auth.uid(), 'produzione'::text, 'write'::public.permission_level)
      OR public.has_permission(auth.uid(), 'preventivi'::text, 'write'::public.permission_level)
      OR public.has_permission(auth.uid(), 'progettazione'::text, 'write'::public.permission_level)
      OR public.has_permission(auth.uid(), 'flow'::text, 'write'::public.permission_level)
      OR public.has_permission(auth.uid(), 'falegnameria'::text, 'write'::public.permission_level)
      OR public.has_permission(auth.uid(), 'montaggi'::text, 'write'::public.permission_level)
    )
    AND public.can_view_order(auth.uid(), order_id)
  )
);

DROP POLICY IF EXISTS checklist_cud_assigned_or_coordinator ON public.production_sub_checklist;
CREATE POLICY checklist_cud_flow_writer
ON public.production_sub_checklist
FOR ALL
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
  OR EXISTS (
    SELECT 1
    FROM public.production_sub_orders ps
    WHERE ps.id = production_sub_checklist.sub_id
      AND public.can_view_sub_order(auth.uid(), ps.id)
  )
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
  OR EXISTS (
    SELECT 1
    FROM public.production_sub_orders ps
    WHERE ps.id = production_sub_checklist.sub_id
      AND public.can_view_sub_order(auth.uid(), ps.id)
  )
);

DROP POLICY IF EXISTS invres_cud_writer ON public.inventory_reservations;
CREATE POLICY invres_cud_flow_writer
ON public.inventory_reservations
FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'coordinatore'::public.app_role)
  OR public.has_permission(auth.uid(), 'produzione'::text, 'write'::public.permission_level)
  OR public.has_permission(auth.uid(), 'preventivi'::text, 'write'::public.permission_level)
  OR public.has_permission(auth.uid(), 'progettazione'::text, 'write'::public.permission_level)
  OR public.has_permission(auth.uid(), 'flow'::text, 'write'::public.permission_level)
  OR public.has_permission(auth.uid(), 'magazzino'::text, 'write'::public.permission_level)
)
WITH CHECK (
  reserved_by = auth.uid()
  AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'coordinatore'::public.app_role)
    OR public.has_permission(auth.uid(), 'produzione'::text, 'write'::public.permission_level)
    OR public.has_permission(auth.uid(), 'preventivi'::text, 'write'::public.permission_level)
    OR public.has_permission(auth.uid(), 'progettazione'::text, 'write'::public.permission_level)
    OR public.has_permission(auth.uid(), 'flow'::text, 'write'::public.permission_level)
    OR public.has_permission(auth.uid(), 'magazzino'::text, 'write'::public.permission_level)
  )
);