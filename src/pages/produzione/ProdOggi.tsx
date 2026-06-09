import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, ArrowLeft, ArrowRight, User, AlertTriangle } from "lucide-react";
import { ProdLayout } from "@/components/produzione/ProdLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DEPT_LABEL, DEPT_COLOR, SUB_STATUS_LABEL, ProdDept, ProdSubStatus } from "@/lib/produzione/types";
import { urgencyBadge } from "@/lib/urgency";
import { Button } from "@/components/ui/button";
import { userColor } from "@/lib/user-color";

type Sub = {
  id: string;
  code: string;
  dept: ProdDept;
  status: ProdSubStatus;
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

type Profile = { id: string; display_name: string | null };

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
  const [subs, setSubs] = useState<Sub[]>([]);
  const [orders, setOrders] = useState<Record<string, Order>>({});
  const [deadlines, setDeadlines] = useState<Record<string, string | null>>({});
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);

      // Solo sub-ordini assegnati all'utente, ancora aperti
      const subsQ = await supabase
        .from("production_sub_orders")
        .select("id, code, dept, status, order_id, due_date, assignee_id, start_date, end_date")
        .eq("assignee_id", user.id)
        .not("status", "in", "(completato,annullato)")
        .order("due_date", { ascending: true, nullsFirst: false })
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

      const profMap: Record<string, Profile> = {};
      if (user.id) {
        const me = await supabase.from("profiles").select("id, display_name").eq("id", user.id).maybeSingle();
        if (me.data) profMap[me.data.id] = me.data as Profile;
      }

      if (cancelled) return;
      setSubs(allSubs);
      setOrders(orderMap);
      setDeadlines(dlMap);
      setProfiles(profMap);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Calcola data effettiva per ciascun sub (due_date oppure scadenza commessa)
  const subDate = (s: Sub): string | null =>
    s.due_date ?? deadlines[orders[s.order_id]?.source_commessa_id ?? ""] ?? null;

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

  // Raggruppa per giorno della settimana corrente + in ritardo + successivi
  const { byDay, overdue, future, undated } = useMemo(() => {
    const today = todayIso();
    const byDay: Record<string, Sub[]> = {};
    for (const d of weekDays) byDay[isoOf(d)] = [];
    const overdue: Sub[] = [];
    const future: Sub[] = [];
    const undated: Sub[] = [];
    for (const s of subs) {
      const dl = subDate(s);
      if (!dl) { undated.push(s); continue; }
      if (dl < today && dl < weekStartIso) { overdue.push(s); continue; }
      if (dl >= weekStartIso && dl <= weekEndIso) {
        // Sub in ritardo ma all'interno della settimana: mostrali nel giorno
        if (byDay[dl]) byDay[dl].push(s);
        else overdue.push(s);
      } else if (dl > weekEndIso) {
        future.push(s);
      } else {
        overdue.push(s);
      }
    }
    return { byDay, overdue, future, undated };
  }, [subs, weekDays, weekStartIso, weekEndIso, orders, deadlines]);

  const renderCard = (s: Sub) => {
    const o = orders[s.order_id];
    const dl = subDate(s);
    const u = urgencyBadge(dl, { done: false });
    const dc = DEPT_COLOR[s.dept];
    const assignee = s.assignee_id ? profiles[s.assignee_id]?.display_name : null;
    const uc = userColor(s.assignee_id);
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
        className={`block border rounded-sm overflow-hidden transition-colors hover:brightness-95 ${statusBg}`}
        title="Apri dettaglio lavorazione"
      >
        <div className={`${dc.chip} px-2 py-1.5 flex items-center gap-1.5`}>
          <span className="text-base leading-none" aria-hidden>{dc.emoji}</span>
          <span className="font-display font-extrabold uppercase tracking-wide text-[12px] leading-none truncate">
            {DEPT_LABEL[s.dept]}
          </span>
          {u && (
            <span className={`ml-auto text-[9px] font-mono uppercase font-bold px-1 py-0.5 rounded-sm border ${u.cls}`}>
              {u.label}
            </span>
          )}
        </div>
        <div className="p-1.5 space-y-1.5">
          <div className="flex items-center justify-between gap-1">
            <span className="font-mono text-[10px] font-bold bg-ink text-paper px-1 py-0.5 rounded-sm">{s.code}</span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-ink/70 truncate">{SUB_STATUS_LABEL[s.status]}</span>
          </div>
          <div className="text-[13px] font-semibold truncate">{o?.cliente ?? "—"}</div>
          <div
            className="flex items-center gap-1 text-[13px] font-bold rounded-sm px-1.5 py-1 border"
            style={s.assignee_id ? { backgroundColor: uc.bg, color: uc.fg, borderColor: uc.border } : undefined}
          >
            <User className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{assignee ?? "Non assegnato"}</span>
          </div>
        </div>
      </Link>
    );
  };

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
              Le lavorazioni assegnate a te, divise per giorno della settimana.
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

        {loading ? (
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
                  {overdue.map(renderCard)}
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
                    className={`border-2 rounded-sm p-2 min-h-[120px] flex flex-col ${
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
                        items.map(renderCard)
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
                  {future.map(renderCard)}
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
                  {undated.map(renderCard)}
                </div>
              </section>
            )}

            {subs.length === 0 && (
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
