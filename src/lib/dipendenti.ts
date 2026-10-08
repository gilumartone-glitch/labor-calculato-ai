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
  contract_hours_per_day: number;
  attivo: boolean;
  note: string | null;
  rate_history?: unknown;
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

/** Moltiplicatore netto → costo azienda (tasse, contributi, TFR, oneri). */
export const NET_TO_COMPANY_MULTIPLIER = 1.9;
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
  Math.max(0, d.hourly_rate ?? 0) * WORK_HOURS_PER_DAY * WORK_DAYS_PER_MONTH * SALARY_MONTHS * NET_TO_COMPANY_MULTIPLIER;
export const dipendenteCompanyCost = (d: Pick<Dipendente, "hourly_rate" | "inps_pct" | "inail_pct" | "tfr_pct" | "extra_costs">) =>
  dipendenteRal(d) + (d.extra_costs || 0);
export const dipendenteHourlyCost = (d: Pick<Dipendente, "hourly_rate" | "inps_pct" | "inail_pct" | "tfr_pct" | "extra_costs" | "annual_hours">) =>
  Math.max(0, d.hourly_rate ?? 0) * NET_TO_COMPANY_MULTIPLIER;

/** Costo azienda per un'ora di straordinario (netto × 1,9). */
export const dipendenteOvertimeHourlyCost = (
  _d: Pick<Dipendente, "inps_pct" | "inail_pct" | "tfr_pct">,
) => OVERTIME_EXTRA_HOURLY * NET_TO_COMPANY_MULTIPLIER;

/** Costo azienda per il bonus trasferta giornaliero (netto × 1,9). */
export const dipendenteTrasfertaDailyCost = (
  _d: Pick<Dipendente, "inps_pct" | "inail_pct" | "tfr_pct">,
) => TRASFERTA_DAILY_EXTRA * NET_TO_COMPANY_MULTIPLIER;



export type RateChange = { from: string; rate: number };

/** Paga oraria valida in una data (YYYY-MM-DD) secondo lo storico; se manca lo storico usa la paga attuale. */
export const rateAt = (d: { hourly_rate?: number | null; rate_history?: unknown } | undefined, date: string): number => {
  if (!d) return 0;
  const hist = (Array.isArray(d.rate_history) ? d.rate_history : []) as RateChange[];
  const valid = hist.filter((h) => h && typeof h.from === "string" && h.from <= date).sort((a, b) => a.from.localeCompare(b.from));
  if (valid.length) return Number(valid[valid.length - 1].rate) || 0;
  if (hist.length) {
    // data precedente a tutto lo storico: usa la prima paga registrata
    const first = [...hist].sort((a, b) => a.from.localeCompare(b.from))[0];
    return Number(first.rate) || 0;
  }
  return Number(d.hourly_rate) || 0;
};

/** Registra un cambio paga dalla data indicata, conservando la paga precedente per il passato. */
export const applyRateChange = (oldRate: number, history: unknown, from: string, newRate: number): RateChange[] => {
  let hist = (Array.isArray(history) ? history : []) as RateChange[];
  if (hist.length === 0) hist = [{ from: "2000-01-01", rate: oldRate }];
  hist = hist.filter((h) => h.from !== from);
  hist.push({ from, rate: newRate });
  return hist.sort((a, b) => a.from.localeCompare(b.from));
};
