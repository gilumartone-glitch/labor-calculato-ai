// Dati di un'azienda dalla partita IVA, per compilare la scheda di un cliente o fornitore.
// Fonte: VIES, il servizio pubblico e gratuito della Commissione europea: restituisce denominazione e sede
// delle partite IVA attive (per l'Italia li fornisce l'Agenzia delle Entrate). Non restituisce PEC,
// codice destinatario SDI, codice fiscale e REA: per quelli serve un servizio a pagamento del Registro imprese.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const VIES = Deno.env.get("GESTIONALE_VIES_URL") ?? "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";
const PAESI_UE = ["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK", "XI"];
const pulito = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; return s && !/^-+$/.test(s) ? s : ""; };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Accesso mancante." }, 401);
    const utente = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: chi, error: erroreChi } = await utente.auth.getUser();
    if (erroreChi || !chi?.user) return json({ error: "Accesso non valido." }, 401);
    const { data: scrive } = await utente.rpc("has_permission", { _user_id: chi.user.id, _page: "gestionale", _required: "write" });
    if (!scrive) return json({ error: "Permesso negato." }, 403);

    const corpo = await req.json().catch(() => ({})) as Record<string, unknown>;
    const paese = String(corpo.paese ?? "IT").trim().toUpperCase().replace(/^GR$/, "EL");
    const numero = String(corpo.partita_iva ?? "").replace(/[\s.\-]/g, "").toUpperCase();
    if (!PAESI_UE.includes(paese)) return json({ error: "La ricerca funziona per le partite IVA dell'Unione europea." }, 400);
    if (!/^[A-Z0-9+*]{2,12}$/.test(numero) || (paese === "IT" && !/^\d{11}$/.test(numero))) return json({ error: "La partita IVA non ha un formato valido." }, 400);

    let risposta: Response;
    try {
      risposta = await fetch(VIES, {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ countryCode: paese, vatNumber: numero }), signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      console.error("VIES non raggiungibile", e instanceof Error ? e.message : String(e));
      return json({ error: "Il servizio delle partite IVA (VIES) non risponde: riprova tra poco o compila a mano." }, 502);
    }
    const dati = await risposta.json().catch(() => null) as Record<string, unknown> | null;
    const errori = (dati?.errorWrappers as { error?: string }[] | undefined)?.map((e) => e.error).filter(Boolean) ?? [];
    const stato = String(dati?.userError ?? errori[0] ?? "");
    if (!risposta.ok || !dati || errori.length > 0 || /UNAVAILABLE|MAX_CONCURRENT|TIMEOUT|BLOCKED|SERVICE/i.test(stato)) {
      console.error("VIES errore", risposta.status, stato);
      return json({ error: /INVALID_INPUT/i.test(stato) ? "La partita IVA non ha un formato valido." : "Il servizio delle partite IVA (VIES) in questo momento non risponde per questo Paese: riprova tra poco o compila a mano." }, 502);
    }
    const valida = dati.valid === true || dati.isValid === true;
    if (!valida) return json({ trovata: false, fonte: "VIES", messaggio: "Partita IVA non attiva o inesistente secondo l'Agenzia delle Entrate (VIES). Controlla il numero." });
    return json({ trovata: true, fonte: "VIES", paese, partita_iva: numero, denominazione: pulito(dati.name) || pulito(dati.traderName), indirizzo_grezzo: pulito(dati.address) || pulito(dati.traderAddress) });
  } catch (e) {
    console.error("gestionale-cerca-azienda", e);
    return json({ error: "Errore imprevisto nella ricerca." }, 500);
  }
});
