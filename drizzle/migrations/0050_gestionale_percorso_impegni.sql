-- =====================================================================
-- GESTIONALE · Fase 7 — Percorso dei documenti e materiale impegnato
-- Sola struttura. Tocca soltanto oggetti gest_.
--  * campo Produzione (nome dello spettacolo) su tutti i documenti
--  * percorso: preventivo → conferma d'ordine → DDT → fattura, con numero e data
--  * la conferma d'ordine impegna il materiale; DDT e fattura accompagnatoria lo scaricano
-- =====================================================================

ALTER TABLE public.gest_documenti
  ADD COLUMN produzione        TEXT,                              -- nome dello spettacolo / produzione
  ADD COLUMN accompagnatoria   BOOLEAN NOT NULL DEFAULT false,    -- fattura che accompagna la merce: scarica il magazzino
  ADD COLUMN impegno_chiuso_il TIMESTAMPTZ;                       -- conferma d'ordine: materiale liberato a mano

-- Una fattura che nasce da un DDT non può essere accompagnatoria: il DDT ha già scaricato.
CREATE FUNCTION public.gest_fn_accompagnatoria() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.accompagnatoria THEN
    IF NEW.tipo <> 'fattura' THEN
      NEW.accompagnatoria := false;
    ELSIF NEW.origine_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.gest_documenti o WHERE o.id = NEW.origine_id AND o.tipo = 'ddt') THEN
      RAISE EXCEPTION 'Questa fattura nasce da un DDT, che ha già scaricato il magazzino: non può essere accompagnatoria.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gest_documenti_accompagnatoria BEFORE INSERT OR UPDATE OF accompagnatoria ON public.gest_documenti
  FOR EACH ROW EXECUTE FUNCTION public.gest_fn_accompagnatoria();

-- Percorso: i documenti da cui discende un documento, dal più vecchio al più recente.
CREATE FUNCTION public.gest_percorso_documento(_documento_id UUID)
RETURNS TABLE (id UUID, tipo TEXT, numero INTEGER, anno INTEGER, serie TEXT, data DATE, stato TEXT, livello INTEGER)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH RECURSIVE su AS (
    SELECT d.id, d.tipo, d.numero, d.anno, d.serie, d.data, d.stato, d.origine_id, 0 AS livello
    FROM public.gest_documenti d WHERE d.id = _documento_id
    UNION ALL
    SELECT p.id, p.tipo, p.numero, p.anno, p.serie, p.data, p.stato, p.origine_id, su.livello + 1
    FROM public.gest_documenti p JOIN su ON p.id = su.origine_id
    WHERE su.livello < 20
  )
  SELECT su.id, su.tipo, su.numero, su.anno, su.serie, su.data, su.stato, su.livello
  FROM su WHERE su.livello > 0 ORDER BY su.livello DESC
$$;

-- Materiale impegnato: righe articolo delle conferme d'ordine non ancora consegnate.
-- Si libera da solo quando il DDT (o la fattura accompagnatoria) viene confermato,
-- quando l'ordine viene annullato, oppure a mano.
CREATE VIEW public.gest_impegni WITH (security_invoker = true) AS
SELECT r.id AS riga_id, r.documento_id, d.numero, d.anno, d.serie, d.data, d.consegna_prevista, d.produzione,
       d.anagrafica_id, COALESCE(d.intestatario->>'ragione_sociale', '') AS ragione_sociale,
       r.variante_id, r.descrizione, r.um,
       r.quantita AS ordinata,
       LEAST(r.quantita, COALESCE(e.evasa, 0)) AS consegnata,
       GREATEST(r.quantita - COALESCE(e.evasa, 0), 0) AS impegnata
FROM public.gest_documenti_righe r
JOIN public.gest_documenti d ON d.id = r.documento_id
LEFT JOIN LATERAL (
  SELECT sum(x.quantita) AS evasa
  FROM public.gest_documenti_righe x
  JOIN public.gest_documenti dx ON dx.id = x.documento_id
  WHERE x.riga_origine_id = r.id AND dx.stato = 'confermato'
    AND (dx.tipo = 'ddt' OR (dx.tipo = 'fattura' AND dx.accompagnatoria))
) e ON true
WHERE d.tipo = 'ordine' AND d.stato = 'confermato' AND d.impegno_chiuso_il IS NULL
  AND r.tipo_riga = 'articolo' AND r.variante_id IS NOT NULL
  AND r.quantita - COALESCE(e.evasa, 0) > 0;

