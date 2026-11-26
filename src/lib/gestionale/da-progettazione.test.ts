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

  it("voce per voce: una riga per ogni pezzo, materiale, lavorazione e trasporto, con il margine dentro il prezzo", () => {
    const input: RiepilogoProgetto = {
      ...base, deptMargins: {}, margin: 20,
      departments: [{
        key: "tappezzeria", label: "Tappezzeria",
        // pezzi 600, materiali 10,80, lavorazioni 90, trasporti 50
        totals: { materials: 10.8, operations: 90, perimeters: 0, pieces: 600, transports: 50, total: 750.8 } as DepartmentTotals,
        state: stato({
          pieces: [
            { id: "p", productName: "Velluto", color: "nero", width: 450, height: 320, dimUnit: "cm", quantity: 2 },
            { id: "q", productName: "Fodera", color: "", width: 450, height: 320, dimUnit: "cm" },
          ] as unknown as DepartmentState["pieces"],
          materials: [{ id: "m", name: "Fettuccia", unit: "m", quantity: 9, unitCost: 1.2 }, { id: "m0", name: "Gratis", unit: "m", quantity: 1, unitCost: 0 }] as unknown as DepartmentState["materials"],
          operations: [{ id: "o", name: "Confezione", mode: "ora", unit: "h", quantity: 3, rate: 30 }] as unknown as DepartmentState["operations"],
          transports: [{ id: "t", description: "Consegna a Roma", quantity: 1, unitCost: 50 }] as unknown as DepartmentState["transports"],
        }),
      }],
    };
    const p = preventivoDaProgettazione(input, aliquote);
    expect(p.righe.map((r) => [r.descrizione, r.quantita, r.um, r.prezzo_unitario])).toEqual([
      // senza listino il totale pezzi (600) si divide per copie: 2 su 3 al velluto, 1 su 3 alla fodera; poi +20%
      ["Velluto — 450 × 320 cm", 2, "pz", 240],
      ["Fodera — 450 × 320 cm", 1, "pz", 240],
      ["Fettuccia", 9, "m", 1.44],
      ["Confezione", 3, "h", 36],
      ["Consegna a Roma", 1, null, 50],       // sui trasporti niente margine
    ]);
    expect(p.righe[0].dettagli).toBe("Colore nero");
    expect(p.netto).toBe(890.96);             // 750,80 + (750,80 − 50) × 20%
    expect(calcolaTotali(p.righe, aliquote).imponibile).toBe(890.96);
    expect(p.righe.some((r) => /altre voci|conguaglio|Arrotondamento/.test(r.descrizione))).toBe(false);
  });

  it("gli stessi pezzi stanno su una riga sola; pezzi diversi su righe separate, ognuno con il suo disegno", () => {
    const catalog = { perimeterOps: [{ id: "orlo", name: "Orlo", color: "#c00", pricePerMeter: 2 }] } as unknown as NonNullable<RiepilogoProgetto["departments"][number]["catalog"]>;
    const telo = { productName: "Velluto", color: "nero", width: 450, height: 320, dimUnit: "cm", perimeters: [{ id: "a", opId: "orlo", sides: ["top", "bottom"] }], customWorks: [{ id: "c", name: "Sacca per catena", price: 40 }] };
    const input: RiepilogoProgetto = {
      ...base, deptMargins: {}, margin: 0,
      departments: [
        { key: "tappezzeria", label: "Tappezzeria", totals: { ...totali(500), pieces: 500 }, catalog,
          state: stato({ pieces: [
            { ...telo, id: "p1", quantity: 2 }, { ...telo, id: "p2", quantity: 1 },          // stesso pezzo: 3 copie su una riga
            { ...telo, id: "p3", quantity: 1, color: "rosso" },                               // colore diverso: riga a parte
            { id: "q", productName: "Fodera", color: "", width: 450, height: 320, dimUnit: "cm", perimeters: [] },
          ] as unknown as DepartmentState["pieces"] }) },
        { key: "falegnameria", label: "Falegnameria", totals: totali(200) },
      ],
    };
    const p = preventivoDaProgettazione(input, aliquote);
    expect(p.righe.map((r) => [r.tipo_riga, r.descrizione, r.quantita])).toEqual([
      ["nota", "TAPPEZZERIA", 0],
      ["lavorazione", "Velluto — 450 × 320 cm", 3], ["lavorazione", "Velluto — 450 × 320 cm", 1], ["lavorazione", "Fodera — 450 × 320 cm", 1],
      ["lavorazione", "Falegnameria", 1],       // reparto senza dettaglio: resta una riga sola
    ]);
    const [, nero, rosso, fodera, fal] = p.righe;
    expect(nero.schede_tecniche).toHaveLength(1);
    expect(nero.schede_tecniche?.[0]).toMatchObject({ titolo: "Velluto", quantita: 3, colore: "nero", lavorazioni: [{ nome: "Orlo", lati: ["top", "bottom"], colore: "#c00" }], lavorazioniLibere: ["Sacca per catena"] });
    expect(nero.dettagli).toBe("Colore nero\nSopra: Orlo\nSotto: Orlo\nSinistra: —\nDestra: —\nAltre lavorazioni: Sacca per catena");
    expect(rosso.schede_tecniche?.[0]).toMatchObject({ colore: "rosso", quantita: 1 });
    expect(fodera.dettagli).toBeNull();
    expect(JSON.stringify(p.righe.map((r) => r.schede_tecniche))).not.toMatch(/price|40/);
    expect("schede_tecniche" in fal).toBe(false);
    expect(p.netto).toBe(700);
    expect(calcolaTotali(p.righe, aliquote).imponibile).toBe(700);
  });

  it("quello che il reparto conteggia fuori dalle voci finisce in «altre voci»; i centesimi tornano sempre", () => {
    for (const pezziTot of [333.33, 100, 0.07]) {
      const input: RiepilogoProgetto = {
        ...base, deptMargins: {}, margin: 33.3,
        departments: [{ key: "stampa", label: "Stampa", totals: { ...totali(pezziTot + 77.77), pieces: pezziTot },
          state: stato({ pieces: [1, 2, 3].map((n) => ({ id: `p${n}`, productName: `Telo ${n}`, color: "", width: 100 * n, height: 100, dimUnit: "cm", quantity: 3, perimeters: [] })) as unknown as DepartmentState["pieces"] }) }],
      };
      const p = preventivoDaProgettazione(input, aliquote);
      expect(p.righe.filter((r) => r.descrizione.startsWith("Telo"))).toHaveLength(3);
      expect(p.righe.find((r) => r.descrizione === "Stampa — altre voci")?.quantita).toBe(1);
      const atteso = Math.round((nettoProgettazione(input) + Number.EPSILON) * 100) / 100;
      expect(p.netto).toBe(atteso);
      expect(calcolaTotali(p.righe, aliquote).imponibile).toBe(atteso);
    }
  });

  it("Vendite: una riga per prodotto con caratteristiche, quantità e prezzo all'unità di misura", () => {
    const input: RiepilogoProgetto = {
      ...base, deptMargins: { magazzino: 0 }, margin: 30,
      departments: [
        { key: "magazzino", label: "Vendite", totals: { ...totali(461.5), materials: 461.5 },
          vendite: [
            { nome: "Velluto Verdi", variante: "nero · 500 g/m² · h 300 cm · ignifugo classe 1", um: "m", quantita: 25.5, prezzo: 14.9 },
            { nome: "Tappeto danza — rotolo intero", variante: "20 × 1,6 m", um: "rotoli", quantita: 1, prezzo: 81.55 },
            { nome: "Nastro biadesivo", variante: null, um: "pz", quantita: 3, prezzo: 0 },      // omaggio: resta in elenco a zero
            { nome: "Scartato", variante: null, um: "pz", quantita: 0, prezzo: 10 },
          ] },
        { key: "stampa", label: "Stampa", totals: totali(100) },
      ],
    };
    const p = preventivoDaProgettazione(input, aliquote);
    expect(p.righe.map((r) => [r.tipo_riga, r.descrizione, r.dettagli, r.quantita, r.um, r.prezzo_unitario])).toEqual([
      ["nota", "VENDITE", null, 0, null, 0],
      ["libera", "Velluto Verdi", "nero · 500 g/m² · h 300 cm · ignifugo classe 1", 25.5, "m", 14.9],
      ["libera", "Tappeto danza — rotolo intero", "20 × 1,6 m", 1, "rotoli", 81.55],
      ["libera", "Nastro biadesivo", null, 3, "pz", 0],
      ["lavorazione", "Stampa", null, 1, null, 130],
    ]);
    expect(p.righe.some((r) => r.descrizione === "Vendite" || /altre voci/.test(r.descrizione))).toBe(false);
    expect(p.netto).toBe(591.5);
    expect(calcolaTotali(p.righe, aliquote).imponibile).toBe(591.5);
    // con il margine del reparto, il prezzo all'unità lo comprende
    const conMargine = preventivoDaProgettazione({ ...input, deptMargins: { magazzino: 10 } }, aliquote);
    expect(conMargine.righe[1].prezzo_unitario).toBe(16.39);
    expect(calcolaTotali(conMargine.righe, aliquote).imponibile).toBe(conMargine.netto);
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

import { testataDaCliente } from "./da-progettazione";

describe("cliente sul preventivo nato dalla scheda", () => {
  it("porta pagamento, condizione, scissione dei pagamenti e nome dell'ordine del cliente", () => {
    expect(testataDaCliente({ id: "c1", pagamento: "Bonifico 30 gg", esigibilita_iva: "S", ordine_cliente_tipo: "RdA", condizione_pagamento_id: "bb30" }))
      .toEqual({ anagrafica_id: "c1", pagamento: "Bonifico 30 gg", condizione_pagamento_id: "bb30", esigibilita_iva: "S", ordine_cliente_tipo: "RdA" });
  });
  it("cliente senza preferenze: valori neutri", () => {
    expect(testataDaCliente({ id: "c2", pagamento: null, esigibilita_iva: "I", ordine_cliente_tipo: null }))
      .toEqual({ anagrafica_id: "c2", pagamento: null, condizione_pagamento_id: null, esigibilita_iva: "I", ordine_cliente_tipo: null });
  });
});
