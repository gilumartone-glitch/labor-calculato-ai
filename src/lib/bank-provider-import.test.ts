import { describe, expect, it } from "vitest";
import { normalizeBookedTransaction } from "../../supabase/functions/_shared/bank-import";
const booked = { status: "BOOK", booking_date: "2026-10-29", transaction_amount: { amount: "12.50", currency: "EUR" }, credit_debit_indicator: "DBIT", entry_reference: "bank-123", remittance_information: ["FATTURA 10"] };
describe("bank import", () => {
  it("imports an outgoing booked movement as minus 12.50", () => { expect(normalizeBookedTransaction(booked)?.amount).toBe(-12.5); });
  it("imports an incoming booked movement as plus 12.50", () => { expect(normalizeBookedTransaction({ ...booked, credit_debit_indicator: "CRDT" })?.amount).toBe(12.5); });
  it("does not import pending movements", () => { expect(normalizeBookedTransaction({ ...booked, status: "PDNG" })).toBeNull(); });
  it("blocks missing references instead of manufacturing duplicate-prone IDs", () => { expect(() => normalizeBookedTransaction({ ...booked, entry_reference: undefined })).toThrow("Riferimento bancario stabile mancante"); });
});