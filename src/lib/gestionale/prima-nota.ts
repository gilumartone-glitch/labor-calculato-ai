import { supabase } from "@/integrations/supabase/client";
import type { TipoDocumento } from "./documenti";

// Accesso tipizzato a mano: vedi nota in ./api.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const esito = <T,>(res: { data: T | null; error: { message: string } | null }): T => {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
};
const arrotonda2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Conti su cui passa il denaro. Le banche hanno lo stesso nome usato in Contabilità → Conti. */
export const CONTI: { codice: string; etichetta: string }[] = [
  { codice: "contanti", etichetta: "Contanti" },
  { codice: "bnl", etichetta: "BNL" },
  { codice: "credem", etichetta: "Credem" },
  { codice: "paypal", etichetta: "PayPal" },
];

export const etichettaConto = (codice: string): string =>
  CONTI.find((c) => c.codice === codice)?.etichetta ?? codice.charAt(0).toUpperCase() + codice.slice(1);

export type VersoMovimento = "entrata" | "uscita";

export type RigaPrimaNota = {
  id: string;
  data: string;
  verso: VersoMovimento;
  importo: number;
  conto: string;
  ragione_sociale: string;
  documento_tipo: TipoDocumento | null;
  documento_numero: string | null;
  documento_rif: string | null;
  descrizione: string;
  origine: "manuale" | "banca";
  e_storno: boolean;
  creato_il: string;
  documento_id: string | null;
  scadenza_id: string | null;
  manuale_id: number | null;
  pagamento_id: number | null;
};

export async function elencoPrimaNota(dal: string, al: string): Promise<RigaPrimaNota[]> {
  const tutte: RigaPrimaNota[] = [];
  const PAGINA = 1000;
  for (let da = 0; ; da += PAGINA) {
    const pagina = esito<RigaPrimaNota[]>(
      await db.from("gest_prima_nota_vista").select("*").gte("data", dal).lte("data", al)
        .order("data").order("creato_il").order("id").range(da, da + PAGINA - 1),
    );
    tutte.push(...pagina);
    if (pagina.length < PAGINA) break;
  }
  return tutte.map((r) => ({ ...r, importo: Number(r.importo) }));
}

export async function registraMovimento(m: {
  data: string; verso: VersoMovimento; importo: number; conto: string; descrizione: string; documentoRif: string;
}): Promise<number> {
  return Number(esito<number>(await db.rpc("gest_prima_nota_registra", {
    _data: m.data, _verso: m.verso, _importo: m.importo, _conto: m.conto,
    _descrizione: m.descrizione, _documento_rif: m.documentoRif, _anagrafica_id: null,
  })));
}

export async function stornaMovimento(id: number): Promise<void> {
  esito(await db.rpc("gest_prima_nota_storna", { _id: id }));
}

/** Entrate, uscite e saldo del periodo, per conto e in totale. */
export function riepilogoPrimaNota(righe: Pick<RigaPrimaNota, "verso" | "importo" | "conto">[]) {
  const perConto = new Map<string, { conto: string; entrate: number; uscite: number }>();
  for (const r of righe) {
    const c = perConto.get(r.conto) ?? { conto: r.conto, entrate: 0, uscite: 0 };
    if (r.verso === "entrata") c.entrate += r.importo; else c.uscite += r.importo;
    perConto.set(r.conto, c);
  }
  const conti = [...perConto.values()]
    .map((c) => ({ conto: c.conto, entrate: arrotonda2(c.entrate), uscite: arrotonda2(c.uscite), saldo: arrotonda2(c.entrate - c.uscite) }))
    .sort((a, b) => a.conto.localeCompare(b.conto));
  const entrate = arrotonda2(conti.reduce((t, c) => t + c.entrate, 0));
  const uscite = arrotonda2(conti.reduce((t, c) => t + c.uscite, 0));
  return { conti, entrate, uscite, saldo: arrotonda2(entrate - uscite) };
}

const TIPO_BREVE: Partial<Record<TipoDocumento, string>> = {
  fattura: "Fattura", nota_credito: "Nota di credito", fattura_fornitore: "Fattura fornitore",
};

/** Il documento che giustifica la riga: la fattura, oppure lo scontrino/ricevuta indicato a mano. */
export function documentoRiga(r: Pick<RigaPrimaNota, "documento_tipo" | "documento_numero" | "documento_rif">): string {
  if (!r.documento_tipo) return r.documento_rif ?? "";
  if (r.documento_tipo === "fattura_fornitore") return `${TIPO_BREVE.fattura_fornitore} ${r.documento_rif || r.documento_numero || ""}`.trim();
  return `${TIPO_BREVE[r.documento_tipo] ?? r.documento_tipo} ${r.documento_numero ?? ""}`.trim();
}

const campoCsv = (v: string): string => (/[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const importoCsv = (n: number): string => n.toFixed(2).replace(".", ",");
const dataCsv = (iso: string): string => iso.slice(0, 10).split("-").reverse().join("/");

/** CSV per il commercialista: separatore «;», decimali con la virgola, si apre direttamente in Excel. */
export function primaNotaCsv(righe: RigaPrimaNota[]): string {
  const testata = ["Data", "Conto", "Documento", "Cliente / fornitore", "Descrizione", "Entrata", "Uscita"];
  const corpo = righe.map((r) => [
    dataCsv(r.data), etichettaConto(r.conto), documentoRiga(r), r.ragione_sociale,
    r.e_storno ? `Storno${r.descrizione ? `: ${r.descrizione}` : ""}` : r.descrizione,
    r.verso === "entrata" ? importoCsv(r.importo) : "", r.verso === "uscita" ? importoCsv(r.importo) : "",
  ]);
  return [testata, ...corpo].map((riga) => riga.map(campoCsv).join(";")).join("\r\n") + "\r\n";
}
