import { describe, expect, it } from "vitest";
import { automaticCashCausale } from "../../supabase/functions/_shared/bank-auto-cash-rules";

describe("automatic direct cash allowlist", () => {
  it("registers CARTA DI DEBITO", () => {
    expect(automaticCashCausale({ amount: -36.87, description: "PAGAMENTO DEBINT PDINT PAGAMENTO CARTA DI DEBITO INTERNAZIONALE 537599******0775" })).toBe("CARTA DI DEBITO");
  });
  it("registers BANCA", () => {
    expect(automaticCashCausale({ amount: -1, description: "COMM BONIFICO ISTANTANEO COIST;causale interna: CO" })).toBe("BANCA");
  });
  it("registers GOOGLE", () => {
    expect(automaticCashCausale({ amount: -10, description: "SEPA DD CORE PDDDC DA GOOGLE IRELAND LIMITED MANDATO 66372913;causale interna: PD" })).toBe("GOOGLE");
  });
  it("does not register other creditors or payment reasons", () => {
    expect(automaticCashCausale({ description: "VIACARD PDVIA;causale interna: PD" })).toBeNull();
    expect(automaticCashCausale({ description: "RIMBORSO GOOGLE", manual_updated_at: "2026-11-05" })).toBeNull();
    expect(automaticCashCausale({ description: "BANCA SELLA" })).toBeNull();
  });
  it("honors manual edits and structured names", () => {
    expect(automaticCashCausale({ description: "FATTURA", counterparty_name: "GOOGLE IRELAND LIMITED" })).toBe("GOOGLE");
    expect(automaticCashCausale({ description: "ALTRO", counterparty_name: "GOOGLE", manual_updated_at: "2026-11-05" })).toBeNull();
  });
});