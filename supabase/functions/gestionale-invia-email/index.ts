// Invio per email dei documenti del Gestionale dalle caselle aziendali (SMTP di SiteGround).
//
// Le caselle si configurano dall'app: Gestionale > Impostazioni > Mail.
//   gest_caselle_email          indirizzo, nome, documenti che può spedire, attiva
//   gest_caselle_email_segreti  password cifrata (AES-GCM), leggibile solo da qui
//   gest_impostazioni «email_smtp»  server di posta in uscita e porta
// Il browser non riceve mai le password: le manda una volta per salvarle e basta.
//
// Riserva, se nell'app non è configurata nessuna casella: i segreti GESTIONALE_SMTP_HOST,
// GESTIONALE_SMTP_PORT e GESTIONALE_SMTP_CASELLE ({"indirizzo":"password"}).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import nodemailer from "npm:nodemailer@6.9.16";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const CONTESTI = ["preventivo", "ordine", "ddt", "fattura", "nota_credito", "estratto_conto"];
const AMMINISTRAZIONE = "amministrazione@tecnofra.it";
const EMAIL = /^[^@\s<>"',;]+@[^@\s<>"',;]+\.[^@\s<>"',;]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Casella = { id: string | null; indirizzo: string; nome: string; documenti: string[]; password: string };
type Smtp = { host: string; porta: number };
// deno-lint-ignore no-explicit-any
type Db = any;

/* ---------- cifratura delle password ---------- */
const b64 = (b: Uint8Array) => { let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s); };
const daB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function chiave(): Promise<CryptoKey> {
  const seme = Deno.env.get("GESTIONALE_SMTP_CHIAVE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`gestionale-caselle-email:${seme}`));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function cifra(testo: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await chiave(), new TextEncoder().encode(testo)));
  return `v1:${b64(iv)}:${b64(ct)}`;
}
async function decifra(cifrato: string): Promise<string | null> {
  try {
    const [v, iv, ct] = cifrato.split(":");
    if (v !== "v1") return null;
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: daB64(iv) }, await chiave(), daB64(ct)));
  } catch { return null; }
}

/* ---------- configurazione ---------- */
async function leggiSmtp(admin: Db): Promise<Smtp> {
  let host = ""; let porta = 0;
  const { data } = await admin.from("gest_impostazioni").select("valore").eq("chiave", "email_smtp").maybeSingle();
  try { const v = JSON.parse(data?.valore ?? "{}"); host = String(v.host ?? "").trim(); porta = Number(v.porta) || 0; } catch { /* si usa la riserva */ }
  if (!host) host = (Deno.env.get("GESTIONALE_SMTP_HOST") ?? "").trim();
  if (!porta) porta = Number(Deno.env.get("GESTIONALE_SMTP_PORT") ?? "465") || 465;
  return { host, porta };
}

function caselleDaSegreti(): Casella[] {
  try {
    const grezze = JSON.parse(Deno.env.get("GESTIONALE_SMTP_CASELLE") ?? "{}") as Record<string, unknown>;
    const pulite: Casella[] = [];
    for (const [indirizzo, password] of Object.entries(grezze)) {
      const i = indirizzo.trim().toLowerCase();
      if (!EMAIL.test(i) || typeof password !== "string" || !password) continue;
      // senza impostazioni nell'app vale la regola di partenza: fatture, note di credito ed estratti conto solo dall'amministrazione
      pulite.push({ id: null, indirizzo: i, nome: "", password, documenti: i === AMMINISTRAZIONE ? CONTESTI : ["preventivo", "ordine", "ddt"] });
    }
    return pulite.sort((a, b) => a.indirizzo.localeCompare(b.indirizzo));
  } catch { return []; }
}

