import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { documentoRiga, etichettaConto, primaNotaCsv, riepilogoPrimaNota, type RigaPrimaNota } from "./prima-nota";

const riga = (p: Partial<RigaPrimaNota>): RigaPrimaNota => ({
  id: "F1", data: "2027-01-10", verso: "entrata", importo: 100, conto: "bnl", ragione_sociale: "Teatro Prova srl",
  documento_tipo: "fattura", documento_numero: "12/2027", documento_rif: null, descrizione: "", origine: "banca",
  e_storno: false, creato_il: "2027-01-10T10:00:00Z", documento_id: "d", scadenza_id: "s", manuale_id: null, pagamento_id: 1, ...p,
});

describe("riepilogoPrimaNota", () => {
  it("somma entrate e uscite per conto e in totale", () => {
    const r = riepilogoPrimaNota([
      { verso: "entrata", importo: 1220.1, conto: "bnl" },
      { verso: "entrata", importo: 0.2, conto: "bnl" },
      { verso: "uscita", importo: 244, conto: "credem" },
      { verso: "uscita", importo: 12.5, conto: "contanti" },
      { verso: "entrata", importo: 50, conto: "contanti" },
    ]);
    expect(r.conti).toEqual([
      { conto: "bnl", entrate: 1220.3, uscite: 0, saldo: 1220.3 },
      { conto: "contanti", entrate: 50, uscite: 12.5, saldo: 37.5 },
      { conto: "credem", entrate: 0, uscite: 244, saldo: -244 },
    ]);
    expect(r).toMatchObject({ entrate: 1270.3, uscite: 256.5, saldo: 1013.8 });
  });

  it("periodo vuoto", () => {
    expect(riepilogoPrimaNota([])).toEqual({ conti: [], entrate: 0, uscite: 0, saldo: 0 });
  });
});

describe("documentoRiga", () => {
  it("fattura emessa: numero interno", () => {
    expect(documentoRiga(riga({}))).toBe("Fattura 12/2027");
  });
  it("fattura fornitore: numero del fornitore", () => {
    expect(documentoRiga(riga({ documento_tipo: "fattura_fornitore", documento_numero: "3/2027", documento_rif: "FT 55" }))).toBe("Fattura fornitore FT 55");
  });
  it("movimento manuale: il documento indicato", () => {
    expect(documentoRiga(riga({ documento_tipo: null, documento_numero: null, documento_rif: "Scontrino 45" }))).toBe("Scontrino 45");
  });
});

describe("primaNotaCsv", () => {
  it("separatore punto e virgola, decimali con la virgola, testi protetti", () => {
    const csv = primaNotaCsv([
      riga({}),
      riga({ id: "M1", verso: "uscita", importo: 12.5, conto: "contanti", ragione_sociale: "", documento_tipo: null, documento_numero: null, documento_rif: "Scontrino 45; bar", descrizione: 'Caffè "riunione"', origine: "manuale" }),
    ]);
    const righe = csv.trimEnd().split("\r\n");
    expect(righe[0]).toBe("Data;Conto;Documento;Cliente / fornitore;Descrizione;Entrata;Uscita");
    expect(righe[1]).toBe("10/01/2027;BNL;Fattura 12/2027;Teatro Prova srl;;100,00;");
    expect(righe[2]).toBe('10/01/2027;Contanti;"Scontrino 45; bar";;"Caffè ""riunione""";;12,50');
  });
  it("gli storni sono riconoscibili", () => {
    expect(primaNotaCsv([riga({ e_storno: true, verso: "uscita" })])).toContain(";Storno;;100,00");
  });
});

describe("etichettaConto", () => {
  it("conti noti e conti liberi", () => {
    expect(etichettaConto("bnl")).toBe("BNL");
    expect(etichettaConto("satispay")).toBe("Satispay");
  });
});
