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

/** Defaults calibrati per CCNL metalmeccanico (vedi NetToCostCalculator). */
export const NET_TO_GROSS_RATIO = 0.72;
export const WORK_HOURS_PER_DAY = 8;
export const WORK_DAYS_PER_MONTH = 22;
export const SALARY_MONTHS = 13;
export const EFFECTIVE_ANNUAL_HOURS = 1650;
/** Extra netto per ogni ora oltre le 8 giornaliere (da tassare). */
export const OVERTIME_EXTRA_HOURLY = 5;
/** Bonus netto giornaliero per i giorni di trasferta (da tassare). */
export const TRASFERTA_DAILY_EXTRA = 20;

export const dipendenteRal = (d: Pick<Dipendente, "hourly_rate">) =>
  (Math.max(0, d.hourly_rate ?? 0) * WORK_HOURS_PER_DAY * WORK_DAYS_PER_MONTH * SALARY_MONTHS) / NET_TO_GROSS_RATIO;
export const dipendenteCompanyCost = (d: Pick<Dipendente, "hourly_rate" | "inps_pct" | "inail_pct" | "tfr_pct" | "extra_costs">) => {
  const ral = dipendenteRal(d);
  return ral * (1 + (d.inps_pct || 0) / 100 + (d.inail_pct || 0) / 100 + (d.tfr_pct || 0) / 100) + (d.extra_costs || 0);
};
export const dipendenteHourlyCost = (d: Pick<Dipendente, "hourly_rate" | "inps_pct" | "inail_pct" | "tfr_pct" | "extra_costs" | "annual_hours">) =>
  dipendenteCompanyCost(d) / Math.max(1, d.annual_hours || EFFECTIVE_ANNUAL_HOURS);

/** Costo azienda per un'ora di straordinario (netto OVERTIME_EXTRA_HOURLY lordizzato). */
export const dipendenteOvertimeHourlyCost = (
  d: Pick<Dipendente, "inps_pct" | "inail_pct" | "tfr_pct">,
) => (OVERTIME_EXTRA_HOURLY / NET_TO_GROSS_RATIO) * (1 + (d.inps_pct || 0) / 100 + (d.inail_pct || 0) / 100 + (d.tfr_pct || 0) / 100);

/** Costo azienda per il bonus trasferta giornaliero (netto TRASFERTA_DAILY_EXTRA lordizzato). */
export const dipendenteTrasfertaDailyCost = (
  d: Pick<Dipendente, "inps_pct" | "inail_pct" | "tfr_pct">,
) => (TRASFERTA_DAILY_EXTRA / NET_TO_GROSS_RATIO) * (1 + (d.inps_pct || 0) / 100 + (d.inail_pct || 0) / 100 + (d.tfr_pct || 0) / 100);


