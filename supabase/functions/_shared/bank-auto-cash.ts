import { automaticCashCausale } from "./bank-auto-cash-rules.ts";

/** Runs only with a service client after owner or schedule authorization. No bank requests. */
export async function registerAutomaticBankCash(admin: any): Promise<number> {
  let count = 0;
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await admin.from("bank_transactions")
      .select("id,description,amount,counterparty_name,manual_updated_at,updated_at,booking_date")
      .is("deleted_at", null).eq("status", "BOOK").order("id").range(offset, offset + 499);
    if (error) throw new Error("automatic_cash_read_failed");
    const entries = (data ?? []).flatMap((row: any) => {
      const description = automaticCashCausale(row);
      return description ? [{ transaction_id: row.id, description, expected_updated_at: row.updated_at }] : [];
    });
    if (entries.length) {
      const { data: result, error: saveError } = await admin.rpc("auto_register_bank_cash", { _entries: entries });
      if (saveError) throw new Error("automatic_cash_save_failed");
      count += Number(result?.count ?? 0);
    }
    if ((data?.length ?? 0) < 500) return count;
  }
}