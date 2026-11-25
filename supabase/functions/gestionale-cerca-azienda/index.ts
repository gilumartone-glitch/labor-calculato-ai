// Dati di un'azienda dalla partita IVA, per compilare la scheda di un cliente o fornitore.
//
// Due fonti:
//  - Openapi (company.openapi.com/IT-advanced), a pagamento, solo Italia: dati del Registro imprese,
//    con codice fiscale, PEC e codice destinatario SDI. Si usa se in Impostazioni > Servizi è stata
//    salvata la chiave (token). La chiave sta cifrata in gest_segreti e non torna mai al browser.
//  - VIES, pubblico e gratuito: denominazione e sede. Si usa per l'estero, se la chiave non c'è,
//    o come riserva se Openapi non risponde.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const VIES = Deno.env.get("GESTIONALE_VIES_URL") ?? "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";
const OPENAPI = (Deno.env.get("GESTIONALE_OPENAPI_URL") ?? "https://company.openapi.com").replace(/\/+$/, "");
const CHIAVE_OPENAPI = "openapi_company_token";
const PAESI_UE = ["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK", "XI"];
const pulito = (v: unknown) => { const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : typeof v === "number" ? String(v) : ""; return s && !/^-+$/.test(s) ? s : ""; };
// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Oggetto = Record<string, any>;

/* ---------- cifratura della chiave ---------- */
const b64 = (b: Uint8Array) => { let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s); };
const daB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function chiaveCifratura(): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`gestionale-segreti:${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function cifra(testo: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await chiaveCifratura(), new TextEncoder().encode(testo)));
  return `v1:${b64(iv)}:${b64(ct)}`;
}
async function decifra(cifrato: string): Promise<string | null> {
  try {
    const [v, iv, ct] = cifrato.split(":");
    if (v !== "v1") return null;
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: daB64(iv) }, await chiaveCifratura(), daB64(ct)));
  } catch { return null; }
}
async function leggiToken(admin: Db): Promise<{ token: string | null; aggiornato_il: string | null; tabella: boolean }> {
  const { data, error } = await admin.from("gest_segreti").select("valore_cifrato, aggiornato_il").eq("chiave", CHIAVE_OPENAPI).maybeSingle();
  if (error) return { token: null, aggiornato_il: null, tabella: false };
  const token = data ? await decifra(data.valore_cifrato) : null;
  return { token: token || null, aggiornato_il: token ? data.aggiornato_il : null, tabella: true };
}

/* ---------- Openapi ---------- */
type Trovata = { denominazione: string; indirizzo: string; cap: string; citta: string; provincia: string; codice_fiscale: string; pec: string; codice_sdi: string; forma_giuridica: string; rea: string; cessata: boolean };

function daOpenapi(d: Oggetto): Trovata {
  const sede: Oggetto = d.address?.registeredOffice ?? d.registeredOffice ?? d.address ?? {};
  const civico = pulito(sede.streetNumber);
  let via = [pulito(sede.toponym), pulito(sede.street)].filter(Boolean).join(" ") || pulito(sede.streetName);
  if (via && civico && !new RegExp(`(^|[\\s,])${civico.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i").test(via)) via = `${via} ${civico}`;
  const sdi = pulito(d.sdiCode).toUpperCase();
  const cciaa = pulito(d.cciaa); const rea = pulito(d.reaCode);
  const stato = pulito(d.activityStatus).toUpperCase();
  return {
    denominazione: pulito(d.companyName), indirizzo: via, cap: pulito(sede.zipCode), citta: pulito(sede.town), provincia: pulito(sede.province).toUpperCase().slice(0, 2),
    codice_fiscale: pulito(d.taxCode).toUpperCase(), pec: pulito(d.pec).toLowerCase(),
    codice_sdi: /^[A-Z0-9]{7}$/.test(sdi) && sdi !== "0000000" ? sdi : "",
    forma_giuridica: pulito(d.detailedLegalForm?.description), rea: rea ? [cciaa, rea].filter(Boolean).join("-") : "",
    cessata: d.cessata === true || /CESSAT|CANCELLAT|INATTIV/.test(stato),
  };
}

