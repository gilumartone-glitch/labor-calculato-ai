import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, ArrowLeft, ArrowRight, User, AlertTriangle, ListChecks } from "lucide-react";
import { ProdLayout } from "@/components/produzione/ProdLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AdminTask, useAdminTasks } from "@/hooks/useAdminTasks";
import { DEPT_LABEL, DEPT_COLOR, SUB_STATUS_LABEL, ProdDept, ProdSubStatus } from "@/lib/produzione/types";
import { urgencyBadge } from "@/lib/urgency";
import { Button } from "@/components/ui/button";
import { userColor } from "@/lib/user-color";
import { TASK_CATEGORY_META, TASK_PRIORITY_META, TASK_STATUS_LABEL } from "@/lib/tasks/constants";

type Sub = {
  id: string;
  code: string;
  dept: ProdDept;
  status: ProdSubStatus;
  order_id: string;
  due_date: string | null;
  assignee_id: string | null;
  operator_ids: string[] | null;
  coordinator_id: string | null;
  start_date: string | null;
  end_date: string | null;
};

type Order = {
  id: string;
  code: string;
  cliente: string;
  status: string;
  source_commessa_id: string | null;
  coordinator_id: string | null;
  created_by: string | null;
};

type Profile = { id: string; display_name: string | null };

type Activity =
  | { kind: "sub"; id: string; date: string | null; sub: Sub }
  | { kind: "task"; id: string; date: string | null; task: AdminTask };

const todayIso = () => {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
};

const isoOf = (d: Date) => {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
};

// Lunedì della settimana di `d` (giorni in formato ISO it: lun=primo)
const mondayOf = (d: Date) => {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7; // 0=lun ... 6=dom
  x.setDate(x.getDate() - dow);
  return x;
};

const WEEKDAYS = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];


