import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { preventivoDaProgettazione, type RiepilogoProgetto } from "./da-progettazione";
import { calcolaTotali, type AliquotaIva } from "./documenti";
import type { DepartmentState, DepartmentTotals } from "@/components/calculator/types";

const aliquote: AliquotaIva[] = [
  { id: "a22", codice: "22", descrizione: "IVA 22%", percentuale: 22, natura: null },
  { id: "a10", codice: "10", descrizione: "IVA 10%", percentuale: 10, natura: null },
];

const totali = (total: number, transports = 0): DepartmentTotals =>
  ({ materials: 0, operations: 0, perimeters: 0, pieces: 0, transports, total } as DepartmentTotals);

const stato = (p: Partial<DepartmentState>): DepartmentState =>
  ({ materials: [], operations: [], perimeters: [], pieces: [], transports: [], ...p } as DepartmentState);

const base: RiepilogoProgetto = {
  jobName: "Sipario teatro", quantity: 1, margin: 30, vat: 22, applyVat: true,
  departments: [
    { key: "tappezzeria", label: "Tappezzeria", totals: totali(333.33, 33.33) },
    { key: "stampa", label: "Stampa", totals: totali(100.1) },
    { key: "vuoto", label: "Falegnameria", totals: totali(0) },
  ],
  deptMargins: { stampa: 12.5 },
};

/** Netto come lo calcola il Riepilogo generale di Progettazione. */
const nettoProgettazione = (i: RiepilogoProgetto, lavorazioniProdotto = 0) =>
  i.departments.reduce((s, d) => s + d.totals.total + Math.max(0, d.totals.total - (d.totals.transports ?? 0)) * ((i.deptMargins?.[d.key] ?? i.margin) / 100), 0)
  + lavorazioniProdotto * (1 + i.margin / 100);

describe("preventivo del Gestionale da una scheda di Progettazione", () => {
  it("crea una riga per reparto con costo, senza i reparti a zero", () => {
    const p = preventivoDaProgettazione(base, aliquote);
    expect(p.oggetto).toBe("Sipario teatro");
    expect(p.righe.map((r) => r.descrizione)).toEqual(["Tappezzeria", "Stampa"]);
    expect(p.righe.every((r) => r.tipo_riga === "lavorazione" && r.quantita === 1 && r.aliquota_id === "a22")).toBe(true);
  });

  it("applica il margine del reparto, escludendo i trasporti dalla base", () => {
    const p = preventivoDaProgettazione(base, aliquote);
    // 333,33 + (333,33 − 33,33) × 30% = 423,33 ; 100,10 + 100,10 × 12,5% = 112,6125
    expect(p.righe[0].prezzo_unitario).toBe(423.33);
    expect(p.netto).toBe(535.94);
  });

  it("dà un imponibile identico al netto di Progettazione, anche con arrotondamenti sfavorevoli", () => {
    const casi: RiepilogoProgetto[] = [
      base,
      { ...base, deptMargins: {}, margin: 33.3, departments: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ key: `d${n}`, label: `Reparto ${n}`, totals: totali(10.005 + n * 0.111) })) },
      { ...base, margin: 17.77, departments: [{ key: "a", label: "A", totals: totali(0.335) }, { key: "b", label: "B", totals: totali(0.335) }, { key: "c", label: "C", totals: totali(0.335) }] },
    ];
    for (const c of casi) {
      const p = preventivoDaProgettazione(c, aliquote);
      const atteso = Math.round((nettoProgettazione(c) + Number.EPSILON) * 100) / 100;
      expect(p.netto).toBe(atteso);
      expect(calcolaTotali(p.righe, aliquote).imponibile).toBe(atteso);
    }
  });

  it("aggiunge le lavorazioni prodotto con il margine generale", () => {
    const input: RiepilogoProgetto = {
      ...base,
      subProjects: [{ id: "s1", name: "Quinta", order: 0, productWorks: [
        { id: "w1", name: "Ignifugazione", dept: "tappezzeria", hours: 2.5, hourlyCost: 40 },
        { id: "w2", name: "Senza ore", dept: "stampa", hours: 0, hourlyCost: 40 },
      ] }],
    };
    const p = preventivoDaProgettazione(input, aliquote);
    const riga = p.righe.find((r) => r.descrizione === "Quinta — Ignifugazione");
    expect(riga).toMatchObject({ prezzo_unitario: 130, dettagli: "2,5 h" });
    expect(p.righe.some((r) => r.descrizione.includes("Senza ore"))).toBe(false);
    expect(p.netto).toBe(Math.round(nettoProgettazione(input, 100) * 100) / 100);
  });

  it("descrive pezzi, materiali e lavorazioni del reparto senza mostrare i costi", () => {
    const input: RiepilogoProgetto = {
      ...base,
      departments: [{
        key: "tappezzeria", label: "Tappezzeria", totals: totali(500),
        state: stato({
          pieces: [{ id: "p", productName: "Velluto", color: "nero", width: 450, height: 320, dimUnit: "cm", quantity: 2 }] as unknown as DepartmentState["pieces"],
          materials: [{ id: "m", name: "Fettuccia", unit: "m", quantity: 9, unitCost: 1.2 }, { id: "m0", name: "Gratis", unit: "m", quantity: 1, unitCost: 0 }] as unknown as DepartmentState["materials"],
          operations: [{ id: "o", name: "Confezione", mode: "ora", unit: "h", quantity: 3, rate: 30 }] as unknown as DepartmentState["operations"],
        }),
      }],
    };
    const [riga] = preventivoDaProgettazione(input, aliquote).righe;
    expect(riga.dettagli).toBe("Velluto — 450,0×320,0 cm · nero · 2 pz\nFettuccia — 9,00 m\nConfezione");
    expect(riga.dettagli).not.toMatch(/€|1,2|30/);
  });

  it("gestisce IVA non applicata, aliquota non presente e quantità multiple", () => {
    expect(preventivoDaProgettazione({ ...base, applyVat: false }, aliquote).righe.every((r) => r.aliquota_id === null)).toBe(true);
    const senza = preventivoDaProgettazione({ ...base, vat: 5 }, aliquote);
    expect(senza.aliquotaMancante).toBe(5);
    expect(senza.righe[0].aliquota_id).toBeNull();
    const lotto = preventivoDaProgettazione({ ...base, quantity: 4 }, aliquote);
    const nota = lotto.righe[lotto.righe.length - 1];
    expect(nota.tipo_riga).toBe("nota");
    expect(nota.descrizione).toBe("Quantità: 4 pz — prezzo cadauno 133,99 € + IVA");
    expect(calcolaTotali(lotto.righe, aliquote).imponibile).toBe(535.94);
  });

  it("non crea righe se il progetto non ha costi", () => {
    const p = preventivoDaProgettazione({ ...base, departments: [] }, aliquote);
    expect(p.righe).toEqual([]);
    expect(p.netto).toBe(0);
  });
});
