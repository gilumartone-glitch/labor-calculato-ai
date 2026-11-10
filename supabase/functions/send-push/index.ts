import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createHash, timingSafeEqual } from "node:crypto";
import { safeNotificationPath, pushFailureStatus } from "../_shared/push-rules.ts";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Metodo non consentito" }, 405);
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Richiesta non valida" }, 400);
    const { data: config } = await admin.from("notification_push_config").select("token").eq("id", true).maybeSingle();
    const bearer = req.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
    const hash = (s: string) => createHash("sha256").update(s).digest();
    const internal = !!config?.token && timingSafeEqual(hash(bearer), hash(config.token));
    let userId: string;
    let note: { id?: string; message: string; link?: string | null; is_urgent?: boolean };
    if (internal) {
      if (typeof body.notification_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.notification_id)) return json({ error: "Notifica non valida" }, 400);
      const { data, error } = await admin.from("prod_notifications").select("id,user_id,message,link,is_urgent,order_id").eq("id", body.notification_id).maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: "Notifica non disponibile" }, 404);
      userId = data.user_id;
      note = { ...data, link: data.link || (data.order_id ? `/produzione/board?order=${data.order_id}` : "/hub") };
    } else {
      const client = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
      const { data: { user } } = await client.auth.getUser();
      if (!user) return json({ error: "Accedi per controllare le notifiche" }, 401);
      const { data: approved } = await client.rpc("is_approved", { _user_id: user.id });
      if (!approved) return json({ error: "Non autorizzato" }, 403);
      if (body.action === "public-key" && Object.keys(body).length === 1) return json({ publicKey: Deno.env.get("VAPID_PUBLIC_KEY") ?? "" });
      if (body.action !== "test" || Object.keys(body).length !== 1) return json({ error: "Richiesta non valida" }, 400);
      userId = user.id;
      note = { message: "Le notifiche di Tecnofra Flow sono attive.", link: "/hub" };
    }
    const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    if (!publicKey || !privateKey) return json({ error: "Invio notifiche non configurato" }, 503);
    const subject = Deno.env.get("VAPID_SUBJECT") ?? "";
    webpush.setVapidDetails(/^(mailto:|https:\/\/)/.test(subject) ? subject : "mailto:info@tecnofra.it", publicKey, privateKey);
    const { data: subs, error } = await admin.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("user_id", userId);
    if (error) throw error;
    const payload = JSON.stringify({ title: "Tecnofra Flow", body: note.message, url: safeNotificationPath(note.link), urgent: !!note.is_urgent, tag: note.id || crypto.randomUUID() });
    let sent = 0;
    const dead: string[] = [];
    const failures: number[] = [];
    await Promise.all((subs ?? []).map(async s => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: note.is_urgent ? "high" : "normal", timeout: 15000 });
        sent++;
      } catch (e) {
        const code = pushFailureStatus(e);
        failures.push(code);
        if (code === 404 || code === 410) dead.push(s.id);
      }
    }));
    if (dead.length) await admin.from("push_subscriptions").delete().in("id", dead);
    console.info("push delivery", { sent, failed: failures.length, removed: dead.length, statuses: failures });
    return json({ sent, failed: failures.length, removed: dead.length, registered: subs?.length ?? 0, statuses: failures });
  } catch { return json({ error: "Invio notifiche non completato" }, 500); }
});
