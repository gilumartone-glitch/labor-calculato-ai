-- =====================================================================
-- GESTIONALE · Fase 5 — Prima nota e collegamento con la Contabilità
--
-- 1. Ogni scadenza di fattura diventa una voce «in competenza» (prevista)
--    nella Contabilità esistente, alla sua data.
-- 2. Quando in Contabilità → Conti un movimento bancario viene associato a
--    quella voce, la scadenza risulta pagata e la riga entra in prima nota
--    con il conto della banca.
-- 3. I contanti si registrano dallo Scadenzario: la voce passa in cassa.
-- 4. Prima nota: registro cronologico dei movimenti documentati.
--
-- Sola struttura. Oggetti nuovi con prefisso gest_; sugli oggetti esistenti
-- della Contabilità aggiunge un solo trigger (su bank_allocations) e scrive
-- nelle voci di contabilita_state con le stesse regole dell'associazione bancaria.
-- =====================================================================

-- 1. Colonne di collegamento --------------------------------------------
ALTER TABLE public.gest_scadenze
  ADD COLUMN contabilita_key          TEXT,   -- anno contabile in cui vive la voce in competenza
  ADD COLUMN contabilita_movimento_id TEXT;   -- id della voce in competenza
CREATE INDEX gest_scadenze_contabilita_idx ON public.gest_scadenze (contabilita_movimento_id);

ALTER TABLE public.gest_pagamenti
  ADD COLUMN conto               TEXT,                             -- contanti, bnl, credem, paypal…
  ADD COLUMN origine             TEXT NOT NULL DEFAULT 'manuale',  -- manuale | banca
  ADD COLUMN bank_allocation_id  UUID,
  ADD COLUMN bank_transaction_id UUID;
CREATE UNIQUE INDEX gest_pagamenti_allocazione_unica ON public.gest_pagamenti (bank_allocation_id)
  WHERE bank_allocation_id IS NOT NULL;

