import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  AZIENDA_VUOTA, controllaFattura, creaFatturaXml, modalitaPagamento, nomeFileFattura, progressivoInvio, testoLatino, totaliFattura,
  type DatiAzienda, type DatiFattura, type RigaFattura,
} from "./fattura-pa";

const azienda: DatiAzienda = {
  ...AZIENDA_VUOTA, denominazione: "Prova Scene S.r.l.s.", partita_iva: "01234567890", codice_fiscale: "01234567890",
  indirizzo: "Via Roma 1", cap: "80013", comune: "Casalnuovo di Napoli", provincia: "NA",
  rea_ufficio: "NA", rea_numero: "123456", capitale_sociale: "1.000,00", socio_unico: "SM",
  telefono: "081 1234567", email: "info@example.it", iban: "IT60 X054 2811 1010 0000 0123 456", banca: "Banca di Prova",
};
const aliquote = [
  { id: "a22", codice: "22", descrizione: "IVA 22%", percentuale: 22, natura: null },
  { id: "a10", codice: "10", descrizione: "IVA 10%", percentuale: 10, natura: null },
  { id: "n3", codice: "NI8", descrizione: "Non imp. art. 8 DPR 633/72", percentuale: 0, natura: "N3.1" },
];
const riga = (p: Partial<RigaFattura>): RigaFattura => ({
  tipo_riga: "libera", codice: null, descrizione: "Tessuto", dettagli: null, um: "m", quantita: 1, prezzo_unitario: 100, sconto_pct: 0, aliquota_id: "a22", ...p,
});
const fattura = (p: Partial<DatiFattura> = {}): DatiFattura => ({
  tipo: "fattura", numero: 12, anno: 2027, serie: "", data: "2027-01-15", oggetto: "Fornitura sipario", riferimento_esterno: null, data_esterna: null,
  cig: null, cup: null, esigibilita_iva: "I", bollo_virtuale: false,
  cliente: { ragione_sociale: "Teatro Prova srl", partita_iva: "09876543210", codice_fiscale: null, codice_sdi: "ABC1234", pec: null, indirizzo: "Corso Italia 5", cap: "00100", citta: "Roma", provincia: "RM", nazione: "IT" },
  righe: [riga({ codice: "TES-001", descrizione: "Velluto ignifugo “Scala” – rosso", quantita: 12.5, prezzo_unitario: 18.4, sconto_pct: 10 }), riga({ tipo_riga: "nota", descrizione: "Consegna a Vs. cura", quantita: 0, prezzo_unitario: 0, aliquota_id: null })],
  aliquote, condizione: { rate: [{ giorni: 30, percentuale: 50 }, { giorni: 60, percentuale: 50 }], fine_mese: true, modalita: "Bonifico" }, origine: null, ...p,
});
const valore = (xml: string, nome: string) => [...xml.matchAll(new RegExp(`<${nome}>([^<]*)</${nome}>`, "g"))].map((m) => m[1]);

describe("testoLatino", () => {
  it("traduce i caratteri non ammessi e toglie gli altri", () => {
    expect(testoLatino("Costo 5 € – “telo” 3×2 m… 😀 perché", 100)).toBe('Costo 5 EUR - "telo" 3x2 m... perché');
  });
  it("rispetta la lunghezza massima", () => {
    expect(testoLatino("abcdef", 4)).toBe("abcd");
  });
});

describe("progressivo e nome del file", () => {
  it("unico per documento, 5 caratteri", () => {
    expect(progressivoInvio({ tipo: "fattura", numero: 12, anno: 2027 })).toBe("FB00C");
    expect(progressivoInvio({ tipo: "nota_credito", numero: 12, anno: 2027 })).toBe("NB00C");
    expect(nomeFileFattura(azienda, { tipo: "fattura", numero: 700, anno: 2027 })).toBe("IT01234567890_FB0JG.xml");
  });
});

describe("modalitaPagamento", () => {
  it("riconosce le parole usate nelle condizioni", () => {
    expect(modalitaPagamento("RiBa 30/60 fm")).toBe("MP12");
    expect(modalitaPagamento("Contanti alla consegna")).toBe("MP01");
    expect(modalitaPagamento(null)).toBe("MP05");
  });
});

