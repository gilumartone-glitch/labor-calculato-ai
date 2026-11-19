-- =====================================================================
-- GESTIONALE · Fase 6 — Dati per la fattura elettronica
-- Sola struttura. Tocca soltanto oggetti gest_.
--  * documenti: CIG, CUP, esigibilità IVA (scissione dei pagamenti), bollo virtuale
--  * anagrafiche: esigibilità IVA abituale del cliente
--  * impostazioni: l'amministratore può aggiungere chiavi (dati dell'azienda)
--  * scadenze: con la scissione dei pagamenti si incassa l'imponibile
-- =====================================================================

ALTER TABLE public.gest_documenti
  ADD COLUMN cig             TEXT,
  ADD COLUMN cup             TEXT,
  ADD COLUMN esigibilita_iva TEXT NOT NULL DEFAULT 'I' CHECK (esigibilita_iva IN ('I','D','S')),
  ADD COLUMN bollo_virtuale  BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.gest_anagrafiche
  ADD COLUMN esigibilita_iva TEXT NOT NULL DEFAULT 'I' CHECK (esigibilita_iva IN ('I','D','S'));

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
  -- scissione dei pagamenti: l'IVA la versa il cliente all'Erario, si incassa solo l'imponibile
  _totale := (_d.totale - CASE WHEN _d.esigibilita_iva = 'S' AND _d.tipo IN ('fattura','nota_credito') THEN _d.imposta ELSE 0 END) * _segno;

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
     cig, cup, esigibilita_iva, bollo_virtuale)
  VALUES
    (_tipo, 'bozza', _o.serie, CURRENT_DATE, _o.anagrafica_id, _o.oggetto,
     CASE WHEN _tipo = 'fattura_fornitore' THEN NULL ELSE _o.riferimento_esterno END,
     CASE WHEN _tipo = 'fattura_fornitore' THEN NULL ELSE _o.data_esterna END,
     _o.pagamento, _o.condizione_pagamento_id, _o.consegna_prevista, _o.destinazione, _o.note, _o.note_interne,
     _o.id, _o.design_draft_id, auth.uid(),
     CASE WHEN _tipo = 'fattura_fornitore' THEN NULL ELSE _o.cig END,
     CASE WHEN _tipo = 'fattura_fornitore' THEN NULL ELSE _o.cup END,
     CASE WHEN _tipo = 'fattura_fornitore' THEN 'I' ELSE _o.esigibilita_iva END,
     CASE WHEN _tipo = 'fattura_fornitore' THEN false ELSE _o.bollo_virtuale END)
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

-- Privilegi espliciti (prima delle policy)
GRANT INSERT ON public.gest_impostazioni TO authenticated;
REVOKE ALL ON FUNCTION public.gest_genera_scadenze(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gest_deriva_documento(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gest_deriva_documento(UUID, TEXT) TO authenticated, service_role;

CREATE POLICY gest_impostazioni_insert ON public.gest_impostazioni FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
