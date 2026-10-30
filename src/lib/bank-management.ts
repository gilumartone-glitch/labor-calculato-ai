export const BANK_START_DATE = "2026-10-24";
// Display gate only; database and server functions independently enforce access.
export const canViewBankAccounts = (email?: string | null) => email?.toLowerCase() === "gmartone@tecnofra.it";
export const bankDateAllowed = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= BANK_START_DATE;
export function currentBankAccounts<T extends { bank: string; account_ref: string }>(stored: T[], live: { bank: string; account_ref: string }[], ready: boolean): T[] {
  return stored.filter(a => a.bank === "PayPal" || (ready ? live.some(l => l.bank === a.bank && l.account_ref === a.account_ref) : a.account_ref.startsWith("OBIO-")));
}