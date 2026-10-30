import { describe, expect, it } from "vitest";
import { bankCausale } from "./bank-causale";

describe("bank payer and recipient causali", () => {
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