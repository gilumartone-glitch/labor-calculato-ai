import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { bankingRequest, BankProviderError } from "../_shared/enable-banking.ts";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Metodo non consentito" }, 405);
  try {
    const client = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: { user } } = await client.auth.getUser();
    if (!user) return json({ error: "Accedi per verificare il collegamento." }, 401);
    const { data: allowed, error } = await client.rpc("can_reconcile_bank", { _uid: user.id });
    if (error || !allowed) return json({ error: "Non autorizzato." }, 403);
    const app = await bankingRequest("/application");
    return json({ verified: true, name: app.name, active: app.active, services: app.services, redirect_urls: app.redirect_urls, linkedAccountCount: Array.isArray(app.accounts) ? app.accounts.length : null, costsVerified: false, importActive: false });
  } catch (e) {
    if (e instanceof BankProviderError) return json({ error: "Verifica Enable Banking non riuscita", status: e.status, details: e.details }, e.status);
    return json({ error: "Verifica non riuscita. Controlla la configurazione della chiave privata." }, 500);
  }
});