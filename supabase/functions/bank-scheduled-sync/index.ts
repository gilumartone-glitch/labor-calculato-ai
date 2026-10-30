import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { bankScheduleSlot } from "../_shared/bank-schedule.ts";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Metodo non consentito." }, 405);
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !["scheduled", "activate", "verify"].includes(body.action)) return json({ error: "Richiesta non valida." }, 400);
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const token = Deno.env.get("BANK_SCHEDULE_TOKEN");
    if (!token) return json({ error: "Autorizzazione degli aggiornamenti non configurata." }, 503);
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    if (body.action === "scheduled") {
      if (req.headers.get("x-bank-schedule-token") !== token) return json({ error: "Non autorizzato." }, 401);
      if (!bankScheduleSlot()) return json({ status: "blocked", reason: "outside_schedule", imported: 0 });
    } else {
      const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
      const { data: { user } } = await client.auth.getUser();
      if (!user) return json({ error: "Accedi per configurare gli aggiornamenti." }, 401);
      const { data: allowed } = await client.rpc("can_reconcile_bank", { _uid: user.id });
      if (!allowed) return json({ error: "Non autorizzato." }, 403);
      if (body.action === "activate") {
        const { error } = await admin.rpc("activate_bank_schedule", { _token: token, _endpoint: `${url}/functions/v1/bank-scheduled-sync` });
        if (error) return json({ error: "Attivazione degli aggiornamenti non riuscita." }, 503);
        return json({ enabled: true, times: ["08:30", "15:00"], timezone: "Europe/Rome", banks: ["Credem", "BNL", "PayPal"] });
      }
    }
    const [{ data: config }, { data: settings }] = await Promise.all([
      admin.from("bank_schedule_config").select("enabled").eq("id", true).maybeSingle(),
      admin.from("bank_provider_settings").select("sync_enabled,provider,costs_verified").eq("id", true).maybeSingle(),
    ]);
    if (!config?.enabled || !settings?.sync_enabled || settings.provider !== "open_banking_io" || !settings.costs_verified) return json({ status: "blocked", reason: "schedule_disabled", imported: 0 });
    const results = await Promise.all(["obio-sync", "paypal-sync"].map(async name => {
      try {
        const response = await fetch(`${url}/functions/v1/${name}`, { method: "POST", headers: { "Content-Type": "application/json", "x-bank-schedule-token": token }, body: JSON.stringify({ action: "scheduled" }), signal: AbortSignal.timeout(120000) });
        const data = await response.json();
        const status = !response.ok || data.error ? "error" : data.status ?? "success";
        // Store only sanitized result codes and counts, never headers or raw errors.
        if (name === "paypal-sync") await admin.from("bank_sync_log").insert({ bank: "PayPal", outcome: status === "success" ? "success" : "error", message: status === "success" ? `Aggiornamento automatico PayPal: ${Number(data.imported ?? 0)} nuovi movimenti.` : "Aggiornamento automatico PayPal non completato." });
        return { provider: name === "obio-sync" ? "Credem e BNL" : "PayPal", status, imported: Number(data.imported ?? 0), failed: Number(data.failed ?? 0) };
      } catch {
        await admin.from("bank_sync_log").insert({ bank: name === "obio-sync" ? "Credem/BNL" : "PayPal", outcome: "error", message: "Aggiornamento automatico non completato: servizio non disponibile." });
        return { provider: name === "obio-sync" ? "Credem e BNL" : "PayPal", status: "error", imported: 0 };
      }
    }));
    return json({ status: results.every(r => r.status === "success") ? "success" : "partial", results });
  } catch { return json({ error: "Aggiornamento automatico non completato." }, 500); }
});