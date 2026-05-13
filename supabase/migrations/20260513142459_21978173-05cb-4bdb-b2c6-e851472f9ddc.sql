DROP POLICY IF EXISTS porders_select_assigned_or_coordinator ON public.production_orders;
CREATE POLICY porders_select_assigned_or_coordinator
ON public.production_orders
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'coordinatore'::app_role)
  OR auth.uid() = created_by
  OR EXISTS (
    SELECT 1
    FROM production_sub_orders ps
    JOIN profiles p ON p.id = auth.uid()
    WHERE ps.order_id = production_orders.id
      AND (ps.dept)::text = ANY ((p.settori)::text[])
  )
);