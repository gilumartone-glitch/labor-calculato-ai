-- =====================================================================
-- GESTIONALE · Fase 4 — Scadenzario incassi e pagamenti
-- Condizioni di pagamento, scadenze generate alla conferma di fatture,
-- note di credito e fatture fornitori, registro di incassi e pagamenti.
-- Sola struttura, solo oggetti del Gestionale (prefisso gest_).
-- =====================================================================

-- 1. Condizioni di pagamento -------------------------------------------
CREATE TABLE public.gest_condizioni_pagamento (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codice        TEXT NOT NULL UNIQUE,
  descrizione   TEXT NOT NULL,
  modalita      TEXT,              -- bonifico, RiBa, rimessa diretta, contanti…
  -- rate: elenco di {giorni, percentuale}; le percentuali sommano 100
  rate          JSONB NOT NULL DEFAULT '[{"giorni":0,"percentuale":100}]'::jsonb,
  fine_mese     BOOLEAN NOT NULL DEFAULT false,   -- ogni scadenza slitta alla fine del suo mese
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  archiviato_il TIMESTAMPTZ,
  CONSTRAINT gest_condizioni_pagamento_rate_elenco CHECK (jsonb_typeof(rate) = 'array' AND jsonb_array_length(rate) > 0)
);

CREATE FUNCTION public.gest_fn_condizione_pagamento_controllo() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _r JSONB;
  _somma NUMERIC := 0;
BEGIN
  FOR _r IN SELECT * FROM jsonb_array_elements(NEW.rate) LOOP
    IF jsonb_typeof(_r->'giorni') IS DISTINCT FROM 'number' OR jsonb_typeof(_r->'percentuale') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Ogni rata deve avere giorni (zero o più) e percentuale (maggiore di zero).';
    END IF;
    IF (_r->>'giorni')::NUMERIC < 0 OR (_r->>'percentuale')::NUMERIC <= 0 THEN
      RAISE EXCEPTION 'Ogni rata deve avere giorni (zero o più) e percentuale (maggiore di zero).';
    END IF;
    _somma := _somma + (_r->>'percentuale')::NUMERIC;
  END LOOP;
  IF _somma <> 100 THEN
    RAISE EXCEPTION 'Le percentuali delle rate devono sommare 100 (ora sommano %).', _somma;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gest_condizioni_pagamento_controllo BEFORE INSERT OR UPDATE ON public.gest_condizioni_pagamento
  FOR EACH ROW EXECUTE FUNCTION public.gest_fn_condizione_pagamento_controllo();

ALTER TABLE public.gest_documenti
  ADD COLUMN condizione_pagamento_id UUID REFERENCES public.gest_condizioni_pagamento(id);
ALTER TABLE public.gest_anagrafiche
  ADD COLUMN condizione_pagamento_id UUID REFERENCES public.gest_condizioni_pagamento(id);

-- 2. Scadenze ------------------------------------------------------------
CREATE TABLE public.gest_scadenze (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id  UUID NOT NULL REFERENCES public.gest_documenti(id),
  anagrafica_id UUID REFERENCES public.gest_anagrafiche(id),
  verso         TEXT NOT NULL CHECK (verso IN ('incasso','pagamento')),
  numero_rata   INTEGER NOT NULL DEFAULT 1,
  data_scadenza DATE NOT NULL,
  importo       NUMERIC(14,2) NOT NULL,     -- negativo per le note di credito
  modalita      TEXT,
  note          TEXT,
  annullata_il  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (documento_id, numero_rata)
);
CREATE INDEX gest_scadenze_data_idx ON public.gest_scadenze (verso, data_scadenza);
CREATE INDEX gest_scadenze_anagrafica_idx ON public.gest_scadenze (anagrafica_id);

-- Di una scadenza si possono cambiare solo data, modalità e note.
CREATE FUNCTION public.gest_fn_scadenza_guardia() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF COALESCE(current_setting('gest.sistema', true), '') = '1' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Le scadenze nascono dalla conferma dei documenti.';
  END IF;
  IF (NEW.documento_id, NEW.anagrafica_id, NEW.verso, NEW.numero_rata, NEW.importo, NEW.annullata_il)
     IS DISTINCT FROM (OLD.documento_id, OLD.anagrafica_id, OLD.verso, OLD.numero_rata, OLD.importo, OLD.annullata_il) THEN
    RAISE EXCEPTION 'Di una scadenza si possono cambiare solo data, modalità e note.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gest_scadenze_guardia BEFORE INSERT OR UPDATE ON public.gest_scadenze
  FOR EACH ROW EXECUTE FUNCTION public.gest_fn_scadenza_guardia();

