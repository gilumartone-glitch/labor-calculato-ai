import { describe, expect, it } from "vitest";
import { normalizeObioMovement, obioTermsVerified, obioAccountRef } from "../../supabase/functions/_shared/obio-import";

const movement = { id: "transaction-1", currency: "EUR", amount: "12.50", creditDebitIndicator: "DBIT", status: "BOOK", bookingDate: "2026-10-30", valueDate: "2026-10-30", remittanceInformation: "FATTURA", note: null, referenceNumber: "reference-1", creditorName: "FORNITORE", debtorName: null };
describe("open-banking.io import", () => {
  it("keeps outgoing amounts as exact negative decimal strings", () => expect(normalizeObioMovement(movement)?.amount).toBe("-12.50"));
  it("does not invert an already negative outgoing amount", () => expect(normalizeObioMovement({ ...movement, amount: "-12.50" })?.amount).toBe("-12.50"));
  it("keeps incoming amounts positive", () => expect(normalizeObioMovement({ ...movement, creditDebitIndicator: "CRDT" })?.amount).toBe("12.50"));
  it("preserves pending state, never turns it into booked", () => expect(normalizeObioMovement({ ...movement, status: "PDNG" })?.status).toBe("PDNG"));
  it("rejects missing status", () => expect(() => normalizeObioMovement({ ...movement, status: null })).toThrow("unknown_status"));
  it("rejects conflicting incoming signs", () => expect(() => normalizeObioMovement({ ...movement, amount: "-12.50", creditDebitIndicator: "CRDT" })).toThrow("inconsistent_direction"));
  it("does not reuse Enable commercial verification", () => expect(obioTermsVerified({ provider: "enable_banking", costs_verified: true, monthly_cost_eur: 200, commercial_evidence: "Old contract" })).toBe(false));
  it("requires verified commercial evidence before sync", () => expect(obioTermsVerified({ provider: "open_banking_io", costs_verified: true, monthly_cost_eur: 0, commercial_evidence: "" })).toBe(false));
  it("accepts verified free service with documented evidence", () => expect(obioTermsVerified({ provider: "open_banking_io", costs_verified: true, monthly_cost_eur: 0, commercial_evidence: "Approved free plan" })).toBe(true));
  it("keeps account identity stable independently of array order", async () => expect(await obioAccountRef("IT-test-account")).toBe(await obioAccountRef("it-TEST-account")));
});