-- 2. Prima nota: movimenti documentati che non nascono da una fattura ----
CREATE TABLE public.gest_prima_nota (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  data          DATE NOT NULL DEFAULT CURRENT_DATE,
  verso         TEXT NOT NULL CHECK (verso IN ('entrata','uscita')),
  importo       NUMERIC(14,2) NOT NULL CHECK (importo <> 0),   -- negativo solo negli storni
  conto         TEXT NOT NULL,
  descrizione   TEXT NOT NULL CHECK (btrim(descrizione) <> ''),
  -- riferimento al documento che giustifica il movimento: scontrino, ricevuta, F24, busta paga…
  documento_rif TEXT NOT NULL CHECK (btrim(documento_rif) <> ''),
  anagrafica_id UUID REFERENCES public.gest_anagrafiche(id),
  storno_di     BIGINT REFERENCES public.gest_prima_nota(id),
  utente        UUID DEFAULT auth.uid(),
  creato_il     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX gest_prima_nota_data_idx ON public.gest_prima_nota (data);
CREATE UNIQUE INDEX gest_prima_nota_storno_unico ON public.gest_prima_nota (storno_di) WHERE storno_di IS NOT NULL;

CREATE TRIGGER gest_prima_nota_immutabile BEFORE UPDATE OR DELETE ON public.gest_prima_nota
  FOR EACH ROW EXECUTE FUNCTION public.gest_fn_solo_inserimento();
CREATE TRIGGER gest_prima_nota_storico AFTER INSERT ON public.gest_prima_nota
  FOR EACH ROW EXECUTE FUNCTION public.gest_fn_storico();

-- Registro unico: incassi e pagamenti delle fatture + movimenti manuali documentati.
CREATE VIEW public.gest_prima_nota_vista WITH (security_invoker = true) AS
SELECT 'F' || p.id AS id, p.data,
       CASE WHEN (s.verso = 'incasso') = (p.importo > 0) THEN 'entrata' ELSE 'uscita' END AS verso,
       abs(p.importo)::NUMERIC(14,2) AS importo,
       COALESCE(p.conto, 'da indicare') AS conto,
       COALESCE(d.intestatario->>'ragione_sociale', a.ragione_sociale, '') AS ragione_sociale,
       d.tipo AS documento_tipo,
       d.numero || CASE WHEN d.serie <> '' THEN '/' || d.serie ELSE '' END || '/' || d.anno AS documento_numero,
       d.riferimento_esterno AS documento_rif,
       COALESCE(p.nota, '') AS descrizione,
       p.origine, (p.storno_di IS NOT NULL) AS e_storno, p.creato_il,
       s.documento_id, p.scadenza_id, NULL::BIGINT AS manuale_id, p.id AS pagamento_id
FROM public.gest_pagamenti p
JOIN public.gest_scadenze s ON s.id = p.scadenza_id
JOIN public.gest_documenti d ON d.id = s.documento_id
LEFT JOIN public.gest_anagrafiche a ON a.id = s.anagrafica_id
UNION ALL
SELECT 'M' || m.id, m.data,
       CASE WHEN m.importo > 0 THEN m.verso WHEN m.verso = 'entrata' THEN 'uscita' ELSE 'entrata' END,
       abs(m.importo)::NUMERIC(14,2), m.conto,
       COALESCE(a.ragione_sociale, ''), NULL, NULL, m.documento_rif, m.descrizione,
       'manuale', (m.storno_di IS NOT NULL), m.creato_il,
       NULL, NULL, m.id, NULL
FROM public.gest_prima_nota m
LEFT JOIN public.gest_anagrafiche a ON a.id = m.anagrafica_id;

-- 3. Scrittura nelle voci della Contabilità ------------------------------
-- Stessa regola della Contabilità: l'anno 2026 sta in 'main', gli altri in 'main-ANNO'.
CREATE FUNCTION public.gest_cont_key(_data DATE) RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN EXTRACT(YEAR FROM _data) = 2026 THEN 'main' ELSE 'main-' || EXTRACT(YEAR FROM _data)::INTEGER END
$$;

-- Toglie una voce dall'elenco e la segna tra le eliminate (come fa la Contabilità).
CREATE FUNCTION public.gest_cont_rimuovi_voce(_key TEXT, _id TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v JSONB;
  nuove JSONB;
  del JSONB;
BEGIN
  SELECT data INTO v FROM public.contabilita_state WHERE key = _key FOR UPDATE;
  IF v IS NULL OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v->'movements', '[]'::jsonb)) m WHERE m->>'id' = _id) THEN
    RETURN false;
  END IF;
  SELECT COALESCE(jsonb_agg(m), '[]'::jsonb) INTO nuove
  FROM jsonb_array_elements(v->'movements') m WHERE m->>'id' <> _id;
  del := COALESCE(v->'deletedIds', '{}'::jsonb);
  v := jsonb_set(v, '{movements}', nuove);
  v := jsonb_set(v, '{deletedIds}', del || jsonb_build_object('movements', COALESCE(del->'movements', '[]'::jsonb) || jsonb_build_array(_id)));
  UPDATE public.contabilita_state SET data = v, updated_by = auth.uid(), updated_at = clock_timestamp() WHERE key = _key;
  RETURN true;
END $$;

-- Crea la voce «prevista» di una scadenza. Restituisce l'id della voce, o NULL
-- se la Contabilità di quell'anno non è ancora stata aperta.
CREATE FUNCTION public.gest_cont_scrivi_competenza(_scadenza_id UUID, _importo NUMERIC) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.gest_scadenze;
  d public.gest_documenti;
  k TEXT;
  v JSONB;
  importo NUMERIC(14,2);
  voce_id TEXT;
  numero TEXT;
  nome TEXT;
  voce JSONB;
  _prima TEXT;
