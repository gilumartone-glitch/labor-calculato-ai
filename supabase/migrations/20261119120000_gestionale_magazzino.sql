-- =====================================================================
-- GESTIONALE · Fase 1 — Magazzino: articoli, varianti, bagni, pezze,
-- registro movimenti, storico completo.
--
-- Solo oggetti NUOVI con prefisso gest_: nessuna tabella esistente viene
-- modificata. Il collegamento con il magazzino di Produzione è il campo
-- facoltativo gest_varianti.inventory_item_id.
-- =====================================================================

-- 1. Pagina e permessi ------------------------------------------------
INSERT INTO public.app_pages (key, label, description, ordine)
VALUES ('gestionale', 'Gestionale', 'Articoli e varianti, bagni e pezze, movimenti di magazzino, documenti', 95)
ON CONFLICT (key) DO NOTHING;

-- 2. Storico: chi ha cambiato cosa, quando, prima e dopo ---------------
CREATE TABLE public.gest_storico (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tabella     TEXT        NOT NULL,
  record_id   TEXT        NOT NULL,
  operazione  TEXT        NOT NULL CHECK (operazione IN ('INSERT','UPDATE')),
  utente      UUID,
  quando      TIMESTAMPTZ NOT NULL DEFAULT now(),
  prima       JSONB,
  dopo        JSONB
);
CREATE INDEX gest_storico_record_idx ON public.gest_storico (tabella, record_id, quando DESC);
CREATE INDEX gest_storico_quando_idx ON public.gest_storico (quando DESC);
COMMENT ON TABLE public.gest_storico IS
  'Storico immutabile del Gestionale: ogni inserimento e modifica, con valori prima e dopo.';

CREATE FUNCTION public.gest_fn_storico() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.gest_storico (tabella, record_id, operazione, utente, dopo)
    VALUES (TG_TABLE_NAME, NEW.id::text, TG_OP, auth.uid(), to_jsonb(NEW));
  ELSIF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    INSERT INTO public.gest_storico (tabella, record_id, operazione, utente, prima, dopo)
    VALUES (TG_TABLE_NAME, NEW.id::text, TG_OP, auth.uid(), to_jsonb(OLD), to_jsonb(NEW));
  END IF;
  RETURN NEW;
END $$;

-- Niente cancellazioni reali: si archivia
CREATE FUNCTION public.gest_fn_blocca_delete() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Cancellazione non consentita su %: archiviare il record.', TG_TABLE_NAME;
END $$;

-- Registri: solo inserimento
CREATE FUNCTION public.gest_fn_solo_inserimento() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION '% è un registro: si corregge con uno storno, non modificando.', TG_TABLE_NAME;
END $$;

CREATE FUNCTION public.gest_fn_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER gest_storico_immutabile
  BEFORE UPDATE OR DELETE ON public.gest_storico
  FOR EACH ROW EXECUTE FUNCTION public.gest_fn_solo_inserimento();

-- 3. Articoli e varianti ----------------------------------------------
CREATE TABLE public.gest_articoli (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codice        TEXT NOT NULL UNIQUE,
  nome          TEXT NOT NULL,
  categoria     TEXT NOT NULL CHECK (categoria IN ('tessuto','pannello','altro')),
  um            TEXT NOT NULL CHECK (um IN ('m','m2','pz')),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  archiviato_il TIMESTAMPTZ
);
COMMENT ON TABLE public.gest_articoli IS 'Tipo di materiale: es. Velluto, Molton, Forex, D-bond.';

CREATE TABLE public.gest_varianti (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  articolo_id          UUID NOT NULL REFERENCES public.gest_articoli(id),
  codice               TEXT NOT NULL UNIQUE,
  colore               TEXT,
  ignifugo             BOOLEAN NOT NULL DEFAULT false,
  classe_reazione      TEXT,
  certificato_rif      TEXT,
  -- tessuti
  altezza_cm           NUMERIC(7,1),
  peso_gm2             NUMERIC(7,1),
  -- pannelli
  spessore_mm          NUMERIC(6,2),
  finitura             TEXT,
  formato_larghezza_mm INTEGER,
  formato_altezza_mm   INTEGER,
  costo_um             NUMERIC(12,4),
  prezzo_um            NUMERIC(12,4),
  -- collegamento facoltativo alla scorta del magazzino di Produzione
  inventory_item_id    UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  note                 TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  archiviato_il        TIMESTAMPTZ,
  CONSTRAINT gest_varianti_combinazione_unica UNIQUE NULLS NOT DISTINCT
    (articolo_id, colore, altezza_cm, peso_gm2, ignifugo, spessore_mm, finitura,
     formato_larghezza_mm, formato_altezza_mm)
);
CREATE INDEX gest_varianti_articolo_idx ON public.gest_varianti (articolo_id);
CREATE INDEX gest_varianti_inv_idx ON public.gest_varianti (inventory_item_id);
COMMENT ON TABLE public.gest_varianti IS
  'Combinazione vendibile: colore x altezza x peso x ignifugo (tessuti), spessore x finitura x formato (pannelli).';

