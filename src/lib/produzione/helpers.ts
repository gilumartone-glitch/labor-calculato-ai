import { supabase } from "@/integrations/supabase/client";
import { ProdOrder, ProdSubOrder, isNotifType, PROD_NOTIF_TYPES } from "./types";

export type FlowLaunchStep =
  | "creazione_commessa"
  | "creazione_ordine"
  | "creazione_acquisti"
  | "creazione_lavorazione"
  | "creazione_pianificazione"
  | "assegnazione_flow"
  | "chiusura_draft"
  | "generico";

const FLOW_STEP_LABEL: Record<FlowLaunchStep, string> = {
  creazione_commessa: "creazione commessa Flow",
  creazione_ordine: "creazione ordine produzione",
  creazione_acquisti: "creazione sub-ordine Acquisti",
  creazione_lavorazione: "creazione lavorazione",
  creazione_pianificazione: "creazione pianificazione",
  assegnazione_flow: "assegnazione operatori Flow",
  chiusura_draft: "chiusura scheda progetto",
  generico: "invio al Flow",
};

export class FlowLaunchError extends Error {
  step: FlowLaunchStep;
  table?: string;
  code?: string;
  details?: string;
  hint?: string;
  raw: unknown;

  constructor(step: FlowLaunchStep, table: string | undefined, raw: any) {
    const message = raw?.message ? String(raw.message) : String(raw ?? "Errore sconosciuto");
    super(message);
    this.name = "FlowLaunchError";
    this.step = step;
    this.table = table;
    this.code = raw?.code ? String(raw.code) : undefined;
    this.details = raw?.details ? String(raw.details) : undefined;
    this.hint = raw?.hint ? String(raw.hint) : undefined;
    this.raw = raw;
  }
}

export function throwFlowError(step: FlowLaunchStep, table: string, error: unknown): never {
  throw new FlowLaunchError(step, table, error);
}

export function describeFlowLaunchError(error: unknown): { title: string; description: string } {
  if (error instanceof FlowLaunchError) {
    const parts = [
      `Fase: ${FLOW_STEP_LABEL[error.step]}`,
      error.table ? `Tabella: ${error.table}` : null,
      error.code ? `Codice: ${error.code}` : null,
      error.message ? `Messaggio: ${error.message}` : null,
      error.details ? `Dettagli: ${error.details}` : null,
      error.hint ? `Suggerimento: ${error.hint}` : null,
    ].filter(Boolean);
    return { title: `Errore invio al Flow`, description: parts.join(" · ") };
  }
  const msg = error instanceof Error ? error.message : String(error ?? "Errore sconosciuto");
  return { title: "Errore invio al Flow", description: msg };
}

export async function readFlowLaunchDebug() {
  const { data, error } = await (supabase as any).rpc("debug_flow_launch_permissions", {});
  if (error) return { debugError: error.message };
  return data;
}

/** Genera un codice ordine ORD-YYYY-### incrementale per anno corrente.
 *  Usa una funzione SECURITY DEFINER per leggere TUTTI gli ordini, anche quelli
 *  non visibili all'utente corrente per via delle policy RLS (evita collisioni). */