BEGIN
  SELECT * INTO s FROM public.gest_scadenze WHERE id = _scadenza_id FOR NO KEY UPDATE;
  IF NOT FOUND OR s.annullata_il IS NOT NULL THEN
    RETURN NULL;
  END IF;
  importo := abs(COALESCE(_importo, s.importo));
  IF importo = 0 THEN
    RETURN NULL;
  END IF;
  SELECT * INTO d FROM public.gest_documenti WHERE id = s.documento_id;
  k := public.gest_cont_key(s.data_scadenza);
  SELECT data INTO v FROM public.contabilita_state WHERE key = k FOR UPDATE;
  IF v IS NULL OR jsonb_typeof(COALESCE(v->'movements', '[]'::jsonb)) <> 'array' THEN
    RETURN NULL;
  END IF;

  voce_id := 'gest-' || replace(gen_random_uuid()::text, '-', '');
  numero := d.numero || CASE WHEN d.serie <> '' THEN '/' || d.serie ELSE '' END || '/' || d.anno;
  nome := COALESCE(d.intestatario->>'ragione_sociale', (SELECT ragione_sociale FROM public.gest_anagrafiche WHERE id = s.anagrafica_id), '');
  voce := jsonb_build_object(
    'id', voce_id,
    'date', s.data_scadenza::text,
    'description', upper(btrim(nome || ' - ' || CASE d.tipo
        WHEN 'fattura' THEN 'FATTURA ' || numero
        WHEN 'nota_credito' THEN 'NOTA DI CREDITO ' || numero
        ELSE 'FATTURA ' || COALESCE(NULLIF(btrim(d.riferimento_esterno), ''), numero) END)),
    'category', CASE WHEN d.tipo = 'fattura_fornitore' THEN 'FATTURE FORNITORI' ELSE 'FATTURE CLIENTI' END,
    'type', CASE WHEN (s.verso = 'incasso') = (s.importo > 0) THEN 'entrata' ELSE 'uscita' END,
    'status', 'previsto',
    'amount', importo,
    'acconto', 0,
    'invoiceNumber', CASE WHEN d.tipo = 'fattura_fornitore' THEN COALESCE(NULLIF(btrim(d.riferimento_esterno), ''), numero) ELSE numero END,
    'gestionaleScadenzaId', s.id,
    '_u', ceil(extract(epoch FROM clock_timestamp()) * 1000));
  v := jsonb_set(v, '{movements}', COALESCE(v->'movements', '[]'::jsonb) || jsonb_build_array(voce));
  UPDATE public.contabilita_state SET data = v, updated_by = auth.uid(), updated_at = clock_timestamp() WHERE key = k;

  _prima := COALESCE(current_setting('gest.sistema', true), '');
  PERFORM set_config('gest.sistema', '1', true);
  UPDATE public.gest_scadenze SET contabilita_key = k, contabilita_movimento_id = voce_id WHERE id = s.id;
  PERFORM set_config('gest.sistema', _prima, true);
  RETURN voce_id;
END $$;