/** Le caselle da cui si può spedire: attive e con la password salvata. */
async function caselleUtilizzabili(admin: Db): Promise<{ caselle: Casella[]; origine: "app" | "segreti" }> {
  const { data: righe, error } = await admin.from("gest_caselle_email").select("id, indirizzo, nome, documenti, attiva").order("indirizzo");
  if (error || !righe || righe.length === 0) return { caselle: caselleDaSegreti(), origine: "segreti" };
  const { data: segreti } = await admin.from("gest_caselle_email_segreti").select("casella_id, password_cifrata");
  const cifrate = new Map<string, string>((segreti ?? []).map((s: { casella_id: string; password_cifrata: string }) => [s.casella_id, s.password_cifrata]));
  const caselle: Casella[] = [];
  for (const r of righe) {
    if (!r.attiva || !cifrate.has(r.id)) continue;
    const password = await decifra(cifrate.get(r.id)!);
    if (password) caselle.push({ id: r.id, indirizzo: r.indirizzo, nome: r.nome ?? "", documenti: r.documenti ?? [], password });
  }
  return { caselle, origine: "app" };
}

const elenco = (v: unknown, massimo: number): string[] | null => {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > massimo) return null;
  const puliti = v.map((x) => String(x).trim().toLowerCase());
  return puliti.every((x) => EMAIL.test(x)) ? [...new Set(puliti)] : null;
};

const erroreLeggibile = (da: string, messaggio: string) =>
  /auth|535|credential|password/i.test(messaggio)
    ? `La casella ${da} ha rifiutato l'accesso: controlla la password in Impostazioni > Mail.`
    : /ENOTFOUND|ECONNREFUSED|timeout|ETIMEDOUT|EAI_AGAIN/i.test(messaggio)
      ? "Il server di posta non risponde: controlla l'indirizzo del server e la porta in Impostazioni > Mail."
      : `Il server di posta ha rifiutato l'operazione: ${messaggio.slice(0, 200)}`;

