import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { anagraficheConPartite, creaPdfEstrattoConto, estrattoConto, nomeDocumentoEstratto, nomeFileEstratto } from "./estratto-conto";
import { AZIENDA_VUOTA } from "./fattura-pa";
import type { Scadenza } from "./scadenzario";

const s = (p: Partial<Scadenza> & Pick<Scadenza, "id" | "documento_id">): Scadenza => ({
  anagrafica_id: "teatro", verso: "incasso", numero_rata: 1, data_scadenza: "2027-02-28", importo: 610, modalita: null, note: null,
  documento_tipo: "fattura", documento_numero: 1, documento_anno: 2027, documento_serie: "", documento_data: "2027-01-10",
  riferimento_esterno: null, ragione_sociale: "Teatro Prova srl", pagato: 0, residuo: 610, ultimo_pagamento: null, stato: "aperta", in_contabilita: true, ...p,
});
const scadenze = [
  s({ id: "a", documento_id: "f1", pagato: 610, residuo: 0, stato: "saldata", ultimo_pagamento: "2027-02-20" }),
  s({ id: "b", documento_id: "f1", numero_rata: 2, data_scadenza: "2027-03-31", pagato: 200, residuo: 410, stato: "scaduta" }),
  s({ id: "c", documento_id: "f2", documento_numero: 2, documento_data: "2027-03-05", data_scadenza: "2027-12-31", importo: 1000, residuo: 1000 }),
  s({ id: "d", documento_id: "n1", documento_tipo: "nota_credito", documento_numero: 1, documento_data: "2027-03-10", importo: -100, residuo: -100 }),
  s({ id: "e", documento_id: "f9", documento_numero: 9, pagato: 610, residuo: 0, stato: "saldata" }),
  s({ id: "f", documento_id: "x1", anagrafica_id: "altro", ragione_sociale: "Altro Cliente", importo: 50, residuo: 50, stato: "scaduta" }),
  s({ id: "g", documento_id: "p1", anagrafica_id: "forn", verso: "pagamento", ragione_sociale: "Tessuti Nord spa", documento_tipo: "fattura_fornitore", riferimento_esterno: "FT 55", importo: 244, residuo: 244 }),
];

describe("estratto conto", () => {
  it("elenco dei clienti con partite: prima chi deve di più, con lo scaduto", () => {
    expect(anagraficheConPartite(scadenze, "incasso")).toEqual([
      { anagrafica_id: "teatro", ragione_sociale: "Teatro Prova srl", documenti: 4, residuo: 1310, scaduto: 410 },
      { anagrafica_id: "altro", ragione_sociale: "Altro Cliente", documenti: 1, residuo: 50, scaduto: 50 },
    ]);
    expect(anagraficheConPartite(scadenze, "pagamento").map((p) => p.ragione_sociale)).toEqual(["Tessuti Nord spa"]);
  });
  it("tutti i documenti del cliente con saldato, da saldare e scaduto; la nota di credito scala", () => {
    const e = estrattoConto(scadenze, "teatro", { verso: "incasso", soloAperte: false });
    expect(e.documenti.map((d) => [nomeDocumentoEstratto(d), d.totale, d.pagato, d.residuo, d.scaduto])).toEqual([
      ["Fattura n. 1/2027", 1220, 810, 410, 410],
      ["Fattura n. 9/2027", 610, 610, 0, 0],
      ["Fattura n. 2/2027", 1000, 0, 1000, 0],
      ["Nota di credito n. 1/2027", -100, 0, -100, 0],
    ]);
    expect(e.documenti[0].rate.map((r) => r.numero_rata)).toEqual([1, 2]);
    expect(e.totali).toEqual({ totale: 2730, pagato: 1420, residuo: 1310, scaduto: 410, aScadere: 900 });
  });
  it("solo partite aperte e filtro per data del documento", () => {
    const aperte = estrattoConto(scadenze, "teatro", { verso: "incasso", soloAperte: true });
    expect(aperte.documenti.map((d) => d.numero)).toEqual(["1/2027", "2/2027", "1/2027"]);
    expect(aperte.totali.residuo).toBe(1310);
    const marzo = estrattoConto(scadenze, "teatro", { verso: "incasso", soloAperte: false, dal: "2027-03-01", al: "2027-03-31" });
    expect(marzo.totali).toMatchObject({ totale: 900, residuo: 900 });
  });
  it("fornitori: il documento è quello del fornitore", () => {
    const e = estrattoConto(scadenze, "forn", { verso: "pagamento", soloAperte: true });
    expect(nomeDocumentoEstratto(e.documenti[0])).toBe("Fattura FT 55");
  });
  it("PDF: si crea anche vuoto e va su più pagine con molti documenti", () => {
    const vuoto = estrattoConto([], "teatro", { verso: "incasso", soloAperte: true });
    expect(creaPdfEstrattoConto({ ...AZIENDA_VUOTA }, {}, vuoto, { verso: "incasso", soloAperte: true, alGiorno: "2027-04-01" }).getNumberOfPages()).toBe(1);
    const tante = Array.from({ length: 90 }, (_, i) => s({ id: `r${i}`, documento_id: `d${i}`, documento_numero: i + 1 }));
    const e = estrattoConto(tante, "teatro", { verso: "incasso", soloAperte: false });
    expect(creaPdfEstrattoConto({ ...AZIENDA_VUOTA }, { ragione_sociale: "Teatro Prova srl" }, e, { verso: "incasso", soloAperte: false, alGiorno: "2027-04-01" }).getNumberOfPages()).toBeGreaterThan(1);
    expect(nomeFileEstratto("Teatro “Prova” s.r.l.", "2027-04-01")).toBe("Estratto-conto_Teatro-Prova-s-r-l_2027-04-01.pdf");
  });
});
