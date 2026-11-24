import { describe, expect, it } from "vitest";
import { casellaProposta, casellePerContesto, inBase64, interpretaCaselle, type Caselle } from "./invio-email";
import { emailEstrattoConto } from "./email-documento";

const tutti = ["preventivo", "ordine", "ddt", "fattura", "nota_credito", "estratto_conto"] as const;
const caselle: Caselle = { configurato: true, caselle: [
  { indirizzo: "amministrazione@tecnofra.it", nome: "Amministrazione", documenti: ["fattura", "nota_credito", "estratto_conto"] },
  { indirizzo: "commerciale@tecnofra.it", nome: "Commerciale", documenti: ["preventivo", "ordine"] },
  { indirizzo: "magazzino@tecnofra.it", nome: "", documenti: ["ddt", "ordine"] },
] };
const indirizzi = (c: ReturnType<typeof casellePerContesto>) => c.map((x) => x.indirizzo);

describe("caselle da cui spedire", () => {
  it("ogni documento parte solo dalle caselle abilitate per quel documento", () => {
    expect(indirizzi(casellePerContesto("fattura", caselle))).toEqual(["amministrazione@tecnofra.it"]);
    expect(indirizzi(casellePerContesto("estratto_conto", caselle))).toEqual(["amministrazione@tecnofra.it"]);
    expect(indirizzi(casellePerContesto("preventivo", caselle))).toEqual(["commerciale@tecnofra.it"]);
    expect(indirizzi(casellePerContesto("ordine", caselle))).toEqual(["commerciale@tecnofra.it", "magazzino@tecnofra.it"]);
    expect(indirizzi(casellePerContesto("ddt", caselle))).toEqual(["magazzino@tecnofra.it"]);
  });
  it("senza configurazione nessuna casella", () => {
    expect(casellePerContesto("preventivo", { ...caselle, configurato: false })).toEqual([]);
  });
  it("legge la risposta del server, anche quella della prima versione (solo indirizzi)", () => {
    expect(interpretaCaselle(null)).toEqual({ configurato: false, caselle: [] });
    expect(interpretaCaselle({ configurato: true, caselle: [{ indirizzo: "a@tecnofra.it", nome: "A", documenti: ["ddt", "inventato"] }] }))
      .toEqual({ configurato: true, caselle: [{ indirizzo: "a@tecnofra.it", nome: "A", documenti: ["ddt"] }] });
    const vecchia = interpretaCaselle({ configurato: true, caselle: ["amministrazione@tecnofra.it", "info@tecnofra.it"] });
    expect(vecchia.caselle[0].documenti).toEqual([...tutti]);
    expect(vecchia.caselle[1].documenti).toEqual(["preventivo", "ordine", "ddt"]);
  });
  it("propone l'ultima usata, l'unica disponibile, altrimenti lascia scegliere", () => {
    expect(casellaProposta("preventivo", ["info@tecnofra.it", "x@tecnofra.it"], "info@tecnofra.it")).toBe("info@tecnofra.it");
    expect(casellaProposta("preventivo", ["info@tecnofra.it", "x@tecnofra.it"], "vecchia@tecnofra.it")).toBe("");
    expect(casellaProposta("preventivo", ["info@tecnofra.it", "x@tecnofra.it"], null)).toBe("");
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
