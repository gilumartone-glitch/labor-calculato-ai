import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const API = "https://api-m.paypal.com";

async function token() {
  const id = Deno.env.get("PAYPAL_CLIENT_ID"), secret = Deno.env.get("PAYPAL_CLIENT_SECRET");
  if (!id || !secret) throw new Error("Credenziali PayPal mancanti.");
  const r = await fetch(`${API}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${btoa(`${id}:${secret}`)}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`PayPal ha rifiutato le credenziali (${r.status}). Controlla Client ID e Secret Live.`);
  return body.access_token as string;
}

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Metodo non consentito" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: { user } } = await client.auth.getUser();
    if (!user) return json({ error: "Accedi per importare i movimenti." }, 401);
    const { data: allowed } = await client.rpc("can_reconcile_bank", { _uid: user.id });
    if (!allowed) return json({ error: "Non autorizzato." }, 403);
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const access = await token();
    const rows: Record<string, unknown>[] = [];
    let skipped = 0;
    const end = new Date();
    // PayPal allows max 31 days per request: read the last 90 days in windows.
    for (let w = 0; w < 3; w++) {
      const to = new Date(end.getTime() - w * 30 * 86400000);
      const from = new Date(to.getTime() - 30 * 86400000);
      for (let page = 1; page <= 50; page++) {
        const q = new URLSearchParams({ start_date: iso(from), end_date: iso(to), fields: "transaction_info,payer_info", page_size: "500", page: String(page), transaction_status: "S" });
        const r = await fetch(`${API}/v1/reporting/transactions?${q}`, { headers: { Authorization: `Bearer ${access}` } });
        const body = await r.json().catch(() => ({}));
        if (r.status === 403) return json({ error: "PayPal non consente la lettura: attiva «Transaction Search» nell'app e riprova (può servire qualche ora)." }, 403);
        if (!r.ok) throw new Error(body?.message ?? `Lettura PayPal non riuscita (${r.status}).`);
        for (const t of body.transaction_details ?? []) {
          const i = t.transaction_info ?? {};
          if (i.transaction_amount?.currency_code !== "EUR") { skipped++; continue; }
          const gross = Number(i.transaction_amount.value), fee = Number(i.fee_amount?.value ?? 0);
          const amount = Math.round((gross + (Number.isFinite(fee) ? fee : 0)) * 100) / 100;
          const date = String(i.transaction_initiation_date ?? "").slice(0, 10);
          if (!i.transaction_id || !amount || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { skipped++; continue; }
          const p = t.payer_info ?? {};
          const name = p.payer_name?.alternate_full_name || [p.payer_name?.given_name, p.payer_name?.surname].filter(Boolean).join(" ") || p.email_address || "";
          const description = [name, i.transaction_subject, i.transaction_note].filter(Boolean).join(" · ") || "Movimento PayPal";
          rows.push({ bank: "PayPal", account_ref: "PAYPAL AZIENDALE", external_id: `pp-${i.transaction_id}`, booking_date: date, description: description.toLocaleUpperCase("it-IT").slice(0, 2000), amount, currency: "EUR", source: "paypal", created_by: user.id });
        }
        if (page >= (body.total_pages ?? 1)) break;
      }
    }
    let imported = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const { data, error } = await admin.from("bank_transactions").upsert(rows.slice(i, i + 500), { onConflict: "bank,account_ref,external_id", ignoreDuplicates: true }).select("id");
      if (error) throw new Error("Salvataggio movimenti non riuscito.");
      imported += data?.length ?? 0;
    }
    return json({ imported, read: rows.length, skipped });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Importazione PayPal non riuscita." }, 500);
  }
});
