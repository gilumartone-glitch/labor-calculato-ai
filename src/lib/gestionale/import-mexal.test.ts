import { describe, expect, it } from "vitest";
import { daMexal, leggiExportMexal, riepilogoImport } from "./import-mexal";

// Dati inventati, nella stessa forma dell'export "Anagrafica Clienti Fornitori per Excel" di Mexal.
const COLONNE = [
  "Conto", "Ragione Sociale", "Partita Iva", "Codice Fiscale", "Senza p.Iva", "Indirizzo", "CAP", "Località", "Prov",
  "Nazione", "Codice SDI", "Telefono", "Cod Pag", "Pagamento", "Banca di appoggio", "ABI", "CAB", "Banca presentazione",
  "Cod. Iva/Esenzione", "Email", "PEC", "Saldo", "Esposizione", "Fido", "Fuori fido", "Rischio",
];
const riga = (celle: string[]) => `<Row>${celle.map((c) => `<Cell><Data ss:Type="String">${c}</Data></Cell>`).join("")}</Row>`;
const foglio = (righe: string[]) => `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Foglio1"><Table>
  ${riga(["STAMPA CLIENTI E FORNITORI"])}
  ${riga(["Azienda:", "PROVA SRL"])}
  ${riga(COLONNE)}
  ${righe.join("\n")}
  ${riga(["Fine Stampa"])}
 </Table></Worksheet>
</Workbook>`;

const completa = [
  "501.00010", "Teatro Esempio srl", "IT01234567890", "01234567890", "N", "Via Roma 1", "80100", "NAPOLI", "NA",
  "Italia", "ABC1234", "0810000000", "22", "BONIFICO ANTICIPATO", "Banca Uno", "01234", "03400", "202.00001 BANCA",
  " 22", "a@esempio.it; b@esempio.it", "pec@esempio.it", "597.19000000000005", "10", "5000", "0", "292.8",
];
const xml = foglio([
  riga(completa),
  // riga corta: Mexal omette le celle finali vuote
  riga(["501.00011", ".", "000000000000000", "", "N", ".", "99999", ".", "EE", "Italia"]),
  riga(["601.00020", "Stoffe Estere GmbH", "DE123456789", "XXXXXXXXXX", "S", "Hauptstr. 5", "10115", "BERLIN", "EE", "DE"]),
  riga(["501.00012", "Privato Senza Iva", "IT00000000000", "RSSMRA80A01F839X", "N"]),
]);

describe("import anagrafiche da Mexal", () => {
  const lettura = leggiExportMexal(xml);

  it("legge tutte le schede e riporta le righe che non lo sono", () => {
    expect(lettura.intestazioni).toEqual(COLONNE);
    expect(lettura.righe).toHaveLength(4);
    expect(lettura.nonSchede.map((r) => r[0])).toEqual(["STAMPA CLIENTI E FORNITORI", "Azienda:", "Fine Stampa"]);
  });

  it("conserva ogni colonna originale, senza ritocchi, in dati_origine", () => {
    const a = daMexal(lettura.righe[0], "2026-11-19T12:00:00Z");
    COLONNE.forEach((c, i) => expect(a.dati_origine[c]).toBe(completa[i]));
    expect(Object.keys(a.dati_origine)).toHaveLength(26);
    // le righe corte hanno comunque tutte le 26 colonne, vuote dove Mexal non ha scritto nulla
    expect(Object.keys(daMexal(lettura.righe[1], "x").dati_origine)).toHaveLength(26);
  });

  it("copia i campi noti nei campi del Gestionale", () => {
    const a = daMexal(lettura.righe[0], "2026-11-19T12:00:00Z");
    expect(a).toMatchObject({
      codice: "501.00010", codice_mexal: "501.00010", is_cliente: true, is_fornitore: false,
      ragione_sociale: "Teatro Esempio srl", partita_iva: "IT01234567890", codice_fiscale: "01234567890",
      senza_partita_iva: false, indirizzo: "Via Roma 1", cap: "80100", citta: "NAPOLI", provincia: "NA", nazione: "IT",
      codice_sdi: "ABC1234", telefono: "0810000000", codice_pagamento: "22", pagamento: "BONIFICO ANTICIPATO",
      banca_appoggio: "Banca Uno", abi: "01234", cab: "03400", banca_presentazione: "202.00001 BANCA",
      codice_iva_esenzione: "22", email: "a@esempio.it; b@esempio.it", pec: "pec@esempio.it", fido: 5000, origine: "mexal",
    });
  });

  it("riconosce fornitori, nazioni estere e schede senza partita IVA", () => {
    const f = daMexal(lettura.righe[2], "x");
    expect(f).toMatchObject({ is_cliente: false, is_fornitore: true, nazione: "DE", partita_iva: "DE123456789", senza_partita_iva: true });
  });

  it("non tratta i segnaposto come partite IVA o codici fiscali veri, ma li conserva nell'originale", () => {
    const zeri = daMexal(lettura.righe[1], "x");
    expect(zeri.partita_iva).toBeNull();
    expect(zeri.dati_origine["Partita Iva"]).toBe("000000000000000");
    expect(zeri.ragione_sociale).toBe(".");
    const privato = daMexal(lettura.righe[3], "x");
    expect(privato.partita_iva).toBeNull();
    expect(privato.codice_fiscale).toBe("RSSMRA80A01F839X");
    expect(daMexal(lettura.righe[2], "x").codice_fiscale).toBeNull();
    expect(daMexal(lettura.righe[2], "x").dati_origine["Codice Fiscale"]).toBe("XXXXXXXXXX");
  });

  it("riassume cosa verrà importato", () => {
    expect(riepilogoImport(lettura)).toEqual({
      totale: 4, clienti: 3, fornitori: 1, pivaSegnaposto: 2, cfSegnaposto: 1, altriMastri: [], nonSchede: 3,
    });
  });

  it("rifiuta un file che non è l'export atteso", () => {
    expect(() => leggiExportMexal("<Workbook xmlns=\"urn:schemas-microsoft-com:office:spreadsheet\"/>")).toThrow(/Conto/);
  });
});
