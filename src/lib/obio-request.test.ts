import { describe, expect, it } from "vitest";
import { OBIO_REQUEST_TIMEOUT_MS, obioFailureCode } from "../../supabase/functions/_shared/obio-request";

describe("bank request diagnostics", () => {
  it("allows a single request to wait sixty seconds", () => {
    expect(OBIO_REQUEST_TIMEOUT_MS).toBe(60000);
  });
  it("distinguishes a timeout from a rate limit", () => {
    expect(obioFailureCode({ name: "TimeoutError" }, "refresh_bank")).toBe("provider_timeout");
    expect(obioFailureCode({ status: 429 }, "refresh_bank")).toBe("rate_limited");
  });
  it("retains a known consent refusal", () => {
    expect(obioFailureCode({ reason: "reconnect_needed", status: 403 }, "refresh_bank")).toBe("reconnect_needed");
  });
  it("never exposes provider messages or unknown reasons", () => {
    expect(obioFailureCode({ reason: "private-value", message: "secret" }, "refresh_bank")).toBe("refresh_bank");
    expect(obioFailureCode({ status: 503, message: "secret" }, "refresh_bank")).toBe("http_503");
  });
});