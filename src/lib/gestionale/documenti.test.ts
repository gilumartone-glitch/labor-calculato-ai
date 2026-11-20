import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { calcolaTotali, importoRiga, rigaVuota, titoloDocumento, type AliquotaIva, type RigaBozza } from "./documenti";

const aliquote: AliquotaIva[] = [
  { id: "a22", codice: "22", descrizione: "IVA 22%", percentuale: 22, natura: null },
  { id: "a4", codice: "4", descrizione: "IVA 4%", percentuale: 4, natura: null },
];

const riga = (p: Partial<RigaBozza>): RigaBozza => ({ ...rigaVuota("a22"), descrizione: "x", ...p });

describe("documenti del Gestionale", () => {
  it("calcola l'importo di riga con sconto e arrotondamento al centesimo", () => {
    expect(importoRiga(riga({ quantita: 12.5, prezzo_unitario: 33.333, sconto_pct: 10 }))).toBe(375);
    expect(importoRiga(riga({ quantita: 3, prezzo_unitario: 9.99 }))).toBe(29.97);
    expect(importoRiga(riga({ tipo_riga: "nota", quantita: 5, prezzo_unitario: 100 }))).toBe(0);
  });

  // Stessi numeri verificati sul database: i due calcoli devono coincidere.
  it("calcola i totali con l'imposta per aliquota, come il database", () => {
    const righe = [
      riga({ quantita: 12.5, prezzo_unitario: 33.333, sconto_pct: 10 }),
      riga({ tipo_riga: "lavorazione", quantita: 1, prezzo_unitario: 250 }),
      riga({ quantita: 3, prezzo_unitario: 9.99, aliquota_id: "a4" }),
      riga({ tipo_riga: "nota", quantita: 5, prezzo_unitario: 100 }),
    ];
    expect(calcolaTotali(righe, aliquote)).toEqual({ imponibile: 654.97, imposta: 138.7, totale: 793.67 });
  });

  it("non applica imposta alle righe senza aliquota", () => {
    expect(calcolaTotali([riga({ quantita: 1, prezzo_unitario: 100, aliquota_id: null })], aliquote))
      .toEqual({ imponibile: 100, imposta: 0, totale: 100 });
  });

  it("compone il titolo con numero e anno solo dopo la conferma", () => {
    expect(titoloDocumento({ tipo: "preventivo", numero: 12, anno: 2026, serie: "", stato: "confermato" })).toBe("Preventivo n. 12/2026");
    expect(titoloDocumento({ tipo: "ddt", numero: null, anno: null, serie: "", stato: "bozza" })).toBe("DDT (bozza)");
  });
});

describe("percorso dei documenti e magazzino", () => {
  it("testoPercorso elenca i documenti confermati con numero e data", async () => {
    const { testoPercorso } = await import("./documenti");
    expect(testoPercorso([
      { id: "1", tipo: "preventivo", numero: 45, anno: 2026, serie: "", data: "2026-11-01", stato: "confermato" },
      { id: "2", tipo: "ordine", numero: 12, anno: 2026, serie: "A", data: "2026-11-05", stato: "confermato" },
      { id: "3", tipo: "ddt", numero: null, anno: null, serie: "", data: "2026-11-09", stato: "bozza" },
    ])).toBe("Preventivo n. 45/2026 del 01/11/2026 - Conferma d'ordine n. 12/A/2026 del 05/11/2026");
  });
  it("scaricano o caricano: bolla di carico, DDT e fattura accompagnatoria; la conferma d'ordine no", async () => {
    const { muoveMagazzino } = await import("./documenti");
    expect(muoveMagazzino("ddt")).toBe(true);
    expect(muoveMagazzino("bolla_carico")).toBe(true);
    expect(muoveMagazzino("fattura")).toBe(false);
    expect(muoveMagazzino("fattura", true)).toBe(true);
    expect(muoveMagazzino("ordine", true)).toBe(false);
  });
});

describe("catenaDocumento", () => {
  it("risale all'origine e scende a tutto ciò che ne è nato, saltando le bozze scartate", async () => {
    const { catenaDocumento } = await import("./documenti");
    const n = (id: string, tipo: "preventivo" | "ordine" | "ddt" | "fattura", origine_id: string | null, numero: number | null, data: string, stato: "bozza" | "confermato" | "annullato" = "confermato") =>
      [id, { id, tipo, numero, anno: 2026, serie: "", data, stato, origine_id }] as const;
    const nodi = new Map([
      n("p", "preventivo", null, 45, "2026-11-01"), n("o", "ordine", "p", 12, "2026-11-05"),
      n("d2", "ddt", "o", 41, "2026-11-12"), n("d1", "ddt", "o", 40, "2026-11-10"),
      n("f1", "fattura", "d1", 7, "2026-11-11"), n("x", "ddt", "o", null, "2026-11-09", "annullato"),
      n("altro", "preventivo", null, 46, "2026-11-02"),
    ]);
    const o = catenaDocumento("o", nodi);
    expect(o.prima.map((x) => x.id)).toEqual(["p"]);
    expect(o.dopo.map((x) => x.id)).toEqual(["d1", "f1", "d2"]);
    const f = catenaDocumento("f1", nodi);
    expect(f.prima.map((x) => x.id)).toEqual(["p", "o", "d1"]);
    expect(f.dopo).toEqual([]);
    expect(catenaDocumento("altro", nodi)).toEqual({ prima: [], dopo: [] });
  });
});