describe("controllaFattura", () => {
  it("fattura completa: nessun errore", () => {
    expect(controllaFattura(azienda, fattura())).toEqual({ errori: [], avvisi: [] });
  });
  it("segnala i dati mancanti di azienda, cliente e righe", () => {
    const c = controllaFattura({ ...azienda, partita_iva: "123", cap: "" }, fattura({
      cliente: { ragione_sociale: "Mario Rossi", indirizzo: "Via X", citta: "Napoli", cap: "8013", nazione: "IT" },
      righe: [riga({ aliquota_id: null }), riga({ aliquota_id: "n3" })],
      aliquote: [{ ...aliquote[2], natura: null }],
    }));
    expect(c.errori).toEqual([
      "Dati azienda: la partita IVA deve avere 11 cifre.",
      "Dati azienda: il CAP deve avere 5 cifre.",
      "Cliente: il CAP deve avere 5 cifre.",
      "Cliente: serve la partita IVA oppure il codice fiscale.",
      "Riga 1: manca l'aliquota IVA.",
      "Riga 2: l'aliquota «Non imp. art. 8 DPR 633/72» è senza IVA ma non ha il codice natura (N1…N7).",
    ]);
  });
  it("avvisa su bollo, bozza e destinatario mancante", () => {
    const c = controllaFattura(azienda, fattura({
      numero: null, righe: [riga({ aliquota_id: "n3" })],
      cliente: { ...fattura().cliente, codice_sdi: null },
    }));
    expect(c.errori).toEqual([]);
    expect(c.avvisi).toHaveLength(3);
  });
  it("CIG senza riferimento d'ordine è un errore", () => {
    expect(controllaFattura(azienda, fattura({ cig: "1234567890" })).errori).toEqual(["Con CIG o CUP serve anche il riferimento all'ordine del cliente."]);
  });
});

describe("totaliFattura", () => {
  it("imposta per aliquota; con la scissione dei pagamenti il cliente paga l'imponibile", () => {
    const d = fattura({ righe: [riga({ quantita: 3, prezzo_unitario: 33.33 }), riga({ aliquota_id: "a10", prezzo_unitario: 50 })] });
    expect(totaliFattura(d)).toMatchObject({ imponibile: 149.99, imposta: 27, totale: 176.99, daPagare: 176.99 });
    expect(totaliFattura({ ...d, esigibilita_iva: "S" }).daPagare).toBe(149.99);
  });
});

