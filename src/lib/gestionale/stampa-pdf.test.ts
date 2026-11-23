import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { creaPdfDocumento, nomeFilePdf, riferimentiStampa, titoloStampa, type DatiStampa } from "./stampa-pdf";
import { AZIENDA_VUOTA } from "./fattura-pa";

const base: DatiStampa = {
  tipo: "fattura", numero: 7, anno: 2027, serie: "", data: "2027-01-15", accompagnatoria: false,
  cliente: { ragione_sociale: "Fondazione Teatro di Prova – Stagione Lirica", partita_iva: "09876543210" },
  oggetto: "Sipario", produzione: "Il Barbiere di Siviglia", ordine_cliente_tipo: "OP", riferimento_esterno: "4500123", data_esterna: "2026-11-02",
  cig: "A1B2C3D4E5", cup: null, pagamento: "Bonifico", validita_giorni: 30, consegna_prevista: "2026-12-10", destinazione: null,
  causale_trasporto: null, aspetto_beni: null, colli: null, peso_kg: null, vettore: null, porto: null, note: null,
  esigibilita_iva: "I", bollo_virtuale: false,
  righe: [{ tipo_riga: "libera", codice: null, descrizione: "Tessuto", dettagli: null, um: "m", quantita: 2, prezzo_unitario: 100, sconto_pct: 0, aliquota_id: "a22", variante_id: null, riga_origine_id: null } as never],
  aliquote: [{ id: "a22", codice: "22", descrizione: "IVA 22%", percentuale: 22, natura: null }],
  condizione: null,
  percorso: [{ id: "p", tipo: "preventivo", numero: 45, anno: 2026, serie: "", data: "2026-11-01", stato: "confermato" }],
};

describe("stampa PDF", () => {
  it("titolo con numero e data; la bozza e la fattura accompagnatoria si riconoscono", () => {
    expect(titoloStampa(base)).toBe("FATTURA n. 7/2027 del 15/01/2027");
    expect(titoloStampa({ ...base, accompagnatoria: true })).toBe("FATTURA ACCOMPAGNATORIA n. 7/2027 del 15/01/2027");
    expect(titoloStampa({ ...base, tipo: "ordine", numero: null })).toBe("CONFERMA D'ORDINE / FATTURA PROFORMA - BOZZA del 15/01/2027");
  });
  it("nome del file leggibile e senza caratteri strani", () => {
    expect(nomeFilePdf(base)).toBe("Fattura_7-2027_Fondazione-Teatro-di-Prova-Stagione-Lirica.pdf");
    expect(nomeFilePdf({ ...base, tipo: "preventivo", numero: null, cliente: {} })).toBe("Preventivo_bozza.pdf");
  });
  it("i riferimenti sono gli stessi della fattura elettronica, solo quelli compilati", () => {
    expect(riferimentiStampa(base)).toEqual([
      ["Ordine cliente", "OP 4500123 del 02/11/2026"],
      ["Produzione", "Il Barbiere di Siviglia"],
      ["CIG", "A1B2C3D4E5"],
      ["Riferimenti", "Preventivo n. 45/2026 del 01/11/2026"],
      ["Pagamento", "Bonifico"],
    ]);
    // la validità è del preventivo, la consegna della conferma d'ordine, il DDT non parla di pagamenti
    expect(riferimentiStampa({ ...base, tipo: "preventivo" }).map(([n]) => n)).toContain("Validità offerta");
    expect(riferimentiStampa({ ...base, tipo: "ordine" }).map(([n]) => n)).toContain("Consegna prevista");
    expect(riferimentiStampa({ ...base, tipo: "ddt" }).map(([n]) => n)).not.toContain("Pagamento");
  });
  it("crea il file anche con dati azienda vuoti e senza righe; molte righe vanno su più pagine", () => {
    expect(creaPdfDocumento({ ...AZIENDA_VUOTA }, { ...base, righe: [] }).getNumberOfPages()).toBe(1);
    const lunga = { ...base, righe: Array.from({ length: 80 }, () => base.righe[0]) };
    expect(creaPdfDocumento({ ...AZIENDA_VUOTA }, lunga).getNumberOfPages()).toBeGreaterThan(1);
  });
});
