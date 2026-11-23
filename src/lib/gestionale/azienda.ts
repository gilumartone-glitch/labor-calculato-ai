import { supabase } from "@/integrations/supabase/client";
import { AZIENDA_VUOTA, type DatiAzienda } from "./fattura-pa";

// Accesso tipizzato a mano: vedi nota in ./api.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const CHIAVE = "azienda";

/** Dati di chi emette le fatture. Stanno nelle impostazioni del Gestionale, con il loro storico. */
export async function leggiAzienda(): Promise<DatiAzienda> {
  const { data, error } = await db.from("gest_impostazioni").select("valore").eq("chiave", CHIAVE).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.valore) return { ...AZIENDA_VUOTA };
  try { return { ...AZIENDA_VUOTA, ...(JSON.parse(data.valore) as Partial<DatiAzienda>) }; } catch { return { ...AZIENDA_VUOTA }; }
}

/** Solo l'amministratore può salvarli. */
export async function salvaAzienda(dati: DatiAzienda): Promise<void> {
  const { error } = await db.from("gest_impostazioni").upsert(
    { chiave: CHIAVE, valore: JSON.stringify(dati), descrizione: "Dati dell'azienda per la fattura elettronica" },
    { onConflict: "chiave" },
  );
  if (error) throw new Error(error.message);
}

/** Il logo per l'intestazione dei PDF, letto una volta sola. Se non si carica si stampa senza. */
let logoInCache: Promise<string | null> | null = null;
export const logoAzienda = (): Promise<string | null> => {
  logoInCache ??= fetch("/tecnofra-logo.png")
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error("logo"))))
    .then((b) => new Promise<string | null>((ok) => { const l = new FileReader(); l.onload = () => ok(String(l.result)); l.onerror = () => ok(null); l.readAsDataURL(b); }))
    .catch(() => null);
  return logoInCache;
};
