import { describe, expect, it } from "vitest";
import { canonicalReference, fallbackTransactionId, consentExpiring, syncDateFrom } from "../../supabase/functions/_shared/bank-identity";
import { normalizeBankTransaction } from "../../supabase/functions/_shared/bank-import";
const tx = { status: "PDNG", booking_date: "2026-10-30", transaction_amount: { amount: "12.50", currency: "EUR" }, credit_debit_indicator: "DBIT", entry_reference: "r1", remittance_information: ["FATTURA 1"] };
describe("shared bank import rules", () => {
  it("retains pending movements with negative debit amounts", async () => {
    const result = await normalizeBankTransaction(tx, "ACCOUNT");
    expect(result?.status).toBe("PDNG"); expect(result?.amount).toBe(-12.5);
  });
  it("keeps pending and booked reference identity stable", async () => {
    expect((await normalizeBankTransaction(tx, "ACCOUNT"))?.external_id).toBe((await normalizeBankTransaction({ ...tx, status: "BOOK" }, "ACCOUNT"))?.external_id);
  });
  it("uses identical fallback identity in CSV and provider channels", async () => {
    const result = await normalizeBankTransaction({ ...tx, entry_reference: undefined, status: "BOOK" }, "ACCOUNT");
    expect(result?.external_id).toBe(await fallbackTransactionId("ACCOUNT", "2026-10-30", -12.5, "fattura 1"));
  });
  it("preserves identical distinct rows using occurrence", async () => {
    expect(await fallbackTransactionId("ACCOUNT", "2026-10-30", -12.5, "FATTURA 1", 1)).not.toBe(await fallbackTransactionId("ACCOUNT", "2026-10-30", -12.5, "FATTURA 1", 2));
  });
  it("maps CSV bank references to provider references", () => { expect(canonicalReference("eb-r1")).toBe("r1"); });
  it("starts first import 90 days before now", () => { expect(syncDateFrom(null, new Date("2026-10-30T12:00:00Z"))).toBe("2026-08-01"); });
  it("overlaps the last successful import by five days", () => { expect(syncDateFrom("2026-10-29T12:00:00Z", new Date("2026-10-30T12:00:00Z"))).toBe("2026-10-24"); });
  it("warns 14 days before expiry", () => { expect(consentExpiring("2026-11-13T12:00:00Z", new Date("2026-10-30T12:00:00Z"))).toBe(true); expect(consentExpiring("2026-11-14T12:00:00Z", new Date("2026-10-30T12:00:00Z"))).toBe(false); });
});