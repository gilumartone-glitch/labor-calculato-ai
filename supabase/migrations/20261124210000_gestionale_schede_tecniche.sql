-- =====================================================================
-- GESTIONALE — Scheda tecnica (disegno e lavorazioni) sulle righe dei documenti
-- Una colonna nuova su gest_documenti_righe e un trigger che la porta da un documento
-- al successivo. Nessun'altra tabella o funzione viene modificata.
--   schede_tecniche: fotografia dei pezzi di Progettazione (misure, forma, lati lavorati, lavorazioni).
--   Quando una riga nasce da un'altra (preventivo -> conferma d'ordine -> DDT -> fattura) eredita la scheda.
-- =====================================================================
ALTER TABLE public.gest_documenti_righe
  ADD COLUMN schede_tecniche JSONB
  CONSTRAINT gest_documenti_righe_schede_elenco CHECK (schede_tecniche IS NULL OR jsonb_typeof(schede_tecniche) = 'array');

CREATE FUNCTION public.gest_fn_riga_eredita_schede() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.schede_tecniche IS NULL AND NEW.riga_origine_id IS NOT NULL THEN
    SELECT r.schede_tecniche INTO NEW.schede_tecniche FROM public.gest_documenti_righe r WHERE r.id = NEW.riga_origine_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.gest_fn_riga_eredita_schede() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER gest_documenti_righe_eredita_schede BEFORE INSERT ON public.gest_documenti_righe
  FOR EACH ROW EXECUTE FUNCTION public.gest_fn_riga_eredita_schede();
