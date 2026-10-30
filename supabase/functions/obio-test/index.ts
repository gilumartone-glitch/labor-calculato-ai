import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { OpenBankingClient } from "npm:@open-banking-io/client@1.3.0";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Metodo non consentito." }, 405);
  const client = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await client.auth.getUser();
  if (!user) return json({ error: "Accedi per verificare il collegamento." }, 401);
  const [{ data: admin }, { data: administration }, { data: approved }] = await Promise.all([
    client.rpc("has_role", { _user_id: user.id, _role: "admin" }),
    client.rpc("is_amministrazione", { _user_id: user.id }),
    client.rpc("is_approved", { _user_id: user.id }),
  ]);
  if (!approved || (!admin && !administration)) return json({ error: "Non autorizzato." }, 403);
  const apiBaseUrl = Deno.env.get("OBIO_API_BASE_URL");
  const apiKey = Deno.env.get("OBIO_API_KEY");
  const privateKeyPkcs8 = Deno.env.get("OBIO_PRIVATE_KEY");
  if (!apiBaseUrl || !apiKey || !privateKeyPkcs8) return json({ error: "Configura OBIO_API_BASE_URL, OBIO_API_KEY e OBIO_PRIVATE_KEY nei segreti del progetto.", code: "credentials_missing", sdkLoaded: true }, 409);
  try {
    const target = new URL(apiBaseUrl);
    if (target.protocol !== "https:" || !(target.hostname === "open-banking.io" || target.hostname.endsWith(".open-banking.io"))) return json({ error: "Indirizzo del servizio non valido: usa il valore ufficiale di credentials.json.", code: "invalid_endpoint" }, 400);
    const provider = new OpenBankingClient({ apiBaseUrl, apiKey, privateKeyPkcs8, timeoutMs: 20000 });
    const accounts = await provider.getAccounts();
    return json({ count: accounts.length, ibanLast4: accounts.map((a) => a.iban?.slice(-4) ?? null) });
  } catch (error) {
    // No raw SDK errors: they can contain request URLs, keys or decrypted data.
    const code = error instanceof DOMException ? (error.name === "DataError" ? "invalid_private_key" : error.name === "OperationError" ? "decryption_failed" : "crypto_failed") : error instanceof TypeError ? "sdk_or_connection_failed" : "provider_read_failed";
    return json({ error: "Prova open-banking.io non riuscita. Nessun dato importato e provider precedente invariato.", code }, 502);
  }
});