-- Toglie la voce in competenza di una scadenza (annullamento, cambio data).
CREATE FUNCTION public.gest_cont_togli_competenza(_scadenza_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.gest_scadenze;
  _prima TEXT;
BEGIN
  SELECT * INTO s FROM public.gest_scadenze WHERE id = _scadenza_id FOR NO KEY UPDATE;
  IF NOT FOUND OR s.contabilita_movimento_id IS NULL THEN
    RETURN;
  END IF;
  PERFORM public.gest_cont_rimuovi_voce(s.contabilita_key, s.contabilita_movimento_id);
  _prima := COALESCE(current_setting('gest.sistema', true), '');
  PERFORM set_config('gest.sistema', '1', true);
  UPDATE public.gest_scadenze SET contabilita_key = NULL, contabilita_movimento_id = NULL WHERE id = s.id;
  PERFORM set_config('gest.sistema', _prima, true);
END $$;

-- Incasso o pagamento in contanti: riduce la voce in competenza e crea il movimento
-- di cassa alla data reale, con le stesse regole dell'associazione bancaria.
CREATE FUNCTION public.gest_cont_incasso_contanti(_pagamento_id BIGINT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.gest_pagamenti;
  s public.gest_scadenze;
  v JSONB;
  m JSONB;
  base JSONB;
  nuove JSONB := '[]'::jsonb;
  del JSONB;
  importo NUMERIC(14,2);
  anticipo NUMERIC;
  residuo NUMERIC;
  stamp NUMERIC := ceil(extract(epoch FROM clock_timestamp()) * 1000);
  k_cassa TEXT;
BEGIN
  SELECT * INTO p FROM public.gest_pagamenti WHERE id = _pagamento_id;
  SELECT * INTO s FROM public.gest_scadenze WHERE id = p.scadenza_id FOR NO KEY UPDATE;
  IF s.contabilita_movimento_id IS NULL THEN
    RETURN;
  END IF;
  importo := abs(p.importo);

  -- 1) riduce (o chiude) la voce in competenza
  SELECT data INTO v FROM public.contabilita_state WHERE key = s.contabilita_key FOR UPDATE;
  IF v IS NULL THEN
    RETURN;
  END IF;
  FOR m IN SELECT value FROM jsonb_array_elements(COALESCE(v->'movements', '[]'::jsonb)) LOOP
    IF m->>'id' = s.contabilita_movimento_id AND m->>'status' = 'previsto' THEN
      base := m;
      anticipo := least((m->>'amount')::numeric, greatest(0, COALESCE((m->>'acconto')::numeric, 0)));
      residuo := (m->>'amount')::numeric - anticipo;
      stamp := greatest(stamp, COALESCE((m->>'_u')::numeric, 0) + 1);
      IF residuo > importo THEN
        nuove := nuove || jsonb_build_array(m || jsonb_build_object('amount', (m->>'amount')::numeric - importo, '_u', stamp));
      ELSIF anticipo > 0 THEN
        nuove := nuove || jsonb_build_array(m || jsonb_build_object('amount', anticipo, 'status', 'cassa', 'acconto', 0, '_u', stamp));
      ELSE
        del := COALESCE(v->'deletedIds', '{}'::jsonb);
        v := jsonb_set(v, '{deletedIds}', del || jsonb_build_object('movements', COALESCE(del->'movements', '[]'::jsonb) || jsonb_build_array(m->>'id')));
      END IF;
    ELSE
      nuove := nuove || jsonb_build_array(m);
    END IF;
  END LOOP;
  IF base IS NULL THEN
    -- la voce non c'è più (modificata a mano in Contabilità): non si tocca altro
    RETURN;
  END IF;
  v := jsonb_set(v, '{movements}', nuove);

  -- 2) movimento di cassa alla data dell'incasso (può cadere in un altro anno contabile)
  k_cassa := public.gest_cont_key(p.data);
  base := (base - 'additions' - 'gestitoAcconti') || jsonb_build_object(
    'id', 'gestpag-' || p.id, 'date', p.data::text, 'amount', importo, 'acconto', 0,
    'status', 'cassa', 'paymentMethod', 'C', '_u', stamp);
  IF k_cassa = s.contabilita_key THEN
    v := jsonb_set(v, '{movements}', (v->'movements') || jsonb_build_array(base));
    UPDATE public.contabilita_state SET data = v, updated_by = auth.uid(), updated_at = clock_timestamp() WHERE key = s.contabilita_key;
  ELSE
    UPDATE public.contabilita_state SET data = v, updated_by = auth.uid(), updated_at = clock_timestamp() WHERE key = s.contabilita_key;
    UPDATE public.contabilita_state
    SET data = jsonb_set(data, '{movements}', COALESCE(data->'movements', '[]'::jsonb) || jsonb_build_array(base)),
        updated_by = auth.uid(), updated_at = clock_timestamp()
    WHERE key = k_cassa;
  END IF;
END $$;

