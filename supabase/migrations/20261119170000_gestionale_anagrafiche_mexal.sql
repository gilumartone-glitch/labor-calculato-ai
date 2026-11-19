-- =====================================================================
-- GESTIONALE · Fase 2b — Anagrafiche: campi per l'import completo da Mexal
-- Sola struttura. Modifica soltanto gest_anagrafiche (tabella del Gestionale).
-- =====================================================================

ALTER TABLE public.gest_anagrafiche
  ADD COLUMN senza_partita_iva    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN codice_pagamento     TEXT,
  ADD COLUMN banca_appoggio       TEXT,
  ADD COLUMN abi                  TEXT,
  ADD COLUMN cab                  TEXT,
  ADD COLUMN banca_presentazione  TEXT,
  ADD COLUMN codice_iva_esenzione TEXT,
  ADD COLUMN fido                 NUMERIC(14,2),
  ADD COLUMN origine              TEXT,          -- da dove arriva la scheda (es. 'mexal')
  ADD COLUMN dati_origine         JSONB,         -- tutti i campi del sistema di provenienza, così come erano
  ADD COLUMN importato_il         TIMESTAMPTZ;

COMMENT ON COLUMN public.gest_anagrafiche.dati_origine IS
  'Copia fedele di tutte le colonne dell''export di provenienza, valori originali inclusi i segnaposto.';

-- Nei dati reali la stessa partita IVA compare su più conti (cliente e fornitore,
-- più sedi, segnaposto): l'unicità passa dal codice conto, non dalla partita IVA.
DROP INDEX IF EXISTS public.gest_anagrafiche_piva_unica;
CREATE INDEX gest_anagrafiche_piva_idx ON public.gest_anagrafiche (partita_iva);

DROP INDEX IF EXISTS public.gest_anagrafiche_mexal_unico;
ALTER TABLE public.gest_anagrafiche ADD CONSTRAINT gest_anagrafiche_codice_mexal_key UNIQUE (codice_mexal);
