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
