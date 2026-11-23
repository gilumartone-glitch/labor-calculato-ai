/**
 * Registri IVA: vendite (fatture e note di credito emesse) e acquisti (fatture dei fornitori),
 * con il riepilogo per aliquota e il prospetto di liquidazione del periodo.
 * Si leggono i soli documenti confermati: non c'è nulla da registrare a parte.
 */
import { supabase } from "@/integrations/supabase/client";
import { numeroDocumento, type TipoDocumento } from "./documenti";

// Accesso tipizzato a mano: vedi nota in ./api.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const esito = <T,>(res: { data: T | null; error: { message: string } | null }): T => {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
};
const arrotonda2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type Registro = "vendite" | "acquisti";

export type DocumentoIva = {
  id: string;
  tipo: Extract<TipoDocumento, "fattura" | "nota_credito" | "fattura_fornitore">;
  numero: number | null;
  anno: number | null;
  serie: string;
  data: string;
  intestatario: { ragione_sociale?: string | null; partita_iva?: string | null; codice_fiscale?: string | null } | null;
  riferimento_esterno: string | null;
  data_esterna: string | null;
  esigibilita_iva: "I" | "D" | "S";
};
export type AliquotaDocumento = { documento_id: string; codice: string; descrizione: string; percentuale: number; natura: string | null; imponibile: number; imposta: number };

export type RigaRegistro = {
  registro: Registro;
  documento_id: string;
  data: string;
  /** vendite: numero della fattura · acquisti: protocollo interno */
  numero: string;
  /** acquisti: numero e data del documento del fornitore */
  documento_fornitore: string;
  tipo: DocumentoIva["tipo"];
  controparte: string;
  partita_iva: string;
  aliquota: string;
  percentuale: number;
  natura: string | null;
  imponibile: number;
  imposta: number;
  /** I immediata · D differita · S scissione dei pagamenti (l'IVA la versa il cliente) */
  esigibilita: "I" | "D" | "S";
};

const dataIt = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");

/** Una riga per documento e per aliquota. Le note di credito entrano con il segno meno. */
export function righeRegistro(documenti: DocumentoIva[], aliquote: AliquotaDocumento[]): RigaRegistro[] {
  const perDocumento = new Map<string, AliquotaDocumento[]>();
  for (const a of aliquote) perDocumento.set(a.documento_id, [...(perDocumento.get(a.documento_id) ?? []), a]);
  const righe: RigaRegistro[] = [];
  for (const d of documenti) {
    const segno = d.tipo === "nota_credito" ? -1 : 1;
    const acquisto = d.tipo === "fattura_fornitore";
    for (const a of (perDocumento.get(d.id) ?? []).sort((x, y) => y.percentuale - x.percentuale || x.codice.localeCompare(y.codice))) {
      righe.push({
        registro: acquisto ? "acquisti" : "vendite",
        documento_id: d.id,
        data: d.data,
        numero: numeroDocumento(d),
        documento_fornitore: acquisto ? [d.riferimento_esterno ?? "", d.data_esterna ? `del ${dataIt(d.data_esterna)}` : ""].filter(Boolean).join(" ") : "",
        tipo: d.tipo,
        controparte: d.intestatario?.ragione_sociale ?? "",
        partita_iva: d.intestatario?.partita_iva || d.intestatario?.codice_fiscale || "",
        aliquota: a.percentuale === 0 ? `${a.codice}${a.natura ? ` (${a.natura})` : ""}` : `${a.percentuale}%`,
        percentuale: Number(a.percentuale),
        natura: a.natura,
        imponibile: arrotonda2(segno * Number(a.imponibile)),
        imposta: arrotonda2(segno * Number(a.imposta)),
        esigibilita: acquisto ? "I" : d.esigibilita_iva,
      });
    }
  }
  return righe.sort((a, b) => a.data.localeCompare(b.data) || a.numero.localeCompare(b.numero, "it", { numeric: true }));
}

export type TotaleAliquota = { aliquota: string; percentuale: number; imponibile: number; imposta: number };

/** Totali per aliquota di un registro. */
export function riepilogoPerAliquota(righe: RigaRegistro[]): TotaleAliquota[] {
  const totali = new Map<string, TotaleAliquota>();
  for (const r of righe) {
    const t = totali.get(r.aliquota) ?? { aliquota: r.aliquota, percentuale: r.percentuale, imponibile: 0, imposta: 0 };
    t.imponibile += r.imponibile; t.imposta += r.imposta;
    totali.set(r.aliquota, t);
  }
  return [...totali.values()].map((t) => ({ ...t, imponibile: arrotonda2(t.imponibile), imposta: arrotonda2(t.imposta) }))
    .sort((a, b) => b.percentuale - a.percentuale || a.aliquota.localeCompare(b.aliquota));
}

