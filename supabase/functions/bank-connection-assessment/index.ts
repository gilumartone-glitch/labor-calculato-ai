import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";

const schema = z.object({ bank: z.enum(["Credem", "BNL", "PayPal"]), product: z.string().trim().min(2).max(150) }).strict();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Metodo non consentito" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !key) return json({ error: "Verifica non disponibile. Riprova più tardi." }, 503);
    const client = createClient(url, key, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return json({ error: "Accedi per verificare i conti." }, 401);
    const { data: allowed, error: permissionError } = await client.rpc("can_reconcile_bank", { _uid: user.id });
    if (permissionError) return json({ error: "Non riesco a verificare i permessi." }, 503);
    if (!allowed) return json({ error: "Non hai il permesso di collegare i conti." }, 403);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: "Scegli Credem o BNL e indica il servizio di accesso al conto." }, 400);
    // This deployment has no production provider adapter, contract or credentials.
    // Never infer coverage from a bank brand, user checkbox or public coverage list.
    return json({
      bank: parsed.data.bank, provider: "Enable Banking", checkedAt: new Date().toISOString(),
      compatibilityVerified: false, productionReady: false, costsConfirmed: false,
      monthlyCostEur: null, consentGranted: false, consentExpiresAt: null, syncFrequencyConfirmed: false,
      blockers: [
        `Supporto di ${parsed.data.bank} per lo specifico conto aziendale da confermare con il provider.`,
        "Preventivo, contratto e verifica aziendale (KYB) non confermati.",
        "Collegamento di produzione del provider non configurato.",
        "Autorizzazione della banca non ancora richiesta: durata, rinnovo e frequenza da confermare.",
      ],
    });
  } catch {
    return json({ error: "Verifica non riuscita. Nessun collegamento è stato attivato." }, 500);
  }
});