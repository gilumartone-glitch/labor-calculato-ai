import { supabase } from "@/integrations/supabase/client";
import type { TipoDocumento } from "./documenti";

// Accesso tipizzato a mano: vedi nota in ./api.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const esito = <T,>(res: { data: T | null; error: { message: string } | null }): T => {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
};
const num = (v: unknown): number => (v == null ? 0 : Number(v));
const arrotonda2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/* ------------------------------------------------------------------ */
/* Condizioni di pagamento                                             */
/* ------------------------------------------------------------------ */
export type Rata = { giorni: number; percentuale: number };

export type CondizionePagamento = {
  id: string;
  codice: string;
  descrizione: string;
  modalita: string | null;
  rate: Rata[];
  fine_mese: boolean;
};

export type DatiCondizione = Omit<CondizionePagamento, "id">;

/**
 * Da "30/60/90" a tre rate uguali; da "0" a rata unica a vista.
 * L'ultima rata prende il resto, così le percentuali sommano 100.
 */
export function rateDaGiorni(testo: string): Rata[] | null {
  const parti = testo.split(/[/,;\s]+/).map((p) => p.trim()).filter((p) => p !== "");
  if (parti.length === 0) return null;
  const giorni = parti.map((p) => Number(p));
  if (giorni.some((g) => !Number.isInteger(g) || g < 0)) return null;
  const quota = Math.floor(10000 / giorni.length) / 100;
  return giorni.map((g, i) => ({
    giorni: g,
    percentuale: i === giorni.length - 1 ? arrotonda2(100 - quota * (giorni.length - 1)) : quota,
  }));
}

export const giorniDaRate = (rate: Rata[]): string => rate.map((r) => r.giorni).join("/");

const fineMese = (iso: string): string => {
  const [a, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
};

const piuGiorni = (iso: string, giorni: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + giorni);
  return d.toISOString().slice(0, 10);
};

/** Anteprima delle scadenze di un documento, calcolate come le calcola il database alla conferma. */
export function anteprimaScadenze(totale: number, dataBase: string, condizione: Pick<CondizionePagamento, "rate" | "fine_mese"> | null): { data: string; importo: number }[] {
  const rate = condizione?.rate?.length ? condizione.rate : [{ giorni: 0, percentuale: 100 }];
  let assegnato = 0;
  return rate.map((r, i) => {
    const importo = i === rate.length - 1 ? arrotonda2(totale - assegnato) : arrotonda2((totale * r.percentuale) / 100);
    assegnato = arrotonda2(assegnato + importo);
    const data = piuGiorni(dataBase, r.giorni);
    return { data: condizione?.fine_mese ? fineMese(data) : data, importo };
  });
}

export async function elencoCondizioni(): Promise<CondizionePagamento[]> {
  return esito<CondizionePagamento[]>(
    await db.from("gest_condizioni_pagamento").select("id, codice, descrizione, modalita, rate, fine_mese").is("archiviato_il", null).order("descrizione"),
  );
}

export async function salvaCondizione(dati: DatiCondizione, id?: string): Promise<CondizionePagamento> {
  const q = id
    ? db.from("gest_condizioni_pagamento").update(dati).eq("id", id)
    : db.from("gest_condizioni_pagamento").insert(dati);
  return esito<CondizionePagamento>(await q.select("id, codice, descrizione, modalita, rate, fine_mese").single());
}

export async function archiviaCondizione(id: string): Promise<void> {
  esito(await db.from("gest_condizioni_pagamento").update({ archiviato_il: new Date().toISOString() }).eq("id", id));
}

/* ------------------------------------------------------------------ */
/* Scadenze e pagamenti                                                */
/* ------------------------------------------------------------------ */
export type Verso = "incasso" | "pagamento";
export type StatoScadenza = "aperta" | "parziale" | "scaduta" | "saldata";

export type Scadenza = {
  id: string;
  documento_id: string;
  anagrafica_id: string | null;
  verso: Verso;
  numero_rata: number;
  data_scadenza: string;
  importo: number;
  modalita: string | null;
  note: string | null;
  documento_tipo: TipoDocumento;
  documento_numero: number | null;
  documento_anno: number | null;
  documento_serie: string;
  documento_data: string;
  riferimento_esterno: string | null;
  ragione_sociale: string | null;
  pagato: number;
  residuo: number;
  ultimo_pagamento: string | null;
  stato: StatoScadenza;
};

export type Pagamento = {
  id: number;
  scadenza_id: string;
  data: string;
  importo: number;
  modalita: string | null;
  nota: string | null;
  storno_di: number | null;
  creato_il: string;
};

export async function elencoScadenze(): Promise<Scadenza[]> {
  const tutte: Scadenza[] = [];
  const PAGINA = 1000;
  for (let da = 0; ; da += PAGINA) {
    const pagina = esito<Scadenza[]>(
      await db.from("gest_scadenzario").select("*").order("data_scadenza").order("id").range(da, da + PAGINA - 1),
    );
    tutte.push(...pagina);
    if (pagina.length < PAGINA) break;
  }
  return tutte.map((s) => ({ ...s, importo: num(s.importo), pagato: num(s.pagato), residuo: num(s.residuo) }));
}

export async function elencoPagamenti(scadenzaId: string): Promise<Pagamento[]> {
  const righe = esito<Pagamento[]>(await db.from("gest_pagamenti").select("*").eq("scadenza_id", scadenzaId).order("id"));
  return righe.map((p) => ({ ...p, importo: num(p.importo) }));
}

/** Registra un incasso o un pagamento e restituisce il residuo della scadenza. */
export async function registraPagamento(p: { scadenzaId: string; importo: number; data: string; modalita?: string | null; nota?: string | null }): Promise<number> {
  return num(esito<number>(await db.rpc("gest_registra_pagamento", {
    _scadenza_id: p.scadenzaId, _importo: p.importo, _data: p.data, _modalita: p.modalita ?? null, _nota: p.nota ?? null,
  })));
}

export async function stornaPagamento(pagamentoId: number): Promise<void> {
  esito(await db.rpc("gest_storna_pagamento", { _pagamento_id: pagamentoId, _nota: null }));
}

export async function spostaScadenza(id: string, dati: { data_scadenza: string; modalita: string | null; note: string | null }): Promise<void> {
  esito(await db.from("gest_scadenze").update(dati).eq("id", id));
}

/** Totali per il riepilogo in testa allo scadenzario. */
export function riepilogoScadenze(scadenze: Scadenza[]) {
  const t = { daIncassare: 0, incassiScaduti: 0, daPagare: 0, pagamentiScaduti: 0 };
  for (const s of scadenze) {
    if (s.stato === "saldata") continue;
    if (s.verso === "incasso") {
      t.daIncassare += s.residuo;
      if (s.stato === "scaduta") t.incassiScaduti += s.residuo;
    } else {
      t.daPagare += s.residuo;
      if (s.stato === "scaduta") t.pagamentiScaduti += s.residuo;
    }
  }
  return {
    daIncassare: arrotonda2(t.daIncassare), incassiScaduti: arrotonda2(t.incassiScaduti),
    daPagare: arrotonda2(t.daPagare), pagamentiScaduti: arrotonda2(t.pagamentiScaduti),
  };
}
