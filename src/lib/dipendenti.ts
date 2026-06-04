import { supabase } from "@/integrations/supabase/client";
import type { MacroReparto } from "@/lib/reparti";

export type Dipendente = {
  id: string;
  nome: string;
  funzione: string | null;
  email: string | null;
  telefono: string | null;
  macro_reparti: string[];
  reparti: string[];
  profile_id: string | null;
  hourly_rate: number;
  ral: number;
  inps_pct: number;
  inail_pct: number;
  tfr_pct: number;
  extra_costs: number;
  annual_hours: number;
  attivo: boolean;
  note: string | null;
};

export const fetchDipendenti = async (onlyActive = true): Promise<Dipendente[]> => {
  let q = supabase.from("dipendenti").select("*").order("nome", { ascending: true });
  if (onlyActive) q = q.eq("attivo", true);
  const { data, error } = await q;
  if (error) {
    console.warn("[dipendenti] fetch error", error.message);
    return [];
  }
  return (data ?? []) as Dipendente[];
};

/** Trasforma un dipendente in UserLite compatibile con LavorazioneGuidedForm. */
export const dipendenteAsUser = (d: Dipendente) => ({
  id: `dip:${d.id}`,
  display_name: d.nome + (d.funzione ? ` · ${d.funzione}` : ""),
  settori: d.reparti,
});

export const isDipendenteId = (id: string | null | undefined) =>
  typeof id === "string" && id.startsWith("dip:");

export const stripDipPrefix = (id: string) => id.startsWith("dip:") ? id.slice(4) : id;

export const filterDipendentiByMacro = (list: Dipendente[], macro: MacroReparto) =>
  list.filter((d) => d.macro_reparti.includes(macro));
