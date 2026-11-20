-- =====================================================================
-- GESTIONALE — Ordine del cliente: il nome che gli dà il cliente (OP, RdA, OC…)
-- in un campo, il numero in un altro. Sola struttura, solo oggetti gest_.
-- =====================================================================
ALTER TABLE public.gest_documenti   ADD COLUMN ordine_cliente_tipo TEXT;   -- come il cliente chiama il suo ordine
ALTER TABLE public.gest_anagrafiche ADD COLUMN ordine_cliente_tipo TEXT;   -- nome abituale per quel cliente

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
     cig, cup, esigibilita_iva, bollo_virtuale, produzione, accompagnatoria, ordine_cliente_tipo)
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
     (_o.tipo = 'ordine' AND _tipo = 'fattura'),
     CASE WHEN _tipo = 'fattura_fornitore' THEN NULL ELSE _o.ordine_cliente_tipo END)
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

REVOKE ALL ON FUNCTION public.gest_deriva_documento(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gest_deriva_documento(UUID, TEXT) TO authenticated, service_role;