export async function nextOrderCode(): Promise<string> {
  const { data, error } = await supabase.rpc("next_production_order_code");
  if (!error && typeof data === "string" && data.length > 0) return data;
  // Fallback: leggi quello visibile
  const year = new Date().getFullYear();
  const prefix = `ORD-${year}-`;
  const { data: rows } = await supabase
    .from("production_orders")
    .select("code")
    .like("code", `${prefix}%`)
    .order("code", { ascending: false })
    .limit(1);
  let n = 1;
  if (rows && rows[0]?.code) {
    const m = rows[0].code.match(/-(\d+)$/);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(n).padStart(3, "0")}`;
}

/** Genera codice sub-ordine: SOD-014-T (taglio), -S, -P, -A, -X */
export function subCode(orderCode: string, suffix: string, idx: number): string {
  const m = orderCode.match(/(\d+)$/);
  const n = m ? m[1] : "000";
  return `SOD-${n}-${suffix}${idx > 1 ? idx : ""}`;
}

/** Scrive una entry nel log. Best-effort: errori loggati ma non lanciati. */
export async function logAction(opts: {
  action: string;
  entity_type: string;
  entity_id?: string | null;
  detail?: string;
  prev_state?: any;
  new_state?: any;
}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.rpc("log_audit_action", {
    _action: opts.action,
    _entity_type: opts.entity_type,
    _entity_id: opts.entity_id ?? null,
    _detail: opts.detail ?? null,
    _prev_state: opts.prev_state ?? null,
    _new_state: opts.new_state ?? null,
  } as any);
}

/** Crea notifica per uno o più utenti. */
export async function notify(opts: {
  userIds: string[];
  type: import("./types").NotifType;
  message: string;
  order_id?: string | null;
  link?: string;
  is_urgent?: boolean;
}) {
  if (!opts.userIds.length) return;
  if (!isNotifType(opts.type)) {
    console.error(
      `[notify] tipo notifica non valido: "${opts.type}". Valori ammessi: ${PROD_NOTIF_TYPES.join(", ")}`
    );
    return;
  }
  const rows = opts.userIds.map((uid) => ({
    user_id: uid,
    type: opts.type,
    message: opts.message,
    order_id: opts.order_id ?? null,
    link: opts.link ?? null,
    is_urgent: opts.is_urgent ?? false,
  }));
  const { error } = await supabase.from("prod_notifications").insert(rows);
  if (error) {
    console.error("[notify] insert prod_notifications failed:", error.message, { type: opts.type, userIds: opts.userIds, order_id: opts.order_id });
  }
}

/** Calcola percentuale completamento di un ordine in base ai sub-ordini. */
export function orderProgress(subs: ProdSubOrder[]): number {
  if (!subs.length) return 0;
  const done = subs.filter((s) => s.status === "completato").length;
  return Math.round((done / subs.length) * 100);
}

/** Restituisce gli utenti che hanno permessi di scrittura sulla pagina produzione.
 *  Se viene passato `depts`, filtra solo gli utenti il cui profilo ha almeno
 *  uno dei settori richiesti (così non spammiamo notifiche cross-reparto).
 *  Gli admin sono sempre inclusi. */
export async function getProduzioneWriters(depts?: string[]): Promise<string[]> {
  const { data } = await supabase
    .from("user_permissions")
    .select("user_id")
    .eq("page_key", "produzione")
    .eq("level", "write");
  const writerIds = (data ?? []).map((r: any) => r.user_id);
  if (!depts || depts.length === 0 || writerIds.length === 0) return writerIds;

  const [{ data: profs }, { data: admins }] = await Promise.all([
    supabase.from("profiles").select("id, settori").in("id", writerIds),
    (supabase as any).rpc("get_admin_user_ids"),
  ]);
  const adminSet = new Set(((admins ?? []) as any[]).map((r: any) => (typeof r === "string" ? r : r.user_id ?? r)));
  const deptSet = new Set(depts);
  return (profs ?? [])
    .filter((p: any) => adminSet.has(p.id) || ((p.settori ?? []) as string[]).some((s) => deptSet.has(s)))
    .map((p: any) => p.id);
}

/** Tutti gli admin. */
export async function getAdmins(): Promise<string[]> {
  const { data } = await (supabase as any).rpc("get_admin_user_ids");
  return ((data ?? []) as any[]).map((r: any) => (typeof r === "string" ? r : r.user_id ?? r));
}

/** Utenti con il settore "magazzino" assegnato nel profilo. */
export async function getMagazzinoUsers(): Promise<string[]> {
  const { data } = await supabase
    .from("profiles")
    .select("id, settori")
    .contains("settori", ["magazzino"]);
  return (data ?? []).map((r: any) => r.id);
}