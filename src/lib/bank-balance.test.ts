import { describe, expect, it } from "vitest";
import { selectBankBalance, paypalBalance } from "../../supabase/functions/_shared/bank-balance";
const balance = (type: string, amount = "125.50", currency = "EUR", referenceDate = "2026-11-02") => ({ type, amount, currency, referenceDate });
describe("actual account balances", () => {
  it("reads closing booked balances when interim booked is absent", () => expect(selectBankBalance([balance("CLBD")], "EUR")?.amount).toBe("125.50"));
  it("prefers booked over available without adding them", () => expect(selectBankBalance([balance("ITAV", "150.00"), balance("ITBD", "100.00")], "EUR")?.amount).toBe("100.00"));
  it("labels the available fallback", () => expect(selectBankBalance([balance("CLAV")], "EUR")?.type).toBe("CLAV"));
  it("does not invent zero or select another currency", () => expect(selectBankBalance([balance("ITBD", "99.00", "USD"), balance("ITBD", "invalid")], "EUR")).toBeNull());
  it("preserves true zero and negative balances", () => { expect(selectBankBalance([balance("ITBD", "0.00")], "EUR")?.amount).toBe("0.00"); expect(selectBankBalance([balance("ITBD", "-10.50")], "EUR")?.amount).toBe("-10.50"); });
  it("selects the most recent snapshot of the same type", () => expect(selectBankBalance([balance("CLBD", "10.00", "EUR", "2026-10-30"), balance("CLBD", "20.00")], "EUR")?.amount).toBe("20.00"));
  it("reads PayPal total EUR balance and actual reporting date", () => expect(paypalBalance({ balances: [{ currency: "EUR", total_balance: { currency_code: "EUR", value: "745.82" } }], as_of_time: "2026-11-02T07:30:00Z" })).toEqual({ balance: "745.82", balance_date: "2026-11-02T07:30:00Z" }));
  it("rejects missing or invalid PayPal snapshots", () => { expect(paypalBalance({ balances: [] })).toBeNull(); expect(paypalBalance({ balances: [{ currency: "EUR", total_balance: { currency_code: "USD", value: "50.00" } }], as_of_time: "2026-11-02" })).toBeNull(); });
});