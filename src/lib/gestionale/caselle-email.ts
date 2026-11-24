/**
 * Impostazioni > Mail: le caselle da cui il Gestionale spedisce i documenti.
 * Per ogni casella: indirizzo, nome, quali documenti può spedire, attiva sì/no.
 * La password si scrive una volta: va alla funzione sul server che la cifra e la conserva; da lì non torna più indietro.
 */
import { supabase } from "@/integrations/supabase/client";
import { CASELLA_AMMINISTRAZIONE, type ContestoEmail } from "./invio-email";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const FUNZIONE = "gestionale-invia-email";
const CHIAVE_SMTP = "email_smtp";

export type CasellaEmail = { id: string; indirizzo: string; nome: string; documenti: ContestoEmail[]; attiva: boolean };
export type ServerPosta = { host: string; porta: number };
export type ImpostazioniEmail = {
  /** false finché tabelle e funzione non sono attive sul server */
  disponibile: boolean; motivo?: string;
  smtp: ServerPosta; caselle: CasellaEmail[];
  /** id casella → quando è stata salvata la password */
  conPassword: Record<string, string>;
};

/** L'indirizzo come si salva: minuscolo, senza spazi. null se non è un indirizzo. */
export function normalizzaIndirizzo(testo: string): string | null {
  const i = testo.trim().toLowerCase();
  return /^[^@\s<>"',;]+@[^@\s<>"',;]+\.[^@\s<>"',;]+$/.test(i) ? i : null;
}

/** Proposta per una casella nuova: l'amministrazione spedisce i documenti contabili, le altre quelli commerciali. */
export const documentiProposti = (indirizzo: string): ContestoEmail[] =>
  indirizzo === CASELLA_AMMINISTRAZIONE ? ["fattura", "nota_credito", "estratto_conto"] : ["preventivo", "ordine", "ddt"];

/** Cosa manca perché una casella possa spedire. Elenco vuoto = pronta. */
export function mancanzeCasella(c: Pick<CasellaEmail, "attiva" | "documenti">, haPassword: boolean, smtp: ServerPosta): string[] {
  return [
    !smtp.host.trim() ? "manca il server di posta" : "",
    !haPassword ? "manca la password" : "",
    c.documenti.length === 0 ? "nessun documento abilitato" : "",
    !c.attiva ? "disattivata" : "",
  ].filter(Boolean);
}

async function chiama<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(FUNZIONE, { body });
  if (error) {
    let motivo = error.message;
    try { const corpo = await (error as { context?: Response }).context?.json(); if (corpo?.error) motivo = corpo.error; } catch { /* resta il messaggio generico */ }
    throw new Error(motivo);
  }
  return data as T;
}

export async function leggiImpostazioniEmail(): Promise<ImpostazioniEmail> {
  const vuote: ImpostazioniEmail = { disponibile: false, smtp: { host: "", porta: 465 }, caselle: [], conPassword: {} };
  const { data: righe, error } = await db.from("gest_caselle_email").select("id, indirizzo, nome, documenti, attiva").order("indirizzo");
  if (error) return { ...vuote, motivo: "Le tabelle delle caselle non sono ancora attive sul server." };
  try {
    const s = await chiama<{ smtp?: Partial<ServerPosta>; con_password?: Record<string, string> }>({ azione: "impostazioni" });
    if (!s || typeof s.con_password !== "object") return { ...vuote, caselle: righe as CasellaEmail[], motivo: "La funzione di invio sul server non è aggiornata." };
    return { disponibile: true, caselle: righe as CasellaEmail[], conPassword: s.con_password ?? {}, smtp: { host: s.smtp?.host ?? "", porta: Number(s.smtp?.porta) || 465 } };
  } catch (e) {
    return { ...vuote, caselle: righe as CasellaEmail[], motivo: e instanceof Error ? e.message : String(e) };
  }
}

export async function salvaServerPosta(s: ServerPosta): Promise<void> {
  const host = s.host.trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) throw new Error("Scrivi il nome del server di posta in uscita, per esempio mail.tecnofra.it.");
  if (![465, 587].includes(s.porta)) throw new Error("La porta è 465 oppure 587.");
  const { error } = await db.from("gest_impostazioni").upsert(
    { chiave: CHIAVE_SMTP, valore: JSON.stringify({ host, porta: s.porta }), descrizione: "Server di posta in uscita per l'invio dei documenti" }, { onConflict: "chiave" });
  if (error) throw new Error(error.message);
}

export async function creaCasella(c: { indirizzo: string; nome: string; documenti: ContestoEmail[] }): Promise<CasellaEmail> {
  const indirizzo = normalizzaIndirizzo(c.indirizzo);
  if (!indirizzo) throw new Error("L'indirizzo email non è valido.");
  const { data, error } = await db.from("gest_caselle_email").insert({ indirizzo, nome: c.nome.trim(), documenti: c.documenti }).select("id, indirizzo, nome, documenti, attiva").single();
  if (error) throw new Error(error.code === "23505" ? `La casella ${indirizzo} c'è già.` : error.message);
  return data as CasellaEmail;
}

export async function aggiornaCasella(id: string, modifiche: Partial<Pick<CasellaEmail, "nome" | "documenti" | "attiva">>): Promise<void> {
  const { error } = await db.from("gest_caselle_email").update(modifiche).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Salva la password della casella sul server (cifrata). Non si può rileggere: si può solo sostituire. */
export async function impostaPassword(casellaId: string, password: string): Promise<void> {
  await chiama({ azione: "password", casella_id: casellaId, password });
}

/** Prova l'accesso al server di posta con la password salvata, senza spedire nulla. */
export async function provaCasella(casellaId: string): Promise<void> {
  await chiama({ azione: "prova", casella_id: casellaId });
}
