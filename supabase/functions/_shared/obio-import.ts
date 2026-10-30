export type ObioMovement = {
  id: string; currency: string; amount: string; creditDebitIndicator: string;
  status: string | null; bookingDate: string | null; valueDate: string | null;
  remittanceInformation: string | null; note: string | null; referenceNumber: string | null;
  creditorName: string | null; debtorName: string | null;
};

export function obioTermsVerified(settings: { provider?: string; costs_verified?: boolean; monthly_cost_eur?: string | number | null; commercial_evidence?: string | null } | null) {
  return settings?.provider === "open_banking_io" && settings.costs_verified === true && settings.monthly_cost_eur != null && !!settings.commercial_evidence?.trim();
}

export function normalizeObioMovement(t: ObioMovement) {
  if (t.currency !== "EUR") throw new Error("unsupported_currency");
  if (t.status !== "BOOK" && t.status !== "PDNG") throw new Error("unknown_status");
  if (!t.bookingDate || !/^\d{4}-\d{2}-\d{2}$/.test(t.bookingDate)) throw new Error("missing_booking_date");
  if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(t.amount)) throw new Error("invalid_amount");
  const unsigned = t.amount.replace(/^[+-]/, "");
  if (/^0+(?:\.0+)?$/.test(unsigned)) return null;
  if (t.creditDebitIndicator !== "DBIT" && t.creditDebitIndicator !== "CRDT") throw new Error("unknown_direction");
  if (t.amount.startsWith("-") && t.creditDebitIndicator !== "DBIT") throw new Error("inconsistent_direction");
  const amount = t.creditDebitIndicator === "DBIT" ? `-${unsigned}` : unsigned;
  const counterparty = t.creditDebitIndicator === "DBIT" ? t.creditorName : t.debtorName;
  const description = t.remittanceInformation?.trim() || t.note?.trim() || counterparty?.trim() || "MOVIMENTO BANCARIO";
  const reference = t.referenceNumber?.trim() || t.id?.trim();
  return { booking_date: t.bookingDate, value_date: t.valueDate, status: t.status, amount, currency: "EUR", description: description.slice(0, 2000), counterparty_name: counterparty, reference_key: reference ?? null };
}

export async function obioAccountRef(identity: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity.trim().toUpperCase()));
  return `OBIO-${Array.from(new Uint8Array(digest), v => v.toString(16).padStart(2, "0")).join("")}`;
}

export async function obioFallbackRef(account: string, row: { booking_date: string; amount: string; description: string }, occurrence: number) {
  return (await obioAccountRef(`${account}|${row.booking_date}|${row.amount}|${row.description.trim().replace(/\s+/g, " ").toUpperCase()}|${occurrence}`)).replace(/^OBIO-/, "hash-");
}