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

const fmtDateLabel = (iso: string | null) => {
  if (!iso) return "Senza data";
  try {
    const d = new Date(iso);
    const t = todayIso();
    if (iso === t) return "Oggi";
    return d.toLocaleDateString("it-IT", { weekday: "long", day: "2-digit", month: "long" });
  } catch { return iso; }
};

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

  // Raggruppa per data
  const groups = useMemo(() => {
    const map = new Map<string, Sub[]>();
    for (const s of subs) {
      const k = subDate(s) ?? "__none__";
      const arr = map.get(k) ?? [];
      arr.push(s);
      map.set(k, arr);
    }
    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === "__none__") return 1;
      if (b === "__none__") return -1;
      return a.localeCompare(b);
    });
    return keys.map((k) => ({ key: k, date: k === "__none__" ? null : k, items: map.get(k)! }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subs, orders, deadlines]);

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
        {/* Header colorato del reparto (stesso stile Flow Board) */}
        <div className={`${dc.chip} px-2.5 py-2 flex items-center gap-2`}>
          <span className="text-xl leading-none" aria-hidden>{dc.emoji}</span>
          <span className="font-display font-extrabold uppercase tracking-wide text-[16px] leading-none truncate">
            {DEPT_LABEL[s.dept]}
          </span>
          {u && (
            <span className={`ml-auto text-[10px] font-mono uppercase font-bold px-1.5 py-0.5 rounded-sm border-2 ${u.cls}`}>
              {u.label}
            </span>
          )}
        </div>
        <div className="p-2 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] font-bold bg-ink text-paper px-1.5 py-0.5 rounded-sm">{s.code}</span>
            <span className="text-[11px] font-mono uppercase tracking-wider text-ink/70">{SUB_STATUS_LABEL[s.status]}</span>
          </div>
          <div className="text-[14px] font-semibold truncate">{o?.cliente ?? "—"}</div>
          <div
            className="flex items-center gap-1.5 text-[16px] font-bold rounded-sm px-2 py-1.5 border"
            style={s.assignee_id ? { backgroundColor: uc.bg, color: uc.fg, borderColor: uc.border } : undefined}
          >
            <User className="w-4 h-4 shrink-0" />
            <span className="truncate">{assignee ?? "Non assegnato"}</span>
          </div>
        </div>
      </Link>
    );
  };

  return (
    <ProdLayout>
      <div className="p-3 sm:p-6 space-y-4 max-w-6xl mx-auto">
        <div className="flex items-start sm:items-center justify-between flex-wrap gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-primary">// Produzione</div>
            <h1 className="font-display text-2xl font-semibold flex items-center gap-2">
              <CalendarClock className="w-6 h-6 text-primary" />
              Le mie Attività
            </h1>
            <div className="text-[11px] text-muted-foreground mt-1">
              Le lavorazioni assegnate a te, divise per data di scadenza.
            </div>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/produzione/board"><ArrowLeft className="w-3.5 h-3.5 mr-1" /> Flow Board</Link>
          </Button>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Caricamento…</div>
        ) : subs.length === 0 ? (
          <div className="border-2 border-dashed border-ink/20 rounded-sm p-8 text-center text-sm text-muted-foreground italic">
            Nessuna attività assegnata. Goditi la pausa.
          </div>
        ) : (
          <div className="space-y-5">
            {groups.map((g) => {
              const today = todayIso();
              const isOverdue = g.date && g.date < today;
              const isToday = g.date === today;
              return (
                <section
                  key={g.key}
                  className={`border-2 rounded-sm p-3 ${
                    isOverdue ? "border-destructive bg-destructive/5" :
                    isToday ? "border-primary bg-primary/5" :
                    "border-ink/20"
                  }`}
                >
                  <div className="flex items-baseline justify-between mb-3 gap-2 flex-wrap">
                    <h2 className={`font-display text-base font-bold uppercase tracking-wider ${isOverdue ? "text-destructive" : ""}`}>
                      {fmtDateLabel(g.date)}
                      {isOverdue && <span className="ml-2 text-[11px] font-mono">· in ritardo</span>}
                    </h2>
                    <span className="text-[11px] font-mono text-muted-foreground">
                      {g.items.length} lavorazion{g.items.length === 1 ? "e" : "i"}
                    </span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {g.items.map(renderCard)}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </ProdLayout>
  );
}