const trasporto = (smtp: Smtp, c: Pick<Casella, "indirizzo" | "password">) =>
  nodemailer.createTransport({ host: smtp.host, port: smtp.porta, secure: smtp.porta === 465, auth: { user: c.indirizzo, pass: c.password }, connectionTimeout: 15000, greetingTimeout: 15000 });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Accesso mancante." }, 401);
    const utente = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: chi, error: erroreChi } = await utente.auth.getUser();
    if (erroreChi || !chi?.user) return json({ error: "Accesso non valido." }, 401);
    const admin: Db = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const corpo = await req.json().catch(() => ({})) as Record<string, unknown>;
    const azione = String(corpo.azione ?? "");
    const smtp = await leggiSmtp(admin);

    /* ---------- impostazioni: solo l'amministratore ---------- */
    if (azione === "impostazioni" || azione === "password" || azione === "prova") {
      const { data: ruolo } = await admin.from("user_roles").select("role").eq("user_id", chi.user.id).eq("role", "admin").limit(1);
      if (!ruolo || ruolo.length === 0) return json({ error: "Le caselle email le configura solo l'amministratore." }, 403);

      if (azione === "impostazioni") {
        const { data: segreti, error } = await admin.from("gest_caselle_email_segreti").select("casella_id, aggiornata_il");
        if (error) return json({ error: "Le tabelle delle caselle non ci sono ancora: va applicata la migrazione." }, 503);
        return json({ smtp, con_password: Object.fromEntries((segreti ?? []).map((s: { casella_id: string; aggiornata_il: string }) => [s.casella_id, s.aggiornata_il])), caselle_nei_segreti: caselleDaSegreti().map((c) => c.indirizzo) });
      }

      const casellaId = String(corpo.casella_id ?? "");
      if (!UUID.test(casellaId)) return json({ error: "Casella non indicata." }, 400);
      const { data: casella } = await admin.from("gest_caselle_email").select("id, indirizzo").eq("id", casellaId).maybeSingle();
      if (!casella) return json({ error: "Casella non trovata." }, 404);

      if (azione === "password") {
        const password = typeof corpo.password === "string" ? corpo.password : "";
        if (!password || password.length > 500) return json({ error: "Scrivi la password della casella." }, 400);
        const { error } = await admin.from("gest_caselle_email_segreti").upsert(
          { casella_id: casellaId, password_cifrata: await cifra(password), aggiornata_il: new Date().toISOString(), aggiornata_da: chi.user.id }, { onConflict: "casella_id" });
        if (error) { console.error("password non salvata", error.message); return json({ error: "Password non salvata." }, 500); }
        return json({ salvata: true });
      }

      // prova: accesso al server di posta con la password salvata, senza spedire nulla
      if (!smtp.host) return json({ error: "Manca il server di posta in uscita." }, 400);
      const { data: segreto } = await admin.from("gest_caselle_email_segreti").select("password_cifrata").eq("casella_id", casellaId).maybeSingle();
      const password = segreto ? await decifra(segreto.password_cifrata) : null;
      if (!password) return json({ error: `Per ${casella.indirizzo} non c'è una password salvata (o va reinserita).` }, 400);
      try { await trasporto(smtp, { indirizzo: casella.indirizzo, password }).verify(); return json({ riuscita: true }); }
      catch (e) { const m = e instanceof Error ? e.message : String(e); console.error("prova fallita", { casella: casella.indirizzo, m }); return json({ error: erroreLeggibile(casella.indirizzo, m) }, 502); }
    }

    /* ---------- elenco delle caselle e invio ---------- */
    const { caselle } = await caselleUtilizzabili(admin);
    const configurato = Boolean(smtp.host) && caselle.length > 0;

    const { data: legge } = await utente.rpc("has_permission", { _user_id: chi.user.id, _page: "gestionale", _required: "read" });
    if (azione === "caselle") {
      if (!legge) return json({ error: "Permesso negato." }, 403);
      return json({ configurato, caselle: caselle.map((c) => ({ indirizzo: c.indirizzo, nome: c.nome, documenti: c.documenti })) });
    }
    if (azione !== "invia") return json({ error: "Azione non prevista." }, 400);

    const { data: scrive } = await utente.rpc("has_permission", { _user_id: chi.user.id, _page: "gestionale", _required: "write" });
    if (!scrive) return json({ error: "Non hai il permesso di spedire documenti dal Gestionale." }, 403);
    if (!configurato) return json({ error: "L'invio diretto non è ancora configurato: mancano il server di posta o le caselle (Impostazioni > Mail)." }, 503);

    const contesto = String(corpo.contesto ?? "");
    const da = String(corpo.da ?? "").trim().toLowerCase();
    const a = elenco(corpo.a, 10);
    const cc = elenco(corpo.cc, 10);
    const oggetto = String(corpo.oggetto ?? "").replace(/[\r\n]+/g, " ").trim();
    const testo = String(corpo.testo ?? "");
    const allegato = corpo.allegato as { nome?: unknown; base64?: unknown } | undefined;
    const documentoId = typeof corpo.documento_id === "string" && UUID.test(corpo.documento_id) ? corpo.documento_id : null;
    const anagraficaId = typeof corpo.anagrafica_id === "string" && UUID.test(corpo.anagrafica_id) ? corpo.anagrafica_id : null;

    if (!CONTESTI.includes(contesto)) return json({ error: "Tipo di documento non previsto." }, 400);
    const casella = caselle.find((c) => c.indirizzo === da);
    if (!casella) return json({ error: `La casella ${da || "(vuota)"} non è tra quelle configurate.` }, 400);
    if (!casella.documenti.includes(contesto)) return json({ error: `La casella ${da} non è abilitata a spedire questo tipo di documento (Impostazioni > Mail).` }, 400);
    if (!a || a.length === 0) return json({ error: "Indica almeno un destinatario valido (massimo 10)." }, 400);
    if (!cc) return json({ error: "Un indirizzo in copia non è valido." }, 400);
    if (!oggetto || oggetto.length > 200) return json({ error: "L'oggetto è obbligatorio (massimo 200 caratteri)." }, 400);
    if (!testo.trim() || testo.length > 20000) return json({ error: "Il messaggio è obbligatorio (massimo 20.000 caratteri)." }, 400);

    let pdf: Uint8Array | null = null;
    let nomeAllegato: string | null = null;
    if (allegato) {
      nomeAllegato = String(allegato.nome ?? "documento.pdf").replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "documento.pdf";
      if (!nomeAllegato.toLowerCase().endsWith(".pdf")) nomeAllegato += ".pdf";
      try { pdf = daB64(String(allegato.base64 ?? "")); } catch { return json({ error: "Allegato non leggibile." }, 400); }
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

    try {
      const esito = await trasporto(smtp, casella).sendMail({
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
      return json({ error: erroreLeggibile(da, messaggio) }, 502);
    }
  } catch (e) {
    console.error("gestionale-invia-email", e);
    return json({ error: "Errore imprevisto nell'invio." }, 500);
  }
});