-- Storno di un incasso in contanti: toglie il movimento di cassa e rimette la voce in competenza.
CREATE FUNCTION public.gest_cont_storno_contanti(_pagamento_id BIGINT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.gest_pagamenti;
  s public.gest_scadenze;
  v JSONB;
  nuove JSONB;
  importo NUMERIC(14,2);
  stamp NUMERIC := ceil(extract(epoch FROM clock_timestamp()) * 1000);
BEGIN
  SELECT * INTO p FROM public.gest_pagamenti WHERE id = _pagamento_id;
  SELECT * INTO s FROM public.gest_scadenze WHERE id = p.scadenza_id FOR NO KEY UPDATE;
  importo := abs(p.importo);
  IF NOT public.gest_cont_rimuovi_voce(public.gest_cont_key(p.data), 'gestpag-' || p.id) THEN
    RETURN;   -- quell'incasso non era passato dalla Contabilità
  END IF;

  IF s.contabilita_movimento_id IS NOT NULL THEN
    SELECT data INTO v FROM public.contabilita_state WHERE key = s.contabilita_key FOR UPDATE;
    IF v IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v->'movements', '[]'::jsonb)) m
                                 WHERE m->>'id' = s.contabilita_movimento_id AND m->>'status' = 'previsto') THEN
      SELECT jsonb_agg(CASE WHEN m->>'id' = s.contabilita_movimento_id
                            THEN m || jsonb_build_object('amount', (m->>'amount')::numeric + importo,
                                                         '_u', greatest(stamp, COALESCE((m->>'_u')::numeric, 0) + 1))
                            ELSE m END)
      INTO nuove FROM jsonb_array_elements(v->'movements') m;
      UPDATE public.contabilita_state SET data = jsonb_set(v, '{movements}', nuove), updated_by = auth.uid(), updated_at = clock_timestamp()
      WHERE key = s.contabilita_key;
      RETURN;
    END IF;
  END IF;
  -- la voce era stata chiusa del tutto: se ne crea una nuova per l'importo stornato
  PERFORM public.gest_cont_scrivi_competenza(s.id, importo);
END $$;

-- 4. Associazione bancaria → pagamento della scadenza ---------------------
-- Scatta quando in Contabilità → Conti un movimento bancario viene associato a una
-- voce in competenza nata da una scadenza. Non blocca mai l'associazione.
CREATE FUNCTION public.gest_fn_allocazione_bancaria() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.gest_scadenze;
  b public.bank_transactions;
BEGIN
  IF NEW.competence_id IS NULL THEN
    RETURN NEW;
  END IF;
  BEGIN
    SELECT * INTO s FROM public.gest_scadenze
    WHERE contabilita_movimento_id = NEW.competence_id AND annullata_il IS NULL;
    IF NOT FOUND THEN
      RETURN NEW;
    END IF;
    SELECT * INTO b FROM public.bank_transactions WHERE id = NEW.transaction_id;
    INSERT INTO public.gest_pagamenti
      (scadenza_id, data, importo, modalita, conto, origine, bank_allocation_id, bank_transaction_id, nota, utente)
    VALUES
      (s.id, b.booking_date, sign(s.importo) * NEW.amount, 'Banca', lower(b.bank), 'banca', NEW.id, b.id,
       left(b.description, 200), NEW.created_by);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Gestionale: associazione bancaria % non registrata sulla scadenza: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END $$;
CREATE TRIGGER gest_allocazione_bancaria AFTER INSERT ON public.bank_allocations
  FOR EACH ROW EXECUTE FUNCTION public.gest_fn_allocazione_bancaria();

-- Spostare una scadenza sposta anche la sua voce in competenza.
CREATE FUNCTION public.gest_fn_scadenza_sposta() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _residuo NUMERIC;
  _prima TEXT;
BEGIN
  IF NEW.data_scadenza IS DISTINCT FROM OLD.data_scadenza AND OLD.contabilita_movimento_id IS NOT NULL AND NEW.annullata_il IS NULL THEN
    BEGIN
      SELECT NEW.importo - COALESCE(sum(importo), 0) INTO _residuo FROM public.gest_pagamenti WHERE scadenza_id = NEW.id;
      IF public.gest_cont_rimuovi_voce(OLD.contabilita_key, OLD.contabilita_movimento_id) THEN
        _prima := COALESCE(current_setting('gest.sistema', true), '');
        PERFORM set_config('gest.sistema', '1', true);
        UPDATE public.gest_scadenze SET contabilita_key = NULL, contabilita_movimento_id = NULL WHERE id = NEW.id;
        PERFORM set_config('gest.sistema', _prima, true);
        PERFORM public.gest_cont_scrivi_competenza(NEW.id, _residuo);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Gestionale: voce in competenza non spostata per la scadenza %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER gest_scadenze_sposta AFTER UPDATE OF data_scadenza ON public.gest_scadenze
  FOR EACH ROW EXECUTE FUNCTION public.gest_fn_scadenza_sposta();

