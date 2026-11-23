-- =====================================================================
-- GESTIONALE — Registro delle email inviate dai documenti
-- Sola struttura, una tabella nuova gest_. Le righe le scrive solo la funzione
-- sul server che spedisce (gestionale-invia-email); nessuno le modifica o le cancella.
-- =====================================================================
CREATE TABLE public.gest_email_inviate (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  documento_id  UUID REFERENCES public.gest_documenti(id),
  -- tipo del documento spedito (preventivo, ordine, ddt, fattura, nota_credito) oppure 'estratto_conto'
  contesto      TEXT NOT NULL,
  anagrafica_id UUID REFERENCES public.gest_anagrafiche(id),
  mittente      TEXT NOT NULL,
  destinatari   TEXT[] NOT NULL,
  copia         TEXT[] NOT NULL DEFAULT '{}',
  oggetto       TEXT NOT NULL,
  testo         TEXT NOT NULL,
  allegato_nome TEXT,
  esito         TEXT NOT NULL CHECK (esito IN ('inviata','errore')),
  errore        TEXT,
  message_id    TEXT,
  inviata_da    UUID,
  creato_il     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX gest_email_inviate_documento_idx ON public.gest_email_inviate (documento_id);
CREATE INDEX gest_email_inviate_anagrafica_idx ON public.gest_email_inviate (anagrafica_id);

CREATE TRIGGER gest_email_inviate_immutabile BEFORE UPDATE OR DELETE ON public.gest_email_inviate
  FOR EACH ROW EXECUTE FUNCTION public.gest_fn_solo_inserimento();

GRANT SELECT ON public.gest_email_inviate TO authenticated;
GRANT ALL ON public.gest_email_inviate TO service_role;

ALTER TABLE public.gest_email_inviate ENABLE ROW LEVEL SECURITY;
CREATE POLICY gest_email_inviate_select ON public.gest_email_inviate FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'gestionale', 'read'));
