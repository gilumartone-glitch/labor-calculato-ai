-- =====================================================================
-- GESTIONALE — Caselle email da cui si spediscono i documenti
-- Sola struttura: due tabelle nuove gest_. Nessuna modifica a tabelle esistenti.
--   gest_caselle_email          indirizzo, nome, quali documenti può spedire, attiva sì/no
--   gest_caselle_email_segreti  la password della casella, cifrata: la legge e la scrive solo
--                               la funzione sul server (service_role). Nessun utente la vede.
-- Una casella non si cancella: si disattiva.
-- =====================================================================
CREATE TABLE public.gest_caselle_email (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  indirizzo  TEXT NOT NULL,
  nome       TEXT NOT NULL DEFAULT '',
  -- tipi di documento che la casella può spedire
  documenti  TEXT[] NOT NULL DEFAULT '{}',
  attiva     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gest_caselle_email_indirizzo_valido CHECK (indirizzo = lower(btrim(indirizzo)) AND indirizzo ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT gest_caselle_email_documenti_validi CHECK (documenti <@ ARRAY['preventivo','ordine','ddt','fattura','nota_credito','estratto_conto']::TEXT[])
);
CREATE UNIQUE INDEX gest_caselle_email_indirizzo_idx ON public.gest_caselle_email (indirizzo);

CREATE TRIGGER gest_caselle_email_updated_at BEFORE UPDATE ON public.gest_caselle_email
  FOR EACH ROW EXECUTE FUNCTION public.gest_fn_updated_at();
CREATE TRIGGER gest_caselle_email_storico AFTER INSERT OR UPDATE ON public.gest_caselle_email
  FOR EACH ROW EXECUTE FUNCTION public.gest_fn_storico();

CREATE TABLE public.gest_caselle_email_segreti (
  casella_id       UUID PRIMARY KEY REFERENCES public.gest_caselle_email(id),
  password_cifrata TEXT NOT NULL,
  aggiornata_il    TIMESTAMPTZ NOT NULL DEFAULT now(),
  aggiornata_da    UUID
);

-- Privilegi espliciti (prima delle policy)
REVOKE ALL ON public.gest_caselle_email FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.gest_caselle_email TO authenticated;
GRANT ALL ON public.gest_caselle_email TO service_role;
REVOKE ALL ON public.gest_caselle_email_segreti FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.gest_caselle_email_segreti TO service_role;

ALTER TABLE public.gest_caselle_email ENABLE ROW LEVEL SECURITY;
CREATE POLICY gest_caselle_email_select ON public.gest_caselle_email FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'gestionale', 'read'));
CREATE POLICY gest_caselle_email_insert ON public.gest_caselle_email FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY gest_caselle_email_update ON public.gest_caselle_email FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Senza policy: con la sicurezza per riga attiva nessun utente legge o scrive le password.
ALTER TABLE public.gest_caselle_email_segreti ENABLE ROW LEVEL SECURITY;
