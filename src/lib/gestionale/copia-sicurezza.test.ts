import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { TABELLE_COPIA, componiCopia, impacchettaCopia, leggiCopia, nomeFileCopia, testoCanonico, type Riga } from "./copia-sicurezza";

const tabelle = (): Record<string, Riga[]> => ({
  ...Object.fromEntries(TABELLE_COPIA.map((t) => [t.nome, [] as Riga[]])),
  gest_anagrafiche: [{ id: "a1", ragione_sociale: "Teatro “Prova” srl – Napoli", fido: 1500.5, dati_origine: { b: 2, a: [1, null, "x"] }, archiviato_il: null }],
  gest_documenti: [{ id: "d1", tipo: "fattura", numero: 7, totale: 252.54 }, { id: "d2", tipo: "ddt", numero: 40, totale: 0 }],
});

describe("copia di sicurezza", () => {
  it("il testo canonico non dipende dall'ordine delle chiavi", () => {
    expect(testoCanonico({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe(testoCanonico({ a: { c: null, d: [1, { y: 2, z: 1 }] }, b: 1 }));
    expect(testoCanonico({ a: [1, 2] })).not.toBe(testoCanonico({ a: [2, 1] }));
  });
  it("crea, impacchetta e rilegge: stessi dati, copia integra", async () => {
    const copia = await componiCopia(tabelle(), "2027-01-15T18:30:00.000Z");
    expect(copia.conteggi.gest_documenti).toBe(2);
    expect(copia.impronta).toMatch(/^[0-9a-f]{64}$/);
    expect(nomeFileCopia(copia)).toBe("Gestionale_copia_2027-01-15_18-30.zip");
    const esito = await leggiCopia(await impacchettaCopia(copia));
    expect(esito.integra).toBe(true);
    expect(esito.copia.tabelle).toEqual(copia.tabelle);
  });
  it("si accorge di un dato cambiato, di una tabella mancante e di un file che non è una copia", async () => {
    const copia = await componiCopia(tabelle());
    const alterata = JSON.parse(JSON.stringify(copia)); alterata.tabelle.gest_documenti[0].totale = 1;
    expect((await leggiCopia(new TextEncoder().encode(JSON.stringify(alterata)))).integra).toBe(false);
    const monca = JSON.parse(JSON.stringify(copia)); delete monca.tabelle.gest_pezze;
    expect((await leggiCopia(new TextEncoder().encode(JSON.stringify(monca)))).problemi.join(" ")).toContain("gest_pezze");
    await expect(leggiCopia(new TextEncoder().encode("{\"ciao\":1}"))).rejects.toThrow(/non è una copia/);
    await expect(leggiCopia(new TextEncoder().encode("non json"))).rejects.toThrow(/danneggiato/);
  });
  it("lo script di ripristino accetta il file creato dall'app e rifiuta quello alterato", async () => {
    const script = await import("../../../scripts/gestionale-ripristina.mjs");
    const copia = await componiCopia(tabelle());
    const cartella = fs.mkdtempSync(path.join(os.tmpdir(), "copia-"));
    const buona = path.join(cartella, "copia.zip"); const cattiva = path.join(cartella, "alterata.json");
    fs.writeFileSync(buona, await impacchettaCopia(copia));
    const sql: string = script.sqlRipristino(await script.leggiCopia(buona));
    expect(sql).toContain("SELECT pg_temp.carica('gest_documenti'");
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
    const alterata = JSON.parse(JSON.stringify(copia)); alterata.tabelle.gest_documenti[0].numero = 8;
    fs.writeFileSync(cattiva, JSON.stringify(alterata));
    await expect(script.leggiCopia(cattiva)).rejects.toThrow(/Impronta/);
  });
});