describe("creaFatturaXml", () => {
  it("fattura tra privati con sconto, nota e due rate", () => {
    const xml = creaFatturaXml(azienda, fattura());
    expect(xml).toContain('versione="FPR12"');
    expect(valore(xml, "FormatoTrasmissione")).toEqual(["FPR12"]);
    expect(valore(xml, "CodiceDestinatario")).toEqual(["ABC1234"]);
    expect(valore(xml, "TipoDocumento")).toEqual(["TD01"]);
    expect(valore(xml, "Numero")).toEqual(["12/2027"]);
    expect(valore(xml, "Descrizione")).toEqual(['Velluto ignifugo &quot;Scala&quot; - rosso', "Consegna a Vs. cura"]);
    expect(valore(xml, "Quantita")).toEqual(["12.50"]);
    expect(valore(xml, "PrezzoUnitario")).toEqual(["18.40", "0.00"]);
    expect(valore(xml, "Percentuale")).toEqual(["10.00"]);
    expect(valore(xml, "PrezzoTotale")).toEqual(["207.00", "0.00"]);
    expect(valore(xml, "AliquotaIVA")).toEqual(["22.00", "22.00", "22.00"]);
    expect(valore(xml, "ImponibileImporto")).toEqual(["207.00"]);
    expect(valore(xml, "Imposta")).toEqual(["45.54"]);
    expect(valore(xml, "ImportoTotaleDocumento")).toEqual(["252.54"]);
    expect(valore(xml, "CondizioniPagamento")).toEqual(["TP01"]);
    expect(valore(xml, "DataScadenzaPagamento")).toEqual(["2027-02-28", "2027-03-31"]);
    expect(valore(xml, "ImportoPagamento")).toEqual(["126.27", "126.27"]);
    expect(valore(xml, "IBAN")).toEqual(["IT60X0542811101000000123456", "IT60X0542811101000000123456"]);
    expect(valore(xml, "CapitaleSociale")).toEqual(["1000.00"]);
  });

  it("scissione dei pagamenti con CIG: IVA esposta, si incassa l'imponibile", () => {
    const xml = creaFatturaXml(azienda, fattura({ esigibilita_iva: "S", cig: "a1b2c3d4e5", riferimento_esterno: "ODA 4500012345", data_esterna: "2027-01-02", condizione: null }));
    expect(valore(xml, "EsigibilitaIVA")).toEqual(["S"]);
    expect(valore(xml, "CodiceCIG")).toEqual(["A1B2C3D4E5"]);
    expect(valore(xml, "IdDocumento")).toEqual(["ODA 4500012345"]);
    expect(valore(xml, "ImportoTotaleDocumento")).toEqual(["252.54"]);
    expect(valore(xml, "ImportoPagamento")).toEqual(["207.00"]);
    expect(valore(xml, "CondizioniPagamento")).toEqual(["TP02"]);
  });

  it("nota di credito: TD04 con la fattura rettificata, senza pagamento", () => {
    const xml = creaFatturaXml(azienda, fattura({ tipo: "nota_credito", numero: 3, origine: { tipo: "fattura", numero: "12/2027", data: "2027-01-15" } }));
    expect(valore(xml, "TipoDocumento")).toEqual(["TD04"]);
    expect(xml).toContain("<DatiFattureCollegate><IdDocumento>12/2027</IdDocumento><Data>2027-01-15</Data></DatiFattureCollegate>");
    expect(xml).not.toContain("DatiPagamento");
  });

  it("fattura da DDT di un giorno precedente: differita con riferimento al DDT", () => {
    const xml = creaFatturaXml(azienda, fattura({ origine: { tipo: "ddt", numero: "40/2027", data: "2027-01-10" } }));
    expect(valore(xml, "TipoDocumento")).toEqual(["TD24"]);
    expect(valore(xml, "NumeroDDT")).toEqual(["40/2027"]);
  });

  it("Pubblica Amministrazione, operazione senza IVA con bollo, cliente via PEC, cliente estero", () => {
    const pa = creaFatturaXml(azienda, fattura({ cliente: { ...fattura().cliente, codice_sdi: "UFABCD" }, cig: "1234567890", riferimento_esterno: "Det. 15" }));
    expect(valore(pa, "FormatoTrasmissione")).toEqual(["FPA12"]);

    const esente = creaFatturaXml(azienda, fattura({ righe: [riga({ aliquota_id: "n3" })], bollo_virtuale: true }));
    expect(valore(esente, "Natura")).toEqual(["N3.1", "N3.1"]);
    expect(valore(esente, "RiferimentoNormativo")).toEqual(["Non imp. art. 8 DPR 633/72"]);
    expect(esente).toContain("<DatiBollo><BolloVirtuale>SI</BolloVirtuale><ImportoBollo>2.00</ImportoBollo></DatiBollo>");

    const pec = creaFatturaXml(azienda, fattura({ cliente: { ...fattura().cliente, codice_sdi: null, pec: "teatro@pec.example.it" } }));
    expect(valore(pec, "CodiceDestinatario")).toEqual(["0000000"]);
    expect(valore(pec, "PECDestinatario")).toEqual(["teatro@pec.example.it"]);

    const estero = creaFatturaXml(azienda, fattura({ cliente: { ragione_sociale: "Bühne GmbH", partita_iva: "DE123456789", indirizzo: "Hauptstraße 1", citta: "Berlin", cap: "10115", nazione: "DE" } }));
    expect(valore(estero, "CodiceDestinatario")).toEqual(["XXXXXXX"]);
    expect(valore(estero, "CAP")).toEqual(["80013", "00000"]);
    expect(estero).toContain("<IdPaese>DE</IdPaese><IdCodice>123456789</IdCodice>");
  });

  it("con errori non crea il file", () => {
    expect(() => creaFatturaXml({ ...azienda, partita_iva: "" }, fattura())).toThrow(/partita IVA/);
  });
});
