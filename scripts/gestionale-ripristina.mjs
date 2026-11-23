#!/usr/bin/env node
/**
 * Ripristino di una copia di sicurezza del Gestionale in un database NUOVO.
 *
 *   node scripts/gestionale-ripristina.mjs Gestionale_copia_2027-01-15_18-30.zip > ripristino.sql
 *
 * Il file .sql prodotto va eseguito da chi amministra il database, DOPO aver applicato le migrazioni
 * (le tabelle gest_ devono già esistere). Attenzione: svuota le tabelle gest_ e le riempie con la copia.
 * Non tocca nessun'altra tabella. Serve un utente che possa sospendere i trigger
 * (session_replication_role), cioè il proprietario del database.
 */
import fs from "node:fs";
import crypto from "node:crypto";

const TABELLE = [
  "gest_impostazioni", "gest_aliquote_iva", "gest_condizioni_pagamento", "gest_anagrafiche", "gest_articoli", "gest_varianti",
  "gest_bagni", "gest_pezze", "gest_numeratori", "gest_documenti", "gest_documenti_righe", "gest_documenti_righe_pezze",
  "gest_movimenti", "gest_scadenze", "gest_pagamenti", "gest_prima_nota", "gest_storico",
];

const canonico = (v) => {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`).join(",")}}`;
};

export async function leggiCopia(percorso) {
  const byte = fs.readFileSync(percorso);
  let testo;
  if (byte[0] === 0x50 && byte[1] === 0x4b) {
    const { default: JSZip } = await import("jszip");
    const voce = (await JSZip.loadAsync(byte)).file("copia.json");
    if (!voce) throw new Error("Nel file .zip manca copia.json.");
    testo = await voce.async("string");
  } else testo = byte.toString("utf8");
  const copia = JSON.parse(testo);
  if (copia.formato !== "tecnofra-gestionale-copia") throw new Error("Il file non è una copia del Gestionale.");
  const impronta = crypto.createHash("sha256").update(canonico(copia.tabelle), "utf8").digest("hex");
  if (impronta !== copia.impronta) throw new Error("Impronta non corrispondente: la copia è alterata o danneggiata. Ripristino annullato.");
  return copia;
}

/** Testo SQL tra apici «dollaro», con un delimitatore che non compare nel contenuto. */
const dollaro = (testo) => {
  let tag = "copia";
  while (testo.includes(`$${tag}$`)) tag += "x";
  return `$${tag}$${testo}$${tag}$`;
};

export function sqlRipristino(copia) {
  const righe = [];
  const scrivi = (s) => righe.push(s);
  scrivi(`-- Ripristino della copia del Gestionale creata il ${copia.creata_il}`);
  scrivi(`-- Impronta ${copia.impronta}`);
  scrivi("BEGIN;");
  scrivi("SET LOCAL session_replication_role = replica;   -- sospende trigger e controlli tra tabelle durante il caricamento");
  scrivi(`TRUNCATE ${[...TABELLE].reverse().map((t) => `public.${t}`).join(", ")} RESTART IDENTITY;`);
  // carica le righe usando solo le colonne che esistono oggi nella tabella
  scrivi(`CREATE OR REPLACE FUNCTION pg_temp.carica(_tabella TEXT, _righe JSONB) RETURNS VOID LANGUAGE plpgsql AS $f$
DECLARE _colonne TEXT;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO _colonne
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = _tabella AND is_generated = 'NEVER';
  EXECUTE format('INSERT INTO public.%I (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM jsonb_populate_recordset(NULL::public.%I, $1)',
                 _tabella, _colonne, _colonne, _tabella) USING _righe;
END $f$;`);
  for (const t of TABELLE) {
    const dati = copia.tabelle[t] ?? [];
    scrivi(`-- ${t}: ${dati.length} righe`);
    for (let i = 0; i < dati.length; i += 500) {
      scrivi(`SELECT pg_temp.carica('${t}', ${dollaro(JSON.stringify(dati.slice(i, i + 500)))}::jsonb);`);
    }
  }
  // i contatori automatici ripartono dopo l'ultimo numero ricaricato
  scrivi(`DO $f$
DECLARE r RECORD; _max BIGINT;
BEGIN
  FOR r IN SELECT table_name, column_name FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name LIKE 'gest\\_%' AND is_identity = 'YES' LOOP
    EXECUTE format('SELECT max(%I) FROM public.%I', r.column_name, r.table_name) INTO _max;
    IF _max IS NOT NULL THEN
      PERFORM setval(pg_get_serial_sequence('public.' || r.table_name, r.column_name), _max);
    END IF;
  END LOOP;
END $f$;`);
  // controllo finale: se i conteggi non tornano, non si salva nulla
  scrivi(`DO $f$
DECLARE _attese JSONB := ${dollaro(JSON.stringify(copia.conteggi))}::jsonb; r RECORD; _n BIGINT;
BEGIN
  FOR r IN SELECT key, value::bigint AS attese FROM jsonb_each_text(_attese) LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', r.key) INTO _n;
    IF _n <> r.attese THEN RAISE EXCEPTION 'Ripristino annullato: % ha % righe, attese %', r.key, _n, r.attese; END IF;
  END LOOP;
END $f$;`);
  scrivi("COMMIT;");
  return righe.join("\n") + "\n";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const percorso = process.argv[2];
  if (!percorso) { console.error("Uso: node scripts/gestionale-ripristina.mjs <copia.zip> > ripristino.sql"); process.exit(1); }
  try { process.stdout.write(sqlRipristino(await leggiCopia(percorso))); }
  catch (e) { console.error(String(e.message ?? e)); process.exit(1); }
}
