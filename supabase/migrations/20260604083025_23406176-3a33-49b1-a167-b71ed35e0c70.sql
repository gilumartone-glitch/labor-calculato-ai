-- 1) Add enum value
ALTER TYPE public.commessa_reparto ADD VALUE IF NOT EXISTS 'montaggi';

-- 2) responsabile flag su commessa_assegnatari
ALTER TABLE public.commessa_assegnatari
  ADD COLUMN IF NOT EXISTS responsabile boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS commessa_assegnatari_resp_unique
  ON public.commessa_assegnatari (commessa_id)
  WHERE responsabile;

-- 3) commessa_updates
CREATE TABLE IF NOT EXISTS public.commessa_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commessa_id uuid NOT NULL,
  author_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('nota','aggiornamento','completamento','richiesta_prolungamento','risposta_admin')),
  body text NOT NULL DEFAULT '',
  proposed_date date,
  status text CHECK (status IN ('pending','approvato','rifiutato')),
  decided_by uuid,
  decided_at timestamptz,
  parent_id uuid REFERENCES public.commessa_updates(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS commessa_updates_commessa_idx ON public.commessa_updates(commessa_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.commessa_updates TO authenticated;
GRANT ALL ON public.commessa_updates TO service_role;

ALTER TABLE public.commessa_updates ENABLE ROW LEVEL SECURITY;

-- SELECT: tutti gli autenticati
CREATE POLICY "updates_select_auth"
  ON public.commessa_updates FOR SELECT
  TO authenticated
  USING (true);

-- INSERT: autore = uid, e (assegnatario della commessa OR admin/coordinatore)
CREATE POLICY "updates_insert_priv"
  ON public.commessa_updates FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = author_id
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'coordinatore'::app_role)
      OR EXISTS (
        SELECT 1 FROM public.commessa_assegnatari ca
        WHERE ca.commessa_id = commessa_updates.commessa_id
          AND ca.user_id = auth.uid()
      )
    )
  );

-- UPDATE: autore o admin (per decisioni serve anche essere admin se cambia status)
CREATE POLICY "updates_update_self_or_admin"
  ON public.commessa_updates FOR UPDATE
  TO authenticated
  USING (auth.uid() = author_id OR public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (auth.uid() = author_id OR public.has_role(auth.uid(), 'admin'::app_role));

-- DELETE: autore o admin
CREATE POLICY "updates_delete_self_or_admin"
  ON public.commessa_updates FOR DELETE
  TO authenticated
  USING (auth.uid() = author_id OR public.has_role(auth.uid(), 'admin'::app_role));

-- trigger updated_at
DROP TRIGGER IF EXISTS commessa_updates_set_updated_at ON public.commessa_updates;
CREATE TRIGGER commessa_updates_set_updated_at
  BEFORE UPDATE ON public.commessa_updates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();