-- 4. Bagni e pezze ----------------------------------------------------
CREATE TABLE public.gest_bagni (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variante_id   UUID NOT NULL REFERENCES public.gest_varianti(id),
  codice_bagno  TEXT NOT NULL,
  fornitore     TEXT,
  data_arrivo   DATE,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  archiviato_il TIMESTAMPTZ,
  UNIQUE (variante_id, codice_bagno)
);
COMMENT ON TABLE public.gest_bagni IS
  'Bagno di tintura: pezze dello stesso colore ma di bagni diversi non sono intercambiabili.';

CREATE SEQUENCE public.gest_pezze_codice_seq START 1;

CREATE TABLE public.gest_pezze (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codice               TEXT NOT NULL UNIQUE,
  variante_id          UUID NOT NULL REFERENCES public.gest_varianti(id),
  bagno_id             UUID REFERENCES public.gest_bagni(id),
  lunghezza_iniziale_m NUMERIC(10,2) NOT NULL CHECK (lunghezza_iniziale_m > 0),
  posizione            TEXT,
  stato                TEXT NOT NULL DEFAULT 'disponibile'
                       CHECK (stato IN ('disponibile','esaurita','scarto')),
  note                 TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  archiviato_il        TIMESTAMPTZ
);
CREATE INDEX gest_pezze_variante_idx ON public.gest_pezze (variante_id, stato);
CREATE INDEX gest_pezze_bagno_idx ON public.gest_pezze (bagno_id);
COMMENT ON TABLE public.gest_pezze IS 'Pezza o rotolo fisico, con etichetta e metri residui.';

