ALTER TABLE public.contabilita_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view contabilita state" ON public.contabilita_state;
DROP POLICY IF EXISTS "Writers can insert contabilita state" ON public.contabilita_state;
DROP POLICY IF EXISTS "Writers can update contabilita state" ON public.contabilita_state;
DROP POLICY IF EXISTS "Admins can delete contabilita state" ON public.contabilita_state;

CREATE POLICY "Contabilita users can view shared state"
ON public.contabilita_state
FOR SELECT
TO authenticated
USING (
  public.has_permission(auth.uid(), 'contabilita', 'read')
  OR public.has_permission(auth.uid(), 'contabilita', 'write')
);

CREATE POLICY "Contabilita users can create shared state"
ON public.contabilita_state
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_permission(auth.uid(), 'contabilita', 'read')
  OR public.has_permission(auth.uid(), 'contabilita', 'write')
);

CREATE POLICY "Contabilita users can update shared state"
ON public.contabilita_state
FOR UPDATE
TO authenticated
USING (
  public.has_permission(auth.uid(), 'contabilita', 'read')
  OR public.has_permission(auth.uid(), 'contabilita', 'write')
)
WITH CHECK (
  public.has_permission(auth.uid(), 'contabilita', 'read')
  OR public.has_permission(auth.uid(), 'contabilita', 'write')
);

CREATE POLICY "Admins can delete shared contabilita state"
ON public.contabilita_state
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication p
    JOIN pg_publication_rel pr ON p.oid = pr.prpubid
    JOIN pg_class c ON c.oid = pr.prrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE p.pubname = 'supabase_realtime'
      AND n.nspname = 'public'
      AND c.relname = 'contabilita_state'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.contabilita_state;
  END IF;
END $$;

ALTER TABLE public.contabilita_state REPLICA IDENTITY FULL;