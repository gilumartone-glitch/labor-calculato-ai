DROP POLICY IF EXISTS "porders_select_all" ON public.production_orders;
DROP POLICY IF EXISTS "psub_select_all" ON public.production_sub_orders;
DROP POLICY IF EXISTS "psub_cud_writer" ON public.production_sub_orders;
DROP POLICY IF EXISTS "checklist_select_all" ON public.production_sub_checklist;
DROP POLICY IF EXISTS "checklist_cud_writer" ON public.production_sub_checklist;

CREATE POLICY "porders_select_assigned_or_coordinator"
ON public.production_orders
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'coordinatore')
  OR EXISTS (
    SELECT 1
    FROM public.production_sub_orders ps
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE ps.order_id = production_orders.id
      AND ps.dept::text = ANY (p.settori::text[])
  )
);

CREATE POLICY "psub_select_assigned_or_coordinator"
ON public.production_sub_orders
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'coordinatore')
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND production_sub_orders.dept::text = ANY (p.settori::text[])
  )
);

CREATE POLICY "psub_cud_assigned_or_coordinator"
ON public.production_sub_orders
FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'coordinatore')
  OR (
    public.has_permission(auth.uid(), 'produzione', 'write')
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND production_sub_orders.dept::text = ANY (p.settori::text[])
    )
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'coordinatore')
  OR (
    public.has_permission(auth.uid(), 'produzione', 'write')
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND production_sub_orders.dept::text = ANY (p.settori::text[])
    )
  )
);

CREATE POLICY "checklist_select_assigned_or_coordinator"
ON public.production_sub_checklist
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'coordinatore')
  OR EXISTS (
    SELECT 1
    FROM public.production_sub_orders ps
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE ps.id = production_sub_checklist.sub_id
      AND ps.dept::text = ANY (p.settori::text[])
  )
);

CREATE POLICY "checklist_cud_assigned_or_coordinator"
ON public.production_sub_checklist
FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'coordinatore')
  OR (
    public.has_permission(auth.uid(), 'produzione', 'write')
    AND EXISTS (
      SELECT 1
      FROM public.production_sub_orders ps
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE ps.id = production_sub_checklist.sub_id
        AND ps.dept::text = ANY (p.settori::text[])
    )
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'coordinatore')
  OR (
    public.has_permission(auth.uid(), 'produzione', 'write')
    AND EXISTS (
      SELECT 1
      FROM public.production_sub_orders ps
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE ps.id = production_sub_checklist.sub_id
        AND ps.dept::text = ANY (p.settori::text[])
    )
  )
);