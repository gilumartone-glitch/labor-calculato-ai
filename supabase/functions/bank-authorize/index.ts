import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";
import { bankingRequest, BankProviderError } from "../_shared/enable-banking.ts";
import { syncConnection } from "../_shared/bank-sync-service.ts";
const schema = z.discriminatedUnion("action", [z.object({ action: z.literal("start"), bank: z.enum(["Credem", "BNL", "PayPal"]) }).strict(), z.object({ action: z.literal("finish"), state: z.string().uuid(), code: z.string().min(1).max(2000) }).strict()]);
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Metodo non consentito" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: { user } } = await client.auth.getUser();
    if (!user) return json({ error: "Accedi per autorizzare i conti." }, 401);
    const { data: allowed } = await client.rpc("can_reconcile_bank", { _uid: user.id });
    if (!allowed) return json({ error: "Non autorizzato." }, 403);
    const input = schema.safeParse(await req.json());
    if (!input.success) return json({ error: "Richiesta non valida." }, 400);
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    if (input.data.action === "start") {
      const app = await bankingRequest("/application");
      if (!app.active || !app.services?.includes("AIS")) return json({ error: "Applicazione bancaria non attiva." }, 409);
      const result = await bankingRequest("/aspsps?country=IT");
      const pattern = input.data.bank === "Credem" ? /credito emiliano|credem/i : input.data.bank === "PayPal" ? /paypal/i : /nazionale.*lavoro|\bbnl\b/i;
      const matches = (result.aspsps ?? []).filter((b: { name: string; psu_types: string[] }) => pattern.test(b.name) && b.psu_types.includes("business"));
      if (matches.length !== 1) return json({ error: "Servizio aziendale non identificato univocamente. Verifica con Enable Banking." }, 409);
      const bank = matches[0];
      const state = crypto.randomUUID();
      const validUntil = new Date(Date.now() + Math.min(bank.maximum_consent_validity, 180 * 86400) * 1000).toISOString();
      const { error } = await admin.from("bank_provider_connections").insert({ bank: input.data.bank, user_id: user.id, state });
      if (error) throw new Error("Impossibile salvare la richiesta di autorizzazione.");
      const auth = await bankingRequest("/auth", { access: { valid_until: validUntil, balances: true, transactions: true }, aspsp: { name: bank.name, country: "IT" }, psu_type: "business", state, redirect_url: "https://flow.tecnofra.it/eb-callback" });
      const authUrl = new URL(auth.url);
      const host = authUrl.hostname.toLowerCase();
      if (authUrl.protocol !== "https:" || !(host === "enablebanking.com" || host.endsWith(".enablebanking.com"))) {
        console.error("Unexpected auth host", host);
        throw new Error("Indirizzo di autorizzazione inatteso.");
      }
      return json({ url: auth.url });
    }
    const { data: connection } = await admin.from("bank_provider_connections").select("*").eq("state", input.data.state).eq("user_id", user.id).eq("status", "pending").gt("expires_at", new Date().toISOString()).single();
    if (!connection) return json({ error: "Richiesta scaduta o già utilizzata. Ripeti l’autorizzazione da Conti." }, 409);
    // Claim once before consuming the one-time provider code.
    const { data: claimed } = await admin.from("bank_provider_connections").update({ status: "authorizing" }).eq("id", connection.id).eq("status", "pending").select("id").maybeSingle();
    if (!claimed) return json({ error: "Autorizzazione già in elaborazione." }, 409);
    try {
      const session = await bankingRequest("/sessions", { code: input.data.code });
      if (!session.session_id || !session.accounts?.length || !session.access?.valid_until) throw new Error("La banca non ha restituito conti e scadenza del consenso. Ripeti l’autorizzazione.");
      const { error } = await admin.from("bank_provider_connections").update({ session_id: session.session_id, accounts: session.accounts, consent_expires_at: session.access.valid_until, status: "authorized" }).eq("id", connection.id);
      if (error) throw new Error("Impossibile salvare il consenso bancario.");
      for (const account of session.accounts) {
        if (!account.identification_hash || !account.uid) continue;
        const iban = account.account_id?.iban ?? account.iban ?? "";
        const { error: accountError } = await admin.from("bank_accounts").upsert({ connection_id: connection.id, bank: connection.bank, account_ref: `EB-${account.identification_hash}`.slice(0, 100), display_name: String(account.name ?? `${connection.bank} aziendale`).slice(0, 200), iban_last4: typeof iban === "string" ? iban.slice(-4) || null : null, currency: account.currency ?? "EUR", is_active: true }, { onConflict: "bank,account_ref" });
        if (accountError) throw new Error("Consenso salvato; registrazione del conto non completata.");
      }
      const { data: settings } = await admin.from("bank_provider_settings").select("*").eq("id", true).maybeSingle();
      let imported = 0;
      let syncError: string | null = null;
      const importActive = !!(settings?.costs_verified && settings.monthly_cost_eur !== null && settings.commercial_evidence);
      if (importActive) {
        try { imported = await syncConnection(admin, { ...connection, session_id: session.session_id, accounts: session.accounts }, user.id); }
        catch { syncError = "Consenso salvato; prima importazione non completata. Usa Sincronizza ora."; }
      }
      return json({ bank: connection.bank, accountCount: session.accounts.length, consentExpiresAt: session.access.valid_until, importActive, imported, syncError });
    } catch (e) {
      await admin.from("bank_provider_connections").update({ status: "error", last_error: "Autorizzazione non completata. Ripeti da Conti." }).eq("id", connection.id);
      throw e;
    }
  } catch (e) {
    if (e instanceof BankProviderError) return json({ error: "Enable Banking ha rifiutato la richiesta", status: e.status, details: e.details }, e.status);
    return json({ error: e instanceof Error ? e.message : "Collegamento non riuscito." }, 500);
  }
});