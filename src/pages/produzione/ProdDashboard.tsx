import { useMemo, useState } from "react";
import { Plus, AlertTriangle, CheckCircle2, Clock, Package, Bell as BellIcon } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from "recharts";
import { ProdLayout } from "@/components/produzione/ProdLayout";
import { LaunchOrderDialog } from "@/components/produzione/LaunchOrderDialog";
import { useProdStore } from "@/lib/produzione/store";
import { DEPT_LABEL, ORDER_STATUS_LABEL } from "@/lib/produzione/types";
import { orderProgress } from "@/lib/produzione/helpers";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

const STAT_CARD = "border-2 border-ink/15 bg-paper rounded-sm p-4";

const ProdDashboard = () => {
  const { orders, subs, inventory, notifications } = useProdStore();
  const [launch, setLaunch] = useState(false);

  const inProgress = orders.filter((o) => ["nuovo", "in_corso", "pronto"].includes(o.status));
  const urgent = orders.filter((o) => o.priorita !== "normale" && o.status !== "chiuso");
  const weekStart = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d; }, []);
  const completedWeek = orders.filter((o) => o.status === "chiuso" && new Date(o.updated_at) >= weekStart);
  const stockAlerts = inventory.filter((i) => i.qty_intera < i.soglia_minima);
  const unreadNotif = notifications.filter((n) => !n.read_at).length;

  const workload = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of subs) {
      if (s.status === "completato") continue;
      m[s.dept] = (m[s.dept] ?? 0) + 1;
    }
    return Object.entries(m).map(([dept, count]) => ({ dept: DEPT_LABEL[dept as keyof typeof DEPT_LABEL] ?? dept, count }));
  }, [subs]);

  const COLORS = ["hsl(var(--primary))", "hsl(184 60% 50%)", "hsl(24 90% 55%)", "hsl(280 50% 55%)", "hsl(140 50% 45%)"];

  return (
    <ProdLayout>
      <div className="p-6 space-y-5 max-w-7xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-primary">// Produzione</div>
            <h1 className="font-display text-2xl font-semibold">Dashboard</h1>
          </div>
          <Button onClick={() => setLaunch(true)} className="gap-2">
            <Plus className="w-4 h-4" /> Lancia nel Flow
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className={STAT_CARD}>
            <div className="flex items-center justify-between">
              <Clock className="w-4 h-4 text-primary" />
              <span className="font-mono text-[10px] uppercase text-muted-foreground">In corso</span>
            </div>
            <div className="font-display text-3xl font-bold mt-1">{inProgress.length}</div>
          </div>
          <div className={STAT_CARD}>
            <div className="flex items-center justify-between">
              <AlertTriangle className="w-4 h-4 text-destructive" />
              <span className="font-mono text-[10px] uppercase text-muted-foreground">Urgenti</span>
            </div>
            <div className="font-display text-3xl font-bold mt-1 text-destructive">{urgent.length}</div>
          </div>
          <div className={STAT_CARD}>
            <div className="flex items-center justify-between">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span className="font-mono text-[10px] uppercase text-muted-foreground">Settimana</span>
            </div>
            <div className="font-display text-3xl font-bold mt-1 text-emerald-600">{completedWeek.length}</div>
          </div>
          <div className={STAT_CARD}>
            <div className="flex items-center justify-between">
              <Package className="w-4 h-4 text-amber-600" />
              <span className="font-mono text-[10px] uppercase text-muted-foreground">Stock alert</span>
            </div>
            <div className="font-display text-3xl font-bold mt-1 text-amber-600">{stockAlerts.length}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className={`${STAT_CARD} lg:col-span-2`}>
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-3">Carico per reparto</div>
            {workload.length === 0 ? (
              <div className="text-center text-[12px] text-muted-foreground py-12">Nessun lavoro attivo</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={workload}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="dept" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count">
                    {workload.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className={STAT_CARD}>
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1">
              <BellIcon className="w-3 h-3" /> Notifiche non lette
            </div>
            <div className="font-display text-4xl font-bold">{unreadNotif}</div>
            <p className="text-[11px] text-muted-foreground mt-1">Apri la campanella in alto a destra</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className={STAT_CARD}>
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-3 flex items-center justify-between">
              <span>Ordini urgenti / bloccanti</span>
              <Link to="/produzione/board" className="text-primary hover:underline normal-case tracking-normal">Apri board →</Link>
            </div>
            {urgent.length === 0 ? (
              <div className="text-[11px] text-muted-foreground py-4">Nessun ordine urgente</div>
            ) : (
              <ul className="space-y-1.5">
                {urgent.slice(0, 6).map((o) => {
                  const sb = subs.filter((s) => s.order_id === o.id);
                  return (
                    <li key={o.id} className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-sm border-l-4 ${o.priorita === "bloccante" ? "border-l-destructive bg-destructive/5 animate-pulse" : "border-l-amber-500 bg-amber-50"}`}>
                      <div className="min-w-0">
                        <div className="font-mono text-[11px] font-bold">{o.code}</div>
                        <div className="text-[11px] text-ink/70 truncate">{o.cliente}</div>
                      </div>
                      <div className="font-mono text-[10px] text-ink/60">{orderProgress(sb)}%</div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className={STAT_CARD}>
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-3 flex items-center justify-between">
              <span>Stock sotto soglia</span>
              <Link to="/produzione/magazzino" className="text-primary hover:underline normal-case tracking-normal">Magazzino →</Link>
            </div>
            {stockAlerts.length === 0 ? (
              <div className="text-[11px] text-muted-foreground py-4">Tutto in scorta ✓</div>
            ) : (
              <ul className="space-y-1.5">
                {stockAlerts.slice(0, 6).map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2 px-2 py-1.5 bg-amber-50 rounded-sm">
                    <div className="min-w-0">
                      <div className="font-mono text-[11px] font-bold">{i.code}</div>
                      <div className="text-[11px] text-ink/70 truncate">{i.nome}</div>
                    </div>
                    <div className="font-mono text-[11px] text-amber-700 font-bold">{i.qty_intera} {i.um}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <LaunchOrderDialog open={launch} onOpenChange={setLaunch} />
    </ProdLayout>
  );
};

export default ProdDashboard;