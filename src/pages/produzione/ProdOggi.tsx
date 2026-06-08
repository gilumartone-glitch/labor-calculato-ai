import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, ArrowLeft, ClipboardList, HardHat, AlertTriangle } from "lucide-react";
import { ProdLayout } from "@/components/produzione/ProdLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DEPT_LABEL } from "@/lib/produzione/types";
import { urgencyBadge } from "@/lib/urgency";
import { Button } from "@/components/ui/button";

type Sub = {
  id: string;
  code: string;
  dept: string;
  status: string;
  order_id: string;
  due_date: string | null;
  assignee_id: string | null;
  start_date: string | null;
  end_date: string | null;
};

type Order = {
  id: string;
  code: string;
  cliente: string;
  status: string;
  source_commessa_id: string | null;
};

type Plan = {
  id: string;
  date: string;
  hours: number;
  cantiere_label: string;
  reparto: string;
  notes: string | null;
  operator_id: string;
};

type Profile = { id: string; display_name: string | null };

const todayIso = () => {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
};

const fmtDay = (iso: string | null) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short" }); }
  catch { return iso; }
};

export default function ProdOggi() {
  const { user } = useAuth();
  const [subs, setSubs] = useState<Sub[]>([]);
  const [orders, setOrders] = useState<Record<string, Order>>({});
  const [deadlines, setDeadlines] = useState<Record<string, string | null>>({});
  const [plans, setPlans] = useState<Plan[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<"mine" | "all">("mine");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const today = todayIso();

      // Sub-ordini ancora aperti con scadenza fino a oggi, OPPURE in lavorazione (devono finire)
      const subsQ = await supabase
        .from("production_sub_orders")
        .select("id, code, dept, status, order_id, due_date, assignee_id, start_date, end_date")
        .not("status", "in", "(completato,annullato)")
        .order("due_date", { ascending: true })
        .limit(500);

      const allSubs = (subsQ.data ?? []) as Sub[];

      const orderIds = Array.from(new Set(allSubs.map((s) => s.order_id)));
      const ordersQ = orderIds.length
        ? await supabase
            .from("production_orders")
            .select("id, code, cliente, status, source_commessa_id")
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

      // Pianificazione di oggi (tutti i reparti)
      const planQ = await supabase
        .from("montaggi_planning")
        .select("id, date, hours, cantiere_label, reparto, notes, operator_id")
        .eq("date", today)
        .order("start_time", { ascending: true, nullsFirst: false });

      const planList = (planQ.data ?? []) as Plan[];

      const userIds = Array.from(new Set([
        ...allSubs.map((s) => s.assignee_id).filter((x): x is string => !!x),
        ...planList.map((p) => p.operator_id).filter((x): x is string => /^[0-9a-f-]{36}$/i.test(x)),
      ]));
      const profQ = userIds.length
        ? await supabase.from("profiles").select("id, display_name").in("id", userIds)
        : { data: [] as Profile[] };
      const profMap: Record<string, Profile> = {};
      for (const p of (profQ.data ?? []) as Profile[]) profMap[p.id] = p;

      if (cancelled) return;
      setSubs(allSubs);
      setOrders(orderMap);
      setDeadlines(dlMap);
      setPlans(planList);
      setProfiles(profMap);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Filtra sub-ordini "da fare oggi": in lavorazione, oppure due_date <= today,
  // oppure deadline commessa <= today
  const todaySubs = useMemo(() => {
    const today = todayIso();
    return subs.filter((s) => {
      const dl = s.due_date ?? deadlines[orders[s.order_id]?.source_commessa_id ?? ""] ?? null;
      const isOverdueOrToday = dl ? dl <= today : false;
      const inProgress = s.status === "in_lavorazione";
      const startedToday = s.start_date && s.start_date <= today && (!s.end_date || s.end_date >= today);
      return isOverdueOrToday || inProgress || startedToday;
    });
  }, [subs, deadlines, orders]);

  const filteredSubs = useMemo(() => {
    if (scope === "all") return todaySubs;
    return todaySubs.filter((s) => s.assignee_id === user?.id);
  }, [todaySubs, scope, user]);

  const filteredPlans = useMemo(() => {
    if (scope === "all") return plans;
    return plans.filter((p) => p.operator_id === user?.id);
  }, [plans, scope, user]);

  // Raggruppa sub per stato di urgenza
  const groups = useMemo(() => {
    const today = todayIso();
    const overdue: Sub[] = [];
    const oggi: Sub[] = [];
    const inLavoro: Sub[] = [];
    for (const s of filteredSubs) {
      const dl = s.due_date ?? deadlines[orders[s.order_id]?.source_commessa_id ?? ""] ?? null;
      if (dl && dl < today) overdue.push(s);
      else if (dl === today) oggi.push(s);
      else inLavoro.push(s);
    }
    return { overdue, oggi, inLavoro };
  }, [filteredSubs, deadlines, orders]);

  const renderSub = (s: Sub) => {
    const o = orders[s.order_id];
    const dl = s.due_date ?? deadlines[o?.source_commessa_id ?? ""] ?? null;
    const u = urgencyBadge(dl, { done: false });
    const assignee = s.assignee_id ? profiles[s.assignee_id]?.display_name : null;
    return (
      <Link
        key={s.id}
        to={`/produzione/board?sub=${s.id}`}
        className="block border-2 border-ink/15 rounded-sm p-3 hover:border-primary hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-xs font-bold bg-ink text-paper px-1.5 py-0.5 rounded-sm">{s.code}</span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-primary">
              {DEPT_LABEL[s.dept as keyof typeof DEPT_LABEL] ?? s.dept}
            </span>
          </div>
          {u && (
            <span className={`text-[10px] font-mono uppercase font-bold px-1.5 py-0.5 rounded-sm border-2 ${u.cls}`}>
              {u.label}
            </span>
          )}
        </div>
        <div className="text-sm font-semibold truncate">{o?.cliente ?? "—"}</div>
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground mt-1">
          <span className="font-mono uppercase tracking-wider">{s.status}</span>
          <span>{assignee ? `→ ${assignee}` : <span className="italic">non assegnato</span>}</span>
        </div>
      </Link>
    );
  };

  return (
    <ProdLayout>
      <div className="p-3 sm:p-6 space-y-4 max-w-5xl mx-auto">
        <div className="flex items-start sm:items-center justify-between flex-wrap gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-primary">// Produzione</div>
            <h1 className="font-display text-2xl font-semibold flex items-center gap-2">
              <CalendarClock className="w-6 h-6 text-primary" />
              Da fare oggi
            </h1>
            <div className="text-[11px] text-muted-foreground mt-1">
              {new Date().toLocaleDateString("it-IT", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex border-2 border-ink/20 rounded-sm overflow-hidden">
              <button
                type="button"
                onClick={() => setScope("mine")}
                className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider ${scope === "mine" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
              >
                Le mie
              </button>
              <button
                type="button"
                onClick={() => setScope("all")}
                className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider border-l-2 border-ink/20 ${scope === "all" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
              >
                Tutte
              </button>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/produzione/board"><ArrowLeft className="w-3.5 h-3.5 mr-1" /> Board</Link>
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Caricamento…</div>
        ) : (
          <>
            {/* IN RITARDO */}
            {groups.overdue.length > 0 && (
              <section className="border-2 border-destructive bg-destructive/5 rounded-sm p-3">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-destructive" />
                  <h2 className="font-display text-base font-bold text-destructive uppercase tracking-wider">
                    In ritardo · {groups.overdue.length}
                  </h2>
                </div>
                <div className="grid gap-2 md:grid-cols-2">{groups.overdue.map(renderSub)}</div>
              </section>
            )}

            {/* OGGI */}
            <section className="border-2 border-ink/20 rounded-sm p-3">
              <div className="flex items-center gap-2 mb-3">
                <ClipboardList className="w-4 h-4 text-primary" />
                <h2 className="font-display text-base font-bold uppercase tracking-wider">
                  Lavorazioni di oggi · {groups.oggi.length + groups.inLavoro.length}
                </h2>
              </div>
              {groups.oggi.length === 0 && groups.inLavoro.length === 0 ? (
                <div className="text-sm text-muted-foreground italic">Nessuna lavorazione attiva.</div>
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  {[...groups.oggi, ...groups.inLavoro].map(renderSub)}
                </div>
              )}
            </section>

            {/* PIANIFICAZIONE */}
            <section className="border-2 border-ink/20 rounded-sm p-3">
              <div className="flex items-center gap-2 mb-3">
                <HardHat className="w-4 h-4 text-primary" />
                <h2 className="font-display text-base font-bold uppercase tracking-wider">
                  Pianificazione oggi · {filteredPlans.length}
                </h2>
              </div>
              {filteredPlans.length === 0 ? (
                <div className="text-sm text-muted-foreground italic">Nessun turno pianificato.</div>
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  {filteredPlans.map((p) => {
                    const op = profiles[p.operator_id]?.display_name ?? p.operator_id;
                    return (
                      <Link
                        key={p.id}
                        to="/montaggi-pianificazione"
                        className="block border-2 border-ink/15 rounded-sm p-3 hover:border-primary hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="font-bold truncate">{p.cantiere_label || "Senza cantiere"}</span>
                          <span className="text-[10px] font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded-sm shrink-0">
                            {p.hours}h
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span className="font-mono uppercase tracking-wider">{p.reparto}</span>
                          <span>→ {op}</span>
                        </div>
                        {p.notes && (
                          <div className="text-[11px] mt-1 italic line-clamp-2">{p.notes}</div>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </ProdLayout>
  );
}
