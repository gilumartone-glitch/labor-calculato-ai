import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { registerAutomaticBankCash } from "../_shared/bank-auto-cash.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Metodo non consentito." }, 405);
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length) return json({ error: "Richiesta non valida." }, 400);
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: { user } } = await client.auth.getUser();
    if (!user) return json({ error: "Accedi per registrare i movimenti." }, 401);
    const { data: allowed, error } = await client.rpc("can_reconcile_bank", { _uid: user.id });
    if (error || !allowed) return json({ error: "Non autorizzato." }, 403);
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    return json({ count: await registerAutomaticBankCash(admin) });
  } catch { return json({ error: "Registrazione automatica in cassa non completata." }, 500); }
});