/** Risultato: i dati, «non trovata», oppure il motivo per cui il servizio non ha risposto. */
async function cercaOpenapi(token: string, numero: string): Promise<{ dati: Trovata } | { nonTrovata: true } | { errore: string }> {
  let r: Response;
  try {
    r = await fetch(`${OPENAPI}/IT-advanced/${numero}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
  } catch (e) { console.error("Openapi non raggiungibile", e instanceof Error ? e.message : String(e)); return { errore: "il servizio dei dati aziendali non risponde" }; }
  if (r.status === 204 || r.status === 404) return { nonTrovata: true };
  if (r.status === 401 || r.status === 403) return { errore: "la chiave del servizio dei dati aziendali non è valida o è scaduta (Impostazioni > Servizi)" };
  if (r.status === 402) return { errore: "il credito del servizio dei dati aziendali è esaurito" };
  const corpo = await r.json().catch(() => null) as Oggetto | null;
  if (!r.ok || !corpo || corpo.success === false) { console.error("Openapi errore", r.status, pulito(corpo?.message)); return { errore: `il servizio dei dati aziendali ha risposto con un errore (${r.status})` }; }
  const d = Array.isArray(corpo.data) ? corpo.data[0] : corpo.data;
  if (!d || typeof d !== "object") return { nonTrovata: true };
  const dati = daOpenapi(d);
  return dati.denominazione ? { dati } : { nonTrovata: true };
}

/* ---------- VIES ---------- */
async function cercaVies(paese: string, numero: string): Promise<{ valida: boolean; denominazione: string; indirizzo_grezzo: string } | { errore: string; status: number }> {
  let risposta: Response;
  try {
    risposta = await fetch(VIES, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ countryCode: paese, vatNumber: numero }), signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    console.error("VIES non raggiungibile", e instanceof Error ? e.message : String(e));
    return { errore: "Il servizio delle partite IVA (VIES) non risponde: riprova tra poco o compila a mano.", status: 502 };
  }
  const dati = await risposta.json().catch(() => null) as Oggetto | null;
  const errori = (dati?.errorWrappers as { error?: string }[] | undefined)?.map((e) => e.error).filter(Boolean) ?? [];
  const stato = String(dati?.userError ?? errori[0] ?? "");
  if (!risposta.ok || !dati || errori.length > 0 || /UNAVAILABLE|MAX_CONCURRENT|TIMEOUT|BLOCKED|SERVICE/i.test(stato)) {
    console.error("VIES errore", risposta.status, stato);
    return { errore: /INVALID_INPUT/i.test(stato) ? "La partita IVA non ha un formato valido." : "Il servizio delle partite IVA (VIES) in questo momento non risponde per questo Paese: riprova tra poco o compila a mano.", status: 502 };
  }
  return { valida: dati.valid === true || dati.isValid === true, denominazione: pulito(dati.name) || pulito(dati.traderName), indirizzo_grezzo: (typeof dati.address === "string" && !/^-+$/.test(dati.address.trim()) ? dati.address.trim() : "") || pulito(dati.traderAddress) };
}

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
    const azione = String(corpo.azione ?? "cerca");

    /* ---------- chiave del servizio: solo l'amministratore ---------- */
    if (azione === "servizio_stato" || azione === "servizio_chiave") {
      const { data: ruolo } = await admin.from("user_roles").select("role").eq("user_id", chi.user.id).eq("role", "admin").limit(1);
      if (!ruolo || ruolo.length === 0) return json({ error: "I servizi li configura solo l'amministratore." }, 403);
      if (azione === "servizio_chiave") {
        const token = typeof corpo.chiave === "string" ? corpo.chiave.trim() : "";
        if (token.length > 2000 || /\s/.test(token)) return json({ error: "La chiave non ha un formato valido." }, 400);
        // chiave vuota = servizio spento: si torna alla sola ricerca gratuita
        const { error } = await admin.from("gest_segreti").upsert(
          { chiave: CHIAVE_OPENAPI, valore_cifrato: await cifra(token), aggiornato_il: new Date().toISOString(), aggiornato_da: chi.user.id }, { onConflict: "chiave" });
        if (error) { console.error("chiave non salvata", error.message); return json({ error: "Chiave non salvata: la tabella dei servizi non c'è ancora (va applicata la migrazione)." }, 503); }
        return json({ salvata: true, attivo: Boolean(token) });
      }
      const s = await leggiToken(admin);
      return json({ disponibile: s.tabella, attivo: Boolean(s.token), aggiornato_il: s.aggiornato_il });
    }
    if (azione !== "cerca") return json({ error: "Azione non prevista." }, 400);

    // permesso e chiave si leggono insieme: sono due viaggi al database in meno prima della ricerca
    const [{ data: scrive }, chiaveServizio] = await Promise.all([
      utente.rpc("has_permission", { _user_id: chi.user.id, _page: "gestionale", _required: "write" }),
      leggiToken(admin),
    ]);
    if (!scrive) return json({ error: "Permesso negato." }, 403);

    const paese = String(corpo.paese ?? "IT").trim().toUpperCase().replace(/^GR$/, "EL");
    const numero = String(corpo.partita_iva ?? "").replace(/[\s.\-]/g, "").toUpperCase();
    if (!PAESI_UE.includes(paese)) return json({ error: "La ricerca funziona per le partite IVA dell'Unione europea." }, 400);
    if (!/^[A-Z0-9+*]{2,12}$/.test(numero) || (paese === "IT" && !/^\d{11}$/.test(numero))) return json({ error: "La partita IVA non ha un formato valido." }, 400);

    let avviso = "";
    if (paese === "IT") {
      const { token } = chiaveServizio;
      if (token) {
        const inizio = Date.now();
        const r = await cercaOpenapi(token, numero);
        const ms = Date.now() - inizio;
        console.log("Openapi IT-advanced", { ms, esito: "dati" in r ? "trovata" : "errore" in r ? "errore" : "non trovata" });
        if ("dati" in r) return json({ trovata: true, fonte: "Registro imprese", paese, partita_iva: numero, ms_servizio: ms, ...r.dati });
        if ("errore" in r) avviso = `Dati completi non disponibili: ${r.errore}. Uso l'archivio gratuito.`;
        // «non trovata» nel Registro imprese (es. professionisti): si prova comunque VIES
      }
    }
    const v = await cercaVies(paese, numero);
    if ("errore" in v) return json({ error: avviso ? `${avviso} ${v.errore}` : v.errore }, v.status);
    if (!v.valida) return json({ trovata: false, fonte: "VIES", messaggio: "Partita IVA non attiva o inesistente secondo l'Agenzia delle Entrate (VIES). Controlla il numero.", avviso });
    return json({ trovata: true, fonte: "VIES", paese, partita_iva: numero, denominazione: v.denominazione, indirizzo_grezzo: v.indirizzo_grezzo, avviso });
  } catch (e) {
    console.error("gestionale-cerca-azienda", e);
    return json({ error: "Errore imprevisto nella ricerca." }, 500);
  }
});
