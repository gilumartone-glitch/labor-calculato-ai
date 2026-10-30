export const BANK_SYNC_TIMES = ["08:30", "15:00"];
export function bankScheduleSlot(now = new Date()) {
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  return BANK_SYNC_TIMES.includes(time);
}
export async function authorizeBankSync(req: Request, client: any, admin: any, token: string | undefined) {
  let body: unknown;
  try { body = await req.json(); } catch { return { error: "Richiesta non valida.", status: 400 }; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Richiesta non valida.", status: 400 };
  const keys = Object.keys(body);
  const scheduled = keys.length === 1 && "action" in body && body.action === "scheduled";
  if (keys.length && !scheduled) return { error: "Richiesta non valida.", status: 400 };
  if (scheduled) {
    if (!token || req.headers.get("x-bank-schedule-token") !== token) return { error: "Non autorizzato.", status: 401 };
    const [{ data: config, error: configError }, { data: settings, error: settingsError }] = await Promise.all([
      admin.from("bank_schedule_config").select("enabled").eq("id", true).maybeSingle(),
      admin.from("bank_provider_settings").select("sync_enabled,provider,costs_verified,monthly_cost_eur,commercial_evidence").eq("id", true).maybeSingle(),
    ]);
    if (configError || settingsError || !config?.enabled || !settings?.sync_enabled || settings.provider !== "open_banking_io" || !settings.costs_verified || settings.monthly_cost_eur == null || !settings.commercial_evidence?.trim()) return { error: "Aggiornamenti automatici non autorizzati.", status: 403 };
    return { actor: null, scheduled: true };
  }
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { error: "Accedi per sincronizzare i movimenti.", status: 401 };
  const { data: allowed, error } = await client.rpc("can_reconcile_bank", { _uid: user.id });
  if (error || !allowed) return { error: "Non autorizzato.", status: 403 };
  return { actor: user.id, scheduled: false };
}