import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { anteprimaScadenze, giorniDaRate, rateDaGiorni, riepilogoScadenze, type Scadenza } from "./scadenzario";

describe("scadenzario del Gestionale", () => {
  it("trasforma «30/60/90» in rate che sommano 100", () => {
    expect(rateDaGiorni("30/60/90")).toEqual([
      { giorni: 30, percentuale: 33.33 }, { giorni: 60, percentuale: 33.33 }, { giorni: 90, percentuale: 33.34 },
    ]);
    expect(rateDaGiorni("0")).toEqual([{ giorni: 0, percentuale: 100 }]);
    expect(rateDaGiorni("30, 60")).toEqual([{ giorni: 30, percentuale: 50 }, { giorni: 60, percentuale: 50 }]);
    for (const t of ["30/60/90", "30/60/90/120/150/180/210", "10 20 30"]) {
      const somma = rateDaGiorni(t)!.reduce((s, r) => s + r.percentuale, 0);
      expect(Math.round(somma * 100)).toBe(10000);
    }
    expect(giorniDaRate(rateDaGiorni("30/60")!)).toBe("30/60");
  });

  it("rifiuta giorni non validi", () => {
    expect(rateDaGiorni("")).toBeNull();
    expect(rateDaGiorni("trenta")).toBeNull();
    expect(rateDaGiorni("-30")).toBeNull();
    expect(rateDaGiorni("30.5")).toBeNull();
  });

  // Stessi numeri verificati sul database: 1.000,01 € a 30/60/90 fine mese dal 15/01/2026.
  it("calcola le scadenze come il database", () => {
    const rate = rateDaGiorni("30/60/90")!;
    expect(anteprimaScadenze(1000.01, "2026-01-15", { rate, fine_mese: true })).toEqual([
      { data: "2026-02-28", importo: 333.3 }, { data: "2026-03-31", importo: 333.3 }, { data: "2026-04-30", importo: 333.41 },
    ]);
    expect(anteprimaScadenze(244, "2026-03-10", { rate: rateDaGiorni("30")!, fine_mese: false })).toEqual([{ data: "2026-04-09", importo: 244 }]);
    expect(anteprimaScadenze(122, "2026-11-19", null)).toEqual([{ data: "2026-11-19", importo: 122 }]);
  });

  it("gestisce fine mese a cavallo d'anno e febbraio bisestile", () => {
    expect(anteprimaScadenze(100, "2026-12-05", { rate: rateDaGiorni("30")!, fine_mese: true })[0].data).toBe("2027-01-31");
    expect(anteprimaScadenze(100, "2028-01-31", { rate: rateDaGiorni("30")!, fine_mese: true })[0].data).toBe("2028-03-31");
    expect(anteprimaScadenze(100, "2028-01-20", { rate: rateDaGiorni("30")!, fine_mese: true })[0].data).toBe("2028-02-29");
  });

  it("riepiloga residui e scaduti per verso, ignorando le saldate", () => {
    const s = (p: Partial<Scadenza>) => ({ verso: "incasso", stato: "aperta", residuo: 0, ...p }) as Scadenza;
    expect(riepilogoScadenze([
      s({ residuo: 100.1 }), s({ residuo: 50.2, stato: "scaduta" }), s({ residuo: 0, stato: "saldata" }),
      s({ verso: "pagamento", residuo: 300, stato: "parziale" }), s({ verso: "pagamento", residuo: 20, stato: "scaduta" }),
      s({ residuo: -30, stato: "aperta" }),
    ])).toEqual({ daIncassare: 120.3, incassiScaduti: 50.2, daPagare: 320, pagamentiScaduti: 20 });
  });
});
