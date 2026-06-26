DROP POLICY IF EXISTS notif_insert_priv ON public.prod_notifications;
CREATE POLICY notif_insert_priv ON public.prod_notifications
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  OR has_role(auth.uid(), 'admin'::app_role)
  OR (
    has_role(auth.uid(), 'coordinatore'::app_role)
    AND (
      (order_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM production_orders po
        WHERE po.id = prod_notifications.order_id
          AND (po.created_by = prod_notifications.user_id
               OR EXISTS (SELECT 1 FROM production_sub_orders ps
                          WHERE ps.order_id = po.id AND ps.assignee_id = prod_notifications.user_id))
      ))
      OR EXISTS (
        SELECT 1 FROM commessa_assegnatari ca
        WHERE ca.user_id = prod_notifications.user_id
          AND EXISTS (SELECT 1 FROM commessa_assegnatari ca2
                      WHERE ca2.commessa_id = ca.commessa_id AND ca2.user_id = auth.uid())
      )
    )
  )
  -- Permetti al creatore di un ordine di produzione di notificare
  -- gli assegnatari / operatori dei sub-ordini di quell'ordine
  OR (
    order_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM production_orders po
      WHERE po.id = prod_notifications.order_id
        AND po.created_by = auth.uid()
        AND (
          po.coordinator_id = prod_notifications.user_id
          OR EXISTS (
            SELECT 1 FROM production_sub_orders ps
            WHERE ps.order_id = po.id
              AND (
                ps.assignee_id = prod_notifications.user_id
                OR ps.coordinator_id = prod_notifications.user_id
                OR prod_notifications.user_id = ANY(COALESCE(ps.operator_ids, ARRAY[]::uuid[]))
              )
          )
        )
    )
  )
);