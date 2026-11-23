/**
 * Inventario: quanto c'è a magazzino a una certa data e quanto vale.
 * Si ricostruisce dal registro dei movimenti, quindi vale per qualsiasi giorno, anche passato.
 */
import { supabase } from "@/integrations/supabase/client";
import { CATEGORIA_LABEL, descriviVariante, type Articolo, type Categoria, type Variante } from "./types";

// Accesso tipizzato a mano: vedi nota in ./api.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const arrotonda = (n: number, cifre: number) => { const f = 10 ** cifre; return Math.round((n + Number.EPSILON) * f) / f; };

export type MovimentoInventario = { variante_id: string; quantita: number; creato_il: string };

export type RigaInventario = {
  variante_id: string;
  codice: string;
  articolo: string;
  categoria: Categoria;
  variante: string;
  um: string;
  giacenza: number;
  /** costo attuale per unità di misura: null se non indicato */
  costo_um: number | null;
  /** null quando manca il costo */
  valore: number | null;
};

/** Tutti i movimenti di magazzino, dal più vecchio. */
export async function tuttiIMovimenti(): Promise<MovimentoInventario[]> {
  const tutti: MovimentoInventario[] = [];
  const PAGINA = 1000;
  for (let da = 0; ; da += PAGINA) {
    const { data, error } = await db.from("gest_movimenti").select("variante_id, quantita, creato_il").order("id").range(da, da + PAGINA - 1);
    if (error) throw new Error(error.message);
    tutti.push(...(data as MovimentoInventario[]).map((m) => ({ ...m, quantita: Number(m.quantita) })));
    if ((data as MovimentoInventario[]).length < PAGINA) break;
  }
  return tutti;
}

/**
 * Giacenze alla fine del giorno indicato (AAAA-MM-GG, ora italiana del computer).
 * Entrano le varianti con giacenza diversa da zero; con `ancheVuote` tutte quelle non archiviate.
 */
export function inventarioAllaData(movimenti: MovimentoInventario[], varianti: Variante[], articoli: Articolo[], giorno: string, ancheVuote = false): RigaInventario[] {
  const fineGiorno = new Date(`${giorno}T23:59:59.999`).getTime();
  const giacenze = new Map<string, number>();
  for (const m of movimenti) {
    if (new Date(m.creato_il).getTime() > fineGiorno) continue;
    giacenze.set(m.variante_id, (giacenze.get(m.variante_id) ?? 0) + m.quantita);
  }
  const articoloById = new Map(articoli.map((a) => [a.id, a]));
  const righe: RigaInventario[] = [];
  for (const v of varianti) {
    const giacenza = arrotonda(giacenze.get(v.id) ?? 0, 3);
    if (giacenza === 0 && (!ancheVuote || v.archiviato_il)) continue;
    const a = articoloById.get(v.articolo_id);
    righe.push({
      variante_id: v.id, codice: v.codice, articolo: a?.nome ?? "", categoria: a?.categoria ?? "altro", variante: descriviVariante(v), um: a?.um ?? "",
      giacenza, costo_um: v.costo_um, valore: v.costo_um == null ? null : arrotonda(giacenza * v.costo_um, 2),
    });
  }
  return righe.sort((x, y) => x.categoria.localeCompare(y.categoria) || x.articolo.localeCompare(y.articolo, "it") || x.codice.localeCompare(y.codice, "it", { numeric: true }));
}

/** Valore per categoria e totale; conta anche quante righe sono senza costo o in negativo. */
export function riepilogoInventario(righe: RigaInventario[]) {
  const per = new Map<Categoria, { categoria: Categoria; righe: number; valore: number }>();
  for (const r of righe) {
    const c = per.get(r.categoria) ?? { categoria: r.categoria, righe: 0, valore: 0 };
    c.righe++; c.valore += r.valore ?? 0;
    per.set(r.categoria, c);
  }
  const categorie = [...per.values()].map((c) => ({ ...c, valore: arrotonda(c.valore, 2) }));
  return {
    categorie,
    valore: arrotonda(categorie.reduce((t, c) => t + c.valore, 0), 2),
    senzaCosto: righe.filter((r) => r.costo_um == null && r.giacenza !== 0).length,
    negative: righe.filter((r) => r.giacenza < 0).length,
  };
}

const campoCsv = (v: string): string => (/[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const numeroCsv = (n: number | null, cifre: number): string => (n == null ? "" : n.toFixed(cifre).replace(".", ","));

/** CSV dell'inventario: separatore «;», decimali con la virgola. */
export function inventarioCsv(righe: RigaInventario[]): string {
  const testata = ["Categoria", "Codice", "Articolo", "Variante", "UM", "Giacenza", "Costo unitario", "Valore"];
  const corpo = righe.map((r) => [CATEGORIA_LABEL[r.categoria], r.codice, r.articolo, r.variante, r.um, numeroCsv(r.giacenza, 3), numeroCsv(r.costo_um, 4), numeroCsv(r.valore, 2)]);
  return [testata, ...corpo].map((riga) => riga.map(campoCsv).join(";")).join("\r\n") + "\r\n";
}
