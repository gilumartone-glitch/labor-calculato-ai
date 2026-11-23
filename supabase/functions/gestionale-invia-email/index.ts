// Invio per email dei documenti del Gestionale dalle caselle @tecnofra.it (SMTP di SiteGround).
//
// Segreti da impostare (mai nel codice):
//   GESTIONALE_SMTP_HOST     server di posta in uscita indicato da SiteGround (Site Tools > Email > Account > Configurazione)
//   GESTIONALE_SMTP_PORT     465 (predefinita) oppure 587
//   GESTIONALE_SMTP_CASELLE  elenco delle caselle con la loro password, in JSON:
//                            {"amministrazione@tecnofra.it":"...","commerciale@tecnofra.it":"..."}
//
// Il browser non vede mai le password: riceve solo l'elenco degli indirizzi.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import nodemailer from "npm:nodemailer@6.9.16";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** Fatture, note di credito ed estratti conto partono solo dall'amministrazione. */
const AMMINISTRAZIONE = "amministrazione@tecnofra.it";
const CONTESTI_AMMINISTRAZIONE = new Set(["fattura", "nota_credito", "estratto_conto"]);
const CONTESTI = new Set(["preventivo", "ordine", "ddt", "fattura", "nota_credito", "estratto_conto"]);
const EMAIL = /^[^@\s<>"',;]+@[^@\s<>"',;]+\.[^@\s<>"',;]+$/;

function caselle(): Record<string, string> {
  try {
    const grezze = JSON.parse(Deno.env.get("GESTIONALE_SMTP_CASELLE") ?? "{}") as Record<string, unknown>;
    const pulite: Record<string, string> = {};
    for (const [indirizzo, password] of Object.entries(grezze)) {
      const i = indirizzo.trim().toLowerCase();
      if (EMAIL.test(i) && i.endsWith("@tecnofra.it") && typeof password === "string" && password) pulite[i] = password;
    }
    return pulite;
  } catch {
    return {};
  }
}

