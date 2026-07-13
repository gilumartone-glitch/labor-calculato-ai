DROP POLICY IF EXISTS porders_insert_writer ON public.production_orders;

CREATE POLICY porders_insert_writer
ON public.production_orders
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = created_by
  AND (
    public.has_role(auth.uid(), 'admin')
    OR public.has_permission(auth.uid(), 'produzione', 'write')
    OR public.has_permission(auth.uid(), 'preventivi', 'write')
    OR public.has_permission(auth.uid(), 'progettazione', 'write')
    OR public.has_permission(auth.uid(), 'flow', 'write')
    OR public.has_permission(auth.uid(), 'falegnameria', 'write')
    OR public.has_permission(auth.uid(), 'montaggi', 'write')
  )
);