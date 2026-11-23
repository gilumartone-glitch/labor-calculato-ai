import { describe, expect, it } from "vitest";
import { casellaProposta, casellePerContesto, inBase64, soloAmministrazione, type Caselle } from "./invio-email";
import { emailEstrattoConto } from "./email-documento";

const caselle: Caselle = { configurato: true, amministrazione: "amministrazione@tecnofra.it", caselle: ["amministrazione@tecnofra.it", "commerciale@tecnofra.it", "info@tecnofra.it"] };

describe("caselle da cui spedire", () => {
  it("fatture, note di credito ed estratti conto: solo amministrazione", () => {
    for (const c of ["fattura", "nota_credito", "estratto_conto"] as const) {
      expect(soloAmministrazione(c)).toBe(true);
      expect(casellePerContesto(c, caselle)).toEqual(["amministrazione@tecnofra.it"]);
    }
  });
  it("preventivi, conferme d'ordine e DDT: tutte le caselle, sceglie l'operatore", () => {
    for (const c of ["preventivo", "ordine", "ddt"] as const) expect(casellePerContesto(c, caselle)).toEqual(caselle.caselle);
  });
  it("se l'amministrazione non è configurata la fattura non ha caselle", () => {
    expect(casellePerContesto("fattura", { ...caselle, caselle: ["info@tecnofra.it"] })).toEqual([]);
  });
  it("senza configurazione nessuna casella", () => {
    expect(casellePerContesto("preventivo", { ...caselle, configurato: false })).toEqual([]);
  });
  it("propone l'ultima usata, l'unica disponibile, altrimenti lascia scegliere", () => {
    expect(casellaProposta("preventivo", caselle.caselle, "info@tecnofra.it")).toBe("info@tecnofra.it");
    expect(casellaProposta("preventivo", caselle.caselle, "vecchia@tecnofra.it")).toBe("");
    expect(casellaProposta("preventivo", caselle.caselle, null)).toBe("");
    expect(casellaProposta("fattura", ["amministrazione@tecnofra.it"], null)).toBe("amministrazione@tecnofra.it");
    expect(casellaProposta("fattura", [], "amministrazione@tecnofra.it")).toBe("");
  });
});

describe("allegato", () => {
  it("il base64 torna identico anche oltre un blocco", () => {
    const byte = new Uint8Array(100_000).map((_, i) => (i * 31) % 256);
    const ritorno = Uint8Array.from(atob(inBase64(byte)), (c) => c.charCodeAt(0));
    expect(ritorno).toEqual(byte);
  });
});

describe("email dell'estratto conto", () => {
  const azienda = { denominazione: "Tecnofra srls", telefono: "081 000000", email: "amministrazione@tecnofra.it" };
  it("con scaduto chiede il pagamento", () => {
    const e = emailEstrattoConto({ alGiorno: "2027-02-10", residuo: 12345.6, scaduto: 2000 }, azienda);
    expect(e.oggetto).toBe("Estratto conto al 10/02/2027 - Tecnofra srls");
    expect(e.testo).toContain("saldo a nostro favore di 12.345,60 €, di cui 2.000,00 € già scaduti");
    expect(e.testo).toContain("provvedere al pagamento");
  });
  it("senza scaduto non sollecita; a saldo zero lo dice", () => {
    expect(emailEstrattoConto({ alGiorno: "2027-02-10", residuo: 500, scaduto: 0 }, azienda).testo).not.toContain("provvedere");
    expect(emailEstrattoConto({ alGiorno: "2027-02-10", residuo: 0, scaduto: 0 }, azienda).testo).toContain("non risultano importi da saldare");
  });
});
