
-- Helper: can a user view a given order? (SECURITY DEFINER bypasses RLS, breaking recursion)
CREATE OR REPLACE FUNCTION public.can_view_order(_user_id uuid, _order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.production_orders o
    WHERE o.id = _order_id
      AND (o.created_by = _user_id OR o.coordinator_id = _user_id)
  )
  OR EXISTS (
    SELECT 1 FROM public.production_sub_orders s
    WHERE s.order_id = _order_id
      AND (
        s.assignee_id = _user_id
        OR _user_id = ANY(COALESCE(s.operator_ids, ARRAY[]::uuid[]))
        OR s.coordinator_id = _user_id
      )
  )
$$;

DROP POLICY IF EXISTS porders_select_assigned_or_coordinator ON public.production_orders;
CREATE POLICY porders_select_assigned_or_coordinator
ON public.production_orders FOR SELECT
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.can_view_order(auth.uid(), id)
);

DROP POLICY IF EXISTS psub_select_assigned_or_coordinator ON public.production_sub_orders;
CREATE POLICY psub_select_assigned_or_coordinator
ON public.production_sub_orders FOR SELECT
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR assignee_id = auth.uid()
  OR auth.uid() = ANY(COALESCE(operator_ids, ARRAY[]::uuid[]))
  OR coordinator_id = auth.uid()
  OR public.can_view_order(auth.uid(), order_id)
);

DROP POLICY IF EXISTS psub_cud_assigned_or_coordinator ON public.production_sub_orders;
CREATE POLICY psub_cud_assigned_or_coordinator
ON public.production_sub_orders FOR ALL
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR (
    public.has_permission(auth.uid(), 'produzione'::text, 'write'::permission_level)
    AND (
      assignee_id = auth.uid()
      OR auth.uid() = ANY(COALESCE(operator_ids, ARRAY[]::uuid[]))
      OR coordinator_id = auth.uid()
      OR public.can_view_order(auth.uid(), order_id)
    )
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR (
    public.has_permission(auth.uid(), 'produzione'::text, 'write'::permission_level)
    AND (
      assignee_id = auth.uid()
      OR auth.uid() = ANY(COALESCE(operator_ids, ARRAY[]::uuid[]))
      OR coordinator_id = auth.uid()
      OR public.can_view_order(auth.uid(), order_id)
    )
  )
);
