
-- 1. Aggiungi coordinator_id su ordini e sub-ordini
ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS coordinator_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.production_sub_orders
  ADD COLUMN IF NOT EXISTS coordinator_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_porders_coordinator ON public.production_orders(coordinator_id);
CREATE INDEX IF NOT EXISTS idx_psub_coordinator ON public.production_sub_orders(coordinator_id);
CREATE INDEX IF NOT EXISTS idx_psub_assignee ON public.production_sub_orders(assignee_id);
CREATE INDEX IF NOT EXISTS idx_psub_operator_ids ON public.production_sub_orders USING GIN(operator_ids);

-- 2. Backfill: coordinator = created_by per ordini esistenti
UPDATE public.production_orders
SET coordinator_id = created_by
WHERE coordinator_id IS NULL AND created_by IS NOT NULL;

-- 3. Helper SECURITY DEFINER: l'utente può vedere il sub-ordine?
CREATE OR REPLACE FUNCTION public.can_view_sub_order(_user_id uuid, _sub_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.production_sub_orders s
    LEFT JOIN public.production_orders o ON o.id = s.order_id
    WHERE s.id = _sub_id
      AND (
        s.assignee_id = _user_id
        OR _user_id = ANY(COALESCE(s.operator_ids, ARRAY[]::uuid[]))
        OR s.coordinator_id = _user_id
        OR o.coordinator_id = _user_id
        OR o.created_by = _user_id
      )
  )
$$;

-- 4. Helper: l'utente è coordinatore del progetto (ordine o sub)?
CREATE OR REPLACE FUNCTION public.is_project_coordinator(_user_id uuid, _sub_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.production_sub_orders s
    LEFT JOIN public.production_orders o ON o.id = s.order_id
    WHERE s.id = _sub_id
      AND (s.coordinator_id = _user_id OR o.coordinator_id = _user_id)
  )
$$;

-- 5. Sostituisci policy SELECT su production_sub_orders
DROP POLICY IF EXISTS psub_select_assigned_or_coordinator ON public.production_sub_orders;

CREATE POLICY psub_select_assigned_or_coordinator
ON public.production_sub_orders
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR assignee_id = auth.uid()
  OR auth.uid() = ANY(COALESCE(operator_ids, ARRAY[]::uuid[]))
  OR coordinator_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.production_orders o
    WHERE o.id = production_sub_orders.order_id
      AND (o.coordinator_id = auth.uid() OR o.created_by = auth.uid())
  )
);

-- 6. Sostituisci policy CUD su production_sub_orders
DROP POLICY IF EXISTS psub_cud_assigned_or_coordinator ON public.production_sub_orders;

CREATE POLICY psub_cud_assigned_or_coordinator
ON public.production_sub_orders
FOR ALL
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (
    has_permission(auth.uid(), 'produzione'::text, 'write'::permission_level)
    AND (
      assignee_id = auth.uid()
      OR auth.uid() = ANY(COALESCE(operator_ids, ARRAY[]::uuid[]))
      OR coordinator_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.production_orders o
        WHERE o.id = production_sub_orders.order_id
          AND (o.coordinator_id = auth.uid() OR o.created_by = auth.uid())
      )
    )
  )
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR (
    has_permission(auth.uid(), 'produzione'::text, 'write'::permission_level)
    AND (
      assignee_id = auth.uid()
      OR auth.uid() = ANY(COALESCE(operator_ids, ARRAY[]::uuid[]))
      OR coordinator_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.production_orders o
        WHERE o.id = production_sub_orders.order_id
          AND (o.coordinator_id = auth.uid() OR o.created_by = auth.uid())
      )
    )
  )
);

-- 7. Sostituisci policy SELECT su production_orders
DROP POLICY IF EXISTS porders_select_assigned_or_coordinator ON public.production_orders;

CREATE POLICY porders_select_assigned_or_coordinator
ON public.production_orders
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR created_by = auth.uid()
  OR coordinator_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.production_sub_orders s
    WHERE s.order_id = production_orders.id
      AND (
        s.assignee_id = auth.uid()
        OR auth.uid() = ANY(COALESCE(s.operator_ids, ARRAY[]::uuid[]))
        OR s.coordinator_id = auth.uid()
      )
  )
);
