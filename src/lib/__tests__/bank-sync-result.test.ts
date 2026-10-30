import { describe, expect, it } from "vitest";
import { blockedBankSync } from "../../../supabase/functions/_shared/bank-sync-result";

describe("blocked bank synchronization", () => {
  it.each(["commercial_terms_unverified", "schedule_disabled", "consent_required"])("returns a non-error blocked outcome with no imports for %s", (code) => {
    const result = blockedBankSync(code, "Blocked");
    expect(result.status).toBe("blocked");
    expect(result.code).toBe(code);
    expect(result.imported).toBe(0);
    expect(result).not.toHaveProperty("error");
  });
});