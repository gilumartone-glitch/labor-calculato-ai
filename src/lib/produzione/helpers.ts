import { supabase } from "@/integrations/supabase/client";
import { ProdOrder, ProdSubOrder } from "./types";

/** Genera un codice ordine ORD-YYYY-### incrementale per anno corrente. */
export async function nextOrderCode(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `ORD-${year}-`;
  const { data } = await supabase
    .from("production_orders")
    .select("code")
    .like("code", `${prefix}%`)
    .order("code", { ascending: false })
    .limit(1);
  let n = 1;
  if (data && data[0]?.code) {
    const m = data[0].code.match(/-(\d+)$/);
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
  await supabase.from("audit_log").insert({
    user_id: user.id,
    action: opts.action,
    entity_type: opts.entity_type,
    entity_id: opts.entity_id ?? null,
    detail: opts.detail ?? null,
    prev_state: opts.prev_state ?? null,
    new_state: opts.new_state ?? null,
  });
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
  const rows = opts.userIds.map((uid) => ({
    user_id: uid,
    type: opts.type,
    message: opts.message,
    order_id: opts.order_id ?? null,
    link: opts.link ?? null,
    is_urgent: opts.is_urgent ?? false,
  }));
  await supabase.from("prod_notifications").insert(rows);
}

/** Calcola percentuale completamento di un ordine in base ai sub-ordini. */
export function orderProgress(subs: ProdSubOrder[]): number {
  if (!subs.length) return 0;
  const done = subs.filter((s) => s.status === "completato").length;
  return Math.round((done / subs.length) * 100);
}

/** Restituisce gli utenti che hanno permessi di scrittura sulla pagina produzione. */
export async function getProduzioneWriters(): Promise<string[]> {
  const { data } = await supabase
    .from("user_permissions")
    .select("user_id")
    .eq("page_key", "produzione")
    .eq("level", "write");
  return (data ?? []).map((r: any) => r.user_id);
}

/** Tutti gli admin. */
export async function getAdmins(): Promise<string[]> {
  const { data } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
  return (data ?? []).map((r: any) => r.user_id);
}

/** Utenti con il settore "magazzino" assegnato nel profilo. */
export async function getMagazzinoUsers(): Promise<string[]> {
  const { data } = await supabase
    .from("profiles")
    .select("id, settori")
    .contains("settori", ["magazzino"]);
  return (data ?? []).map((r: any) => r.id);
}