/**
 * Compilazione della scheda di un cliente o fornitore dalla sola partita IVA.
 * La ricerca la fa la funzione sul server «gestionale-cerca-azienda» sul servizio pubblico VIES
 * (dati dell'Agenzia delle Entrate): restituisce denominazione e sede. PEC, codice destinatario,
 * codice fiscale e REA non sono in VIES.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Anagrafica, DatiAnagrafica } from "./documenti";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Toglie spazi, punti e il prefisso del Paese: «IT 0123 456 789 0» → { paese: "IT", numero: "01234567890" }. */
export function leggiPartitaIva(testo: string, nazione = "IT"): { paese: string; numero: string } {
  const t = testo.replace(/[\s.-]/g, "").toUpperCase();
  const m = /^([A-Z]{2})(.+)$/.exec(t);
  return m ? { paese: m[1], numero: m[2] } : { paese: (nazione || "IT").trim().toUpperCase() || "IT", numero: t };
}

/** Cifra di controllo della partita IVA italiana (11 cifre). */
export function partitaIvaItalianaValida(numero: string): boolean {
  if (!/^\d{11}$/.test(numero)) return false;
  let somma = 0;
  for (let i = 0; i < 11; i++) {
    let c = Number(numero[i]);
    if (i % 2 === 1) { c *= 2; if (c > 9) c -= 9; }
    somma += c;
  }
  return somma % 10 === 0;
}

export type SedeAzienda = { indirizzo: string | null; cap: string | null; citta: string | null; provincia: string | null };

/** L'indirizzo come lo scrive VIES per l'Italia: «VIA ROMA 1 \n80013 CASALNUOVO DI NAPOLI NA\n». */
export function interpretaIndirizzo(grezzo: string, paese = "IT"): SedeAzienda {
  const righe = grezzo.split(/\r?\n/).map((r) => r.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (righe.length === 0) return { indirizzo: null, cap: null, citta: null, provincia: null };
  if (paese === "IT") {
    const ultima = righe[righe.length - 1];
    const m = /^(\d{5})\s+(.+?)(?:\s+\(?([A-Z]{2})\)?)?$/.exec(ultima);
    if (m) return { indirizzo: righe.slice(0, -1).join(", ") || null, cap: m[1], citta: m[2], provincia: m[3] ?? null };
    // tutto su una riga: «VIA ROMA 1 80013 CASALNUOVO DI NAPOLI NA»
    const u = /^(.+?)\s+(\d{5})\s+(.+?)\s+([A-Z]{2})$/.exec(righe.join(" "));
    if (u) return { indirizzo: u[1], cap: u[2], citta: u[3], provincia: u[4] };
  }
  return { indirizzo: righe.join(", "), cap: null, citta: null, provincia: null };
}

export type AziendaTrovata = { trovata: true; fonte: string; paese: string; partita_iva: string; denominazione: string } & SedeAzienda;
export type EsitoRicerca = AziendaTrovata | { trovata: false; messaggio: string };

/** Interroga il server. Lancia un errore leggibile se il servizio non risponde. */
export async function cercaAzienda(testo: string, nazione = "IT"): Promise<EsitoRicerca> {
  const { paese, numero } = leggiPartitaIva(testo, nazione);
  if (paese === "IT" && !partitaIvaItalianaValida(numero)) return { trovata: false, messaggio: "La partita IVA non è corretta: 11 cifre, e la cifra di controllo non torna. Ricontrolla il numero." };
  const { data, error } = await supabase.functions.invoke("gestionale-cerca-azienda", { body: { paese, partita_iva: numero } });
  if (error) {
    let motivo = "La ricerca dalla partita IVA non è ancora attiva sul server.";
    try { const corpo = await (error as { context?: Response }).context?.json(); if (corpo?.error) motivo = corpo.error; } catch { /* resta il messaggio generico */ }
    throw new Error(motivo);
  }
  if (!data?.trovata) return { trovata: false, messaggio: data?.messaggio ?? "Partita IVA non trovata." };
  return { trovata: true, fonte: data.fonte ?? "VIES", paese, partita_iva: numero, denominazione: String(data.denominazione ?? "").trim(), ...interpretaIndirizzo(String(data.indirizzo_grezzo ?? ""), paese) };
}

const CAMPI = [["ragione_sociale", "denominazione"], ["indirizzo", "indirizzo"], ["cap", "cap"], ["citta", "citta"], ["provincia", "provincia"]] as const;

/**
 * Riporta i dati trovati sulla scheda. Su una scheda nuova compila tutto; su una esistente
 * (`soloVuoti`) riempie solo i campi vuoti e segnala quelli diversi, senza sovrascrivere.
 */
export function compilaScheda(f: DatiAnagrafica, a: AziendaTrovata, soloVuoti: boolean): { scheda: DatiAnagrafica; compilati: string[]; diversi: string[] } {
  const scheda = { ...f, partita_iva: a.partita_iva, nazione: a.paese === "EL" ? "GR" : a.paese === "XI" ? "GB" : a.paese, senza_partita_iva: false };
  const compilati: string[] = []; const diversi: string[] = [];
  const NOME: Record<string, string> = { ragione_sociale: "ragione sociale", indirizzo: "indirizzo", cap: "CAP", citta: "città", provincia: "provincia" };
  for (const [campo, da] of CAMPI) {
    const nuovo = (a[da] ?? "").trim();
    if (!nuovo) continue;
    const attuale = ((scheda[campo] as string | null) ?? "").trim();
    if (!attuale || !soloVuoti) { if (attuale !== nuovo) { (scheda as Record<string, unknown>)[campo] = nuovo; compilati.push(NOME[campo]); } }
    else if (attuale.toLowerCase() !== nuovo.toLowerCase()) diversi.push(`${NOME[campo]}: ${nuovo}`);
  }
  return { scheda, compilati, diversi };
}

/** Una scheda (non archiviata) con la stessa partita IVA c'è già? */
export async function schedaConPartitaIva(numero: string, escludiId?: string): Promise<Pick<Anagrafica, "id" | "codice" | "ragione_sociale"> | null> {
  const { data, error } = await db.from("gest_anagrafiche").select("id, codice, ragione_sociale").is("archiviato_il", null)
    .in("partita_iva", [numero, `IT${numero}`]).limit(2);
  if (error) return null;
  return (data as Pick<Anagrafica, "id" | "codice" | "ragione_sociale">[]).find((x) => x.id !== escludiId) ?? null;
}
