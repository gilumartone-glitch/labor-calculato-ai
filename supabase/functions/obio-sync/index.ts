import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { OpenBankingClient } from "npm:@open-banking-io/client@1.3.0";
import { normalizeObioMovement, obioAccountRef, obioFallbackRef, obioTermsVerified } from "../_shared/obio-import.ts";
import { syncDateFrom } from "../_shared/bank-identity.ts";
import { blockedBankSync } from "../_shared/bank-sync-result.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Metodo non consentito." }, 405);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await client.auth.getUser();
  if (!user) return json({ error: "Accedi per sincronizzare i movimenti." }, 401);
  const { data: allowed, error: accessError } = await client.rpc("can_reconcile_bank", { _uid: user.id });
  if (accessError || !allowed) return json({ error: "Non autorizzato." }, 403);
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const run = crypto.randomUUID();
  let locked = false;
  let imported = 0;
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length) return json({ error: "Richiesta non valida." }, 400);
    const { data: settings, error: settingsError } = await admin.from("bank_provider_settings").select("provider,costs_verified,monthly_cost_eur,commercial_evidence").eq("id", true).maybeSingle();
    if (settingsError) return json(blockedBankSync("commercial_terms_unverified", "Verifica delle condizioni del servizio non disponibile."));
    if (!obioTermsVerified(settings)) return json(blockedBankSync("commercial_terms_unverified", "Sincronizzazione bloccata: mancano il costo e le condizioni confermate di open-banking.io. La lettura dei conti non attiva l’importazione."));
    const apiBaseUrl = Deno.env.get("OBIO_API_BASE_URL");
    const apiKey = Deno.env.get("OBIO_API_KEY");
    const privateKeyPkcs8 = Deno.env.get("OBIO_PRIVATE_KEY");
    if (!apiBaseUrl || !apiKey || !privateKeyPkcs8) return json(blockedBankSync("credentials_missing", "Credenziali del servizio non disponibili."));
    const target = new URL(apiBaseUrl);
    if (target.protocol !== "https:" || !(target.hostname === "open-banking.io" || target.hostname.endsWith(".open-banking.io"))) return json(blockedBankSync("invalid_endpoint", "Indirizzo del servizio non valido."));
    const { data: acquired, error: lockError } = await admin.rpc("acquire_obio_sync", { _run: run });
    if (lockError || !acquired) return json(blockedBankSync("sync_in_progress", "Sincronizzazione già in corso: attendi il completamento."));
    locked = true;
    const provider = new OpenBankingClient({ apiBaseUrl, apiKey, privateKeyPkcs8, timeoutMs: 20000 });
    const [initialAccounts, connections] = await Promise.all([provider.getAccounts(), provider.getConnections()]);
    const supported = initialAccounts.filter(a => /credem|emiliano|bnl|nazionale.*lavoro/i.test(a.aspspName));
    if (!supported.length) return json(blockedBankSync("consent_required", "Nessun conto Credem o BNL disponibile nel servizio."));
    // Verify every connection before syncAll, which can refresh all accounts in the credential scope.
    if (initialAccounts.length !== supported.length || supported.some(a => a.currency !== "EUR" || a.needsReconnect || !connections.some(c => c.accountIds.includes(a.id) && c.isLive && new Date(c.validUntil).getTime() > Date.now() && /business|corporate/i.test(c.psuType ?? "")))) {
      return json(blockedBankSync("business_consent_required", "Verifica o rinnova i consensi aziendali su open-banking.io prima di sincronizzare."));
    }
    const result = await provider.syncAll();
    const accounts = await provider.getAccounts();
    let failed = 0;
    for (const a of accounts) {
      const bank = /credem|emiliano/i.test(a.aspspName) ? "Credem" : /bnl|nazionale.*lavoro/i.test(a.aspspName) ? "BNL" : null;
      if (!bank) continue;
      const accountRef = await obioAccountRef(a.iban || a.id);
      const refusal = result.failures.find(f => f.accountId === a.id);
      const { data: saved, error: saveError } = await admin.from("bank_accounts").upsert({ bank, account_ref: accountRef, display_name: (a.displayName || a.accountName || bank).slice(0, 200), iban_last4: a.iban?.slice(-4) ?? null, currency: a.currency, needs_reconnect: a.needsReconnect || refusal?.reason === "reconnect_needed", is_active: true }, { onConflict: "bank,account_ref" }).select("id,last_sync_at").single();
      if (saveError || !saved) throw new Error("account_save_failed");
      if (refusal) {
        failed++;
        const reason = ["reconnect_needed", "consent_withdrawn", "uid_outdated", "psu_present_required", "rate_limited", "bank_error", "transient", "partner_app_inactive"].includes(refusal.reason) ? refusal.reason : "provider_refused";
        await admin.from("bank_sync_log").insert({ account_id: saved.id, bank, outcome: "blocked", message: `Aggiornamento non eseguito: ${reason}.` });
        continue;
      }
      const rows = [];
      const occurrences = new Map<string, number>();
      let complete = false;
      for (let offset = 0; offset < 20000; offset += 200) {
        const page = await provider.getTransactions(a.id, { from: syncDateFrom(saved.last_sync_at), limit: 200, offset });
        for (const t of page.items) {
          const normalized = normalizeObioMovement(t);
          if (!normalized) continue;
          const key = `${normalized.booking_date}|${normalized.amount}|${normalized.description}`;
          const occurrence = (occurrences.get(key) ?? 0) + 1;
          occurrences.set(key, occurrence);
          const externalId = t.id?.trim() ? `obio-${t.id.trim()}` : await obioFallbackRef(accountRef, normalized, occurrence);
          rows.push({ ...normalized, bank, account_ref: accountRef, external_id: externalId });
        }
        if (!page.items.length || offset + page.items.length >= page.total) { complete = true; break; }
      }
      if (!complete) throw new Error("history_limit");
      for (let start = 0; start < rows.length; start += 500) {
        const { data: count, error: importError } = await admin.rpc("store_bank_transactions", { _rows: rows.slice(start, start + 500), _source: "open_banking_io", _actor: user.id });
        if (importError) throw new Error("storage_failed");
        imported += Number(count ?? 0);
      }
      const balance = a.balances.find(b => b.type === "ITBD" && b.currency === "EUR");
      const { error: balanceError } = await admin.from("bank_accounts").update({ balance: balance?.amount ?? null, balance_date: balance?.referenceDate ?? null, last_sync_at: new Date().toISOString() }).eq("id", saved.id);
      if (balanceError) throw new Error("balance_save_failed");
      await admin.from("bank_sync_log").insert({ account_id: saved.id, bank, outcome: "success", message: "Movimenti e saldo open-banking.io aggiornati." });
    }
    return json({ status: failed ? "partial" : "success", imported, failed, message: failed ? "Alcuni conti richiedono una verifica: consulta gli ultimi aggiornamenti." : "Movimenti e saldi aggiornati." });
  } catch {
    return json({ status: "error", imported, error: "Sincronizzazione non completata. Controlla il consenso su open-banking.io e riprova; i movimenti già salvati non verranno duplicati." }, 502);
  } finally {
    if (locked) await admin.rpc("release_obio_sync", { _run: run });
  }
});