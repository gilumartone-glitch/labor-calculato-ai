export type ImportedTransaction = { external_id: string; booking_date: string; description: string; amount: number; currency: string };
import { canonicalReference, fallbackTransactionId } from "./bank-identity.ts";
export async function normalizeBankTransaction(t: Record<string, any>, account: string, occurrence = 1) {
  if (!["BOOK", "PDNG"].includes(t.status)) return null;
  const date = t.booking_date ?? t.value_date;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("Movimento senza data valida.");
  const value = Number(t.transaction_amount?.amount);
  if (t.transaction_amount?.currency !== "EUR" || !Number.isFinite(value) || value === 0 || !["DBIT", "CRDT"].includes(t.credit_debit_indicator)) throw new Error("Importo o valuta non supportati.");
  const amount = Math.round(Math.abs(value) * 100) / 100 * (t.credit_debit_indicator === "DBIT" ? -1 : 1);
  const description = (Array.isArray(t.remittance_information) ? t.remittance_information.join(" ") : String(t.remittance_information ?? "Movimento bancario")).trim().slice(0, 2000) || "Movimento bancario";
  const reference = canonicalReference(String(t.entry_reference ?? t.transaction_id ?? ""));
  return { external_id: reference ? `eb-${reference}`.slice(0, 250) : await fallbackTransactionId(account, date, amount, description, occurrence), reference_key: reference || null, booking_date: date, value_date: t.value_date ?? null, description, amount, currency: "EUR", status: t.status, counterparty_name: t.creditor?.name ?? t.debtor?.name ?? null };
}
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