import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { collegamentoPosta, indirizzi, oggettoEmail, testoEmail, type DocumentoDaInviare } from "./email-documento";

const azienda = { denominazione: "Prova Scene S.r.l.s.", telefono: "081 1234567", email: "info@example.it" };
const d: DocumentoDaInviare = { tipo: "preventivo", numero: 45, anno: 2026, serie: "", data: "2026-11-23", oggetto: "Sipario in velluto", produzione: "Il Barbiere di Siviglia", ordine_cliente_tipo: "OP", riferimento_esterno: "4500123", validita_giorni: 30 };

describe("email dei documenti", () => {
  it("oggetto con numero, produzione e nome dell'azienda", () => {
    expect(oggettoEmail(d, azienda)).toBe("Preventivo n. 45/2026 del 23/11/2026 - Il Barbiere di Siviglia - Prova Scene S.r.l.s.");
    expect(oggettoEmail({ ...d, tipo: "ordine", numero: null, produzione: null }, azienda)).toBe("Conferma d'ordine in bozza - Prova Scene S.r.l.s.");
  });
  it("testo con riferimenti del cliente, chiusura adatta al documento e firma", () => {
    expect(testoEmail(d, azienda)).toBe([
      "Buongiorno,", "in allegato il preventivo n. 45/2026 del 23/11/2026.", "",
      "Oggetto: Sipario in velluto", "Produzione: Il Barbiere di Siviglia", "Vostro ordine: OP 4500123", "",
      "L'offerta è valida 30 giorni. Restiamo a disposizione per qualsiasi chiarimento.", "",
      "Cordiali saluti", "Prova Scene S.r.l.s.", "Tel. 081 1234567 - info@example.it",
    ].join("\n"));
    const fattura = testoEmail({ ...d, tipo: "fattura", numero: 7, anno: 2027, data: "2027-01-15", oggetto: null, produzione: null, ordine_cliente_tipo: null, riferimento_esterno: null }, azienda);
    expect(fattura).toContain("in allegato la fattura n. 7/2027 del 15/01/2027.");
    expect(fattura).toContain("copia di cortesia");
    expect(testoEmail({ ...d, tipo: "ddt" }, azienda)).not.toContain("offerta");
  });
  it("indirizzi: accetta virgole, punti e virgola e spazi, toglie i doppioni, segnala gli errori", () => {
    expect(indirizzi("a@x.it; b@y.com, a@x.it  sbagliato@ ")).toEqual({ validi: ["a@x.it", "b@y.com"], scartati: ["sbagliato@"] });
    expect(indirizzi("")).toEqual({ validi: [], scartati: [] });
  });
  it("collegamento per il programma di posta", () => {
    const url = collegamentoPosta({ a: ["teatro@example.it"], cc: ["amm@example.it"], oggetto: "Preventivo n. 45/2026 & co.", testo: "Buongiorno,\nin allegato" });
    expect(url).toBe("mailto:teatro%40example.it?cc=amm%40example.it&subject=Preventivo%20n.%2045%2F2026%20%26%20co.&body=Buongiorno%2C%0D%0Ain%20allegato");
  });
});
