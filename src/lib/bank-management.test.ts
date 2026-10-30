import { describe, it, expect } from "vitest";
import { bankDateAllowed, currentBankAccounts, canViewBankAccounts } from "./bank-management";
describe("bank management rules", () => {
  it("restricts banking to gmartone@tecnofra.it", () => {
    expect(canViewBankAccounts("gmartone@tecnofra.it")).toBe(true);
    expect(canViewBankAccounts("GMARTONE@TECNOFRA.IT")).toBe(true);
    expect(canViewBankAccounts("gilumartone@gmail.com")).toBe(false);
    expect(canViewBankAccounts("admin@tecnofra.it")).toBe(false);
    expect(canViewBankAccounts(null)).toBe(false);
    expect(canViewBankAccounts()).toBe(false);
  });
  it("excludes 23 October 2026", () => expect(bankDateAllowed("2026-10-23")).toBe(false));
  it("includes 24 October 2026", () => expect(bankDateAllowed("2026-10-24")).toBe(true));
  it("keeps later movements", () => expect(bankDateAllowed("2026-10-30")).toBe(true));
  it("hides obsolete accounts while keeping the live account and PayPal", () => expect(currentBankAccounts([{ bank: "Credem", account_ref: "EB-old" }, { bank: "Credem", account_ref: "OBIO-current" }, { bank: "PayPal", account_ref: "PAYPAL" }], [{ bank: "Credem", account_ref: "OBIO-current" }], true).map(a => a.account_ref)).toEqual(["OBIO-current", "PAYPAL"]));
});