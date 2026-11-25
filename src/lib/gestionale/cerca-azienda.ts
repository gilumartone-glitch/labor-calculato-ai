/**
 * Compilazione della scheda di un cliente o fornitore dalla sola partita IVA.
 * La ricerca la fa la funzione sul server «gestionale-cerca-azienda»:
 *  - con la chiave del servizio a pagamento (Impostazioni > Servizi) legge il Registro imprese:
 *    denominazione, sede, codice fiscale, PEC, codice destinatario;
 *  - altrimenti il servizio pubblico VIES (Agenzia delle Entrate): solo denominazione e sede.
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

export type AziendaTrovata = {
  trovata: true; fonte: string; paese: string; partita_iva: string; denominazione: string;
  /** solo dal Registro imprese (servizio a pagamento) */
  codice_fiscale?: string | null; pec?: string | null; codice_sdi?: string | null; forma_giuridica?: string | null; rea?: string | null; cessata?: boolean;
  /** perché i dati completi non sono arrivati, se doveva arrivare di più */
  avviso?: string | null;
  /** quanto ha impiegato il servizio esterno a rispondere, in millisecondi */
  msServizio?: number | null;
} & SedeAzienda;
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
  if (!data?.trovata) return { trovata: false, messaggio: [data?.messaggio ?? "Partita IVA non trovata.", data?.avviso].filter(Boolean).join(" ") };
  return interpretaRisposta(data, paese, numero);
}

const testoO = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** La risposta del server: dal Registro imprese la sede arriva già divisa, da VIES va interpretata. */
export function interpretaRisposta(data: Record<string, unknown>, paese: string, numero: string): AziendaTrovata {
  const sede: SedeAzienda = typeof data.indirizzo_grezzo === "string"
    ? interpretaIndirizzo(data.indirizzo_grezzo, paese)
    : { indirizzo: testoO(data.indirizzo), cap: testoO(data.cap), citta: testoO(data.citta), provincia: testoO(data.provincia) };
  return {
    trovata: true, fonte: testoO(data.fonte) ?? "VIES", paese, partita_iva: numero, denominazione: testoO(data.denominazione) ?? "", ...sede,
    codice_fiscale: testoO(data.codice_fiscale), pec: testoO(data.pec), codice_sdi: testoO(data.codice_sdi),
    forma_giuridica: testoO(data.forma_giuridica), rea: testoO(data.rea), cessata: data.cessata === true, avviso: testoO(data.avviso), msServizio: typeof data.ms_servizio === "number" ? data.ms_servizio : null,
  };
}

const CAMPI = [
  ["ragione_sociale", "denominazione"], ["codice_fiscale", "codice_fiscale"], ["indirizzo", "indirizzo"], ["cap", "cap"], ["citta", "citta"], ["provincia", "provincia"],
  ["pec", "pec"], ["codice_sdi", "codice_sdi"],
] as const;

/**
 * Riporta i dati trovati sulla scheda. Su una scheda nuova compila tutto; su una esistente
 * (`soloVuoti`) riempie solo i campi vuoti e segnala quelli diversi, senza sovrascrivere.
 */
export function compilaScheda(f: DatiAnagrafica, a: AziendaTrovata, soloVuoti: boolean): { scheda: DatiAnagrafica; compilati: string[]; diversi: string[] } {
  const scheda = { ...f, partita_iva: a.partita_iva, nazione: a.paese === "EL" ? "GR" : a.paese === "XI" ? "GB" : a.paese, senza_partita_iva: false };
  const compilati: string[] = []; const diversi: string[] = [];
  const NOME: Record<string, string> = { ragione_sociale: "ragione sociale", codice_fiscale: "codice fiscale", indirizzo: "indirizzo", cap: "CAP", citta: "città", provincia: "provincia", pec: "PEC", codice_sdi: "codice destinatario" };
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

/* ---------- Impostazioni > Servizi ---------- */
export type StatoServizio = { disponibile: boolean; attivo: boolean; aggiornato_il: string | null; motivo?: string };

async function chiamaServizio<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("gestionale-cerca-azienda", { body });
  if (error) {
    let motivo = error.message;
    try { const corpo = await (error as { context?: Response }).context?.json(); if (corpo?.error) motivo = corpo.error; } catch { /* resta il messaggio generico */ }
    throw new Error(motivo);
  }
  return data as T;
}
/** Il servizio dei dati aziendali è configurato? (solo amministratore) */
export async function statoServizioAziende(): Promise<StatoServizio> {
  try {
    const s = await chiamaServizio<Partial<StatoServizio>>({ azione: "servizio_stato" });
    if (typeof s?.attivo !== "boolean") return { disponibile: false, attivo: false, aggiornato_il: null, motivo: "La funzione sul server non è aggiornata." };
    return { disponibile: s.disponibile !== false, attivo: s.attivo, aggiornato_il: s.aggiornato_il ?? null, motivo: s.disponibile === false ? "La tabella dei servizi non c'è ancora sul server." : undefined };
  } catch (e) { return { disponibile: false, attivo: false, aggiornato_il: null, motivo: e instanceof Error ? e.message : String(e) }; }
}
/** Salva la chiave (cifrata, sul server). Chiave vuota = servizio spento. */
export async function salvaChiaveServizioAziende(chiave: string): Promise<void> {
  await chiamaServizio({ azione: "servizio_chiave", chiave: chiave.trim() });
}
