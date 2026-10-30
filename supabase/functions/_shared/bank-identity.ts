export const canonicalDescription = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleUpperCase("it-IT");
export const canonicalReference = (value: string) => value.trim().replace(/^eb-/, "");
export async function fallbackTransactionId(account: string, date: string, amount: number, description: string, occurrence = 1) {
  const text = `${account}|${date}|${amount.toFixed(2)}|${canonicalDescription(description)}|${occurrence}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `hash-${Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("")}`;
}
export function syncDateFrom(lastSync: string | null, now = new Date()) {
  const baseline = lastSync ? new Date(lastSync).getTime() - 5 * 86400000 : now.getTime() - 90 * 86400000;
  return new Date(Math.max(baseline, now.getTime() - 90 * 86400000)).toISOString().slice(0, 10);
}
export function consentExpiring(expiry: string | null, now = new Date()) {
  return !!expiry && new Date(expiry).getTime() - now.getTime() <= 14 * 86400000;
}