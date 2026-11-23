import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { liquidazione, periodoIva, registroCsv, riepilogoPerAliquota, righeRegistro, type AliquotaDocumento, type DocumentoIva } from "./registri-iva";

const doc = (p: Partial<DocumentoIva> & Pick<DocumentoIva, "id" | "tipo">): DocumentoIva => ({
  numero: 1, anno: 2027, serie: "", data: "2027-01-10", intestatario: { ragione_sociale: "Teatro Prova srl", partita_iva: "09876543210" },
  riferimento_esterno: null, data_esterna: null, esigibilita_iva: "I", ...p,
});
const iva = (documento_id: string, percentuale: number, imponibile: number, natura: string | null = null): AliquotaDocumento => ({
  documento_id, codice: percentuale === 0 ? "NI8" : String(percentuale), descrizione: "", percentuale, natura, imponibile, imposta: Math.round(imponibile * percentuale) / 100,
});

const documenti = [
  doc({ id: "f2", tipo: "fattura", numero: 2, data: "2027-01-20" }),
  doc({ id: "f1", tipo: "fattura", numero: 1 }),
  doc({ id: "n1", tipo: "nota_credito", numero: 1, data: "2027-01-25" }),
  doc({ id: "s1", tipo: "fattura", numero: 3, data: "2027-01-28", esigibilita_iva: "S", intestatario: { ragione_sociale: "Ente Pubblico", codice_fiscale: "80012345678" } }),
  doc({ id: "a1", tipo: "fattura_fornitore", numero: 5, data: "2027-01-12", riferimento_esterno: "FT 55", data_esterna: "2027-01-08", intestatario: { ragione_sociale: "Tessuti Nord spa", partita_iva: "01111111111" } }),
];
const aliquote = [iva("f1", 22, 1000), iva("f1", 10, 200), iva("f2", 0, 500, "N3.1"), iva("n1", 22, 100), iva("s1", 22, 2000), iva("a1", 22, 300)];
const righe = righeRegistro(documenti, aliquote);

describe("registri IVA", () => {
  it("una riga per documento e aliquota, in ordine di data; la nota di credito è negativa", () => {
    const vendite = righe.filter((r) => r.registro === "vendite");
    expect(vendite.map((r) => [r.numero, r.aliquota, r.imponibile, r.imposta])).toEqual([
      ["1/2027", "22%", 1000, 220], ["1/2027", "10%", 200, 20], ["2/2027", "NI8 (N3.1)", 500, 0], ["1/2027", "22%", -100, -22], ["3/2027", "22%", 2000, 440],
    ]);
    expect(vendite[4].partita_iva).toBe("80012345678");
  });
  it("acquisti: protocollo interno e documento del fornitore", () => {
    const a = righe.filter((r) => r.registro === "acquisti");
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ numero: "5/2027", documento_fornitore: "FT 55 del 08/01/2027", controparte: "Tessuti Nord spa", imposta: 66 });
  });
  it("riepilogo per aliquota", () => {
    expect(riepilogoPerAliquota(righe.filter((r) => r.registro === "vendite"))).toEqual([
      { aliquota: "22%", percentuale: 22, imponibile: 2900, imposta: 638 },
      { aliquota: "10%", percentuale: 10, imponibile: 200, imposta: 20 },
      { aliquota: "NI8 (N3.1)", percentuale: 0, imponibile: 500, imposta: 0 },
    ]);
  });
  it("liquidazione: l'IVA in scissione dei pagamenti non è a debito", () => {
    expect(liquidazione(righe)).toEqual({ ivaVendite: 218, ivaScissione: 440, ivaDifferita: 0, ivaAcquisti: 66, saldo: 152 });
  });
  it("CSV dei due registri", () => {
    const v = registroCsv(righe, "vendite").trimEnd().split("\r\n");
    expect(v[0]).toBe("Data;Numero;Tipo;Cliente;Partita IVA / C.F.;Aliquota;Imponibile;Imposta;Esigibilità");
    expect(v[4]).toBe("25/01/2027;1/2027;Nota di credito;Teatro Prova srl;09876543210;22%;-100,00;-22,00;Immediata");
    expect(registroCsv(righe, "acquisti").trimEnd().split("\r\n")[1]).toBe("12/01/2027;5/2027;FT 55 del 08/01/2027;Fattura fornitore;Tessuti Nord spa;01111111111;22%;300,00;66,00");
  });
  it("periodi: mese, trimestre, anno", () => {
    expect(periodoIva(2028, 2)).toEqual({ dal: "2028-02-01", al: "2028-02-29" });
    expect(periodoIva(2027, "T4")).toEqual({ dal: "2027-10-01", al: "2027-12-31" });
    expect(periodoIva(2027, "anno")).toEqual({ dal: "2027-01-01", al: "2027-12-31" });
  });
});
