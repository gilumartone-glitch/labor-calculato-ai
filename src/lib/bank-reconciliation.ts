import { z } from "zod";

export const bankImportRowSchema = z.object({
  bank: z.enum(["Credem", "BNL", "PayPal"]),
  account_ref: z.string().trim().min(1).max(100),
  external_id: z.string().trim().min(1).max(250),
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => !Number.isNaN(Date.parse(v))),
  description: z.string().trim().min(1).max(2000),
  amount: z.number().finite().refine((v) => v !== 0 && Math.abs(v) <= 999999999),
  currency: z.literal("EUR"),
});

export type BankImportRow = z.infer<typeof bankImportRowSchema>;
export type BankTransaction = BankImportRow & { id: string; source: string; created_at: string; account_id?: string | null; status?: "BOOK" | "PDNG" };
export type BankAllocation = { id: string; transaction_id: string; accounting_key: string; competence_id: string | null; cash_movement_id: string; amount: number; created_at: string };
export type CompetenceMovement = { id: string; date: string; description: string; category: string; invoiceNumber?: string; paymentMethod?: string; type: "entrata" | "uscita"; status: "cassa" | "previsto"; amount: number; acconto?: number };
export const money = (v: number) => Math.round(v * 100) / 100;
export const competenceRemaining = (m: CompetenceMovement) => m.status === "previsto" ? money(Math.max(0, m.amount - Math.min(m.amount, Math.max(0, m.acconto ?? 0)))) : 0;
export const bankRemaining = (t: BankTransaction, allocations: BankAllocation[]) => money(Math.max(0, Math.abs(t.amount) - allocations.filter((a) => a.transaction_id === t.id).reduce((s, a) => s + Number(a.amount), 0)));

export function validateAllocation(transaction: BankTransaction, allocations: BankAllocation[], amount: number, competence?: CompetenceMovement) {
  if (transaction.status === "PDNG") throw new Error("I movimenti in sospeso non possono essere portati in cassa.");
  const value = money(amount);
  if (!Number.isFinite(amount) || value <= 0) throw new Error("Inserisci un importo maggiore di zero.");
  if (value > bankRemaining(transaction, allocations)) throw new Error("L’importo supera il residuo bancario.");
  if (competence) {
    if (competence.type !== (transaction.amount > 0 ? "entrata" : "uscita")) throw new Error("Entrate e uscite non possono essere associate tra loro.");
    if (value > competenceRemaining(competence)) throw new Error("L’importo supera il residuo in competenza.");
  }
  return value;
}

export function parseBankAmount(value: unknown): number {
  if (typeof value === "number") return money(value);
  let text = String(value ?? "").trim().replace(/€/g, "").replace(/\s/g, "");
  const negative = /^\(.*\)$/.test(text);
  text = text.replace(/[()]/g, "");
  if (text.includes(",")) text = text.replace(/\./g, "").replace(",", ".");
  const result = Number(text);
  return money(negative ? -result : result);
}

export function parseBankDate(value: unknown): string {
  const s = String(value ?? "").trim();
  const it = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  const iso = it ? `${it[3]}-${it[2].padStart(2, "0")}-${it[1].padStart(2, "0")}` : s.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || new Date(`${iso}T12:00:00Z`).toISOString().slice(0, 10) !== iso) throw new Error(`Data non valida: ${s}`);
  return iso;
}