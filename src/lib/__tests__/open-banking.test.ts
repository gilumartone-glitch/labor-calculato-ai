import { describe, expect, it } from "vitest";
import { canActivateBankSync, type BankingAssessment } from "../open-banking";

const now = Date.parse("2026-10-29T10:22:00Z");
const ready: BankingAssessment = { bank: "Credem", provider: "Enable Banking", checkedAt: "2026-10-29T10:22:00Z", compatibilityVerified: true, productionReady: true, costsConfirmed: true, monthlyCostEur: 20, consentExpiresAt: "2026-11-29T10:22:00Z", consentGranted: true, syncFrequencyConfirmed: true, blockers: [] };
describe("safe banking activation", () => {
  it("blocks unverified Credem or BNL product compatibility", () => {
    for (const bank of ["Credem", "BNL"] as const) expect(canActivateBankSync({ ...ready, bank, compatibilityVerified: false }, now)).toBe(false);
  });
  it("blocks unknown or unconfirmed costs", () => {
    expect(canActivateBankSync({ ...ready, monthlyCostEur: null }, now)).toBe(false);
    expect(canActivateBankSync({ ...ready, costsConfirmed: false }, now)).toBe(false);
  });
  it("requires production authorization", () => expect(canActivateBankSync({ ...ready, productionReady: false }, now)).toBe(false));
  it("requires actual bank consent", () => expect(canActivateBankSync({ ...ready, consentGranted: false }, now)).toBe(false));
  it("blocks missing or expired renewal date", () => {
    expect(canActivateBankSync({ ...ready, consentExpiresAt: null }, now)).toBe(false);
    expect(canActivateBankSync({ ...ready, consentExpiresAt: "2026-10-29T10:22:00Z" }, now)).toBe(false);
  });
  it("requires confirmed sync frequency", () => expect(canActivateBankSync({ ...ready, syncFrequencyConfirmed: false }, now)).toBe(false));
  it("accepts only all verified prerequisites and no blockers", () => {
    expect(canActivateBankSync(ready, now)).toBe(true);
    expect(canActivateBankSync({ ...ready, blockers: ["Contratto mancante"] }, now)).toBe(false);
  });
});