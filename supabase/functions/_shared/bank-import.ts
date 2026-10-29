export type ImportedTransaction = { external_id: string; booking_date: string; description: string; amount: number; currency: string };
export function normalizeBookedTransaction(t: Record<string, any>): ImportedTransaction | null {
  if (t.status !== "BOOK") return null;
  const date = t.booking_date;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Movimento senza data contabile valida.");
  const raw = Number(t.transaction_amount?.amount);
  const currency = t.transaction_amount?.currency;
  if (currency !== "EUR" || !Number.isFinite(raw) || raw === 0) throw new Error("Movimento con importo o valuta non supportati.");
  if (!["CRDT", "DBIT"].includes(t.credit_debit_indicator)) throw new Error("Segno del movimento bancario non disponibile.");
  const reference = t.entry_reference || t.transaction_id;
  if (typeof reference !== "string" || !reference.trim()) throw new Error("Riferimento bancario stabile mancante: importazione sospesa per evitare duplicati.");
  const description = Array.isArray(t.remittance_information) ? t.remittance_information.join(" ") : (typeof t.remittance_information === "string" ? t.remittance_information : "Movimento bancario");
  return { external_id: `eb-${reference}`.slice(0, 250), booking_date: date, description: description.slice(0, 2000) || "Movimento bancario", amount: Math.round(Math.abs(raw) * 100) / 100 * (t.credit_debit_indicator === "DBIT" ? -1 : 1), currency };
}