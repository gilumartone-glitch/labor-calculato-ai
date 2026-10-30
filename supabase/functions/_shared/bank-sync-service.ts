import { bankingRequest } from "./enable-banking.ts";
import { normalizeBankTransaction } from "./bank-import.ts";
import { syncDateFrom } from "./bank-identity.ts";

export async function syncConnection(admin: any, connection: any, actor: string | null) {
  const now = new Date().toISOString();
  const { data: lock, error: lockError } = await admin.from("bank_provider_connections").update({ sync_lock_until: new Date(Date.now() + 300000).toISOString() }).eq("id", connection.id).or(`sync_lock_until.is.null,sync_lock_until.lt.${now}`).select("id").maybeSingle();
  if (lockError || !lock) throw new Error("Importazione già in corso o collegamento non disponibile.");
  let imported = 0;
  let accountId: string | null = null;
  try {
    const session = await bankingRequest(`/sessions/${encodeURIComponent(connection.session_id)}`);
    if (session.status !== "AUTHORIZED") throw new Error("Consenso non più valido. Rinnova il collegamento.");
    for (const account of connection.accounts) {
      if (!account.uid || !account.identification_hash) throw new Error("Conto senza identificativo stabile.");
      const accountRef = `EB-${account.identification_hash}`.slice(0, 100);
      const iban = account.account_id?.iban ?? account.iban ?? "";
      const { data: saved, error: accountError } = await admin.from("bank_accounts").upsert({ bank: connection.bank, account_ref: accountRef, connection_id: connection.id, display_name: String(account.name ?? account.details ?? `${connection.bank} aziendale`).slice(0, 200), iban_last4: typeof iban === "string" ? iban.slice(-4) || null : null, currency: account.currency ?? "EUR", is_active: true }, { onConflict: "bank,account_ref" }).select("id,last_sync_at").single();
      if (accountError || !saved) throw new Error("Salvataggio conto non riuscito.");
      accountId = saved.id;
      const rows = [];
      const occurrences = new Map<string, number>();
      let continuation: string | undefined;
      // Fetch all states in one request stream; no separate automatic BOOK/PDNG polling.
      for (let page = 0; page < 100; page++) {
        const query = new URLSearchParams({ date_from: syncDateFrom(saved.last_sync_at), date_to: now.slice(0, 10) });
        if (continuation) query.set("continuation_key", continuation);
        const result = await bankingRequest(`/accounts/${encodeURIComponent(account.uid)}/transactions?${query}`);
        for (const t of result.transactions ?? []) {
          const key = JSON.stringify([t.booking_date ?? t.value_date, t.transaction_amount, t.credit_debit_indicator, t.remittance_information]);
          const occurrence = (occurrences.get(key) ?? 0) + 1;
          occurrences.set(key, occurrence);
          const row = await normalizeBankTransaction(t, accountRef, occurrence);
          if (row) rows.push({ ...row, bank: connection.bank, account_ref: accountRef });
        }
        continuation = result.continuation_key;
        if (!continuation) break;
      }
      if (continuation) throw new Error("Storico oltre il limite: nessuna importazione parziale per questo conto.");
      const balances = await bankingRequest(`/accounts/${encodeURIComponent(account.uid)}/balances`);
      const balance = (balances.balances ?? []).find((b: any) => b.balance_type === "CLBD" && b.balance_amount?.currency === "EUR");
      for (let i = 0; i < rows.length; i += 500) {
        const { data, error } = await admin.rpc("store_bank_transactions", { _rows: rows.slice(i, i + 500), _source: "enable_banking", _actor: actor });
        if (error) throw new Error(error.message);
        imported += Number(data ?? 0);
      }
      const value = balance ? Number(balance.balance_amount.amount) : null;
      const { error: balanceError } = await admin.from("bank_accounts").update({ balance: value !== null && Number.isFinite(value) ? value : null, balance_date: balance ? now : null, last_sync_at: now }).eq("id", saved.id);
      if (balanceError) throw new Error("Aggiornamento saldo non riuscito.");
      await admin.from("bank_sync_log").insert({ account_id: saved.id, bank: connection.bank, outcome: "success", message: "Movimenti e saldo aggiornati." });
    }
    await admin.from("bank_provider_connections").update({ last_sync_at: now, last_error: null }).eq("id", connection.id);
    return imported;
  } catch (error) {
    // Store only a fixed safe message, never provider payloads or credentials.
    const message = "Aggiornamento non completato. Controlla il consenso e riprova.";
    await admin.from("bank_provider_connections").update({ last_error: message }).eq("id", connection.id);
    await admin.from("bank_sync_log").insert({ account_id: accountId, bank: connection.bank, outcome: "error", message });
    throw error;
  } finally { await admin.from("bank_provider_connections").update({ sync_lock_until: null }).eq("id", connection.id); }
}