-- 3. Registro incassi e pagamenti (solo inserimento) ---------------------
CREATE TABLE public.gest_pagamenti (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scadenza_id UUID NOT NULL REFERENCES public.gest_scadenze(id),
  data        DATE NOT NULL DEFAULT CURRENT_DATE,
  importo     NUMERIC(14,2) NOT NULL CHECK (importo <> 0),
  modalita    TEXT,
  nota        TEXT,
  storno_di   BIGINT REFERENCES public.gest_pagamenti(id),
  utente      UUID DEFAULT auth.uid(),
  creato_il   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX gest_pagamenti_scadenza_idx ON public.gest_pagamenti (scadenza_id);
CREATE UNIQUE INDEX gest_pagamenti_storno_unico ON public.gest_pagamenti (storno_di) WHERE storno_di IS NOT NULL;

CREATE TRIGGER gest_pagamenti_immutabile BEFORE UPDATE OR DELETE ON public.gest_pagamenti
  FOR EACH ROW EXECUTE FUNCTION public.gest_fn_solo_inserimento();
CREATE TRIGGER gest_pagamenti_storico AFTER INSERT ON public.gest_pagamenti
  FOR EACH ROW EXECUTE FUNCTION public.gest_fn_storico();

-- 4. Trigger comuni ------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['gest_condizioni_pagamento','gest_scadenze']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.gest_fn_updated_at()', t || '_updated_at', t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.gest_fn_storico()', t || '_storico', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.gest_fn_blocca_delete()', t || '_no_delete', t);
  END LOOP;
END $$;

-- 5. Vista scadenzario ---------------------------------------------------
CREATE VIEW public.gest_scadenzario WITH (security_invoker = true) AS
SELECT s.id, s.documento_id, s.anagrafica_id, s.verso, s.numero_rata, s.data_scadenza, s.importo, s.modalita, s.note,
       d.tipo AS documento_tipo, d.numero AS documento_numero, d.anno AS documento_anno, d.serie AS documento_serie,
       d.data AS documento_data, d.riferimento_esterno,
       COALESCE(d.intestatario->>'ragione_sociale', a.ragione_sociale) AS ragione_sociale,
       COALESCE(p.pagato, 0)::NUMERIC(14,2) AS pagato,
       (s.importo - COALESCE(p.pagato, 0))::NUMERIC(14,2) AS residuo,
       p.ultimo_pagamento,
       CASE
         WHEN s.importo - COALESCE(p.pagato, 0) = 0 THEN 'saldata'
         WHEN s.data_scadenza < CURRENT_DATE THEN 'scaduta'
         WHEN COALESCE(p.pagato, 0) <> 0 THEN 'parziale'
         ELSE 'aperta'
       END AS stato
FROM public.gest_scadenze s
JOIN public.gest_documenti d ON d.id = s.documento_id
LEFT JOIN public.gest_anagrafiche a ON a.id = s.anagrafica_id
LEFT JOIN LATERAL (
  SELECT sum(importo) AS pagato, max(data) AS ultimo_pagamento FROM public.gest_pagamenti WHERE scadenza_id = s.id
) p ON true
WHERE s.annullata_il IS NULL;

-- 6. Generazione delle scadenze alla conferma ----------------------------
CREATE FUNCTION public.gest_genera_scadenze(_documento_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _d public.gest_documenti;
  _c public.gest_condizioni_pagamento;
  _rate JSONB := '[{"giorni":0,"percentuale":100}]'::jsonb;
  _fine_mese BOOLEAN := false;
  _modalita TEXT;
  _segno NUMERIC := 1;
  _totale NUMERIC(14,2);
  _assegnato NUMERIC(14,2) := 0;
  _n INTEGER := jsonb_array_length(_rate);
  _i INTEGER;
  _importo NUMERIC(14,2);
  _data DATE;
BEGIN
  SELECT * INTO _d FROM public.gest_documenti WHERE id = _documento_id;
  IF _d.tipo NOT IN ('fattura','nota_credito','fattura_fornitore') OR _d.stato <> 'confermato' THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.gest_scadenze WHERE documento_id = _documento_id) THEN
    RETURN;
  END IF;
  IF _d.condizione_pagamento_id IS NOT NULL THEN
    SELECT * INTO _c FROM public.gest_condizioni_pagamento WHERE id = _d.condizione_pagamento_id;
    _rate := _c.rate;
    _fine_mese := _c.fine_mese;
    _modalita := _c.modalita;
    _n := jsonb_array_length(_rate);
  END IF;
  IF _d.tipo = 'nota_credito' THEN
    _segno := -1;
  END IF;
  _totale := _d.totale * _segno;

  FOR _i IN 0 .. _n - 1 LOOP
    IF _i = _n - 1 THEN
      _importo := _totale - _assegnato;          -- l'ultima rata prende il resto
    ELSE
      _importo := round(_totale * (_rate->_i->>'percentuale')::NUMERIC / 100, 2);
    END IF;
    _assegnato := _assegnato + _importo;
    -- per le fatture fornitori i giorni partono dalla data del documento del fornitore
    _data := COALESCE(CASE WHEN _d.tipo = 'fattura_fornitore' THEN _d.data_esterna END, _d.data)
             + ((_rate->_i->>'giorni')::NUMERIC)::INTEGER;
    IF _fine_mese THEN
      _data := (date_trunc('month', _data) + INTERVAL '1 month - 1 day')::DATE;
    END IF;
    INSERT INTO public.gest_scadenze (documento_id, anagrafica_id, verso, numero_rata, data_scadenza, importo, modalita)
    VALUES (_d.id, _d.anagrafica_id,
            CASE WHEN _d.tipo = 'fattura_fornitore' THEN 'pagamento' ELSE 'incasso' END,
            _i + 1, _data, _importo, _modalita);
  END LOOP;
END $$;

-- 7. Incassi, pagamenti e storni -----------------------------------------
CREATE FUNCTION public.gest_registra_pagamento(
  _scadenza_id UUID, _importo NUMERIC, _data DATE DEFAULT CURRENT_DATE, _modalita TEXT DEFAULT NULL, _nota TEXT DEFAULT NULL
) RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _s public.gest_scadenze;
  _pagato NUMERIC;
  _residuo NUMERIC;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'gestionale', 'write') THEN
    RAISE EXCEPTION 'Permesso negato.';
  END IF;
  SELECT * INTO _s FROM public.gest_scadenze WHERE id = _scadenza_id FOR UPDATE;
  IF NOT FOUND OR _s.annullata_il IS NOT NULL THEN
    RAISE EXCEPTION 'Scadenza non trovata.';
  END IF;
  IF _importo IS NULL OR _importo = 0 THEN
    RAISE EXCEPTION 'Indicare l''importo.';
  END IF;
  SELECT COALESCE(sum(importo), 0) INTO _pagato FROM public.gest_pagamenti WHERE scadenza_id = _scadenza_id;
  _residuo := _s.importo - _pagato;
  -- l'importo deve andare nel verso del residuo e non superarlo
  IF sign(_importo) <> sign(_residuo) OR abs(_importo) > abs(_residuo) THEN
    RAISE EXCEPTION 'Importo non valido: il residuo della scadenza è %.', _residuo;
  END IF;
  INSERT INTO public.gest_pagamenti (scadenza_id, data, importo, modalita, nota, utente)
  VALUES (_scadenza_id, COALESCE(_data, CURRENT_DATE), _importo, COALESCE(_modalita, _s.modalita), _nota, auth.uid());
  RETURN _residuo - _importo;
