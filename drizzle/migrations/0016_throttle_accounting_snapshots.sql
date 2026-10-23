CREATE OR REPLACE FUNCTION public.snapshot_contabilita_state()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_count INTEGER := 0;
BEGIN
  -- Al massimo una copia di sicurezza ogni 10 minuti per chiave: i salvataggi restano veloci.
  IF EXISTS (SELECT 1 FROM public.contabilita_state_snapshots s WHERE s.key = OLD.key AND s.created_at > now() - interval '10 minutes') THEN
    RETURN NEW;
  END IF;
  BEGIN v_count := COALESCE(jsonb_array_length(OLD.data->'movements'), 0); EXCEPTION WHEN OTHERS THEN v_count := 0; END;
  INSERT INTO public.contabilita_state_snapshots (key, data, created_by, movements_count) VALUES (OLD.key, OLD.data, OLD.updated_by, v_count);
  DELETE FROM public.contabilita_state_snapshots s WHERE s.key = OLD.key AND s.id NOT IN (
    SELECT id FROM public.contabilita_state_snapshots WHERE key = OLD.key ORDER BY created_at DESC LIMIT 50);
  RETURN NEW;
END; $function$;
CREATE INDEX IF NOT EXISTS contabilita_state_snapshots_key_created_idx ON public.contabilita_state_snapshots (key, created_at DESC);