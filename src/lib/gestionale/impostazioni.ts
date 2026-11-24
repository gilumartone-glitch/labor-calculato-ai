/**
 * Impostazioni del Gestionale: aliquote IVA, data di avvio delle fatture, numerazione.
 * (Le caselle email stanno in caselle-email.ts, i dati azienda in azienda.ts.)
 */
import { supabase } from "@/integrations/supabase/client";
import type { AliquotaIva, TipoDocumento } from "./documenti";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Codici «Natura» della fattura elettronica per le operazioni senza IVA (specifiche FatturaPA). */
export const NATURE_IVA: { codice: string; nome: string }[] = [
  { codice: "N1", nome: "Escluse ex art. 15" },
  { codice: "N2.1", nome: "Non soggette a IVA, artt. da 7 a 7-septies (fuori campo per territorialità)" },
  { codice: "N2.2", nome: "Non soggette, altri casi" },
  { codice: "N3.1", nome: "Non imponibili, esportazioni" },
  { codice: "N3.2", nome: "Non imponibili, cessioni intracomunitarie" },
  { codice: "N3.3", nome: "Non imponibili, cessioni verso San Marino" },
  { codice: "N3.4", nome: "Non imponibili, operazioni assimilate alle esportazioni" },
  { codice: "N3.5", nome: "Non imponibili, a seguito di dichiarazione d'intento" },
  { codice: "N3.6", nome: "Non imponibili, altre operazioni fuori plafond" },
  { codice: "N4", nome: "Esenti" },
  { codice: "N5", nome: "Regime del margine / IVA non esposta in fattura" },
  { codice: "N6.1", nome: "Inversione contabile, rottami e materiali di recupero" },
  { codice: "N6.2", nome: "Inversione contabile, oro e argento" },
  { codice: "N6.3", nome: "Inversione contabile, subappalto nel settore edile" },
  { codice: "N6.4", nome: "Inversione contabile, cessione di fabbricati" },
  { codice: "N6.5", nome: "Inversione contabile, telefoni cellulari" },
  { codice: "N6.6", nome: "Inversione contabile, prodotti elettronici" },
  { codice: "N6.7", nome: "Inversione contabile, prestazioni comparto edile e settori connessi" },
  { codice: "N6.8", nome: "Inversione contabile, settore energetico" },
  { codice: "N6.9", nome: "Inversione contabile, altri casi" },
  { codice: "N7", nome: "IVA assolta in altro Stato UE" },
];

export type AliquotaBozza = { codice: string; descrizione: string; percentuale: number | null; natura: string | null };

/** Cosa non va in un'aliquota. Elenco vuoto = si può salvare. */
export function controllaAliquota(a: AliquotaBozza, esistenti: Pick<AliquotaIva, "id" | "codice">[], id?: string): string[] {
  const errori: string[] = [];
  const codice = a.codice.trim().toUpperCase();
  if (!codice) errori.push("Manca il codice.");
  else if (!/^[A-Z0-9._-]{1,12}$/.test(codice)) errori.push("Il codice: lettere, numeri, punto o trattino, al massimo 12 caratteri.");
  else if (esistenti.some((e) => e.id !== id && e.codice.trim().toUpperCase() === codice)) errori.push(`Il codice ${codice} è già usato.`);
  if (!a.descrizione.trim()) errori.push("Manca la descrizione.");
  if (a.percentuale == null || Number.isNaN(a.percentuale) || a.percentuale < 0 || a.percentuale > 100) errori.push("La percentuale va da 0 a 100.");
  else if (a.percentuale === 0 && !a.natura) errori.push("Un'aliquota senza IVA deve avere il codice natura: senza, la fattura elettronica viene scartata.");
  else if (a.percentuale > 0 && a.natura) errori.push("Il codice natura va indicato solo per le aliquote a 0%.");
  if (a.natura && !NATURE_IVA.some((n) => n.codice === a.natura)) errori.push(`Il codice natura ${a.natura} non esiste.`);
  return errori;
}

const esito = (r: { error: { message: string; code?: string } | null }) => {
  if (r.error) throw new Error(r.error.code === "23505" ? "Questo codice è già usato (anche da un'aliquota archiviata)." : r.error.message);
};

/** Nuova aliquota. La percentuale non si cambia più dopo: i documenti già fatti la usano. */
export async function creaAliquota(a: AliquotaBozza): Promise<void> {
  esito(await db.from("gest_aliquote_iva").insert({ codice: a.codice.trim().toUpperCase(), descrizione: a.descrizione.trim(), percentuale: a.percentuale, natura: a.natura || null }));
}
/** Di un'aliquota esistente si correggono solo descrizione e natura. */
export async function aggiornaAliquota(id: string, a: Pick<AliquotaBozza, "descrizione" | "natura">): Promise<void> {
  esito(await db.from("gest_aliquote_iva").update({ descrizione: a.descrizione.trim(), natura: a.natura || null }).eq("id", id));
}
/** Archiviata non si propone più nei documenti nuovi; quelli già fatti restano come sono. */
export async function archiviaAliquota(id: string): Promise<void> {
  esito(await db.from("gest_aliquote_iva").update({ archiviato_il: new Date().toISOString() }).eq("id", id));
}

/* ---------- Avvio e numerazione ---------- */
export type Numeratore = { tipo: TipoDocumento; anno: number; serie: string; ultimo: number };
export type Avvio = { fattureAttiveDal: string | null; numeratori: Numeratore[] };

export async function leggiAvvio(): Promise<Avvio> {
  const [imp, num] = await Promise.all([
    db.from("gest_impostazioni").select("valore").eq("chiave", "fatture_attive_dal").maybeSingle(),
    db.from("gest_numeratori").select("tipo, anno, serie, ultimo").order("anno", { ascending: false }).order("tipo").order("serie"),
  ]);
  if (imp.error) throw new Error(imp.error.message);
  if (num.error) throw new Error(num.error.message);
  const data = /^\d{4}-\d{2}-\d{2}$/.test(imp.data?.valore ?? "") ? imp.data.valore : null;
  return { fattureAttiveDal: data, numeratori: num.data as Numeratore[] };
}

/** Solo l'amministratore. */
export async function salvaFattureAttiveDal(data: string): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(new Date(data).getTime())) throw new Error("La data non è valida.");
  const { data: righe, error } = await db.from("gest_impostazioni").update({ valore: data }).eq("chiave", "fatture_attive_dal").select("chiave");
  if (error) throw new Error(error.message);
  if (!righe || righe.length === 0) throw new Error("Non salvato: questa impostazione la cambia solo l'amministratore.");
}

/** Le fatture si possono confermare da oggi? */
export const fattureAttive = (dal: string | null, oggi: string): boolean => dal != null && oggi >= dal;
