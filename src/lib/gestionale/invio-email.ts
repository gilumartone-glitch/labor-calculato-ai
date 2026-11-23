/**
 * Invio diretto dei documenti dalle caselle @tecnofra.it, con il PDF allegato.
 * Spedisce la funzione sul server «gestionale-invia-email»: le password delle caselle stanno lì, il browser non le vede mai.
 * Regola: fatture, note di credito ed estratti conto partono solo dall'amministrazione;
 * preventivi, conferme d'ordine e DDT da una qualsiasi delle caselle configurate, scelta dall'operatore.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const FUNZIONE = "gestionale-invia-email";

export type ContestoEmail = "preventivo" | "ordine" | "ddt" | "fattura" | "nota_credito" | "estratto_conto";
export const CASELLA_AMMINISTRAZIONE = "amministrazione@tecnofra.it";
const SOLO_AMMINISTRAZIONE: ContestoEmail[] = ["fattura", "nota_credito", "estratto_conto"];
export const soloAmministrazione = (contesto: ContestoEmail): boolean => SOLO_AMMINISTRAZIONE.includes(contesto);

export type Caselle = { configurato: boolean; caselle: string[]; amministrazione: string };
const NON_CONFIGURATO: Caselle = { configurato: false, caselle: [], amministrazione: CASELLA_AMMINISTRAZIONE };

/** Da quali caselle si può spedire. Se la funzione non c'è o non è configurata, l'invio diretto non è disponibile. */
export async function leggiCaselle(): Promise<Caselle> {
  try {
    const { data, error } = await supabase.functions.invoke(FUNZIONE, { body: { azione: "caselle" } });
    if (error || !data || !Array.isArray(data.caselle)) return NON_CONFIGURATO;
    return { configurato: Boolean(data.configurato), caselle: data.caselle as string[], amministrazione: (data.amministrazione as string) || CASELLA_AMMINISTRAZIONE };
  } catch { return NON_CONFIGURATO; }
}

/** Le caselle tra cui l'operatore può scegliere per questo tipo di documento. */
export function casellePerContesto(contesto: ContestoEmail, c: Caselle): string[] {
  if (!c.configurato) return [];
  return soloAmministrazione(contesto) ? c.caselle.filter((x) => x === c.amministrazione) : c.caselle;
}

const CHIAVE_ULTIMA = "gestionale:casella-email";
/** La casella proposta: l'ultima usata per quel tipo di documento da questo computer, se c'è ancora. */
export function casellaProposta(contesto: ContestoEmail, disponibili: string[], ultima: string | null = leggiUltimaCasella(contesto)): string {
  if (disponibili.length === 0) return "";
  return ultima && disponibili.includes(ultima) ? ultima : disponibili.length === 1 ? disponibili[0] : "";
}
export function leggiUltimaCasella(contesto: ContestoEmail): string | null { try { return localStorage.getItem(`${CHIAVE_ULTIMA}:${contesto}`); } catch { return null; } }
export function ricordaCasella(contesto: ContestoEmail, casella: string): void { try { localStorage.setItem(`${CHIAVE_ULTIMA}:${contesto}`, casella); } catch { /* si sceglierà di nuovo */ } }

/** Byte del PDF in base64, a pezzi: i file grandi non stanno in una sola chiamata. */
export function inBase64(byte: Uint8Array): string {
  let binario = "";
  for (let i = 0; i < byte.length; i += 0x8000) binario += String.fromCharCode(...byte.subarray(i, i + 0x8000));
  return btoa(binario);
}

export type EmailDiretta = {
  contesto: ContestoEmail; documento_id?: string | null; anagrafica_id?: string | null;
  da: string; a: string[]; cc: string[]; oggetto: string; testo: string;
  allegato: { nome: string; byte: Uint8Array };
};

/** Spedisce. In caso di rifiuto restituisce il motivo scritto dal server. */
export async function inviaEmail(m: EmailDiretta): Promise<void> {
  const { allegato, ...resto } = m;
  const { data, error } = await supabase.functions.invoke(FUNZIONE, {
    body: { azione: "invia", ...resto, allegato: { nome: allegato.nome, base64: inBase64(allegato.byte) } },
  });
  if (error) {
    let motivo = error.message;
    try { const corpo = await (error as { context?: Response }).context?.json(); if (corpo?.error) motivo = corpo.error; } catch { /* resta il messaggio generico */ }
    throw new Error(motivo);
  }
  if (!data?.inviata) throw new Error(data?.error ?? "Il server non ha confermato l'invio.");
}

export type EmailInviata = { id: number; mittente: string; destinatari: string[]; copia: string[]; oggetto: string; esito: "inviata" | "errore"; errore: string | null; creato_il: string };

/** Gli invii già fatti per un documento (o, per l'estratto conto, a un cliente). Se il registro non c'è ancora, elenco vuoto. */
export async function storicoEmail(f: { documento_id?: string | null; anagrafica_id?: string | null; contesto?: ContestoEmail }): Promise<EmailInviata[]> {
  let q = db.from("gest_email_inviate").select("id, mittente, destinatari, copia, oggetto, esito, errore, creato_il").order("creato_il", { ascending: false }).limit(20);
  if (f.documento_id) q = q.eq("documento_id", f.documento_id);
  else if (f.anagrafica_id) { q = q.eq("anagrafica_id", f.anagrafica_id); if (f.contesto) q = q.eq("contesto", f.contesto); }
  else return [];
  const { data, error } = await q;
  return error ? [] : (data as EmailInviata[]);
}
