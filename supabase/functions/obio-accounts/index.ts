import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { OpenBankingClient } from "npm:@open-banking-io/client@1.3.0";
import { obioAccountRef } from "../_shared/obio-import.ts";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Metodo non consentito." }, 405);
  const client = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await client.auth.getUser();
  if (!user) return json({ error: "Accedi per leggere i conti." }, 401);
  const { data: allowed } = await client.rpc("can_reconcile_bank", { _uid: user.id });
  if (!allowed) return json({ error: "Non autorizzato." }, 403);
  try {
    const body = await req.json();
    if (!body || Object.keys(body).length) return json({ error: "Richiesta non valida." }, 400);
    const apiBaseUrl = Deno.env.get("OBIO_API_BASE_URL");
    const apiKey = Deno.env.get("OBIO_API_KEY");
    const privateKeyPkcs8 = Deno.env.get("OBIO_PRIVATE_KEY");
    if (!apiBaseUrl || !apiKey || !privateKeyPkcs8) return json({ status: "unavailable", accounts: [] });
    const target = new URL(apiBaseUrl);
    if (target.protocol !== "https:" || !(target.hostname === "open-banking.io" || target.hostname.endsWith(".open-banking.io"))) return json({ status: "unavailable", accounts: [] });
    const provider = new OpenBankingClient({ apiBaseUrl, apiKey, privateKeyPkcs8, timeoutMs: 20000 });
    const [accounts, connections] = await Promise.all([provider.getAccounts(), provider.getConnections()]);
    return json({ status: "ready", provider: "open-banking.io", accounts: await Promise.all(accounts.map(async (a, index) => {
      const balance = a.balances.find(b => b.type === "ITBD" && b.currency === a.currency);
      const connection = connections.find(c => c.accountIds.includes(a.id));
      const bank = /credem|emiliano/i.test(a.aspspName) ? "Credem" : /bnl|nazionale.*lavoro/i.test(a.aspspName) ? "BNL" : a.aspspName;
      return { id: `obio-view-${index}`, account_ref: await obioAccountRef(a.iban || a.id), bank, display_name: a.displayName || a.accountName || a.ownerName || bank, iban_last4: a.iban?.slice(-4) ?? null, currency: a.currency, balance: balance?.amount ?? null, balance_date: balance?.referenceDate ?? null, last_sync_at: connection?.lastSyncedAt ?? null, is_active: true, needs_reconnect: a.needsReconnect || connection?.isLive === false, valid_until: connection?.validUntil ?? null };
    })) });
  } catch {
    // Never expose provider errors, account identifiers, credentials or full IBANs.
    return json({ status: "unavailable", accounts: [] });
  }
});