export default function ProdOggi() {
  const { user } = useAuth();
  const { tasks, loading: tasksLoading } = useAdminTasks();
  const [subs, setSubs] = useState<Sub[]>([]);
  const [orders, setOrders] = useState<Record<string, Order>>({});
  const [deadlines, setDeadlines] = useState<Record<string, string | null>>({});
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);

  const loadAssignedWork = useCallback(async (showLoading = true) => {
    if (!user) {
      setSubs([]);
      setOrders({});
      setDeadlines({});
      setProfiles({});
      setLoading(false);
      return;
    }

    if (showLoading) setLoading(true);

    // 1) Sub-ordini dove sono operatore (assignee, in operator_ids, o coordinator del sub)
    const subsOperatorQ = await supabase
      .from("production_sub_orders")
      .select("id, code, dept, status, order_id, due_date, assignee_id, operator_ids, coordinator_id, start_date, end_date")
      .or(`assignee_id.eq.${user.id},operator_ids.cs.{${user.id}},coordinator_id.eq.${user.id}`)
      .neq("status", "completato")
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(500);

    // 2) Ordini di cui sono responsabile (coordinator o creator) → fetch tutti i loro sub
    const myOrdersQ = await supabase
      .from("production_orders")
      .select("id, code, cliente, status, source_commessa_id, coordinator_id, created_by")
      .or(`coordinator_id.eq.${user.id},created_by.eq.${user.id}`)
      .limit(500);
    const coordOrderIds = (myOrdersQ.data ?? []).map((o: any) => o.id);
    const subsCoordQ = coordOrderIds.length
      ? await supabase
          .from("production_sub_orders")
          .select("id, code, dept, status, order_id, due_date, assignee_id, operator_ids, coordinator_id, start_date, end_date")
          .in("order_id", coordOrderIds)
          .neq("status", "completato")
          .limit(500)
      : { data: [] as Sub[] };

    // Merge: dedup by id, prefer "operator" role (visto direttamente) altrimenti "coordinator"
    const map = new Map<string, Sub>();
    for (const s of (subsOperatorQ.data ?? []) as Sub[]) map.set(s.id, s);
    for (const s of (subsCoordQ.data ?? []) as Sub[]) if (!map.has(s.id)) map.set(s.id, s);
    const allSubs = Array.from(map.values());

    const orderIds = Array.from(new Set(allSubs.map((s) => s.order_id)));
    const ordersQ = orderIds.length
      ? await supabase
          .from("production_orders")
          .select("id, code, cliente, status, source_commessa_id, coordinator_id, created_by")
          .in("id", orderIds)
      : { data: [] as Order[] };

    const orderMap: Record<string, Order> = {};
    for (const o of (ordersQ.data ?? []) as Order[]) orderMap[o.id] = o;

    const commIds = Array.from(new Set(
      Object.values(orderMap).map((o) => o.source_commessa_id).filter((x): x is string => !!x)
    ));
    const commQ = commIds.length
      ? await supabase.from("commesse").select("id, data_scadenza").in("id", commIds)
      : { data: [] as { id: string; data_scadenza: string | null }[] };
    const dlMap: Record<string, string | null> = {};
    for (const c of (commQ.data ?? []) as { id: string; data_scadenza: string | null }[]) dlMap[c.id] = c.data_scadenza;

    // Carica i profili degli assegnatari per mostrare i nomi
    const assigneeIds = Array.from(new Set(allSubs.map((s) => s.assignee_id).filter((x): x is string => !!x)));
    const profMap: Record<string, Profile> = {};
    if (assigneeIds.length > 0) {
      const profsQ = await supabase.from("profiles").select("id, display_name").in("id", assigneeIds);
      for (const p of (profsQ.data ?? []) as Profile[]) profMap[p.id] = p;
    }

    setSubs(allSubs);
    setOrders(orderMap);
    setDeadlines(dlMap);
    setProfiles(profMap);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    const reload = (showLoading = false) => {
      if (!cancelled) void loadAssignedWork(showLoading);
    };
    const reloadWhenVisible = () => {
      if (document.visibilityState === "visible") reload(false);
    };
    const reloadOnFocus = () => reload(false);

    reload(true);

    if (!user) return () => { cancelled = true; };

    const ch = supabase
      .channel(`prod_oggi_rt_${user.id}_${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "production_sub_orders" }, () => reload(false))
      .on("postgres_changes", { event: "*", schema: "public", table: "production_orders" }, () => reload(false))
      .on("postgres_changes", { event: "*", schema: "public", table: "commesse" }, () => reload(false))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "prod_notifications", filter: `user_id=eq.${user.id}` }, () => reload(false))
      .subscribe();

    window.addEventListener("focus", reloadOnFocus);
    document.addEventListener("visibilitychange", reloadWhenVisible);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", reloadOnFocus);
      document.removeEventListener("visibilitychange", reloadWhenVisible);
      supabase.removeChannel(ch);
    };
  }, [user, loadAssignedWork]);

  // Calcola data effettiva per ciascun sub: nelle "Mie Attività" conta prima l'inizio lavorazione,
  // poi la consegna. Così un lavoro assegnato oggi non resta nascosto solo perché consegna la settimana dopo.
  const subDate = (s: Sub): string | null =>
    s.start_date ?? s.due_date ?? s.end_date ?? deadlines[orders[s.order_id]?.source_commessa_id ?? ""] ?? null;

  const taskDate = (t: AdminTask): string | null => {
    const raw = t.start_at ?? t.due_at;
    return raw ? raw.slice(0, 10) : null;
  };

  const myTasks = useMemo(() => {
    if (!user) return [];
    return tasks.filter((t) => {
      if (t.status === "completato" || t.status === "annullato") return false;
      return t.responsible_id === user.id || (t.assignee_ids ?? []).includes(user.id);
    });
  }, [tasks, user]);

  // Settimana corrente navigabile (lun → dom)
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);
  const weekStartIso = isoOf(weekDays[0]);
  const weekEndIso = isoOf(weekDays[6]);

  const activities = useMemo<Activity[]>(() => {
    const subActivities: Activity[] = subs.map((sub) => ({ kind: "sub", id: sub.id, date: subDate(sub), sub }));
    const taskActivities: Activity[] = myTasks.map((task) => ({ kind: "task", id: task.id, date: taskDate(task), task }));
    return [...subActivities, ...taskActivities];
  }, [subs, myTasks, orders, deadlines]);

  // Raggruppa per giorno della settimana corrente + in ritardo + successivi
  const { byDay, overdue, future, undated } = useMemo(() => {
    const today = todayIso();
    const byDay: Record<string, Activity[]> = {};
    for (const d of weekDays) byDay[isoOf(d)] = [];
    const overdue: Activity[] = [];
    const future: Activity[] = [];
    const undated: Activity[] = [];
    for (const activity of activities) {
      const dl = activity.date;
      if (!dl) { undated.push(activity); continue; }
      if (dl < today && dl < weekStartIso) { overdue.push(activity); continue; }
      if (dl >= weekStartIso && dl <= weekEndIso) {
        // Sub in ritardo ma all'interno della settimana: mostrali nel giorno
        if (byDay[dl]) byDay[dl].push(activity);
        else overdue.push(activity);
      } else if (dl > weekEndIso) {
        future.push(activity);
      } else {
        overdue.push(activity);
      }
    }
    return { byDay, overdue, future, undated };
  }, [activities, weekDays, weekStartIso, weekEndIso]);

  // L'utente è OPERATORE di questa lavorazione, o solo RESPONSABILE?
  const myRole = (s: Sub): "operator" | "coordinator" => {
    if (!user) return "operator";
    if (s.assignee_id === user.id) return "operator";
    if ((s.operator_ids ?? []).includes(user.id)) return "operator";
    return "coordinator";
  };

  const renderSubCard = (s: Sub) => {
    const o = orders[s.order_id];
    const dl = subDate(s);
    const u = urgencyBadge(dl, { done: false });
    const dc = DEPT_COLOR[s.dept];
    const assignee = s.assignee_id ? profiles[s.assignee_id]?.display_name : null;
    const uc = userColor(s.assignee_id);
    const role = myRole(s);
    const isCoord = role === "coordinator";
    const statusBg =
      s.status === "in_lavorazione" ? "bg-blue-50 border-blue-300" :
      s.status === "completato" ? "bg-emerald-50 border-emerald-300" :
      s.status === "rimandato" ? "bg-orange-50 border-orange-300" :
      s.status === "bloccato" ? "bg-destructive/10 border-destructive/40" :
      "bg-muted/40 border-ink/15";
    return (
      <Link
        key={s.id}
        to={`/produzione/board?sub=${s.id}`}
        className={`block border rounded-sm overflow-hidden transition-colors hover:brightness-95 ${statusBg} ${isCoord ? "ring-2 ring-amber-400/60" : ""}`}
        title={isCoord ? "Sei il responsabile di questa lavorazione (non l'operatore)" : "Apri dettaglio lavorazione"}
      >
        <div className={`${dc.chip} px-3 py-2 xl:px-2 xl:py-1.5 flex items-center gap-2 xl:gap-1.5`}>
          <span className="text-lg xl:text-base leading-none" aria-hidden>{dc.emoji}</span>
          <span className="font-display font-extrabold uppercase tracking-wide text-[14px] xl:text-[12px] leading-none truncate">
            {DEPT_LABEL[s.dept]}
          </span>
          {isCoord && (
            <span className="ml-1 text-[9px] xl:text-[8px] font-mono uppercase font-bold px-1.5 py-0.5 rounded-sm bg-amber-400 text-ink border border-amber-500" title="Sei responsabile, non operatore">
              Responsabile
            </span>
          )}
          {u && (
            <span className={`ml-auto text-[10px] xl:text-[9px] font-mono uppercase font-bold px-1.5 py-0.5 rounded-sm border ${u.cls}`}>
              {u.label}
            </span>
          )}
        </div>
        <div className="p-2.5 xl:p-1.5 space-y-2 xl:space-y-1.5">
          {/* Cliente: info essenziale, prominente su mobile */}
          <div className="text-[17px] xl:text-[13px] font-bold leading-tight line-clamp-2 xl:truncate">
            {o?.cliente ?? "—"}
          </div>
          {/* Assegnatario con colore univoco */}
          <div
            className="flex items-center gap-1.5 text-[15px] xl:text-[13px] font-bold rounded-sm px-2 py-1.5 xl:px-1.5 xl:py-1 border"
            style={s.assignee_id ? { backgroundColor: uc.bg, color: uc.fg, borderColor: uc.border } : undefined}
          >
            <User className="w-4 h-4 xl:w-3.5 xl:h-3.5 shrink-0" />
            <span className="truncate">{assignee ?? "Non assegnato"}</span>
          </div>
          {/* Codice + stato: dettagli secondari */}
          <div className="flex items-center justify-between gap-1.5 pt-0.5">
            <span className="font-mono text-[11px] xl:text-[10px] font-bold bg-ink text-paper px-1.5 py-0.5 rounded-sm">{s.code}</span>
            <span className="text-[11px] xl:text-[10px] font-mono uppercase tracking-wider text-ink/70 truncate">{SUB_STATUS_LABEL[s.status]}</span>
          </div>
        </div>
      </Link>
    );
  };

  const renderTaskCard = (t: AdminTask) => {
    const M = TASK_CATEGORY_META[t.category];
    const Icon = M.icon;
    const prio = TASK_PRIORITY_META[t.priority];
    const dl = taskDate(t);
    const u = urgencyBadge(dl, { done: false });
    return (
      <Link
        key={t.id}
        to={`/produzione/tasks?task=${t.id}`}
        className="block border rounded-sm overflow-hidden transition-colors hover:brightness-95 bg-paper border-ink/20"
        title="Apri dettaglio task"
      >
        <div className="bg-primary/10 px-3 py-2 xl:px-2 xl:py-1.5 flex items-center gap-2 xl:gap-1.5 border-b border-ink/10">
          <ListChecks className="w-4 h-4 shrink-0 text-primary" />
          <span className="font-display font-extrabold uppercase tracking-wide text-[14px] xl:text-[12px] leading-none truncate">
            Task
          </span>
          {u && (
            <span className={`ml-auto text-[10px] xl:text-[9px] font-mono uppercase font-bold px-1.5 py-0.5 rounded-sm border ${u.cls}`}>
              {u.label}
            </span>
          )}
        </div>
        <div className="p-2.5 xl:p-1.5 space-y-2 xl:space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className={`inline-flex items-center gap-1 text-[11px] xl:text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${M.bg} ${M.color}`}>
              <Icon className="w-3.5 h-3.5" />{M.label}
            </div>
            <span className={`text-[11px] xl:text-[10px] py-0 px-1.5 border rounded ${prio.className}`}>{prio.label}</span>
          </div>
          <div className="text-[17px] xl:text-[13px] font-bold leading-tight line-clamp-2">
            {t.title}
          </div>
          {t.description && <div className="text-[13px] xl:text-[11px] text-muted-foreground line-clamp-2">{t.description}</div>}
          <div className="flex items-center justify-between gap-1.5 pt-0.5">
            <span className="font-mono text-[11px] xl:text-[10px] font-bold bg-ink text-paper px-1.5 py-0.5 rounded-sm">
              {TASK_STATUS_LABEL[t.status]}
            </span>
            {dl && <span className="text-[11px] xl:text-[10px] font-mono uppercase tracking-wider text-ink/70 truncate">{new Date(dl).toLocaleDateString("it-IT")}</span>}
          </div>
        </div>
      </Link>
    );
  };

  const renderActivity = (activity: Activity) =>
    activity.kind === "sub" ? renderSubCard(activity.sub) : renderTaskCard(activity.task);


  const goPrevWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(d); };
  const goNextWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(d); };
  const goThisWeek = () => setWeekStart(mondayOf(new Date()));

  const weekRangeLabel = `${weekDays[0].toLocaleDateString("it-IT", { day: "2-digit", month: "short" })} – ${weekDays[6].toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })}`;
  const today = todayIso();

  return (
    <ProdLayout>
      <div className="p-3 sm:p-6 space-y-4 w-full">
        <div className="flex items-start sm:items-center justify-between flex-wrap gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-primary">// Produzione</div>
            <h1 className="font-display text-2xl font-semibold flex items-center gap-2">
              <CalendarClock className="w-6 h-6 text-primary" />
              Le mie Attività
            </h1>
            <div className="text-[11px] text-muted-foreground mt-1">
              Lavorazioni e task assegnati a te, divisi per giorno della settimana.
            </div>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/produzione/board"><ArrowLeft className="w-3.5 h-3.5 mr-1" /> Flow Board</Link>
          </Button>
        </div>

        {/* Selettore settimana */}
        <div className="flex items-center justify-between gap-2 flex-wrap border-2 border-ink/20 rounded-sm p-2 bg-background">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={goPrevWeek} aria-label="Settimana precedente">
              <ArrowLeft className="w-3.5 h-3.5" />
            </Button>
            <Button variant="outline" size="sm" onClick={goThisWeek}>Oggi</Button>
            <Button variant="outline" size="sm" onClick={goNextWeek} aria-label="Settimana successiva">
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>
          <div className="font-mono text-xs uppercase tracking-wider text-ink/70">{weekRangeLabel}</div>
        </div>

        {loading || tasksLoading ? (
          <div className="text-sm text-muted-foreground">Caricamento…</div>
        ) : (
          <>
            {/* IN RITARDO (fuori settimana) */}
            {overdue.length > 0 && (
              <section className="border-2 border-destructive bg-destructive/5 rounded-sm p-3">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-destructive" />
                  <h2 className="font-display text-base font-bold text-destructive uppercase tracking-wider">
                    In ritardo · {overdue.length}
                  </h2>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {overdue.map(renderActivity)}
                </div>
              </section>
            )}

            {/* SETTIMANA: 7 colonne giorni */}
            <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
              {weekDays.map((d, i) => {
                const iso = isoOf(d);
                const items = byDay[iso] ?? [];
                const isToday = iso === today;
                const isPast = iso < today;
                return (
                  <section
                    key={iso}
                    className={`border-2 rounded-sm p-2 flex flex-col min-h-[100px] xl:min-h-[calc(100vh-220px)] ${
                      items.length === 0 ? "hidden xl:flex" : ""
                    } ${
                      isToday ? "border-primary bg-primary/5" :
                      isPast ? "border-ink/15 bg-muted/30" :
                      "border-ink/20"
                    }`}
                  >
                    <div className="mb-2 pb-1.5 border-b border-ink/10">
                      <div className={`font-display text-sm font-extrabold uppercase tracking-wider ${isToday ? "text-primary" : ""}`}>
                        {WEEKDAYS[i]}
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {d.toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}
                        </div>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {items.length > 0 ? `${items.length}` : ""}
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2 flex-1">
                      {items.length === 0 ? (
                        <div className="text-[11px] text-muted-foreground italic text-center py-3">—</div>
                      ) : (
                        items.map(renderActivity)
                      )}
                    </div>
                  </section>
                );
              })}
            </div>

            {/* FUTURE oltre la settimana */}
            {future.length > 0 && (
              <section className="border-2 border-ink/20 rounded-sm p-3">
                <h2 className="font-display text-base font-bold uppercase tracking-wider mb-3">
                  Settimane successive · {future.length}
                </h2>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {future.map(renderActivity)}
                </div>
              </section>
            )}

            {/* SENZA DATA */}
            {undated.length > 0 && (
              <section className="border-2 border-dashed border-ink/20 rounded-sm p-3">
                <h2 className="font-display text-base font-bold uppercase tracking-wider mb-3">
                  Senza data · {undated.length}
                </h2>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {undated.map(renderActivity)}
                </div>
              </section>
            )}

            {activities.length === 0 && (
              <div className="border-2 border-dashed border-ink/20 rounded-sm p-8 text-center text-sm text-muted-foreground italic">
                Nessuna attività assegnata. Goditi la pausa.
              </div>
            )}
          </>
        )}
      </div>
    </ProdLayout>
  );

}
