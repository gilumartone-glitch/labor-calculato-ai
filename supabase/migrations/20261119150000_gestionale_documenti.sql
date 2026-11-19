-- =====================================================================
-- GESTIONALE · Fase 2 — Documenti
-- Anagrafiche clienti/fornitori, aliquote IVA, numeratori e documenti:
-- preventivo, ordine/proforma, DDT, fattura, nota di credito,
-- bolla di carico, fattura fornitore.
--
-- Solo oggetti nuovi con prefisso gest_. Le uniche modifiche a oggetti
-- esistenti riguardano gest_storico e gest_fn_storico (fase 1), per
-- registrare nello storico anche le righe eliminate da una bozza.
-- =====================================================================

-- 1. Storico: registra anche le cancellazioni (righe di bozza) ---------
ALTER TABLE public.gest_storico DROP CONSTRAINT IF EXISTS gest_storico_operazione_check;
ALTER TABLE public.gest_storico ADD CONSTRAINT gest_storico_operazione_check
  CHECK (operazione IN ('INSERT','UPDATE','DELETE'));

CREATE OR REPLACE FUNCTION public.gest_fn_storico() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.gest_storico (tabella, record_id, operazione, utente, dopo)
    VALUES (TG_TABLE_NAME, NEW.id::text, TG_OP, auth.uid(), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
      INSERT INTO public.gest_storico (tabella, record_id, operazione, utente, prima, dopo)
      VALUES (TG_TABLE_NAME, NEW.id::text, TG_OP, auth.uid(), to_jsonb(OLD), to_jsonb(NEW));
    END IF;
    RETURN NEW;
  ELSE
    INSERT INTO public.gest_storico (tabella, record_id, operazione, utente, prima)
    VALUES (TG_TABLE_NAME, OLD.id::text, TG_OP, auth.uid(), to_jsonb(OLD));
    RETURN OLD;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.gest_fn_storico() FROM PUBLIC, anon, authenticated;

-- 2. Impostazioni e tabelle fiscali (dati, non codice) -----------------
CREATE TABLE public.gest_impostazioni (
  chiave      TEXT PRIMARY KEY,
  valore      TEXT NOT NULL,
  descrizione TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- I valori iniziali (data di attivazione fatture) si inseriscono a parte: questa migrazione crea solo la struttura.

CREATE TABLE public.gest_aliquote_iva (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codice        TEXT NOT NULL UNIQUE,
  descrizione   TEXT NOT NULL,
  percentuale   NUMERIC(5,2) NOT NULL CHECK (percentuale >= 0 AND percentuale <= 100),
  natura        TEXT,          -- codice natura FatturaPA per le operazioni senza IVA (N1…N7)
  valido_dal    DATE,
  valido_al     DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  archiviato_il TIMESTAMPTZ
);
-- Le aliquote iniziali (22, 10, 4) si inseriscono a parte.

-- 3. Anagrafiche clienti e fornitori -----------------------------------
CREATE SEQUENCE public.gest_anagrafiche_codice_seq START 1;

CREATE TABLE public.gest_anagrafiche (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codice          TEXT NOT NULL UNIQUE,
  is_cliente      BOOLEAN NOT NULL DEFAULT true,
  is_fornitore    BOOLEAN NOT NULL DEFAULT false,
  ragione_sociale TEXT NOT NULL,
  partita_iva     TEXT,
  codice_fiscale  TEXT,
  codice_sdi      TEXT,
  pec             TEXT,
  email           TEXT,
  telefono        TEXT,
  indirizzo       TEXT,
  cap             TEXT,
  citta           TEXT,
  provincia       TEXT,
  nazione         TEXT NOT NULL DEFAULT 'IT',
  pagamento       TEXT,          -- condizioni di pagamento abituali
  codice_mexal    TEXT,          -- codice conto nel sistema precedente, per l'import
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  archiviato_il   TIMESTAMPTZ,
  CONSTRAINT gest_anagrafiche_ruolo CHECK (is_cliente OR is_fornitore)
);
CREATE UNIQUE INDEX gest_anagrafiche_piva_unica ON public.gest_anagrafiche (partita_iva)
  WHERE partita_iva IS NOT NULL AND archiviato_il IS NULL;
CREATE UNIQUE INDEX gest_anagrafiche_mexal_unico ON public.gest_anagrafiche (codice_mexal)
  WHERE codice_mexal IS NOT NULL;
CREATE INDEX gest_anagrafiche_nome_idx ON public.gest_anagrafiche (lower(ragione_sociale));

CREATE FUNCTION public.gest_fn_anagrafica_codice() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.codice IS NULL OR btrim(NEW.codice) = '' THEN
    NEW.codice := 'AN' || lpad(nextval('public.gest_anagrafiche_codice_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gest_anagrafiche_codice BEFORE INSERT ON public.gest_anagrafiche
  FOR EACH ROW EXECUTE FUNCTION public.gest_fn_anagrafica_codice();

-- 4. Numeratori (li muove solo la conferma dei documenti) --------------
CREATE TABLE public.gest_numeratori (
  tipo   TEXT    NOT NULL,
  anno   INTEGER NOT NULL,
  serie  TEXT    NOT NULL DEFAULT '',
  ultimo INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tipo, anno, serie)
);

-- 5. Documenti ---------------------------------------------------------
CREATE TABLE public.gest_documenti (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo                TEXT NOT NULL CHECK (tipo IN
                        ('preventivo','ordine','ddt','fattura','nota_credito','bolla_carico','fattura_fornitore')),
  stato               TEXT NOT NULL DEFAULT 'bozza' CHECK (stato IN ('bozza','confermato','annullato')),
  numero              INTEGER,
  anno                INTEGER,
  serie               TEXT NOT NULL DEFAULT '',
  data                DATE NOT NULL DEFAULT CURRENT_DATE,
  anagrafica_id       UUID REFERENCES public.gest_anagrafiche(id),
  intestatario        JSONB,       -- fotografia dell'anagrafica al momento della conferma
  oggetto             TEXT,
  riferimento_esterno TEXT,        -- rif. ordine cliente, oppure numero del documento del fornitore
  data_esterna        DATE,        -- data del documento del fornitore
  pagamento           TEXT,
  validita_giorni     INTEGER,     -- preventivo
  consegna_prevista   DATE,        -- ordine
  destinazione        TEXT,        -- DDT: luogo di destinazione se diverso dalla sede
  causale_trasporto   TEXT,
  aspetto_beni        TEXT,
  colli               INTEGER,
  peso_kg             NUMERIC(10,2),
  vettore             TEXT,
  porto               TEXT,
  note                TEXT,        -- stampate sul documento
  note_interne        TEXT,        -- non stampate
  origine_id          UUID REFERENCES public.gest_documenti(id),
  design_draft_id     UUID,        -- scheda di Progettazione da cui nasce (se presente)
  imponibile          NUMERIC(14,2) NOT NULL DEFAULT 0,
  imposta             NUMERIC(14,2) NOT NULL DEFAULT 0,
  totale              NUMERIC(14,2) NOT NULL DEFAULT 0,
  creato_da           UUID DEFAULT auth.uid(),
  confermato_il       TIMESTAMPTZ,
  confermato_da       UUID,
  annullato_il        TIMESTAMPTZ,
  motivo_annullamento TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gest_documenti_numero_coerente
    CHECK ((numero IS NULL) = (stato = 'bozza' OR (stato = 'annullato' AND confermato_il IS NULL)))
);
CREATE UNIQUE INDEX gest_documenti_numero_unico ON public.gest_documenti (tipo, anno, serie, numero)
  WHERE numero IS NOT NULL;
CREATE INDEX gest_documenti_elenco_idx ON public.gest_documenti (tipo, data DESC);
CREATE INDEX gest_documenti_anagrafica_idx ON public.gest_documenti (anagrafica_id);
CREATE INDEX gest_documenti_origine_idx ON public.gest_documenti (origine_id);

CREATE TABLE public.gest_documenti_righe (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id    UUID NOT NULL REFERENCES public.gest_documenti(id),
  posizione       INTEGER NOT NULL DEFAULT 0,
  tipo_riga       TEXT NOT NULL DEFAULT 'libera' CHECK (tipo_riga IN ('articolo','lavorazione','libera','nota')),
  variante_id     UUID REFERENCES public.gest_varianti(id),
  codice          TEXT,
  descrizione     TEXT NOT NULL,
  dettagli        TEXT,           -- specifiche della lavorazione
  um              TEXT,
  quantita        NUMERIC(12,3) NOT NULL DEFAULT 1,
  prezzo_unitario NUMERIC(14,4) NOT NULL DEFAULT 0,
  sconto_pct      NUMERIC(5,2)  NOT NULL DEFAULT 0 CHECK (sconto_pct >= 0 AND sconto_pct <= 100),
  aliquota_id     UUID REFERENCES public.gest_aliquote_iva(id),
  importo         NUMERIC(14,2) NOT NULL DEFAULT 0,   -- calcolato
  riga_origine_id UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX gest_documenti_righe_doc_idx ON public.gest_documenti_righe (documento_id, posizione);

-- 6. Regole sui documenti ----------------------------------------------
-- Stato, numero e intestatario li cambiano solo le funzioni di conferma e
-- annullamento. Un documento non più in bozza non si modifica.
CREATE FUNCTION public.gest_fn_documento_guardia() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _sistema BOOLEAN := COALESCE(current_setting('gest.sistema', true), '') = '1';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT _sistema THEN
      NEW.stato := 'bozza';
      NEW.numero := NULL;
      NEW.anno := NULL;
      NEW.intestatario := NULL;
      NEW.confermato_il := NULL;
      NEW.confermato_da := NULL;
      NEW.annullato_il := NULL;
      NEW.motivo_annullamento := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.tipo IS DISTINCT FROM OLD.tipo THEN
    RAISE EXCEPTION 'Il tipo di un documento non può essere cambiato.';
  END IF;
  IF _sistema THEN
    RETURN NEW;
  END IF;
  IF OLD.stato <> 'bozza' THEN
    RAISE EXCEPTION 'Il documento è % e non può essere modificato.', OLD.stato;
  END IF;
  IF (NEW.stato, NEW.numero, NEW.anno, NEW.serie, NEW.intestatario, NEW.confermato_il, NEW.confermato_da,
      NEW.annullato_il, NEW.motivo_annullamento, NEW.origine_id, NEW.creato_da)
     IS DISTINCT FROM
     (OLD.stato, OLD.numero, OLD.anno, OLD.serie, OLD.intestatario, OLD.confermato_il, OLD.confermato_da,
      OLD.annullato_il, OLD.motivo_annullamento, OLD.origine_id, OLD.creato_da) THEN
    RAISE EXCEPTION 'Stato e numerazione si cambiano solo con Conferma o Annulla.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gest_documenti_guardia BEFORE INSERT OR UPDATE ON public.gest_documenti
  FOR EACH ROW EXECUTE FUNCTION public.gest_fn_documento_guardia();

-- Righe: modificabili solo se il documento è in bozza; importo calcolato.
CREATE FUNCTION public.gest_fn_riga_guardia() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _stato TEXT;
  _doc UUID := CASE WHEN TG_OP = 'DELETE' THEN OLD.documento_id ELSE NEW.documento_id END;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.documento_id IS DISTINCT FROM OLD.documento_id THEN
    RAISE EXCEPTION 'Una riga non può essere spostata su un altro documento.';
  END IF;
  SELECT stato INTO _stato FROM public.gest_documenti WHERE id = _doc FOR UPDATE;
  IF _stato IS DISTINCT FROM 'bozza' THEN
    RAISE EXCEPTION 'Le righe si modificano solo sui documenti in bozza.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.tipo_riga = 'nota' THEN
    NEW.quantita := 0;
    NEW.prezzo_unitario := 0;
    NEW.sconto_pct := 0;
    NEW.aliquota_id := NULL;
    NEW.importo := 0;
  ELSE
    NEW.importo := round(NEW.quantita * NEW.prezzo_unitario * (1 - NEW.sconto_pct / 100), 2);
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER gest_documenti_righe_guardia BEFORE INSERT OR UPDATE OR DELETE ON public.gest_documenti_righe
  FOR EACH ROW EXECUTE FUNCTION public.gest_fn_riga_guardia();

-- Totali: imponibile = somma righe; imposta calcolata per aliquota (come in fattura elettronica).
CREATE FUNCTION public.gest_ricalcola_totali(_documento_id UUID) RETURNS VOID
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _imponibile NUMERIC(14,2);
  _imposta    NUMERIC(14,2);
BEGIN
  SELECT COALESCE(sum(importo), 0) INTO _imponibile
  FROM public.gest_documenti_righe WHERE documento_id = _documento_id;

  SELECT COALESCE(sum(imposta), 0) INTO _imposta FROM (
    SELECT round(sum(r.importo) * a.percentuale / 100, 2) AS imposta
    FROM public.gest_documenti_righe r
    JOIN public.gest_aliquote_iva a ON a.id = r.aliquota_id
    WHERE r.documento_id = _documento_id
    GROUP BY a.id, a.percentuale
  ) t;

  UPDATE public.gest_documenti
  SET imponibile = _imponibile, imposta = _imposta, totale = _imponibile + _imposta
  WHERE id = _documento_id
    AND (imponibile, imposta, totale) IS DISTINCT FROM (_imponibile, _imposta, _imponibile + _imposta);
END $$;

CREATE FUNCTION public.gest_fn_riga_totali() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM public.gest_ricalcola_totali(CASE WHEN TG_OP = 'DELETE' THEN OLD.documento_id ELSE NEW.documento_id END);
  RETURN NULL;
END $$;
CREATE TRIGGER gest_documenti_righe_totali AFTER INSERT OR UPDATE OR DELETE ON public.gest_documenti_righe
  FOR EACH ROW EXECUTE FUNCTION public.gest_fn_riga_totali();

-- Riepilogo IVA per aliquota
CREATE VIEW public.gest_documenti_iva WITH (security_invoker = true) AS
SELECT r.documento_id, a.id AS aliquota_id, a.codice, a.descrizione, a.percentuale, a.natura,
       sum(r.importo)::NUMERIC(14,2) AS imponibile,
       round(sum(r.importo) * a.percentuale / 100, 2)::NUMERIC(14,2) AS imposta
FROM public.gest_documenti_righe r
JOIN public.gest_aliquote_iva a ON a.id = r.aliquota_id
GROUP BY r.documento_id, a.id, a.codice, a.descrizione, a.percentuale, a.natura;

-- 7. Trigger comuni: storico, niente cancellazioni, updated_at ---------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['gest_aliquote_iva','gest_anagrafiche','gest_documenti']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.gest_fn_updated_at()', t || '_updated_at', t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.gest_fn_storico()', t || '_storico', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.gest_fn_blocca_delete()', t || '_no_delete', t);
  END LOOP;
END $$;

CREATE TRIGGER gest_documenti_righe_storico AFTER INSERT OR UPDATE OR DELETE ON public.gest_documenti_righe
  FOR EACH ROW EXECUTE FUNCTION public.gest_fn_storico();

CREATE FUNCTION public.gest_fn_impostazioni_storico() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  INSERT INTO public.gest_storico (tabella, record_id, operazione, utente, prima, dopo)
  VALUES (TG_TABLE_NAME, NEW.chiave, TG_OP, auth.uid(), CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END, to_jsonb(NEW));
  RETURN NEW;
END $$;
CREATE TRIGGER gest_impostazioni_storico BEFORE INSERT OR UPDATE ON public.gest_impostazioni
  FOR EACH ROW EXECUTE FUNCTION public.gest_fn_impostazioni_storico();
CREATE TRIGGER gest_impostazioni_no_delete BEFORE DELETE ON public.gest_impostazioni
  FOR EACH ROW EXECUTE FUNCTION public.gest_fn_blocca_delete();

-- 8. Conferma: assegna il numero e blocca il documento -----------------
CREATE FUNCTION public.gest_conferma_documento(_documento_id UUID) RETURNS public.gest_documenti
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _d public.gest_documenti;
  _a public.gest_anagrafiche;
  _anno INTEGER;
  _numero INTEGER;
  _attive_dal DATE;
  _ultima DATE;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'gestionale', 'write') THEN
    RAISE EXCEPTION 'Permesso negato.';
  END IF;
  SELECT * INTO _d FROM public.gest_documenti WHERE id = _documento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Documento non trovato.';
  END IF;
  IF _d.stato <> 'bozza' THEN
    RAISE EXCEPTION 'Il documento è già %.', _d.stato;
  END IF;
  IF _d.anagrafica_id IS NULL THEN
    RAISE EXCEPTION 'Manca il cliente o fornitore.';
  END IF;
  SELECT * INTO _a FROM public.gest_anagrafiche WHERE id = _d.anagrafica_id;
  IF NOT EXISTS (SELECT 1 FROM public.gest_documenti_righe WHERE documento_id = _documento_id AND tipo_riga <> 'nota') THEN
    RAISE EXCEPTION 'Il documento non ha righe.';
  END IF;
  IF _d.tipo IN ('bolla_carico','fattura_fornitore') AND COALESCE(btrim(_d.riferimento_esterno), '') = '' THEN
    RAISE EXCEPTION 'Indicare il numero del documento del fornitore.';
  END IF;

  _anno := EXTRACT(YEAR FROM _d.data)::INTEGER;

  IF _d.tipo IN ('fattura','nota_credito') THEN
    SELECT valore::DATE INTO _attive_dal FROM public.gest_impostazioni WHERE chiave = 'fatture_attive_dal';
    IF _attive_dal IS NULL OR _d.data < _attive_dal THEN
      RAISE EXCEPTION 'Fatture e note di credito si confermano nel Gestionale dal %: fino ad allora restano bozze.',
        COALESCE(to_char(_attive_dal, 'DD/MM/YYYY'), 'giorno da impostare');
    END IF;
    IF EXISTS (SELECT 1 FROM public.gest_documenti_righe
               WHERE documento_id = _documento_id AND tipo_riga <> 'nota' AND aliquota_id IS NULL) THEN
      RAISE EXCEPTION 'Tutte le righe devono avere l''aliquota IVA.';
    END IF;
    -- la numerazione deve seguire l'ordine delle date
    SELECT max(data) INTO _ultima FROM public.gest_documenti
    WHERE tipo = _d.tipo AND anno = _anno AND serie = _d.serie AND numero IS NOT NULL;
    IF _ultima IS NOT NULL AND _d.data < _ultima THEN
      RAISE EXCEPTION 'Data precedente all''ultimo documento numerato (%): la numerazione deve seguire le date.',
        to_char(_ultima, 'DD/MM/YYYY');
    END IF;
  END IF;

  PERFORM public.gest_ricalcola_totali(_documento_id);

  INSERT INTO public.gest_numeratori (tipo, anno, serie, ultimo)
  VALUES (_d.tipo, _anno, _d.serie, 1)
  ON CONFLICT (tipo, anno, serie) DO UPDATE SET ultimo = public.gest_numeratori.ultimo + 1
  RETURNING ultimo INTO _numero;

  PERFORM set_config('gest.sistema', '1', true);
  UPDATE public.gest_documenti
  SET stato = 'confermato', numero = _numero, anno = _anno,
      intestatario = jsonb_build_object(
        'codice', _a.codice, 'ragione_sociale', _a.ragione_sociale, 'partita_iva', _a.partita_iva,
        'codice_fiscale', _a.codice_fiscale, 'codice_sdi', _a.codice_sdi, 'pec', _a.pec,
        'indirizzo', _a.indirizzo, 'cap', _a.cap, 'citta', _a.citta, 'provincia', _a.provincia, 'nazione', _a.nazione),
      confermato_il = now(), confermato_da = auth.uid()
  WHERE id = _documento_id
  RETURNING * INTO _d;
  PERFORM set_config('gest.sistema', '', true);
  RETURN _d;
END $$;

-- Annullamento: il documento resta, con il suo numero, segnato come annullato.
CREATE FUNCTION public.gest_annulla_documento(_documento_id UUID, _motivo TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _d public.gest_documenti;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'gestionale', 'write') THEN
    RAISE EXCEPTION 'Permesso negato.';
  END IF;
  SELECT * INTO _d FROM public.gest_documenti WHERE id = _documento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Documento non trovato.';
  END IF;
  IF _d.stato = 'annullato' THEN
    RAISE EXCEPTION 'Il documento è già annullato.';
  END IF;
  IF _d.stato = 'confermato' AND _d.tipo IN ('fattura','nota_credito') THEN
    RAISE EXCEPTION 'Una fattura confermata non si annulla: si storna con una nota di credito.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.gest_documenti WHERE origine_id = _documento_id AND stato <> 'annullato') THEN
    RAISE EXCEPTION 'Esistono documenti collegati non annullati: annullare prima quelli.';
  END IF;
  PERFORM set_config('gest.sistema', '1', true);
  UPDATE public.gest_documenti
  SET stato = 'annullato', annullato_il = now(), motivo_annullamento = _motivo
  WHERE id = _documento_id;
  PERFORM set_config('gest.sistema', '', true);
END $$;

-- Trasformazione: crea una nuova bozza a partire da un documento confermato.
CREATE FUNCTION public.gest_deriva_documento(_origine_id UUID, _tipo TEXT) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _o public.gest_documenti;
  _nuovo UUID;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'gestionale', 'write') THEN
    RAISE EXCEPTION 'Permesso negato.';
  END IF;
  SELECT * INTO _o FROM public.gest_documenti WHERE id = _origine_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Documento di origine non trovato.';
  END IF;
  IF _o.stato <> 'confermato' THEN
    RAISE EXCEPTION 'Si può trasformare solo un documento confermato.';
  END IF;
  IF NOT ((_o.tipo = 'preventivo'   AND _tipo = 'ordine')
       OR (_o.tipo = 'ordine'       AND _tipo IN ('ddt','fattura'))
       OR (_o.tipo = 'ddt'          AND _tipo = 'fattura')
       OR (_o.tipo = 'fattura'      AND _tipo = 'nota_credito')
       OR (_o.tipo = 'bolla_carico' AND _tipo = 'fattura_fornitore')) THEN
    RAISE EXCEPTION 'Trasformazione non prevista: da % a %.', _o.tipo, _tipo;
  END IF;

  PERFORM set_config('gest.sistema', '1', true);
  INSERT INTO public.gest_documenti
    (tipo, stato, serie, data, anagrafica_id, oggetto, riferimento_esterno, data_esterna, pagamento,
     consegna_prevista, destinazione, note, note_interne, origine_id, design_draft_id, creato_da)
  VALUES
    (_tipo, 'bozza', _o.serie, CURRENT_DATE, _o.anagrafica_id, _o.oggetto,
     CASE WHEN _tipo = 'fattura_fornitore' THEN NULL ELSE _o.riferimento_esterno END,
     CASE WHEN _tipo = 'fattura_fornitore' THEN NULL ELSE _o.data_esterna END,
     _o.pagamento, _o.consegna_prevista, _o.destinazione, _o.note, _o.note_interne,
     _o.id, _o.design_draft_id, auth.uid())
  RETURNING id INTO _nuovo;
  PERFORM set_config('gest.sistema', '', true);

  INSERT INTO public.gest_documenti_righe
    (documento_id, posizione, tipo_riga, variante_id, codice, descrizione, dettagli, um,
     quantita, prezzo_unitario, sconto_pct, aliquota_id, riga_origine_id)
  SELECT _nuovo, posizione, tipo_riga, variante_id, codice, descrizione, dettagli, um,
         quantita, prezzo_unitario, sconto_pct, aliquota_id, id
  FROM public.gest_documenti_righe
  WHERE documento_id = _origine_id
  ORDER BY posizione, created_at;

  RETURN _nuovo;
END $$;

-- 9. Privilegi espliciti (prima delle policy) -------------------------
GRANT SELECT, INSERT, UPDATE ON public.gest_aliquote_iva, public.gest_anagrafiche, public.gest_documenti TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gest_documenti_righe TO authenticated;
GRANT SELECT, UPDATE ON public.gest_impostazioni TO authenticated;
GRANT SELECT ON public.gest_numeratori, public.gest_documenti_iva TO authenticated;
GRANT USAGE ON SEQUENCE public.gest_anagrafiche_codice_seq TO authenticated, service_role;

GRANT ALL ON public.gest_impostazioni, public.gest_aliquote_iva, public.gest_anagrafiche, public.gest_numeratori,
             public.gest_documenti, public.gest_documenti_righe TO service_role;
GRANT SELECT ON public.gest_documenti_iva TO service_role;

REVOKE ALL ON FUNCTION public.gest_fn_impostazioni_storico() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gest_ricalcola_totali(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gest_conferma_documento(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gest_annulla_documento(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gest_deriva_documento(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gest_ricalcola_totali(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gest_conferma_documento(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gest_annulla_documento(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gest_deriva_documento(UUID, TEXT) TO authenticated, service_role;

-- 10. Sicurezza (RLS) --------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['gest_aliquote_iva','gest_anagrafiche','gest_documenti','gest_documenti_righe']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
      USING (public.has_permission(auth.uid(), 'gestionale', 'read'))$p$, t || '_select', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
      WITH CHECK (public.has_permission(auth.uid(), 'gestionale', 'write'))$p$, t || '_insert', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
      USING (public.has_permission(auth.uid(), 'gestionale', 'write'))
      WITH CHECK (public.has_permission(auth.uid(), 'gestionale', 'write'))$p$, t || '_update', t);
  END LOOP;
END $$;

CREATE POLICY gest_documenti_righe_delete ON public.gest_documenti_righe FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(), 'gestionale', 'write'));

ALTER TABLE public.gest_impostazioni ENABLE ROW LEVEL SECURITY;
CREATE POLICY gest_impostazioni_select ON public.gest_impostazioni FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'gestionale', 'read'));
CREATE POLICY gest_impostazioni_update ON public.gest_impostazioni FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.gest_numeratori ENABLE ROW LEVEL SECURITY;
CREATE POLICY gest_numeratori_select ON public.gest_numeratori FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'gestionale', 'read'));
-- nessuna policy di scrittura: i numeratori li muove solo la conferma
