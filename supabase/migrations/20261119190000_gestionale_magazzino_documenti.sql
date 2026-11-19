-- =====================================================================
-- GESTIONALE · Fase 3 — Magazzino dai documenti
-- La bolla di carico confermata carica il magazzino (pezze e bagni per i
-- tessuti); il DDT confermato lo scarica. L'annullamento storna i movimenti.
-- Sola struttura, solo oggetti del Gestionale (prefisso gest_).
-- =====================================================================

-- 1. Movimenti collegati al documento che li ha generati ---------------
ALTER TABLE public.gest_movimenti
  ADD COLUMN documento_id UUID REFERENCES public.gest_documenti(id),
  ADD COLUMN riga_id      UUID;
CREATE INDEX gest_movimenti_documento_idx ON public.gest_movimenti (documento_id);

-- 2. Dettaglio pezze di una riga ---------------------------------------
-- Bolla di carico: le pezze arrivate (bagno, metri, posizione).
-- DDT: le pezze da cui si taglia (pezza, metri).
CREATE TABLE public.gest_documenti_righe_pezze (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  riga_id      UUID NOT NULL REFERENCES public.gest_documenti_righe(id) ON DELETE CASCADE,
  pezza_id     UUID REFERENCES public.gest_pezze(id),
  codice_bagno TEXT,
  posizione    TEXT,
  metri        NUMERIC(10,2) NOT NULL CHECK (metri > 0),
  ordine       INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX gest_documenti_righe_pezze_riga_idx ON public.gest_documenti_righe_pezze (riga_id, ordine);
CREATE INDEX gest_documenti_righe_pezze_pezza_idx ON public.gest_documenti_righe_pezze (pezza_id);

-- Modificabile solo finché il documento è in bozza.
CREATE FUNCTION public.gest_fn_riga_pezze_guardia() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _stato TEXT;
  _riga UUID := CASE WHEN TG_OP = 'DELETE' THEN OLD.riga_id ELSE NEW.riga_id END;
BEGIN
  IF COALESCE(current_setting('gest.sistema', true), '') = '1' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  SELECT d.stato INTO _stato
  FROM public.gest_documenti_righe r JOIN public.gest_documenti d ON d.id = r.documento_id
  WHERE r.id = _riga;
  -- _stato nullo: la riga è appena stata eliminata (cancellazione a cascata da una bozza)
  IF _stato IS NOT NULL AND _stato <> 'bozza' THEN
    RAISE EXCEPTION 'Le pezze di una riga si modificano solo sui documenti in bozza.';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER gest_documenti_righe_pezze_guardia BEFORE INSERT OR UPDATE OR DELETE ON public.gest_documenti_righe_pezze
  FOR EACH ROW EXECUTE FUNCTION public.gest_fn_riga_pezze_guardia();
CREATE TRIGGER gest_documenti_righe_pezze_storico AFTER INSERT OR UPDATE OR DELETE ON public.gest_documenti_righe_pezze
  FOR EACH ROW EXECUTE FUNCTION public.gest_fn_storico();

-- 3. Movimentazione alla conferma --------------------------------------
-- Muovono il magazzino solo le righe «articolo» collegate a una variante.
CREATE FUNCTION public.gest_movimenta_documento(_documento_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _d public.gest_documenti;
  _r RECORD;
  _c RECORD;
  _n INTEGER := 0;
  _rif TEXT;
  _somma NUMERIC;
  _bagno UUID;
  _pezza public.gest_pezze;
  _residuo NUMERIC;
BEGIN
  SELECT * INTO _d FROM public.gest_documenti WHERE id = _documento_id;
  IF _d.tipo NOT IN ('bolla_carico','ddt') OR _d.stato <> 'confermato' THEN
    RETURN;
  END IF;
  _rif := _d.numero || '/' || _d.anno;

  FOR _r IN
    SELECT r.id, r.posizione, r.quantita, r.variante_id, r.descrizione, a.categoria
    FROM public.gest_documenti_righe r
    JOIN public.gest_varianti v ON v.id = r.variante_id
    JOIN public.gest_articoli a ON a.id = v.articolo_id
    WHERE r.documento_id = _documento_id AND r.tipo_riga = 'articolo'
    ORDER BY r.posizione, r.created_at
  LOOP
    _n := _n + 1;
    IF _r.quantita <= 0 THEN
      RAISE EXCEPTION 'Riga % (%): la quantità deve essere maggiore di zero.', _r.posizione, _r.descrizione;
    END IF;

    IF _r.categoria = 'tessuto' THEN
      SELECT sum(metri) INTO _somma FROM public.gest_documenti_righe_pezze WHERE riga_id = _r.id;
      IF _somma IS NULL THEN
        RAISE EXCEPTION 'Riga % (%): indicare le pezze.', _r.posizione, _r.descrizione;
      END IF;
      IF _somma <> _r.quantita THEN
        RAISE EXCEPTION 'Riga % (%): le pezze sommano % m, la riga ne indica %.', _r.posizione, _r.descrizione, _somma, _r.quantita;
      END IF;

      FOR _c IN SELECT * FROM public.gest_documenti_righe_pezze WHERE riga_id = _r.id ORDER BY ordine, created_at LOOP
        IF _d.tipo = 'bolla_carico' THEN
          _bagno := NULL;
          IF COALESCE(btrim(_c.codice_bagno), '') <> '' THEN
            INSERT INTO public.gest_bagni (variante_id, codice_bagno, fornitore, data_arrivo)
            VALUES (_r.variante_id, btrim(_c.codice_bagno), _d.intestatario->>'ragione_sociale', _d.data)
            ON CONFLICT (variante_id, codice_bagno) DO UPDATE SET codice_bagno = EXCLUDED.codice_bagno
            RETURNING id INTO _bagno;
          END IF;
          INSERT INTO public.gest_pezze (variante_id, bagno_id, lunghezza_iniziale_m, posizione)
          VALUES (_r.variante_id, _bagno, _c.metri, _c.posizione)
          RETURNING * INTO _pezza;
          INSERT INTO public.gest_movimenti (variante_id, pezza_id, tipo, quantita, riferimento_tipo, riferimento_id, documento_id, riga_id, utente)
          VALUES (_r.variante_id, _pezza.id, 'carico', _c.metri, _d.tipo, _rif, _d.id, _r.id, auth.uid());
          UPDATE public.gest_documenti_righe_pezze SET pezza_id = _pezza.id WHERE id = _c.id;
        ELSE
          IF _c.pezza_id IS NULL THEN
            RAISE EXCEPTION 'Riga % (%): scegliere la pezza da cui tagliare.', _r.posizione, _r.descrizione;
          END IF;
          SELECT * INTO _pezza FROM public.gest_pezze WHERE id = _c.pezza_id FOR UPDATE;
          IF _pezza.variante_id <> _r.variante_id THEN
            RAISE EXCEPTION 'Riga % (%): la pezza % è di un altro articolo.', _r.posizione, _r.descrizione, _pezza.codice;
          END IF;
          IF _pezza.stato <> 'disponibile' OR _pezza.archiviato_il IS NOT NULL THEN
            RAISE EXCEPTION 'Riga % (%): la pezza % non è disponibile.', _r.posizione, _r.descrizione, _pezza.codice;
          END IF;
          SELECT COALESCE(sum(quantita), 0) INTO _residuo FROM public.gest_movimenti WHERE pezza_id = _pezza.id;
          IF _c.metri > _residuo THEN
            RAISE EXCEPTION 'Riga % (%): la pezza % ha % m residui, ne servono %.', _r.posizione, _r.descrizione, _pezza.codice, _residuo, _c.metri;
          END IF;
          INSERT INTO public.gest_movimenti (variante_id, pezza_id, tipo, quantita, riferimento_tipo, riferimento_id, documento_id, riga_id, utente)
          VALUES (_r.variante_id, _pezza.id, 'scarico', -_c.metri, _d.tipo, _rif, _d.id, _r.id, auth.uid());
          IF _residuo - _c.metri = 0 THEN
            UPDATE public.gest_pezze SET stato = 'esaurita' WHERE id = _pezza.id;
          END IF;
        END IF;
      END LOOP;
    ELSE
      INSERT INTO public.gest_movimenti (variante_id, tipo, quantita, riferimento_tipo, riferimento_id, documento_id, riga_id, utente)
      VALUES (_r.variante_id,
              CASE WHEN _d.tipo = 'bolla_carico' THEN 'carico' ELSE 'scarico' END,
              CASE WHEN _d.tipo = 'bolla_carico' THEN _r.quantita ELSE -_r.quantita END,
              _d.tipo, _rif, _d.id, _r.id, auth.uid());
    END IF;
  END LOOP;
END $$;

-- Storno dei movimenti di un documento che viene annullato.
CREATE FUNCTION public.gest_storna_documento(_documento_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _d public.gest_documenti;
  _m RECORD;
  _altri INTEGER;
  _codice TEXT;
BEGIN
  SELECT * INTO _d FROM public.gest_documenti WHERE id = _documento_id;
  FOR _m IN
    SELECT m.* FROM public.gest_movimenti m
    WHERE m.documento_id = _documento_id AND m.tipo <> 'storno'
      AND NOT EXISTS (SELECT 1 FROM public.gest_movimenti s WHERE s.storno_di = m.id)
    ORDER BY m.id
  LOOP
    IF _m.pezza_id IS NOT NULL THEN
      PERFORM 1 FROM public.gest_pezze WHERE id = _m.pezza_id FOR UPDATE;
      IF _d.tipo = 'bolla_carico' THEN
        -- la pezza caricata da questa bolla non deve avere altri movimenti ancora validi
        -- (un taglio poi stornato non conta)
        SELECT count(*) INTO _altri FROM public.gest_movimenti x
        WHERE x.pezza_id = _m.pezza_id AND x.id <> _m.id AND x.tipo <> 'storno'
          AND NOT EXISTS (SELECT 1 FROM public.gest_movimenti s WHERE s.storno_di = x.id);
        IF _altri > 0 THEN
          SELECT codice INTO _codice FROM public.gest_pezze WHERE id = _m.pezza_id;
          RAISE EXCEPTION 'La pezza % caricata da questa bolla è già stata movimentata: la bolla non si può annullare.', _codice;
        END IF;
      END IF;
    END IF;

    INSERT INTO public.gest_movimenti (variante_id, pezza_id, tipo, quantita, riferimento_tipo, riferimento_id, documento_id, riga_id, storno_di, nota, utente)
    VALUES (_m.variante_id, _m.pezza_id, 'storno', -_m.quantita, _m.riferimento_tipo, _m.riferimento_id, _m.documento_id, _m.riga_id, _m.id,
            'Annullamento documento', auth.uid());

    IF _m.pezza_id IS NOT NULL THEN
      IF _d.tipo = 'bolla_carico' THEN
        UPDATE public.gest_pezze SET stato = 'esaurita', archiviato_il = now() WHERE id = _m.pezza_id;
      ELSE
        UPDATE public.gest_pezze SET stato = 'disponibile' WHERE id = _m.pezza_id AND stato = 'esaurita';
      END IF;
    END IF;
  END LOOP;
END $$;

-- 4. Conferma e annullamento: ora muovono anche il magazzino -----------
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
  UPDATE public.gest_documenti
  SET stato = 'annullato', annullato_il = now(), motivo_annullamento = _motivo
  WHERE id = _documento_id;
  PERFORM set_config('gest.sistema', '', true);
END $$;

-- 5. Privilegi espliciti (prima delle policy) ---------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gest_documenti_righe_pezze TO authenticated;
GRANT ALL ON public.gest_documenti_righe_pezze TO service_role;

REVOKE ALL ON FUNCTION public.gest_fn_riga_pezze_guardia() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gest_movimenta_documento(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gest_storna_documento(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gest_conferma_documento(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gest_annulla_documento(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gest_conferma_documento(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gest_annulla_documento(UUID, TEXT) TO authenticated, service_role;

-- 6. Sicurezza (RLS) ----------------------------------------------------
ALTER TABLE public.gest_documenti_righe_pezze ENABLE ROW LEVEL SECURITY;
CREATE POLICY gest_documenti_righe_pezze_select ON public.gest_documenti_righe_pezze FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'gestionale', 'read'));
CREATE POLICY gest_documenti_righe_pezze_insert ON public.gest_documenti_righe_pezze FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), 'gestionale', 'write'));
CREATE POLICY gest_documenti_righe_pezze_update ON public.gest_documenti_righe_pezze FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'gestionale', 'write'))
  WITH CHECK (public.has_permission(auth.uid(), 'gestionale', 'write'));
CREATE POLICY gest_documenti_righe_pezze_delete ON public.gest_documenti_righe_pezze FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(), 'gestionale', 'write'));
