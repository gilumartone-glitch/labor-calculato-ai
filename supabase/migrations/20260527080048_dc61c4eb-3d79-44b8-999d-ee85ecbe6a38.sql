
CREATE TABLE public.contabilita_state_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL,
  data JSONB NOT NULL,
  created_by UUID,
  movements_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_contab_snap_key_time ON public.contabilita_state_snapshots (key, created_at DESC);

GRANT SELECT, INSERT, DELETE ON public.contabilita_state_snapshots TO authenticated;
GRANT ALL ON public.contabilita_state_snapshots TO service_role;

ALTER TABLE public.contabilita_state_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Contabilita users can view snapshots"
  ON public.contabilita_state_snapshots FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_permission(auth.uid(), 'contabilita'::text, 'read'::permission_level)
    OR public.has_permission(auth.uid(), 'contabilita'::text, 'write'::permission_level)
  );

CREATE POLICY "Contabilita writers can insert snapshots"
  ON public.contabilita_state_snapshots FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_permission(auth.uid(), 'contabilita'::text, 'write'::permission_level)
  );

CREATE POLICY "Admins can delete snapshots"
  ON public.contabilita_state_snapshots FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Funzione che crea uno snapshot della versione PRECEDENTE prima dell'update
CREATE OR REPLACE FUNCTION public.snapshot_contabilita_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  -- Conteggio movimenti per anteprima rapida
  BEGIN
    v_count := COALESCE(jsonb_array_length(OLD.data->'movements'), 0);
  EXCEPTION WHEN OTHERS THEN
    v_count := 0;
  END;

  INSERT INTO public.contabilita_state_snapshots (key, data, created_by, movements_count)
  VALUES (OLD.key, OLD.data, OLD.updated_by, v_count);

  -- Mantieni solo gli ultimi 50 snapshot per chiave
  DELETE FROM public.contabilita_state_snapshots s
  WHERE s.key = OLD.key
    AND s.id NOT IN (
      SELECT id FROM public.contabilita_state_snapshots
      WHERE key = OLD.key
      ORDER BY created_at DESC
      LIMIT 50
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_contabilita ON public.contabilita_state;
CREATE TRIGGER trg_snapshot_contabilita
BEFORE UPDATE ON public.contabilita_state
FOR EACH ROW
WHEN (OLD.data IS DISTINCT FROM NEW.data)
EXECUTE FUNCTION public.snapshot_contabilita_state();

-- Snapshot iniziale dello stato corrente, così c'è almeno una versione di partenza
INSERT INTO public.contabilita_state_snapshots (key, data, created_by, movements_count)
SELECT key, data, updated_by, COALESCE(jsonb_array_length(data->'movements'), 0)
FROM public.contabilita_state;