CREATE FUNCTION public.gest_fn_pezza_codice() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.codice IS NULL OR btrim(NEW.codice) = '' THEN
    NEW.codice := 'PZ' || lpad(nextval('public.gest_pezze_codice_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER gest_pezze_codice BEFORE INSERT ON public.gest_pezze
  FOR EACH ROW EXECUTE FUNCTION public.gest_fn_pezza_codice();

-- 5. Registro movimenti (solo inserimento) -----------------------------
CREATE TABLE public.gest_movimenti (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variante_id      UUID NOT NULL REFERENCES public.gest_varianti(id),
  pezza_id         UUID REFERENCES public.gest_pezze(id),
  sfrido_codice    TEXT,   -- codice del pezzo in inventory_scrap_pieces, se il movimento riguarda uno sfrido
  tipo             TEXT NOT NULL CHECK (tipo IN ('carico','scarico','taglio','rettifica','scarto','storno')),
  quantita         NUMERIC(12,3) NOT NULL CHECK (quantita <> 0),   -- + entra, - esce
  riferimento_tipo TEXT,   -- 'ordine', 'sub_ordine', 'ddt', 'inventario'…
  riferimento_id   TEXT,
  storno_di        BIGINT REFERENCES public.gest_movimenti(id),
  nota             TEXT,
  utente           UUID DEFAULT auth.uid(),
  creato_il        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gest_movimenti_storno_coerente CHECK ((tipo = 'storno') = (storno_di IS NOT NULL))
);
CREATE INDEX gest_movimenti_variante_idx ON public.gest_movimenti (variante_id, creato_il);
CREATE INDEX gest_movimenti_pezza_idx ON public.gest_movimenti (pezza_id, creato_il);
CREATE INDEX gest_movimenti_rif_idx ON public.gest_movimenti (riferimento_tipo, riferimento_id);
CREATE UNIQUE INDEX gest_movimenti_storno_unico ON public.gest_movimenti (storno_di) WHERE storno_di IS NOT NULL;
COMMENT ON TABLE public.gest_movimenti IS
  'Registro di magazzino: la giacenza è la somma dei movimenti. Gli errori si correggono con uno storno.';

CREATE TRIGGER gest_movimenti_immutabile
  BEFORE UPDATE OR DELETE ON public.gest_movimenti
  FOR EACH ROW EXECUTE FUNCTION public.gest_fn_solo_inserimento();

CREATE TRIGGER gest_movimenti_storico
  AFTER INSERT ON public.gest_movimenti
  FOR EACH ROW EXECUTE FUNCTION public.gest_fn_storico();

-- 6. Trigger comuni ---------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['gest_articoli','gest_varianti','gest_bagni','gest_pezze']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.gest_fn_updated_at()', t || '_updated_at', t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.gest_fn_storico()', t || '_storico', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.gest_fn_blocca_delete()', t || '_no_delete', t);
  END LOOP;
END $$;

-- 7. Viste giacenze ---------------------------------------------------
CREATE VIEW public.gest_giacenze_pezze WITH (security_invoker = true) AS
SELECT p.id, p.codice, p.variante_id, p.bagno_id, b.codice_bagno, p.posizione, p.stato,
       p.lunghezza_iniziale_m, p.created_at,
       COALESCE(m.residuo, 0) AS residuo_m
FROM public.gest_pezze p
LEFT JOIN public.gest_bagni b ON b.id = p.bagno_id
LEFT JOIN LATERAL (SELECT sum(quantita) AS residuo FROM public.gest_movimenti WHERE pezza_id = p.id) m ON true
WHERE p.archiviato_il IS NULL;

CREATE VIEW public.gest_giacenze_bagno WITH (security_invoker = true) AS
SELECT g.variante_id, g.bagno_id, g.codice_bagno,
       count(*) FILTER (WHERE g.residuo_m > 0) AS pezze,
       COALESCE(sum(g.residuo_m), 0)          AS metri,
       max(g.residuo_m)                        AS pezza_piu_lunga_m
FROM public.gest_giacenze_pezze g
WHERE g.stato = 'disponibile'
GROUP BY g.variante_id, g.bagno_id, g.codice_bagno;

CREATE VIEW public.gest_giacenze_varianti WITH (security_invoker = true) AS
SELECT v.id AS variante_id, v.codice, v.articolo_id,
       COALESCE((SELECT sum(quantita) FROM public.gest_movimenti m WHERE m.variante_id = v.id), 0) AS giacenza
FROM public.gest_varianti v
WHERE v.archiviato_il IS NULL;

-- 8. Operazioni atomiche ----------------------------------------------
-- Carico di una pezza: crea il bagno se non esiste, la pezza e il movimento.
CREATE FUNCTION public.gest_carica_pezza(
  _variante_id  UUID,
  _metri        NUMERIC,
  _codice_bagno TEXT DEFAULT NULL,
  _posizione    TEXT DEFAULT NULL,
  _fornitore    TEXT DEFAULT NULL,
  _nota         TEXT DEFAULT NULL
) RETURNS public.gest_pezze
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _bagno UUID;
  _pezza public.gest_pezze;
BEGIN
  IF _metri IS NULL OR _metri <= 0 THEN
    RAISE EXCEPTION 'I metri devono essere maggiori di zero.';
  END IF;
  IF _codice_bagno IS NOT NULL AND btrim(_codice_bagno) <> '' THEN
    INSERT INTO public.gest_bagni (variante_id, codice_bagno, fornitore, data_arrivo)
    VALUES (_variante_id, btrim(_codice_bagno), _fornitore, current_date)
    ON CONFLICT (variante_id, codice_bagno) DO UPDATE SET codice_bagno = EXCLUDED.codice_bagno
    RETURNING id INTO _bagno;
  END IF;
  INSERT INTO public.gest_pezze (variante_id, bagno_id, lunghezza_iniziale_m, posizione, note)
  VALUES (_variante_id, _bagno, _metri, _posizione, _nota)
  RETURNING * INTO _pezza;
  INSERT INTO public.gest_movimenti (variante_id, pezza_id, tipo, quantita, nota)
  VALUES (_variante_id, _pezza.id, 'carico', _metri, _nota);
  RETURN _pezza;
END $$;

-- Taglio da una pezza: verifica il residuo, registra il movimento,
-- segna la pezza esaurita quando arriva a zero.
CREATE FUNCTION public.gest_taglia_pezza(
  _pezza_id UUID,
  _metri    NUMERIC,
  _rif_tipo TEXT DEFAULT NULL,
  _rif_id   TEXT DEFAULT NULL,
  _nota     TEXT DEFAULT NULL
) RETURNS NUMERIC
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _p public.gest_pezze;
  _residuo NUMERIC;
BEGIN
  IF _metri IS NULL OR _metri <= 0 THEN
    RAISE EXCEPTION 'I metri da tagliare devono essere maggiori di zero.';
  END IF;
  SELECT * INTO _p FROM public.gest_pezze WHERE id = _pezza_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pezza non trovata.';
  END IF;
  SELECT COALESCE(sum(quantita), 0) INTO _residuo FROM public.gest_movimenti WHERE pezza_id = _pezza_id;
  IF _metri > _residuo THEN
    RAISE EXCEPTION 'Taglio di % m non possibile: la pezza % ha % m residui.', _metri, _p.codice, _residuo;
  END IF;
  INSERT INTO public.gest_movimenti (variante_id, pezza_id, tipo, quantita, riferimento_tipo, riferimento_id, nota)
  VALUES (_p.variante_id, _pezza_id, 'taglio', -_metri, _rif_tipo, _rif_id, _nota);
  IF _residuo - _metri = 0 THEN
    UPDATE public.gest_pezze SET stato = 'esaurita' WHERE id = _pezza_id;
  END IF;
  RETURN _residuo - _metri;
END $$;

-- Storno di un movimento: lo annulla con un movimento uguale e contrario.
CREATE FUNCTION public.gest_storna_movimento(_movimento_id BIGINT, _nota TEXT DEFAULT NULL)
RETURNS BIGINT
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _m public.gest_movimenti;
  _nuovo BIGINT;
BEGIN
  SELECT * INTO _m FROM public.gest_movimenti WHERE id = _movimento_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimento non trovato.';
  END IF;
  IF _m.tipo = 'storno' THEN
    RAISE EXCEPTION 'Uno storno non può essere stornato: registrare un nuovo movimento.';
  END IF;
  IF _m.pezza_id IS NOT NULL THEN
    PERFORM 1 FROM public.gest_pezze WHERE id = _m.pezza_id FOR UPDATE;
  END IF;
  INSERT INTO public.gest_movimenti (variante_id, pezza_id, sfrido_codice, tipo, quantita, riferimento_tipo, riferimento_id, storno_di, nota)
  VALUES (_m.variante_id, _m.pezza_id, _m.sfrido_codice, 'storno', -_m.quantita, _m.riferimento_tipo, _m.riferimento_id, _m.id, _nota)
  RETURNING id INTO _nuovo;
  IF _m.pezza_id IS NOT NULL THEN
    UPDATE public.gest_pezze p
    SET stato = CASE WHEN (SELECT COALESCE(sum(quantita), 0) FROM public.gest_movimenti WHERE pezza_id = p.id) > 0
                     THEN 'disponibile' ELSE 'esaurita' END
    WHERE p.id = _m.pezza_id AND p.stato IN ('disponibile','esaurita');
  END IF;
  RETURN _nuovo;
END $$;

-- 9. Sicurezza (RLS) --------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['gest_articoli','gest_varianti','gest_bagni','gest_pezze']
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

ALTER TABLE public.gest_movimenti ENABLE ROW LEVEL SECURITY;
CREATE POLICY gest_movimenti_select ON public.gest_movimenti FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'gestionale', 'read'));
CREATE POLICY gest_movimenti_insert ON public.gest_movimenti FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), 'gestionale', 'write'));

