import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const API_KEY = Deno.env.get("MAILCHIMP_API_KEY");
    const SERVER = Deno.env.get("MAILCHIMP_SERVER_PREFIX");
    const DEFAULT_AUDIENCE = Deno.env.get("MAILCHIMP_AUDIENCE_ID");
    if (!API_KEY || !SERVER || !DEFAULT_AUDIENCE) throw new Error("Mailchimp non configurato");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Non autenticato" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes.user) return new Response(JSON.stringify({ error: "Non autenticato" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { newsletter_id, send_now = false, test_email = null, action = null, resend_mode = null } = await req.json();
    if (!newsletter_id) throw new Error("newsletter_id mancante");

    const { data: nl, error: nErr } = await supabase.from("marketing_newsletters").select("*").eq("id", newsletter_id).single();
    if (nErr || !nl) throw new Error("Newsletter non trovata");

    const auth = "Basic " + btoa("anystring:" + API_KEY);
    const baseUrl = `https://${SERVER}.api.mailchimp.com/3.0`;

    // ---------- STATS ----------
    if (action === "stats") {
      if (!nl.mailchimp_campaign_id) throw new Error("Campagna non ancora inviata");
      const r = await fetch(`${baseUrl}/reports/${nl.mailchimp_campaign_id}`, { headers: { Authorization: auth } });
      const d = await r.json();
      if (!r.ok) throw new Error(`Mailchimp report [${r.status}]: ${d.detail || JSON.stringify(d)}`);
      const stats = {
        emails_sent: d.emails_sent ?? 0,
        opens_total: d.opens?.opens_total ?? 0,
        unique_opens: d.opens?.unique_opens ?? 0,
        open_rate: d.opens?.open_rate ?? 0,
        clicks_total: d.clicks?.clicks_total ?? 0,
        unique_clicks: d.clicks?.unique_clicks ?? 0,
        click_rate: d.clicks?.click_rate ?? 0,
        bounces: (d.bounces?.hard_bounces ?? 0) + (d.bounces?.soft_bounces ?? 0),
        hard_bounces: d.bounces?.hard_bounces ?? 0,
        soft_bounces: d.bounces?.soft_bounces ?? 0,
        unsubscribed: d.unsubscribed ?? 0,
        send_time: d.send_time ?? null,
      };
      return new Response(JSON.stringify({ success: true, stats }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---------- RESEND a non-aperture / bounced ----------
    if (action === "resend") {
      if (!nl.mailchimp_campaign_id) throw new Error("Campagna originale non disponibile");
      const mode = resend_mode === "bounced" ? "bounced" : "non_openers";
      // Mailchimp Aim segment supporta: opened/clicked/sent/noopen/noclick/was_sent
      // "noopen" copre anche i non recapitati (non hanno aperto perché bounced).
      // Per "bounced" usiamo lo stesso filtro: invieremo a chi non ha aperto.

      // 1. Replica
      const repRes = await fetch(`${baseUrl}/campaigns/${nl.mailchimp_campaign_id}/actions/replicate`, {
        method: "POST", headers: { Authorization: auth },
      });
      const repData = await repRes.json();
      if (!repRes.ok) throw new Error(`Replicate [${repRes.status}]: ${repData.detail || JSON.stringify(repData)}`);
      const newCampaignId = repData.id;

      // 2. Segmenta i destinatari
      const finalSegment = {
        match: "all",
        conditions: [{ condition_type: "Aim", field: "aim", op: "noopen", value: nl.mailchimp_campaign_id }],
      };

      const patchRes = await fetch(`${baseUrl}/campaigns/${newCampaignId}`, {
        method: "PATCH", headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients: { list_id: nl.mailchimp_audience_id || DEFAULT_AUDIENCE, segment_opts: finalSegment },
          settings: {
            subject_line: `${nl.subject} (promemoria)`,
            preview_text: nl.preview_text || "",
            title: `${nl.subject} — re-invio ${mode}`,
            from_name: nl.from_name || "Tecnofra",
            reply_to: nl.from_email || "info@tecnofra.it",
          },
        }),
      });
      if (!patchRes.ok) {
        const pd = await patchRes.json();
        throw new Error(`Patch resend [${patchRes.status}]: ${pd.detail || JSON.stringify(pd)}`);
      }

      // 3. Invia
      const sRes = await fetch(`${baseUrl}/campaigns/${newCampaignId}/actions/send`, { method: "POST", headers: { Authorization: auth } });
      if (!sRes.ok) {
        const sd = await sRes.json();
        throw new Error(`Resend send [${sRes.status}]: ${sd.detail || JSON.stringify(sd)}`);
      }

      return new Response(JSON.stringify({ success: true, campaign_id: newCampaignId, mode }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Recupera nomi categorie selezionate -> tag Mailchimp
    const categoryIds: string[] = Array.isArray(nl.category_ids) ? nl.category_ids : [];
    let tagNames: string[] = [];
    if (categoryIds.length > 0) {
      const { data: catRows } = await supabase.from("marketing_categories").select("id, name").in("id", categoryIds);
      tagNames = (catRows ?? []).map((c: any) => c.name);
    }

    // Crea o aggiorna campagna
    let campaignId = nl.mailchimp_campaign_id as string | null;
    const recipients: any = { list_id: DEFAULT_AUDIENCE };
    if (tagNames.length > 0) {
      // Mailchimp richiede gli ID numerici dei segmenti/tag, non i nomi.
      // Recupera tutti i segmenti della lista e mappa nome -> id.
      const segRes = await fetch(`${baseUrl}/lists/${DEFAULT_AUDIENCE}/segments?count=1000&type=static`, { headers: { Authorization: auth } });
      const segData = await segRes.json();
      if (!segRes.ok) throw new Error(`Mailchimp segmenti [${segRes.status}]: ${segData.detail || JSON.stringify(segData)}`);
      const segmentsByName = new Map<string, number>((segData.segments || []).map((s: any) => [String(s.name).toLowerCase(), s.id]));
      const segmentIds = tagNames.map((n) => segmentsByName.get(n.toLowerCase())).filter((v): v is number => typeof v === "number");
      if (segmentIds.length > 0) {
        recipients.segment_opts = {
          match: "any",
          conditions: segmentIds.map((id) => ({ condition_type: "StaticSegment", field: "static_segment", op: "static_is", value: id })),
        };
      } else {
        console.warn("Nessun segmento Mailchimp trovato per i tag:", tagNames);
      }
    }
    const campaignBody = {
      type: "regular",
      recipients,
      settings: {
        subject_line: nl.subject,
        preview_text: nl.preview_text || "",
        title: nl.subject,
        from_name: nl.from_name || "Tecnofra",
        reply_to: nl.from_email || "info@tecnofra.it",
      },
    };

    if (!campaignId) {
      const cRes = await fetch(`${baseUrl}/campaigns`, {
        method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(campaignBody),
      });
      const cData = await cRes.json();
      if (!cRes.ok) {
        const fieldErrs = Array.isArray(cData.errors) ? cData.errors.map((e: any) => `${e.field}: ${e.message}`).join(" | ") : "";
        throw new Error(`Mailchimp campagna [${cRes.status}]: ${cData.detail || cData.title || ""}${fieldErrs ? " — " + fieldErrs : " — " + JSON.stringify(cData)}`);
      }
      campaignId = cData.id;
    } else {
      const pRes = await fetch(`${baseUrl}/campaigns/${campaignId}`, {
        method: "PATCH", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(campaignBody),
      });
      if (!pRes.ok) {
        const pData = await pRes.json();
        const fieldErrs = Array.isArray(pData.errors) ? pData.errors.map((e: any) => `${e.field}: ${e.message}`).join(" | ") : "";
        throw new Error(`Mailchimp campagna patch [${pRes.status}]: ${pData.detail || pData.title || ""}${fieldErrs ? " — " + fieldErrs : " — " + JSON.stringify(pData)}`);
      }
    }

    // Imposta contenuto HTML
    const contentRes = await fetch(`${baseUrl}/campaigns/${campaignId}/content`, {
      method: "PUT", headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ html: nl.content_html || "<p>(vuoto)</p>" }),
    });
    if (!contentRes.ok) {
      const cd = await contentRes.json();
      throw new Error(`Mailchimp contenuto [${contentRes.status}]: ${cd.detail || JSON.stringify(cd)}`);
    }

    let status = "pronta";
    if (test_email) {
      const tRes = await fetch(`${baseUrl}/campaigns/${campaignId}/actions/test`, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({ test_emails: [test_email], send_type: "html" }),
      });
      if (!tRes.ok) {
        const td = await tRes.json();
        throw new Error(`Mailchimp test [${tRes.status}]: ${td.detail || JSON.stringify(td)}`);
      }
    } else if (send_now) {
      const sRes = await fetch(`${baseUrl}/campaigns/${campaignId}/actions/send`, { method: "POST", headers: { Authorization: auth } });
      if (!sRes.ok) {
        const sd = await sRes.json();
        throw new Error(`Mailchimp invio [${sRes.status}]: ${sd.detail || JSON.stringify(sd)}`);
      }
      status = "inviata";
    }

    if (!test_email) {
      await supabase.from("marketing_newsletters").update({
        mailchimp_campaign_id: campaignId,
        mailchimp_audience_id: DEFAULT_AUDIENCE,
        status,
        sent_at: send_now ? new Date().toISOString() : null,
      }).eq("id", newsletter_id);
    }

    return new Response(JSON.stringify({ success: true, campaign_id: campaignId, status }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Errore sconosciuto";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});