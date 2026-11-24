/**
 * Copia di sicurezza del Gestionale: tutte le tabelle gest_ in un unico file .zip che si scarica
 * e si conserva fuori dall'app (disco esterno, cloud aziendale).
 * Il file porta la propria impronta: «Verifica» controlla che sia integro e lo confronta con i dati attuali.
 * Per ricaricarlo in un database nuovo: scripts/gestionale-ripristina.mjs.
 */
import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";

// Accesso tipizzato a mano: vedi nota in ./api.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const FORMATO_COPIA = "tecnofra-gestionale-copia";

/** Le tabelle, nell'ordine in cui vanno ricaricate (prima quelle da cui le altre dipendono). */
/** `facoltativa`: tabella aggiunta dopo; se nel database non c'è ancora (o in una copia vecchia manca) non è un errore. */
export const TABELLE_COPIA: { nome: string; ordine: string[]; facoltativa?: boolean }[] = [
  { nome: "gest_impostazioni", ordine: ["chiave"] },
  { nome: "gest_aliquote_iva", ordine: ["id"] },
  { nome: "gest_condizioni_pagamento", ordine: ["id"] },
  { nome: "gest_anagrafiche", ordine: ["id"] },
  { nome: "gest_articoli", ordine: ["id"] },
  { nome: "gest_varianti", ordine: ["id"] },
  { nome: "gest_bagni", ordine: ["id"] },
  { nome: "gest_pezze", ordine: ["id"] },
  { nome: "gest_numeratori", ordine: ["tipo", "anno", "serie"] },
  { nome: "gest_documenti", ordine: ["created_at", "id"] },
  { nome: "gest_documenti_righe", ordine: ["id"] },
  { nome: "gest_documenti_righe_pezze", ordine: ["id"] },
  { nome: "gest_movimenti", ordine: ["id"] },
  { nome: "gest_scadenze", ordine: ["id"] },
  { nome: "gest_pagamenti", ordine: ["id"] },
  { nome: "gest_prima_nota", ordine: ["id"] },
  { nome: "gest_storico", ordine: ["id"] },
  { nome: "gest_email_inviate", ordine: ["id"], facoltativa: true },
  // le caselle email sì, le loro password no: gest_caselle_email_segreti resta fuori dalla copia e si reinserisce a mano
  { nome: "gest_caselle_email", ordine: ["id"], facoltativa: true },
];

export type Riga = Record<string, unknown>;
export type Copia = {
  formato: typeof FORMATO_COPIA;
  versione: 1;
  creata_il: string;
  conteggi: Record<string, number>;
  /** SHA-256 del contenuto delle tabelle */
  impronta: string;
  tabelle: Record<string, Riga[]>;
};

/** Testo sempre uguale per gli stessi dati: chiavi in ordine alfabetico a ogni livello. */
export function testoCanonico(valore: unknown): string {
  if (valore === null || typeof valore !== "object") return JSON.stringify(valore) ?? "null";
  if (Array.isArray(valore)) return `[${valore.map(testoCanonico).join(",")}]`;
  const o = valore as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${testoCanonico(o[k])}`).join(",")}}`;
}

