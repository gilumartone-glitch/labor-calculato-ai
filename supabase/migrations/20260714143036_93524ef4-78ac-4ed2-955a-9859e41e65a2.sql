-- Semplifica RLS: qualunque utente approvato può inviare progetti al Flow (created_by = se stesso)
DROP POLICY IF EXISTS porders_insert_writer ON public.production_orders;
CREATE POLICY porders_insert_approved
ON public.production_orders
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND public.is_approved(auth.uid())
);

DROP POLICY IF EXISTS psub_cud_flow_writer ON public.production_sub_orders;
CREATE POLICY psub_cud_approved
ON public.production_sub_orders
FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.is_approved(auth.uid())
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR (public.is_approved(auth.uid()) AND public.can_view_order(auth.uid(), order_id))
);

DROP POLICY IF EXISTS checklist_cud_flow_writer ON public.production_sub_checklist;
CREATE POLICY checklist_cud_approved
ON public.production_sub_checklist
FOR ALL
TO authenticated
USING (public.is_approved(auth.uid()))
WITH CHECK (public.is_approved(auth.uid()));

DROP POLICY IF EXISTS invres_cud_flow_writer ON public.inventory_reservations;
CREATE POLICY invres_cud_approved
ON public.inventory_reservations
FOR ALL
TO authenticated
USING (public.is_approved(auth.uid()))
WITH CHECK (reserved_by = auth.uid() AND public.is_approved(auth.uid()));

DROP POLICY IF EXISTS notif_insert_flow_writer ON public.prod_notifications;
CREATE POLICY notif_insert_approved
ON public.prod_notifications
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.is_approved(auth.uid())
);