import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DEPT_LABEL, DEPT_COLOR, SUB_STATUS_LABEL, ProdDept, ProdOrder, ProdSubOrder } from "@/lib/produzione/types";
import { Profile } from "@/components/flow/types";

const fmt = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d: Date) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); x.setHours(0, 0, 0, 0); return x; };

interface Props {
  orders: ProdOrder[];
  subs: ProdSubOrder[];
  profiles: Profile[];
  onOpenSub: (s: ProdSubOrder) => void;
}

/** Calendario lavorazioni: tutte le produzioni, con reparto e assegnatario. Filtrabile per settore. */
export const ProdCalendar = ({ orders, subs, profiles, onOpenSub }: Props) => {
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [dept, setDept] = useState<ProdDept | "all">("all");
  const [showDone, setShowDone] = useState(true);

  const orderById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);
  const nameOf = (id?: string | null) => (id ? profiles.find((p) => p.id === id)?.display_name ?? "?" : null);

  const deptsPresent = useMemo(() => Array.from(new Set(subs.map((s) => s.dept))), [subs]);

  // Ogni lavorazione occupa i giorni da inizio a fine (o solo la scadenza)
  const items = useMemo(() => subs
    .filter((s) => dept === "all" || s.dept === dept)
    .filter((s) => showDone || s.status !== "completato")
    .map((s) => {
      const a = s as any;
      const order = orderById.get(s.order_id);
      const start: string | null = a.start_date || a.due_date || a.end_date || (order as any)?.data || null;
      const end: string | null = a.end_date || a.due_date || start;
      return start ? { s, order, start, end: end && end >= start ? end : start } : null;
    })
    .filter(Boolean) as { s: ProdSubOrder; order?: ProdOrder; start: string; end: string }[],
  [subs, dept, showDone, orderById]);

  const gridStart = startOfWeek(month);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const today = fmt(new Date());

  return (
    <div className="border-2 border-ink/15 rounded-sm bg-paper md:flex-1 md:min-h-0 md:overflow-auto">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b-2 border-ink/15">
        <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="h-9 w-9 grid place-items-center border-2 border-ink/20 rounded-sm hover:bg-muted"><ChevronLeft className="w-4 h-4" /></button>
        <div className="font-display text-lg font-semibold capitalize min-w-[160px] text-center">
          {month.toLocaleDateString("it-IT", { month: "long", year: "numeric" })}
        </div>
        <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="h-9 w-9 grid place-items-center border-2 border-ink/20 rounded-sm hover:bg-muted"><ChevronRight className="w-4 h-4" /></button>
        <button onClick={() => { const d = new Date(); d.setDate(1); setMonth(d); }} className="h-9 px-3 border-2 border-ink/20 rounded-sm text-sm font-bold uppercase hover:bg-muted">Oggi</button>
        <label className="ml-auto flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Mostra completate
        </label>
      </div>

      <div className="flex flex-wrap gap-1.5 p-3 border-b-2 border-ink/15">
        <button onClick={() => setDept("all")} className={`px-3 py-1.5 rounded-sm border-2 text-sm font-bold uppercase ${dept === "all" ? "bg-ink text-paper border-ink" : "border-ink/20 hover:border-ink/50"}`}>Generale</button>
        {deptsPresent.map((d) => (
          <button key={d} onClick={() => setDept(d)} className={`px-3 py-1.5 rounded-sm border-2 text-sm font-bold uppercase ${dept === d ? `${DEPT_COLOR[d]?.chip} border-transparent` : "border-ink/20 hover:border-ink/50"}`}>
            {DEPT_LABEL[d] ?? d}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-7 text-xs font-bold uppercase text-muted-foreground border-b border-ink/15">
        {["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map((d) => <div key={d} className="px-2 py-1.5">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const ds = fmt(day);
          const inMonth = day.getMonth() === month.getMonth();
          const list = items.filter((i) => i.start <= ds && i.end >= ds);
          return (
            <div key={ds} className={`min-h-[120px] border-r border-b border-ink/10 p-1 ${inMonth ? "" : "bg-muted/40 opacity-60"}`}>
              <div className={`text-sm mb-1 ${ds === today ? "font-bold text-primary" : ""}`}>{day.getDate()}</div>
              <div className="flex flex-col gap-1">
                {list.slice(0, 5).map(({ s, order }) => {
                  const who = nameOf(s.assignee_id) ?? ((s as any).operator_ids ?? []).map(nameOf).filter(Boolean).join(", ");
                  return (
                    <button key={s.id} onClick={() => onOpenSub(s)}
                      title={`${order?.production_name || order?.cliente || ""} · ${DEPT_LABEL[s.dept]} · ${SUB_STATUS_LABEL[s.status]}${who ? ` · ${who}` : ""}`}
                      className={`text-left rounded-sm px-1.5 py-1 text-xs leading-tight ${DEPT_COLOR[s.dept]?.chip ?? "bg-muted"} ${s.status === "completato" ? "opacity-50 line-through" : ""}`}>
                      <div className="font-bold truncate">{order?.production_name || order?.cliente || s.code}</div>
                      <div className="truncate opacity-90">{DEPT_LABEL[s.dept]} · {who || "da assegnare"}</div>
                    </button>
                  );
                })}
                {list.length > 5 && <div className="text-xs text-muted-foreground">+{list.length - 5} altre</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
