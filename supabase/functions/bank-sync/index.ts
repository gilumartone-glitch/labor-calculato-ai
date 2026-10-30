import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";
import { BankProviderError } from "../_shared/enable-banking.ts";
import { syncConnection } from "../_shared/bank-sync-service.ts";
import { blockedBankSync } from "../_shared/bank-sync-result.ts";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Metodo non consentito" }, 405);
  try {
    const input = z.union([z.object({ bank: z.enum(["Credem", "BNL"]) }).strict(), z.object({ action: z.literal("scheduled") }).strict(), z.object({ action: z.literal("prepare-schedule") }).strict()]).safeParse(await req.json());
    if (!input.success) return json({ error: "Banca non valida." }, 400);
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const scheduled = "action" in input.data && input.data.action === "scheduled";
    const scheduleToken = Deno.env.get("BANK_SCHEDULE_TOKEN");
    if (scheduled && (!scheduleToken || req.headers.get("x-bank-schedule-token") !== scheduleToken)) return json({ error: "Non autorizzato." }, 401);
    const { data: { user } } = scheduled ? { data: { user: null } } : await client.auth.getUser();
    if (!scheduled) {
      if (!user) return json({ error: "Accedi per importare i movimenti." }, 401);
      const { data: allowed } = await client.rpc("can_reconcile_bank", { _uid: user.id });
      if (!allowed) return json({ error: "Non autorizzato." }, 403);
    }
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    if ("action" in input.data && input.data.action === "prepare-schedule") {
      const { data: isAdmin } = await client.rpc("has_role", { _user_id: user?.id, _role: "admin" });
      if (!isAdmin || !scheduleToken) return json({ error: "Non autorizzato." }, 403);
      const { error } = await admin.rpc("prepare_bank_schedule", { _token: scheduleToken, _endpoint: `${url}/functions/v1/bank-sync` });
      if (error) return json({ error: "Preparazione aggiornamenti non riuscita." }, 500);
      return json({ prepared: true, enabled: false, localTimes: ["07:00", "14:00"], timezone: "Europe/Rome" });
    }
    const { data: settings, error: settingsError } = await admin.from("bank_provider_settings").select("*").eq("id", true).maybeSingle();
    if (settingsError) return json({ error: "Verifica delle condizioni del servizio non disponibile." }, 503);
    if (!settings?.costs_verified || settings.monthly_cost_eur === null || !settings.commercial_evidence) return json(blockedBankSync("commercial_terms_unverified", "Importazione bloccata: condizioni economiche del servizio non ancora verificate."));
    if (scheduled) {
      const { data: config, error: configError } = await admin.from("bank_schedule_config").select("enabled").eq("id", true).maybeSingle();
      if (configError) return json({ error: "Verifica degli aggiornamenti programmati non disponibile." }, 503);
      if (!config?.enabled || !settings.sync_enabled) return json(blockedBankSync("schedule_disabled", "Aggiornamenti programmati disattivati."));
    }
    let query = admin.from("bank_provider_connections").select("*").eq("status", "authorized").gt("consent_expires_at", new Date().toISOString()).order("created_at", { ascending: false });
    if ("bank" in input.data) query = query.eq("bank", input.data.bank);
    const { data: connections, error } = await query;
    if (error) return json({ error: "Verifica del consenso non disponibile." }, 503);
    if (!connections?.length) return json(blockedBankSync("consent_required", "Autorizza la lettura dalla pagina Conti."));
    const seen = new Set<string>();
    let imported = 0;
    for (const c of connections) {
      if (seen.has(c.bank) || !c.session_id || !["Credem", "BNL"].includes(c.bank)) continue;
      seen.add(c.bank);
      imported += await syncConnection(admin, c, user?.id ?? null);
    }
    return json({ imported });
  } catch (e) {
    if (e instanceof BankProviderError) return json({ error: "Importazione rifiutata dal provider. Verifica il consenso e le condizioni del servizio.", status: e.status }, e.status);
    return json({ error: e instanceof Error ? e.message : "Importazione non riuscita." }, 500);
  }
});