-- 5. Scadenzario: dice anche se la scadenza è collegata alla Contabilità ---
DROP VIEW public.gest_scadenzario;
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
       END AS stato,
       (s.contabilita_movimento_id IS NOT NULL) AS in_contabilita
FROM public.gest_scadenze s
JOIN public.gest_documenti d ON d.id = s.documento_id
LEFT JOIN public.gest_anagrafiche a ON a.id = s.anagrafica_id
LEFT JOIN LATERAL (
  SELECT sum(importo) AS pagato, max(data) AS ultimo_pagamento FROM public.gest_pagamenti WHERE scadenza_id = s.id
) p ON true
WHERE s.annullata_il IS NULL;

-- 6. Incassi, pagamenti e storni: ora con il conto -------------------------
DROP FUNCTION public.gest_registra_pagamento(UUID, NUMERIC, DATE, TEXT, TEXT);
CREATE FUNCTION public.gest_registra_pagamento(
  _scadenza_id UUID, _importo NUMERIC, _data DATE DEFAULT CURRENT_DATE, _conto TEXT DEFAULT 'contanti',
  _modalita TEXT DEFAULT NULL, _nota TEXT DEFAULT NULL
) RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _s public.gest_scadenze;
  _pagato NUMERIC;
  _residuo NUMERIC;
  _conto_ok TEXT := lower(btrim(COALESCE(_conto, '')));
  _pid BIGINT;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'gestionale', 'write') THEN
    RAISE EXCEPTION 'Permesso negato.';
  END IF;
  SELECT * INTO _s FROM public.gest_scadenze WHERE id = _scadenza_id FOR NO KEY UPDATE;
  IF NOT FOUND OR _s.annullata_il IS NOT NULL THEN
    RAISE EXCEPTION 'Scadenza non trovata.';
  END IF;
  IF _importo IS NULL OR _importo = 0 THEN
    RAISE EXCEPTION 'Indicare l''importo.';
  END IF;
  IF _conto_ok = '' THEN
    RAISE EXCEPTION 'Indicare il conto.';
  END IF;
  -- i movimenti in banca arrivano dall'associazione fatta in Contabilità, non da qui
  IF _conto_ok <> 'contanti' AND _s.contabilita_movimento_id IS NOT NULL THEN
    RAISE EXCEPTION 'I pagamenti in banca si registrano in Contabilità → Conti, associando il movimento bancario alla voce in competenza. Da qui si registrano solo i contanti.';
  END IF;
  SELECT COALESCE(sum(importo), 0) INTO _pagato FROM public.gest_pagamenti WHERE scadenza_id = _scadenza_id;
  _residuo := _s.importo - _pagato;
  IF sign(_importo) <> sign(_residuo) OR abs(_importo) > abs(_residuo) THEN
    RAISE EXCEPTION 'Importo non valido: il residuo della scadenza è %.', _residuo;
  END IF;
  INSERT INTO public.gest_pagamenti (scadenza_id, data, importo, modalita, conto, origine, nota, utente)
  VALUES (_scadenza_id, COALESCE(_data, CURRENT_DATE), _importo, COALESCE(_modalita, _s.modalita), _conto_ok, 'manuale', _nota, auth.uid())
  RETURNING id INTO _pid;
  IF _conto_ok = 'contanti' THEN
    PERFORM public.gest_cont_incasso_contanti(_pid);
  END IF;
  RETURN _residuo - _importo;
END $$;

