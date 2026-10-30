import { describe, it, expect } from "vitest";
import { bankDateAllowed, currentBankAccounts } from "./bank-management";
describe("bank management rules", () => {
  it("excludes 23 October 2026", () => expect(bankDateAllowed("2026-10-23")).toBe(false));
  it("includes 24 October 2026", () => expect(bankDateAllowed("2026-10-24")).toBe(true));
  it("keeps later movements", () => expect(bankDateAllowed("2026-10-30")).toBe(true));
  it("hides obsolete accounts while keeping the live account and PayPal", () => expect(currentBankAccounts([{ bank: "Credem", account_ref: "EB-old" }, { bank: "Credem", account_ref: "OBIO-current" }, { bank: "PayPal", account_ref: "PAYPAL" }], [{ bank: "Credem", account_ref: "OBIO-current" }], true).map(a => a.account_ref)).toEqual(["OBIO-current", "PAYPAL"]));
});