const elenco = (v: unknown, massimo: number): string[] | null => {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > massimo) return null;
  const puliti = v.map((x) => String(x).trim().toLowerCase());
  return puliti.every((x) => EMAIL.test(x)) ? [...new Set(puliti)] : null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Accesso mancante." }, 401);
    const utente = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: chi, error: erroreChi } = await utente.auth.getUser();
    if (erroreChi || !chi?.user) return json({ error: "Accesso non valido." }, 401);
    const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const corpo = await req.json().catch(() => ({})) as Record<string, unknown>;
    const disponibili = caselle();
    const host = (Deno.env.get("GESTIONALE_SMTP_HOST") ?? "").trim();
    const configurato = Boolean(host) && Object.keys(disponibili).length > 0;

    // chi può leggere il Gestionale vede da quali caselle si può spedire
    const { data: legge } = await utente.rpc("has_permission", { _user_id: chi.user.id, _page: "gestionale", _required: "read" });
    if (corpo.azione === "caselle") {
      if (!legge) return json({ error: "Permesso negato." }, 403);
      return json({ configurato, caselle: Object.keys(disponibili).sort(), amministrazione: AMMINISTRAZIONE });
    }
    if (corpo.azione !== "invia") return json({ error: "Azione non prevista." }, 400);

    const { data: scrive } = await utente.rpc("has_permission", { _user_id: chi.user.id, _page: "gestionale", _required: "write" });
    if (!scrive) return json({ error: "Non hai il permesso di spedire documenti dal Gestionale." }, 403);
    if (!configurato) return json({ error: "L'invio diretto non è ancora configurato: mancano il server di posta o le caselle." }, 503);

    const contesto = String(corpo.contesto ?? "");
    const da = String(corpo.da ?? "").trim().toLowerCase();
    const a = elenco(corpo.a, 10);
    const cc = elenco(corpo.cc, 10);
    const oggetto = String(corpo.oggetto ?? "").replace(/[\r\n]+/g, " ").trim();
    const testo = String(corpo.testo ?? "");
    const allegato = corpo.allegato as { nome?: unknown; base64?: unknown } | undefined;
    const documentoId = typeof corpo.documento_id === "string" ? corpo.documento_id : null;
    const anagraficaId = typeof corpo.anagrafica_id === "string" ? corpo.anagrafica_id : null;

    if (!CONTESTI.has(contesto)) return json({ error: "Tipo di documento non previsto." }, 400);
    if (!disponibili[da]) return json({ error: `La casella ${da || "(vuota)"} non è tra quelle configurate.` }, 400);
    if (CONTESTI_AMMINISTRAZIONE.has(contesto) && da !== AMMINISTRAZIONE) return json({ error: `Fatture, note di credito ed estratti conto partono solo da ${AMMINISTRAZIONE}.` }, 400);
    if (!a || a.length === 0) return json({ error: "Indica almeno un destinatario valido (massimo 10)." }, 400);
    if (!cc) return json({ error: "Un indirizzo in copia non è valido." }, 400);
    if (!oggetto || oggetto.length > 200) return json({ error: "L'oggetto è obbligatorio (massimo 200 caratteri)." }, 400);
    if (!testo.trim() || testo.length > 20000) return json({ error: "Il messaggio è obbligatorio (massimo 20.000 caratteri)." }, 400);

    let pdf: Uint8Array | null = null;
    let nomeAllegato: string | null = null;
    if (allegato) {
      nomeAllegato = String(allegato.nome ?? "documento.pdf").replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "documento.pdf";
      if (!nomeAllegato.toLowerCase().endsWith(".pdf")) nomeAllegato += ".pdf";
      try { pdf = Uint8Array.from(atob(String(allegato.base64 ?? "")), (c) => c.charCodeAt(0)); } catch { return json({ error: "Allegato non leggibile." }, 400); }
      if (pdf.length < 5 || pdf.length > 8 * 1024 * 1024 || new TextDecoder().decode(pdf.slice(0, 5)) !== "%PDF-") return json({ error: "L'allegato deve essere un PDF di al massimo 8 MB." }, 400);
    }

    // il nome che compare come mittente è quello dei Dati azienda
    let nomeMittente = "Tecnofra";
    const { data: impostazione } = await admin.from("gest_impostazioni").select("valore").eq("chiave", "azienda").maybeSingle();
    try { nomeMittente = (JSON.parse(impostazione?.valore ?? "{}").denominazione ?? "").trim() || nomeMittente; } catch { /* resta Tecnofra */ }

    const registra = (esito: "inviata" | "errore", extra: { errore?: string; message_id?: string }) =>
      admin.from("gest_email_inviate").insert({
        documento_id: documentoId, contesto, anagrafica_id: anagraficaId, mittente: da, destinatari: a, copia: cc,
        oggetto, testo, allegato_nome: nomeAllegato, esito, errore: extra.errore ?? null, message_id: extra.message_id ?? null, inviata_da: chi.user.id,
      });

    const porta = Number(Deno.env.get("GESTIONALE_SMTP_PORT") ?? "465") || 465;
    try {
      const trasporto = nodemailer.createTransport({ host, port: porta, secure: porta === 465, auth: { user: da, pass: disponibili[da] } });
      const esito = await trasporto.sendMail({
        from: { name: nomeMittente, address: da },
        to: a, cc: cc.length ? cc : undefined,
        // una copia torna alla casella che spedisce: con l'SMTP il messaggio non finisce da solo nella posta inviata
        bcc: corpo.copia_al_mittente === false ? undefined : da,
        subject: oggetto, text: testo,
        attachments: pdf ? [{ filename: nomeAllegato!, content: pdf, contentType: "application/pdf" }] : undefined,
      });
      const { error: erroreRegistro } = await registra("inviata", { message_id: esito.messageId });
      if (erroreRegistro) console.error("email inviata ma non registrata", erroreRegistro.message);
      return json({ inviata: true, registrata: !erroreRegistro });
    } catch (e) {
      const messaggio = e instanceof Error ? e.message : String(e);
      console.error("invio fallito", { da, messaggio });
      await registra("errore", { errore: messaggio.slice(0, 500) });
      const leggibile = /auth|535|credential|password/i.test(messaggio)
        ? `La casella ${da} ha rifiutato l'accesso: controlla la password salvata nelle impostazioni protette.`
        : /ENOTFOUND|ECONNREFUSED|timeout|ETIMEDOUT/i.test(messaggio)
          ? "Il server di posta non risponde: controlla l'indirizzo del server e la porta."
          : `Il server di posta ha rifiutato il messaggio: ${messaggio.slice(0, 200)}`;
      return json({ error: leggibile }, 502);
    }
  } catch (e) {
    console.error("gestionale-invia-email", e);
    return json({ error: "Errore imprevisto nell'invio." }, 500);
  }
});
