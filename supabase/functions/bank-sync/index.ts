import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";
import { bankingRequest, BankProviderError } from "../_shared/enable-banking.ts";
import { normalizeBookedTransaction } from "../_shared/bank-import.ts";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Metodo non consentito" }, 405);
  try {
    const input = z.object({ bank: z.enum(["Credem", "BNL", "PayPal"]) }).strict().safeParse(await req.json());
    if (!input.success) return json({ error: "Banca non valida." }, 400);
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: { user } } = await client.auth.getUser();
    if (!user) return json({ error: "Accedi per importare i movimenti." }, 401);
    const { data: allowed } = await client.rpc("can_reconcile_bank", { _uid: user.id });
    if (!allowed) return json({ error: "Non autorizzato." }, 403);
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const { data: settings } = await admin.from("bank_provider_settings").select("*").eq("id", true).maybeSingle();
    if (!settings?.costs_verified || settings.monthly_cost_eur === null || !settings.commercial_evidence) return json({ error: "Importazione bloccata: condizioni economiche del servizio non ancora verificate." }, 409);
    const { data: c } = await admin.from("bank_provider_connections").select("*").eq("bank", input.data.bank).eq("status", "authorized").gt("consent_expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!c?.session_id) return json({ error: "Autorizza la lettura dalla pagina Conti: il collegamento nell’area Enable Banking non crea il consenso di Flow." }, 409);
    const now = new Date().toISOString();
    const { data: lock } = await admin.from("bank_provider_connections").update({ sync_lock_until: new Date(Date.now() + 300000).toISOString() }).eq("id", c.id).or(`sync_lock_until.is.null,sync_lock_until.lt.${now}`).select("id").maybeSingle();
    if (!lock) return json({ error: "Importazione già in corso." }, 409);
    try {
      const session = await bankingRequest(`/sessions/${encodeURIComponent(c.session_id)}`);
      if (session.status !== "AUTHORIZED") throw new Error("Consenso bancario non più valido. Ripeti l’autorizzazione.");
      let imported = 0;
      for (const account of c.accounts) {
        if (!account.uid || !account.identification_hash) throw new Error("Conto senza identificativo stabile.");
        const rows = [];
        let continuation: string | undefined;
        for (let page = 0; page < 20; page++) {
          const query = new URLSearchParams({ date_from: new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10), transaction_status: "BOOK" });
          if (continuation) query.set("continuation_key", continuation);
          const result = await bankingRequest(`/accounts/${encodeURIComponent(account.uid)}/transactions?${query}`);
          for (const t of result.transactions ?? []) {
            const row = normalizeBookedTransaction(t);
            if (row) rows.push({ ...row, bank: c.bank, account_ref: `EB-${account.identification_hash}`.slice(0, 100), source: "enable_banking", created_by: user.id });
          }
          continuation = result.continuation_key;
          if (!continuation) break;
        }
        if (continuation) throw new Error("Storico oltre il limite di una lettura. Nessun import parziale per questo conto.");
        for (let i = 0; i < rows.length; i += 500) {
          const { data, error } = await admin.from("bank_transactions").upsert(rows.slice(i, i + 500), { onConflict: "bank,account_ref,external_id", ignoreDuplicates: true }).select("id");
          if (error) throw new Error("Salvataggio movimenti non riuscito.");
          imported += data?.length ?? 0;
        }
      }
      await admin.from("bank_provider_connections").update({ last_sync_at: new Date().toISOString(), last_error: null }).eq("id", c.id);
      return json({ imported });
    } finally { await admin.from("bank_provider_connections").update({ sync_lock_until: null }).eq("id", c.id); }
  } catch (e) {
    if (e instanceof BankProviderError) return json({ error: "Importazione rifiutata dal provider", status: e.status, details: e.details }, e.status);
    return json({ error: e instanceof Error ? e.message : "Importazione non riuscita." }, 500);
  }
});