import { num } from "@/lib/format";
import type { DepartmentState, DepartmentTotals, SubProject } from "@/components/calculator/types";
import { getProductWorks } from "@/components/calculator/types";
import type { AliquotaIva, RigaBozza } from "./documenti";

/**
 * Riepilogo di una scheda di Progettazione, così come lo mostra il «Riepilogo generale»:
 * stessi dati che alimentano la stampa del preventivo cliente.
 */
export type RiepilogoProgetto = {
  jobName: string;
  quantity: number;
  margin: number;
  vat: number;
  applyVat: boolean;
  departments: { key: string; label: string; totals: DepartmentTotals; state?: DepartmentState }[];
  subProjects?: SubProject[];
  deptMargins?: Record<string, number>;
};

export type PreventivoDaProgetto = {
  oggetto: string | null;
  righe: RigaBozza[];
  /** Imponibile atteso: coincide al centesimo con il «netto» del Riepilogo generale. */
  netto: number;
  /** Aliquota non trovata tra quelle del Gestionale: le righe restano senza IVA e va scelta a mano. */
  aliquotaMancante: number | null;
};

const arrotonda2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Elenco leggibile di cosa comprende un reparto: pezzi, materiali, lavorazioni. Senza prezzi. */
const dettagliReparto = (st: DepartmentState | undefined): string | null => {
  if (!st) return null;
  const righe: string[] = [];
  for (const p of st.pieces ?? []) {
    const qty = Number(p.quantity) || 1;
    const dim = `${num(p.width, 1)}×${num(p.height, 1)} ${p.dimUnit}`;
    righe.push(`${p.productName || "Pezzo"} — ${dim}${p.color ? ` · ${p.color}` : ""}${qty > 1 ? ` · ${qty} pz` : ""}`);
  }
  for (const m of st.materials ?? []) {
    if (m.quantity * m.unitCost <= 0) continue;
    righe.push(`${m.name || "Materiale"} — ${num(m.quantity, 2)} ${m.unit || ""}`.trim());
  }
  for (const op of st.operations ?? []) {
    if (op.quantity * op.rate <= 0) continue;
    righe.push(op.name || "Lavorazione");
  }
  for (const t of st.transports ?? []) {
    if (t.quantity * t.unitCost <= 0) continue;
    righe.push(t.description || "Trasporto");
  }
  return righe.length > 0 ? righe.join("\n") : null;
};

/**
 * Trasforma il riepilogo di Progettazione nelle righe di un preventivo del Gestionale:
 * una riga per reparto (prezzo con margine), una per ogni lavorazione prodotto.
 * La somma delle righe coincide con il netto mostrato in Progettazione.
 */
export function preventivoDaProgettazione(input: RiepilogoProgetto, aliquote: AliquotaIva[]): PreventivoDaProgetto {
  const aliquota = input.applyVat ? aliquote.find((a) => a.percentuale === input.vat) ?? null : null;
  const aliquotaId = aliquota?.id ?? null;
  const margineDi = (k: string) => input.deptMargins?.[k] ?? input.margin;

  const righe: RigaBozza[] = [];
  let nettoEsatto = 0;

  const aggiungi = (descrizione: string, dettagli: string | null, prezzo: number) => {
    nettoEsatto += prezzo;
    righe.push({
      tipo_riga: "lavorazione", variante_id: null, codice: null, descrizione, dettagli, um: null,
      quantita: 1, prezzo_unitario: arrotonda2(prezzo), sconto_pct: 0, aliquota_id: aliquotaId,
    });
  };

  for (const d of input.departments) {
    if (d.totals.total <= 0) continue;
    const baseMargine = Math.max(0, d.totals.total - (d.totals.transports ?? 0));
    aggiungi(d.label, dettagliReparto(d.state), d.totals.total + baseMargine * (margineDi(d.key) / 100));
  }

  for (const sp of input.subProjects ?? []) {
    for (const w of getProductWorks(sp)) {
      const ore = Number(w.hours) || 0;
      const costo = ore * (Number(w.hourlyCost) || 0);
      if (costo <= 0) continue;
      aggiungi(`${sp.name} — ${w.name || "Lavorazione"}`, `${num(ore, 1)} h`, costo * (1 + input.margin / 100));
    }
  }

  // Gli arrotondamenti riga per riga possono spostare il totale di qualche centesimo:
  // la differenza va sull'ultima riga, così l'imponibile è quello di Progettazione.
  const netto = arrotonda2(nettoEsatto);
  if (righe.length > 0) {
    const somma = arrotonda2(righe.reduce((s, r) => s + r.prezzo_unitario, 0));
    const scarto = arrotonda2(netto - somma);
    if (scarto !== 0) {
      const ultima = righe[righe.length - 1];
      ultima.prezzo_unitario = arrotonda2(ultima.prezzo_unitario + scarto);
    }
  }

  if (input.quantity > 1 && righe.length > 0) {
    righe.push({
      tipo_riga: "nota", variante_id: null, codice: null,
      descrizione: `Quantità: ${input.quantity} pz — prezzo cadauno ${num(netto / input.quantity, 2)} € + IVA`,
      dettagli: null, um: null, quantita: 0, prezzo_unitario: 0, sconto_pct: 0, aliquota_id: null,
    });
  }

  return {
    oggetto: input.jobName.trim() || null,
    righe,
    netto,
    aliquotaMancante: input.applyVat && !aliquota ? input.vat : null,
  };
}
