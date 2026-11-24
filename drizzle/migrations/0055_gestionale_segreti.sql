-- =====================================================================
-- GESTIONALE — Chiavi dei servizi esterni (es. il servizio dei dati aziendali)
-- Sola struttura: una tabella nuova gest_. Il valore è cifrato; lo legge e lo scrive solo
-- la funzione sul server (service_role). Sicurezza per riga attiva e SENZA policy: è voluto,
-- nessun utente deve poter leggere o scrivere qui.
-- =====================================================================
CREATE TABLE public.gest_segreti (
  chiave          TEXT PRIMARY KEY,
  valore_cifrato  TEXT NOT NULL,
  aggiornato_il   TIMESTAMPTZ NOT NULL DEFAULT now(),
  aggiornato_da   UUID
);
REVOKE ALL ON public.gest_segreti FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.gest_segreti TO service_role;
ALTER TABLE public.gest_segreti ENABLE ROW LEVEL SECURITY;
