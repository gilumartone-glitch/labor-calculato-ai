
-- Estende le RLS su production_sub_orders e production_sub_checklist per allineare
-- gli utenti con write su preventivi/progettazione/flow/falegnameria/montaggi
-- ai poteri già concessi su production_orders (scelta operatori + scadenze in fase di invio al Flow).

DROP POLICY IF EXISTS psub_cud_assigned_or_coordinator ON public.production_sub_orders;
CREATE POLICY psub_cud_assigned_or_coordinator
ON public.production_sub_orders
FOR ALL
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (
    (
      has_permission(auth.uid(), 'produzione', 'write')
      OR has_permission(auth.uid(), 'preventivi', 'write')
      OR has_permission(auth.uid(), 'progettazione', 'write')
      OR has_permission(auth.uid(), 'flow', 'write')
      OR has_permission(auth.uid(), 'falegnameria', 'write')
      OR has_permission(auth.uid(), 'montaggi', 'write')
    )
    AND (
      assignee_id = auth.uid()
      OR auth.uid() = ANY (COALESCE(operator_ids, ARRAY[]::uuid[]))
      OR coordinator_id = auth.uid()
      OR can_view_order(auth.uid(), order_id)
    )
  )
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR (
    (
      has_permission(auth.uid(), 'produzione', 'write')
      OR has_permission(auth.uid(), 'preventivi', 'write')
      OR has_permission(auth.uid(), 'progettazione', 'write')
      OR has_permission(auth.uid(), 'flow', 'write')
      OR has_permission(auth.uid(), 'falegnameria', 'write')
      OR has_permission(auth.uid(), 'montaggi', 'write')
    )
    AND (
      assignee_id = auth.uid()
      OR auth.uid() = ANY (COALESCE(operator_ids, ARRAY[]::uuid[]))
      OR coordinator_id = auth.uid()
      OR can_view_order(auth.uid(), order_id)
    )
  )
);
