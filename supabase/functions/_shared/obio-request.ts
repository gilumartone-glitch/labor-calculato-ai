// A longer wait does not issue additional bank refresh requests.
export const OBIO_REQUEST_TIMEOUT_MS = 60000;

export function obioFailureCode(error: unknown, stage: string): string {
  if (error && typeof error === "object") {
    const e = error as { name?: unknown; reason?: unknown; status?: unknown };
    if (e.name === "TimeoutError" || e.name === "AbortError") return "provider_timeout";
    const reasons = ["reconnect_needed", "consent_withdrawn", "uid_outdated", "psu_present_required", "rate_limited", "bank_error", "transient", "partner_app_inactive"];
    if (typeof e.reason === "string" && reasons.includes(e.reason)) return e.reason;
    if (typeof e.status === "number" && Number.isInteger(e.status) && e.status >= 400 && e.status <= 599) return e.status === 429 ? "rate_limited" : `http_${e.status}`;
  }
  return stage;
}