CREATE OR REPLACE FUNCTION public.gest_storna_pagamento(_pagamento_id BIGINT, _nota TEXT DEFAULT NULL) RETURNS VOID
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
  IF _p.origine = 'banca' THEN
    RAISE EXCEPTION 'Questo pagamento arriva da un''associazione bancaria fatta in Contabilità: non si storna dal Gestionale.';
  END IF;
  PERFORM 1 FROM public.gest_scadenze WHERE id = _p.scadenza_id FOR NO KEY UPDATE;
  INSERT INTO public.gest_pagamenti (scadenza_id, data, importo, modalita, conto, origine, nota, storno_di, utente)
  VALUES (_p.scadenza_id, CURRENT_DATE, -_p.importo, _p.modalita, _p.conto, 'manuale', COALESCE(_nota, 'Storno'), _p.id, auth.uid());
  IF _p.conto = 'contanti' THEN
    PERFORM public.gest_cont_storno_contanti(_p.id);
  END IF;
END $$;

-- Collega alla Contabilità una scadenza rimasta fuori (anno non ancora aperto, o nata prima).
CREATE FUNCTION public.gest_collega_scadenza(_scadenza_id UUID) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _s public.gest_scadenze;
  _residuo NUMERIC;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'gestionale', 'write') THEN
    RAISE EXCEPTION 'Permesso negato.';
  END IF;
  SELECT * INTO _s FROM public.gest_scadenze WHERE id = _scadenza_id FOR NO KEY UPDATE;
  IF NOT FOUND OR _s.annullata_il IS NOT NULL THEN
    RAISE EXCEPTION 'Scadenza non trovata.';
  END IF;
  IF _s.contabilita_movimento_id IS NOT NULL THEN
    RETURN true;
  END IF;
  SELECT _s.importo - COALESCE(sum(importo), 0) INTO _residuo FROM public.gest_pagamenti WHERE scadenza_id = _s.id;
  IF _residuo = 0 THEN
    RETURN false;
  END IF;
  RETURN public.gest_cont_scrivi_competenza(_s.id, _residuo) IS NOT NULL;
END $$;

-- Prima nota: movimento manuale documentato e suo storno.
CREATE FUNCTION public.gest_prima_nota_registra(
  _data DATE, _verso TEXT, _importo NUMERIC, _conto TEXT, _descrizione TEXT, _documento_rif TEXT, _anagrafica_id UUID DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _id BIGINT;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'gestionale', 'write') THEN
    RAISE EXCEPTION 'Permesso negato.';
  END IF;
  IF _importo IS NULL OR _importo <= 0 THEN
    RAISE EXCEPTION 'L''importo deve essere maggiore di zero.';
  END IF;
  IF COALESCE(btrim(_documento_rif), '') = '' THEN
    RAISE EXCEPTION 'Indicare il documento che giustifica il movimento (scontrino, ricevuta, F24…).';
  END IF;
  INSERT INTO public.gest_prima_nota (data, verso, importo, conto, descrizione, documento_rif, anagrafica_id, utente)
  VALUES (COALESCE(_data, CURRENT_DATE), _verso, _importo, lower(btrim(_conto)), btrim(_descrizione), btrim(_documento_rif), _anagrafica_id, auth.uid())
  RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE FUNCTION public.gest_prima_nota_storna(_id BIGINT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _m public.gest_prima_nota;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'gestionale', 'write') THEN
    RAISE EXCEPTION 'Permesso negato.';
  END IF;
  SELECT * INTO _m FROM public.gest_prima_nota WHERE id = _id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimento non trovato.';
  END IF;
  IF _m.storno_di IS NOT NULL THEN
    RAISE EXCEPTION 'Uno storno non può essere stornato.';
  END IF;
  INSERT INTO public.gest_prima_nota (data, verso, importo, conto, descrizione, documento_rif, anagrafica_id, storno_di, utente)
  VALUES (CURRENT_DATE, _m.verso, -_m.importo, _m.conto, 'Storno: ' || _m.descrizione, _m.documento_rif, _m.anagrafica_id, _m.id, auth.uid());
END $$;

