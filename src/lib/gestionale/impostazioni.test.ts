import { describe, expect, it } from "vitest";
import { controllaAliquota, fattureAttive, NATURE_IVA } from "./impostazioni";

const esistenti = [{ id: "a", codice: "22" }, { id: "b", codice: "ES10" }];
const base = { codice: "N31", descrizione: "Non imponibile art. 8", percentuale: 0, natura: "N3.1" };

describe("aliquote IVA", () => {
  it("un'aliquota corretta passa", () => {
    expect(controllaAliquota(base, esistenti)).toEqual([]);
    expect(controllaAliquota({ codice: "5", descrizione: "IVA 5%", percentuale: 5, natura: null }, esistenti)).toEqual([]);
  });
  it("senza IVA serve la natura; con IVA la natura non ci va", () => {
    expect(controllaAliquota({ ...base, natura: null }, esistenti).join()).toContain("codice natura");
    expect(controllaAliquota({ ...base, percentuale: 22 }, esistenti).join()).toContain("solo per le aliquote a 0%");
    expect(controllaAliquota({ ...base, natura: "N9" }, esistenti).join()).toContain("non esiste");
  });
  it("codice doppio (anche con maiuscole diverse), tranne se è la stessa aliquota", () => {
    expect(controllaAliquota({ ...base, codice: "es10" }, esistenti).join()).toContain("già usato");
    expect(controllaAliquota({ ...base, codice: "es10" }, esistenti, "b")).toEqual([]);
  });
  it("campi mancanti o fuori misura", () => {
    const e = controllaAliquota({ codice: " ", descrizione: "", percentuale: null, natura: null }, esistenti);
    expect(e).toHaveLength(3);
    expect(controllaAliquota({ ...base, percentuale: 101 }, esistenti).join()).toContain("da 0 a 100");
    expect(controllaAliquota({ ...base, codice: "IVA 22%" }, esistenti).join()).toContain("Il codice:");
  });
  it("l'elenco delle nature copre i codici delle specifiche", () => {
    expect(NATURE_IVA.map((n) => n.codice)).toEqual(["N1", "N2.1", "N2.2", "N3.1", "N3.2", "N3.3", "N3.4", "N3.5", "N3.6", "N4", "N5", "N6.1", "N6.2", "N6.3", "N6.4", "N6.5", "N6.6", "N6.7", "N6.8", "N6.9", "N7"]);
  });
});

describe("avvio delle fatture", () => {
  it("attive dal giorno indicato in poi", () => {
    expect(fattureAttive("2027-01-01", "2026-12-31")).toBe(false);
    expect(fattureAttive("2027-01-01", "2027-01-01")).toBe(true);
    expect(fattureAttive(null, "2027-06-01")).toBe(false);
  });
});
