import { describe, expect, it } from "vitest";
import { safeNotificationPath, pushFailureStatus } from "../../supabase/functions/_shared/push-rules";
describe("notification delivery safety", () => {
  it("keeps internal destinations", () => { expect(safeNotificationPath("/produzione/board?order=123")).toBe("/produzione/board?order=123"); });
  it("rejects external destinations", () => {
    for (const path of ["https://example.com", "//example.com", "/\\example.com", null]) expect(safeNotificationPath(path)).toBe("/hub");
  });
  it("returns only sanitized delivery status", () => {
    expect(pushFailureStatus({ statusCode: 410, body: "private" })).toBe(410);
    expect(pushFailureStatus({ statusCode: "private" })).toBe(0);
  });
});