END $$;

CREATE FUNCTION public.gest_storna_pagamento(_pagamento_id BIGINT, _nota TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _p public.gest_pagamenti;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'gestionale', 'write') THEN
    RAISE EXCEPTION 'Permesso negato.';
  END IF;
  SELECT * INTO _p FROM public.gest_pagamenti WHERE id = _pagamento_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pagamento non trovato.';
  END IF;
  IF _p.storno_di IS NOT NULL THEN
    RAISE EXCEPTION 'Uno storno non può essere stornato.';
  END IF;
  PERFORM 1 FROM public.gest_scadenze WHERE id = _p.scadenza_id FOR UPDATE;
  INSERT INTO public.gest_pagamenti (scadenza_id, data, importo, modalita, nota, storno_di, utente)
  VALUES (_p.scadenza_id, CURRENT_DATE, -_p.importo, _p.modalita, COALESCE(_nota, 'Storno'), _p.id, auth.uid());
END $$;

-- 8. Conferma, annullamento e trasformazione aggiornati -------------------
CREATE OR REPLACE FUNCTION public.gest_conferma_documento(_documento_id UUID) RETURNS public.gest_documenti
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
  IF _d.tipo IN ('bolla_carico','ddt') THEN
    PERFORM public.gest_movimenta_documento(_d.id);
  END IF;
  IF _d.tipo IN ('fattura','nota_credito','fattura_fornitore') THEN
    PERFORM public.gest_genera_scadenze(_d.id);
  END IF;
  PERFORM set_config('gest.sistema', '', true);
  RETURN _d;