-- Rete di sicurezza: recupera le associazioni bancarie che non hanno ancora il loro
-- pagamento sulla scadenza. Restituisce quante ne ha recuperate.
CREATE FUNCTION public.gest_riallinea_banca() RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _n INTEGER;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'gestionale', 'write') THEN
    RAISE EXCEPTION 'Permesso negato.';
  END IF;
  INSERT INTO public.gest_pagamenti
    (scadenza_id, data, importo, modalita, conto, origine, bank_allocation_id, bank_transaction_id, nota, utente)
  SELECT s.id, b.booking_date, sign(s.importo) * a.amount, 'Banca', lower(b.bank), 'banca', a.id, b.id, left(b.description, 200), a.created_by
  FROM public.bank_allocations a
  JOIN public.bank_transactions b ON b.id = a.transaction_id
  JOIN public.gest_scadenze s ON s.contabilita_movimento_id = a.competence_id AND s.annullata_il IS NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.gest_pagamenti p WHERE p.bank_allocation_id = a.id);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

-- 7. Scadenze, annullamento e guardia aggiornati ---------------------------
CREATE OR REPLACE FUNCTION public.gest_fn_scadenza_guardia() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF COALESCE(current_setting('gest.sistema', true), '') = '1' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Le scadenze nascono dalla conferma dei documenti.';
  END IF;
  IF (NEW.documento_id, NEW.anagrafica_id, NEW.verso, NEW.numero_rata, NEW.importo, NEW.annullata_il,
      NEW.contabilita_key, NEW.contabilita_movimento_id)
     IS DISTINCT FROM (OLD.documento_id, OLD.anagrafica_id, OLD.verso, OLD.numero_rata, OLD.importo, OLD.annullata_il,
      OLD.contabilita_key, OLD.contabilita_movimento_id) THEN
    RAISE EXCEPTION 'Di una scadenza si possono cambiare solo data, modalità e note.';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.gest_genera_scadenze(_documento_id UUID) RETURNS VOID
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
  _sid UUID;
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
            _i + 1, _data, _importo, _modalita)
    RETURNING id INTO _sid;
    BEGIN
      PERFORM public.gest_cont_scrivi_competenza(_sid, NULL);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Scadenza % non collegata alla Contabilità: %', _sid, SQLERRM;
    END;
  END LOOP;
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
    PERFORM public.gest_cont_togli_competenza(s.id) FROM public.gest_scadenze s WHERE s.documento_id = _d.id AND s.annullata_il IS NULL;
    UPDATE public.gest_scadenze SET annullata_il = now() WHERE documento_id = _d.id AND annullata_il IS NULL;
  END IF;
  UPDATE public.gest_documenti
  SET stato = 'annullato', annullato_il = now(), motivo_annullamento = _motivo
  WHERE id = _documento_id;
  PERFORM set_config('gest.sistema', '', true);
END $$;

-- 8. Privilegi espliciti (prima delle policy) -----------------------------
GRANT SELECT ON public.gest_prima_nota, public.gest_prima_nota_vista, public.gest_scadenzario TO authenticated;
GRANT ALL ON public.gest_prima_nota TO service_role;
GRANT SELECT ON public.gest_prima_nota_vista, public.gest_scadenzario TO service_role;

REVOKE ALL ON FUNCTION public.gest_cont_key(DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gest_cont_rimuovi_voce(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gest_cont_scrivi_competenza(UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gest_cont_togli_competenza(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gest_cont_incasso_contanti(BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gest_cont_storno_contanti(BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gest_fn_allocazione_bancaria() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gest_fn_scadenza_sposta() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gest_genera_scadenze(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gest_registra_pagamento(UUID, NUMERIC, DATE, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gest_storna_pagamento(BIGINT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gest_collega_scadenza(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gest_riallinea_banca() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gest_prima_nota_registra(DATE, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gest_prima_nota_storna(BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gest_annulla_documento(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gest_cont_key(DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gest_registra_pagamento(UUID, NUMERIC, DATE, TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gest_storna_pagamento(BIGINT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gest_collega_scadenza(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gest_riallinea_banca() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gest_prima_nota_registra(DATE, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gest_prima_nota_storna(BIGINT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gest_annulla_documento(UUID, TEXT) TO authenticated, service_role;

-- 9. Sicurezza (RLS) -------------------------------------------------------
ALTER TABLE public.gest_prima_nota ENABLE ROW LEVEL SECURITY;
CREATE POLICY gest_prima_nota_select ON public.gest_prima_nota FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'gestionale', 'read'));
