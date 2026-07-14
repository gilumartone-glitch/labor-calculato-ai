-- Harden and broaden Flow launch policies so approved non-admin users can create
-- the parent production order and its child work orders in the same client flow.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_orders TO authenticated;
GRANT ALL ON public.production_orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_sub_orders TO authenticated;
GRANT ALL ON public.production_sub_orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prod_notifications TO authenticated;
GRANT ALL ON public.prod_notifications TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commessa_assegnatari TO authenticated;
GRANT ALL ON public.commessa_assegnatari TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.montaggi_planning TO authenticated;
GRANT ALL ON public.montaggi_planning TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.montaggi_assignment_items TO authenticated;
GRANT ALL ON public.montaggi_assignment_items TO service_role;

DROP POLICY IF EXISTS porders_insert_flow_approved_writer ON public.production_orders;
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

DROP POLICY IF EXISTS psub_cud_approved ON public.production_sub_orders;
CREATE POLICY psub_cud_approved
ON public.production_sub_orders
FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'coordinatore'::public.app_role)
  OR public.is_approved(auth.uid())
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR (
    public.is_approved(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.production_orders po
      WHERE po.id = production_sub_orders.order_id
        AND (
          po.created_by = auth.uid()
          OR po.coordinator_id = auth.uid()
          OR public.has_role(auth.uid(), 'coordinatore'::public.app_role)
          OR public.has_permission(auth.uid(), 'flow'::text, 'write'::public.permission_level)
          OR public.has_permission(auth.uid(), 'produzione'::text, 'write'::public.permission_level)
          OR public.has_permission(auth.uid(), 'preventivi'::text, 'write'::public.permission_level)
          OR public.has_permission(auth.uid(), 'progettazione'::text, 'write'::public.permission_level)
          OR public.has_permission(auth.uid(), 'falegnameria'::text, 'write'::public.permission_level)
          OR public.has_permission(auth.uid(), 'montaggi'::text, 'write'::public.permission_level)
        )
    )
  )
);