END $$;

CREATE OR REPLACE FUNCTION public.gest_annulla_documento(_documento_id UUID, _motivo TEXT DEFAULT NULL) RETURNS VOID
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
  IF _d.stato = 'confermato' AND _d.tipo IN ('bolla_carico','ddt') THEN
    PERFORM public.gest_storna_documento(_d.id);
  END IF;
  IF _d.stato = 'confermato' AND _d.tipo = 'fattura_fornitore' THEN
    IF EXISTS (SELECT 1 FROM public.gest_scadenzario s WHERE s.documento_id = _d.id AND s.pagato <> 0) THEN
      RAISE EXCEPTION 'La fattura ha pagamenti registrati: stornare prima i pagamenti.';
    END IF;
    UPDATE public.gest_scadenze SET annullata_il = now() WHERE documento_id = _d.id AND annullata_il IS NULL;
  END IF;
  UPDATE public.gest_documenti
  SET stato = 'annullato', annullato_il = now(), motivo_annullamento = _motivo
  WHERE id = _documento_id;
  PERFORM set_config('gest.sistema', '', true);
END $$;

CREATE OR REPLACE FUNCTION public.gest_deriva_documento(_origine_id UUID, _tipo TEXT) RETURNS UUID
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
    (tipo, stato, serie, data, anagrafica_id, oggetto, riferimento_esterno, data_esterna, pagamento, condizione_pagamento_id,
     consegna_prevista, destinazione, note, note_interne, origine_id, design_draft_id, creato_da)
  VALUES
    (_tipo, 'bozza', _o.serie, CURRENT_DATE, _o.anagrafica_id, _o.oggetto,
     CASE WHEN _tipo = 'fattura_fornitore' THEN NULL ELSE _o.riferimento_esterno END,
     CASE WHEN _tipo = 'fattura_fornitore' THEN NULL ELSE _o.data_esterna END,
     _o.pagamento, _o.condizione_pagamento_id, _o.consegna_prevista, _o.destinazione, _o.note, _o.note_interne,
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

-- 9. Privilegi espliciti (prima delle policy) ----------------------------
GRANT SELECT, INSERT, UPDATE ON public.gest_condizioni_pagamento TO authenticated;
GRANT SELECT, UPDATE ON public.gest_scadenze TO authenticated;
GRANT SELECT ON public.gest_pagamenti, public.gest_scadenzario TO authenticated;
GRANT ALL ON public.gest_condizioni_pagamento, public.gest_scadenze, public.gest_pagamenti TO service_role;
GRANT SELECT ON public.gest_scadenzario TO service_role;

REVOKE ALL ON FUNCTION public.gest_genera_scadenze(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gest_registra_pagamento(UUID, NUMERIC, DATE, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gest_storna_pagamento(BIGINT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gest_conferma_documento(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gest_annulla_documento(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gest_deriva_documento(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gest_registra_pagamento(UUID, NUMERIC, DATE, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gest_storna_pagamento(BIGINT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gest_conferma_documento(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gest_annulla_documento(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gest_deriva_documento(UUID, TEXT) TO authenticated, service_role;

-- 10. Sicurezza (RLS) ----------------------------------------------------
ALTER TABLE public.gest_condizioni_pagamento ENABLE ROW LEVEL SECURITY;
CREATE POLICY gest_condizioni_pagamento_select ON public.gest_condizioni_pagamento FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'gestionale', 'read'));
CREATE POLICY gest_condizioni_pagamento_insert ON public.gest_condizioni_pagamento FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), 'gestionale', 'write'));
CREATE POLICY gest_condizioni_pagamento_update ON public.gest_condizioni_pagamento FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'gestionale', 'write'))
  WITH CHECK (public.has_permission(auth.uid(), 'gestionale', 'write'));

ALTER TABLE public.gest_scadenze ENABLE ROW LEVEL SECURITY;
CREATE POLICY gest_scadenze_select ON public.gest_scadenze FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'gestionale', 'read'));
CREATE POLICY gest_scadenze_update ON public.gest_scadenze FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'gestionale', 'write'))
  WITH CHECK (public.has_permission(auth.uid(), 'gestionale', 'write'));

ALTER TABLE public.gest_pagamenti ENABLE ROW LEVEL SECURITY;
CREATE POLICY gest_pagamenti_select ON public.gest_pagamenti FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'gestionale', 'read'));