ALTER TABLE public.gest_storico ENABLE ROW LEVEL SECURITY;
CREATE POLICY gest_storico_select ON public.gest_storico FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'gestionale', 'read'));
-- nessuna policy di scrittura: lo storico si alimenta solo dai trigger

-- 10. Privilegi espliciti (minimo necessario) ------------------------
-- Tabelle anagrafiche: lettura, inserimento, modifica. Nessun DELETE.
GRANT SELECT, INSERT, UPDATE ON public.gest_articoli, public.gest_varianti, public.gest_bagni, public.gest_pezze TO authenticated;
-- Registro movimenti: solo lettura e inserimento.
GRANT SELECT, INSERT ON public.gest_movimenti TO authenticated;
-- Storico: sola lettura (lo scrivono i trigger).
GRANT SELECT ON public.gest_storico TO authenticated;
GRANT SELECT ON public.gest_giacenze_pezze, public.gest_giacenze_bagno, public.gest_giacenze_varianti TO authenticated;
GRANT USAGE ON SEQUENCE public.gest_pezze_codice_seq TO authenticated;

GRANT ALL ON public.gest_articoli, public.gest_varianti, public.gest_bagni, public.gest_pezze,
             public.gest_movimenti, public.gest_storico TO service_role;
GRANT SELECT ON public.gest_giacenze_pezze, public.gest_giacenze_bagno, public.gest_giacenze_varianti TO service_role;
GRANT USAGE ON SEQUENCE public.gest_pezze_codice_seq TO service_role;

-- Funzioni: nessun accesso anonimo.
REVOKE ALL ON FUNCTION public.gest_fn_storico() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gest_carica_pezza(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gest_taglia_pezza(UUID, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gest_storna_movimento(BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gest_carica_pezza(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gest_taglia_pezza(UUID, NUMERIC, TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gest_storna_movimento(BIGINT, TEXT) TO authenticated, service_role;