/**
 * Prospetto di liquidazione del periodo.
 * A debito conta solo l'IVA a esigibilità immediata: quella in scissione dei pagamenti la versa il cliente,
 * quella differita diventa dovuta all'incasso e qui resta indicata a parte.
 * L'IVA sugli acquisti è considerata tutta detraibile.
 */
export function liquidazione(righe: RigaRegistro[]) {
  const somma = (f: (r: RigaRegistro) => boolean) => arrotonda2(righe.filter(f).reduce((t, r) => t + r.imposta, 0));
  const ivaVendite = somma((r) => r.registro === "vendite" && r.esigibilita === "I");
  const ivaScissione = somma((r) => r.registro === "vendite" && r.esigibilita === "S");
  const ivaDifferita = somma((r) => r.registro === "vendite" && r.esigibilita === "D");
  const ivaAcquisti = somma((r) => r.registro === "acquisti");
  return { ivaVendite, ivaScissione, ivaDifferita, ivaAcquisti, saldo: arrotonda2(ivaVendite - ivaAcquisti) };
}

const campoCsv = (v: string): string => (/[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const importoCsv = (n: number): string => n.toFixed(2).replace(".", ",");
const TIPO_CSV: Record<DocumentoIva["tipo"], string> = { fattura: "Fattura", nota_credito: "Nota di credito", fattura_fornitore: "Fattura fornitore" };
const ESIGIBILITA_CSV = { I: "Immediata", D: "Differita", S: "Scissione dei pagamenti" } as const;

/** CSV di un registro per il commercialista: separatore «;», decimali con la virgola. */
export function registroCsv(righe: RigaRegistro[], registro: Registro): string {
  const acquisti = registro === "acquisti";
  const testata = ["Data", acquisti ? "Protocollo" : "Numero", ...(acquisti ? ["Documento fornitore"] : []), "Tipo", acquisti ? "Fornitore" : "Cliente", "Partita IVA / C.F.", "Aliquota", "Imponibile", "Imposta", ...(acquisti ? [] : ["Esigibilità"])];
  const corpo = righe.filter((r) => r.registro === registro).map((r) => [
    dataIt(r.data), r.numero, ...(acquisti ? [r.documento_fornitore] : []), TIPO_CSV[r.tipo], r.controparte, r.partita_iva,
    r.aliquota, importoCsv(r.imponibile), importoCsv(r.imposta), ...(acquisti ? [] : [ESIGIBILITA_CSV[r.esigibilita]]),
  ]);
  return [testata, ...corpo].map((riga) => riga.map(campoCsv).join(";")).join("\r\n") + "\r\n";
}

/** Primo e ultimo giorno di un mese (1-12), di un trimestre (T1-T4) o dell'anno. */
export function periodoIva(anno: number, periodo: number | "T1" | "T2" | "T3" | "T4" | "anno"): { dal: string; al: string } {
  const iso = (m: number, g: number) => `${anno}-${String(m).padStart(2, "0")}-${String(g).padStart(2, "0")}`;
  const fine = (m: number) => new Date(anno, m, 0).getDate();
  if (periodo === "anno") return { dal: iso(1, 1), al: iso(12, 31) };
  if (typeof periodo === "number") return { dal: iso(periodo, 1), al: iso(periodo, fine(periodo)) };
  const primo = (Number(periodo[1]) - 1) * 3 + 1;
  return { dal: iso(primo, 1), al: iso(primo + 2, fine(primo + 2)) };
}

const aBlocchi = <T,>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** Legge dal database i documenti confermati del periodo con il loro riepilogo IVA. */
export async function leggiRegistri(dal: string, al: string): Promise<RigaRegistro[]> {
  const documenti: DocumentoIva[] = [];
  const PAGINA = 1000;
  for (let da = 0; ; da += PAGINA) {
    const pagina = esito<DocumentoIva[]>(
      await db.from("gest_documenti")
        .select("id, tipo, numero, anno, serie, data, intestatario, riferimento_esterno, data_esterna, esigibilita_iva")
        .in("tipo", ["fattura", "nota_credito", "fattura_fornitore"]).eq("stato", "confermato")
        .gte("data", dal).lte("data", al).order("data").order("numero").range(da, da + PAGINA - 1),
    );
    documenti.push(...pagina);
    if (pagina.length < PAGINA) break;
  }
  const aliquote: AliquotaDocumento[] = [];
  for (const blocco of aBlocchi(documenti.map((d) => d.id), 150)) {
    aliquote.push(...esito<AliquotaDocumento[]>(
      await db.from("gest_documenti_iva").select("documento_id, codice, descrizione, percentuale, natura, imponibile, imposta").in("documento_id", blocco),
    ));
  }
  return righeRegistro(documenti, aliquote);
}
