import { describe, expect, it } from "vitest";
import { bankCausale } from "./bank-causale";

describe("bank payer and recipient causali", () => {
  it("finds payer or recipient across real Credem formats", () => {
    const c = (d: string, amount = -1) => bankCausale({ description: d, amount });
    expect(c("Ordinante:  LSDM S.R.L. VIA MAGNA GRAECIA, 121; ulteriori descrizioni: BONIFICO A CREDITO          OCRET Fattura", 10)).toBe("LSDM");
    expect(c("PAGAMENTO PREAUTORIZZATO    PDPRE LEASYS ITALIA S.P.A.          C.SO ORBASSANO 367   MANDATO 80T49")).toBe("LEASYS");
    expect(c("PAGAMENTO EFFETTO           ERRIB RIF. FT. NR. 693 2026 DEL 05 08                    GRAF ADHESIVE S.R.L.;causale interna: ER")).toBe("GRAF ADHESIVE");
    expect(c("COMMISSIONI VARIE           COVAR;causale interna: CO")).toBe("BANCA");
  });
  it("keeps only the PayPal counterparty name", () => {
    expect(bankCausale({ amount: -30, description: "STEFANO PUGLISI · NASTRO BIADESIVO PER MOQUETTE APPROVATO NEC, 38 MM X 50 M." })).toBe("STEFANO PUGLISI");
  });
  it("keeps only the instant transfer counterparty", () => {
    expect(bankCausale({ amount: -100, description: "rif. banca: 20261104 5429057; ulteriori descrizioni: BON. ISTANTANEO A DEBITO DIIST IBENA Textilwerke GmbH Rif. 000012611041250090691340" })).toBe("IBENA");
  });
  it("maps debit card fee to CARTA DI DEBITO", () => {
    expect(bankCausale({ amount: -2, description: "CANONE CARTA DEBITO INT COINT CANONE CARTA DI DEBITO INTERNAZIONALE 537599******0775;causale interna: CO" })).toBe("CARTA DI DEBITO");
  });
  it("maps SEPA direct debit to creditor brand", () => {
    expect(bankCausale({ amount: -10, description: "SEPA DD CORE PDDDC DA GOOGLE IRELAND LIMITED MANDATO 66372913;causale interna: PD" })).toBe("GOOGLE");
  });
  it("maps instant transfer fee to BANCA", () => {
    expect(bankCausale({ amount: -1, description: "COMM BONIFICO ISTANTANEO COIST;causale interna: CO" })).toBe("BANCA");
  });
  it("proposes only VIACARD for the supplied bank narrative without changing the original", () => {
    const movement = { amount: -275.71, description: "VIACARD PDVIA;causale interna: PD" };
    expect(bankCausale(movement)).toBe("VIACARD");
    expect(movement.description).toBe("VIACARD PDVIA;causale interna: PD");
    expect(bankCausale({ ...movement, description: "viacard PDVIA;causale interna: PD", counterparty_name: "VIACARD PDVIA" })).toBe("VIACARD");
    expect(bankCausale({ ...movement, description: "VIACARD PERSONALIZZATA", manual_updated_at: "2026-11-04T12:11:00Z" })).toBe("VIACARD PERSONALIZZATA");
  });
  it("automatically labels the supplied international debit-card payment", () => {
    expect(bankCausale({ amount: -36.87, description: "PAGAMENTO DEBINT PDINT PAGAMENTO CARTA DI DEBITO INTERNAZIONALE 537599******0775 -28/10/26-04:53 BONOMO;causale interna" })).toBe("CARTA DI DEBITO");
  });
  it("keeps only the company name from the supplied incoming transfer", () => {
    expect(bankCausale({ amount: 100, description: "BONIFICO A CREDITO SOCIETA' COSTRUZIONE SEGNALETICA SOCI SALDO ORDINE 356/2026 DEL 01.10.2026 RIF. 263026062979340-486784068*." })).toBe("SOCIETA' COSTRUZIONE SEGNALETICA SOCI");
  });
  it("uses the supplied counterparty name instead of the transfer wording", () => {
    expect(bankCausale({ amount: 100, description: "BONIFICO FATTURA 10", counterparty_name: "Mario Rossi" })).toBe("MARIO ROSSI");
  });
  it("extracts the payer from a BNL incoming transfer", () => {
    expect(bankCausale({ amount: 597.8, description: "YYY28102026                ASSOCIAZIONE THEATRICA ETS                 B.ORD:01005/39840/ DES/BEN:TECNO" })).toBe("ASSOCIAZIONE THEATRICA ETS");
  });
  it("uses the recipient for outgoing transfers, not the payer", () => {
    expect(bankCausale({ amount: -50, description: "ORDINANTE: TECNOFRA; BENEFICIARIO: Mario Rossi; CAUSALE: FATTURA 1" })).toBe("MARIO ROSSI");
  });
  it("uses the payer for incoming transfers, not the recipient", () => {
    expect(bankCausale({ amount: 50, description: "ORDINANTE: Mario Rossi; BENEFICIARIO: TECNOFRA" })).toBe("MARIO ROSSI");
  });
  it("keeps descriptions when no reliable name is available", () => {
    expect(bankCausale({ amount: -20, description: "PAGAMENTO CARTA 537599******0775" })).toBe("PAGAMENTO CARTA 537599******0775");
  });
  it("preserves a manually edited causale over the original counterparty", () => {
    expect(bankCausale({ amount: -50, description: "AFFITTO", counterparty_name: "Mario Rossi", manual_updated_at: "2026-10-30T12:00:00Z" })).toBe("AFFITTO");
  });
});
import { automaticCashCausale } from "../../supabase/functions/_shared/bank-auto-cash-rules";
describe("customer names are never bank fees", () => {
  it("BNL payer COOP stays a customer", () => {
    expect(bankCausale({ description: "YYY28102026      COOP ALLEANZA 3.0     B.ORD: X", amount: 100 })).toBe("COOP ALLEANZA 3.0");
  });
  it("CONAD transfer is not auto cash", () => {
    const m = { description: "BONIFICO A CREDITO CONAD SRL SALDO FT 12", amount: 100 };
    expect(bankCausale(m)).toBe("CONAD");
    expect(automaticCashCausale(m)).toBeNull();
  });
  it("real Credem fee stays BANCA", () => {
    expect(bankCausale({ description: "COMM BONIFICO ISTANTANEO COIST;causale interna: CO", amount: -1 })).toBe("BANCA");
  });
});