-- Giacenze: quanto c'è, quanto è impegnato, quanto è davvero disponibile.
CREATE OR REPLACE VIEW public.gest_giacenze_varianti WITH (security_invoker = true) AS
SELECT v.id AS variante_id, v.codice, v.articolo_id,
       COALESCE((SELECT sum(quantita) FROM public.gest_movimenti m WHERE m.variante_id = v.id), 0) AS giacenza,
       COALESCE((SELECT sum(i.impegnata) FROM public.gest_impegni i WHERE i.variante_id = v.id), 0) AS impegnato,
       COALESCE((SELECT sum(quantita) FROM public.gest_movimenti m WHERE m.variante_id = v.id), 0)
         - COALESCE((SELECT sum(i.impegnata) FROM public.gest_impegni i WHERE i.variante_id = v.id), 0) AS disponibile
FROM public.gest_varianti v
WHERE v.archiviato_il IS NULL;

-- Libera (o rimette) a mano il materiale impegnato da una conferma d'ordine.
CREATE FUNCTION public.gest_chiudi_impegno(_documento_id UUID, _chiudi BOOLEAN DEFAULT true) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _d public.gest_documenti;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'gestionale', 'write') THEN
    RAISE EXCEPTION 'Permesso negato.';
  END IF;
  SELECT * INTO _d FROM public.gest_documenti WHERE id = _documento_id FOR UPDATE;
  IF NOT FOUND OR _d.tipo <> 'ordine' OR _d.stato <> 'confermato' THEN
    RAISE EXCEPTION 'Solo una conferma d''ordine confermata impegna materiale.';
  END IF;
  PERFORM set_config('gest.sistema', '1', true);
  UPDATE public.gest_documenti SET impegno_chiuso_il = CASE WHEN _chiudi THEN now() END WHERE id = _documento_id;
  PERFORM set_config('gest.sistema', '', true);
END $$;

CREATE OR REPLACE FUNCTION public.gest_movimenta_documento(_documento_id UUID) RETURNS VOID
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
  IF NOT (_d.tipo IN ('bolla_carico','ddt') OR (_d.tipo = 'fattura' AND _d.accompagnatoria)) OR _d.stato <> 'confermato' THEN
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
  IF _d.tipo IN ('bolla_carico','ddt') OR (_d.tipo = 'fattura' AND _d.accompagnatoria) THEN
    PERFORM public.gest_movimenta_documento(_d.id);
  END IF;
  IF _d.tipo IN ('fattura','nota_credito','fattura_fornitore') THEN
    PERFORM public.gest_genera_scadenze(_d.id);
  END IF;
  PERFORM set_config('gest.sistema', '', true);
  RETURN _d;
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
     consegna_prevista, destinazione, note, note_interne, origine_id, design_draft_id, creato_da,
     cig, cup, esigibilita_iva, bollo_virtuale, produzione, accompagnatoria)
  VALUES
    (_tipo, 'bozza', _o.serie, CURRENT_DATE, _o.anagrafica_id, _o.oggetto,
     CASE WHEN _tipo = 'fattura_fornitore' THEN NULL ELSE _o.riferimento_esterno END,
     CASE WHEN _tipo = 'fattura_fornitore' THEN NULL ELSE _o.data_esterna END,
     _o.pagamento, _o.condizione_pagamento_id, _o.consegna_prevista, _o.destinazione, _o.note, _o.note_interne,
     _o.id, _o.design_draft_id, auth.uid(),
     CASE WHEN _tipo = 'fattura_fornitore' THEN NULL ELSE _o.cig END,
     CASE WHEN _tipo = 'fattura_fornitore' THEN NULL ELSE _o.cup END,
     CASE WHEN _tipo = 'fattura_fornitore' THEN 'I' ELSE _o.esigibilita_iva END,
     CASE WHEN _tipo = 'fattura_fornitore' THEN false ELSE _o.bollo_virtuale END,
     _o.produzione,
     -- fattura fatta direttamente dalla conferma d'ordine, senza DDT: accompagna la merce e la scarica
     (_o.tipo = 'ordine' AND _tipo = 'fattura'))
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

-- Privilegi espliciti
GRANT SELECT ON public.gest_impegni, public.gest_giacenze_varianti TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.gest_fn_accompagnatoria() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gest_percorso_documento(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gest_chiudi_impegno(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gest_movimenta_documento(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gest_conferma_documento(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gest_deriva_documento(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gest_percorso_documento(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gest_chiudi_impegno(UUID, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gest_conferma_documento(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gest_deriva_documento(UUID, TEXT) TO authenticated, service_role;