export async function improntaTabelle(tabelle: Record<string, Riga[]>): Promise<string> {
  const byte = new TextEncoder().encode(testoCanonico(tabelle));
  const hash = await crypto.subtle.digest("SHA-256", byte);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function componiCopia(tabelle: Record<string, Riga[]>, creataIl = new Date().toISOString()): Promise<Copia> {
  return {
    formato: FORMATO_COPIA, versione: 1, creata_il: creataIl,
    conteggi: Object.fromEntries(Object.entries(tabelle).map(([nome, righe]) => [nome, righe.length])),
    impronta: await improntaTabelle(tabelle),
    tabelle,
  };
}

/** La tabella non esiste (ancora) nel database. */
const tabellaAssente = (e: { code?: string; message?: string }) => e.code === "42P01" || e.code === "PGRST205" || /does not exist|could not find the table/i.test(e.message ?? "");

async function leggiTabella(nome: string, ordine: string[], facoltativa = false): Promise<Riga[] | null> {
  const righe: Riga[] = [];
  const PAGINA = 1000;
  for (let da = 0; ; da += PAGINA) {
    let q = db.from(nome).select("*");
    for (const colonna of ordine) q = q.order(colonna);
    const { data, error } = await q.range(da, da + PAGINA - 1);
    if (error && facoltativa && tabellaAssente(error)) return null;
    if (error) throw new Error(`${nome}: ${error.message}`);
    righe.push(...(data as Riga[]));
    if ((data as Riga[]).length < PAGINA) break;
  }
  return righe;
}

/** Legge tutto il Gestionale. `avanzamento` riceve il nome della tabella in lettura e a che punto si è. */
export async function creaCopia(avanzamento?: (tabella: string, fatte: number, totale: number) => void): Promise<Copia> {
  const tabelle: Record<string, Riga[]> = {};
  for (let i = 0; i < TABELLE_COPIA.length; i++) {
    const t = TABELLE_COPIA[i];
    avanzamento?.(t.nome, i, TABELLE_COPIA.length);
    const righe = await leggiTabella(t.nome, t.ordine, t.facoltativa);
    if (righe) tabelle[t.nome] = righe;
  }
  avanzamento?.("", TABELLE_COPIA.length, TABELLE_COPIA.length);
  return componiCopia(tabelle);
}

export const nomeFileCopia = (c: Pick<Copia, "creata_il">): string =>
  `Gestionale_copia_${c.creata_il.slice(0, 16).replace("T", "_").replace(":", "-")}.zip`;

const LEGGIMI = (c: Copia) => `COPIA DI SICUREZZA DEL GESTIONALE TECNOFRA
Creata il ${c.creata_il}

Contiene tutte le tabelle del Gestionale (documenti, righe, anagrafiche, magazzino, scadenze,
pagamenti, prima nota e lo storico delle modifiche) nel file copia.json.
Non contiene la Contabilità né gli altri moduli dell'app.

Righe per tabella:
${Object.entries(c.conteggi).map(([n, q]) => `  ${n}: ${q}`).join("\n")}

Impronta SHA-256 dei dati: ${c.impronta}

Per controllarla: Gestionale > Copia di sicurezza > Verifica una copia.
Per ricaricarla in un database nuovo: node scripts/gestionale-ripristina.mjs <questo file> > ripristino.sql
`;

/** Il file .zip della copia, come sequenza di byte. */
export async function impacchettaCopia(c: Copia): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("copia.json", JSON.stringify(c));
  zip.file("LEGGIMI.txt", LEGGIMI(c));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

const CHIAVE_ULTIMA = "gestionale:ultima-copia";
/** Data dell'ultima copia scaricata da questo computer, se c'è. */
export const ultimaCopia = (): string | null => { try { return localStorage.getItem(CHIAVE_ULTIMA); } catch { return null; } };
export const ricordaUltimaCopia = (creataIl: string): void => { try { localStorage.setItem(CHIAVE_ULTIMA, creataIl); } catch { /* la data resta solo a schermo */ } };
/** Giorni passati dall'ultima copia: null se non ne è mai stata fatta una da questo computer. */
export const giorniDallUltimaCopia = (): number | null => {
  const u = ultimaCopia();
  return u ? Math.floor((Date.now() - new Date(u).getTime()) / 86_400_000) : null;
};

export type EsitoVerifica = { copia: Copia; integra: boolean; problemi: string[] };

/** Apre un file di copia (.zip o .json) e controlla che sia completo e non alterato. */
export async function leggiCopia(file: Blob | ArrayBuffer | Uint8Array): Promise<EsitoVerifica> {
  const byte = file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : file instanceof Uint8Array ? file : new Uint8Array(file);
  let testo: string;
  if (byte[0] === 0x50 && byte[1] === 0x4b) {
    const voce = (await JSZip.loadAsync(byte)).file("copia.json");
    if (!voce) throw new Error("Nel file .zip manca copia.json: non è una copia del Gestionale.");
    testo = await voce.async("string");
  } else testo = new TextDecoder().decode(byte);
  let copia: Copia;
  try { copia = JSON.parse(testo) as Copia; } catch { throw new Error("Il file non si legge: è danneggiato o non è una copia del Gestionale."); }
  if (copia?.formato !== FORMATO_COPIA || typeof copia.tabelle !== "object") throw new Error("Il file non è una copia del Gestionale.");

  const problemi: string[] = [];
  if ((await improntaTabelle(copia.tabelle)) !== copia.impronta) problemi.push("L'impronta non corrisponde: il contenuto è stato alterato o il file è danneggiato.");
  for (const t of TABELLE_COPIA) {
    const righe = copia.tabelle[t.nome];
    if (righe === undefined && t.facoltativa) continue;
    if (!Array.isArray(righe)) problemi.push(`Manca la tabella ${t.nome}.`);
    else if (righe.length !== copia.conteggi?.[t.nome]) problemi.push(`${t.nome}: ${righe.length} righe, ne erano dichiarate ${copia.conteggi?.[t.nome] ?? "?"}.`);
  }
  return { copia, integra: problemi.length === 0, problemi };
}

/** Quante righe ha oggi ogni tabella, per confrontarle con una copia. */
export async function conteggiAttuali(): Promise<Record<string, number>> {
  const voci = await Promise.all(TABELLE_COPIA.map(async (t) => {
    const { count, error } = await db.from(t.nome).select("*", { count: "exact", head: true });
    if (error && t.facoltativa && tabellaAssente(error)) return null;
    if (error) throw new Error(`${t.nome}: ${error.message}`);
    return [t.nome, count ?? 0] as const;
  }));
  return Object.fromEntries(voci.filter((v): v is readonly [string, number] => v !== null));
}

export const ETICHETTA_TABELLA: Record<string, string> = {
  gest_impostazioni: "Impostazioni", gest_aliquote_iva: "Aliquote IVA", gest_condizioni_pagamento: "Condizioni di pagamento",
  gest_anagrafiche: "Clienti e fornitori", gest_articoli: "Articoli", gest_varianti: "Varianti", gest_bagni: "Bagni", gest_pezze: "Pezze",
  gest_numeratori: "Numeratori", gest_documenti: "Documenti", gest_documenti_righe: "Righe dei documenti",
  gest_documenti_righe_pezze: "Pezze nelle righe", gest_movimenti: "Movimenti di magazzino", gest_scadenze: "Scadenze",
  gest_pagamenti: "Incassi e pagamenti", gest_prima_nota: "Prima nota", gest_storico: "Storico delle modifiche",
  gest_email_inviate: "Email inviate", gest_caselle_email: "Caselle email",
};
