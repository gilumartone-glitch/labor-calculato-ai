type Balance = { type: string; currency: string; amount: string; referenceDate: string | null };
const validAmount = (value: unknown): value is string => typeof value === "string" && /^[+-]?\d+(?:\.\d{1,2})?$/.test(value);

// Booked balance first; available balance is a labelled fallback, never a sum of imported movements.
export function selectBankBalance(balances: Balance[], currency: string) {
  for (const type of ["ITBD", "CLBD", "ITAV", "CLAV"]) {
    const matching = balances.filter(b => b.type === type && b.currency === currency && validAmount(b.amount));
    matching.sort((a, b) => (b.referenceDate ?? "").localeCompare(a.referenceDate ?? ""));
    if (matching[0]) return matching[0];
  }
  return null;
}

export function paypalBalance(body: { balances?: { currency: string; total_balance?: { currency_code: string; value: string } }[]; as_of_time?: string; last_refresh_time?: string }) {
  const amount = body.balances?.find(b => b.currency === "EUR")?.total_balance;
  const date = body.as_of_time ?? body.last_refresh_time;
  if (amount?.currency_code !== "EUR" || !validAmount(amount.value) || !date || !Number.isFinite(Date.parse(date))) return null;
  return { balance: amount.value, balance_date: date };
}