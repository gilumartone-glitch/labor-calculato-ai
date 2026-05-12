import { useMemo, useState, useRef, useEffect } from "react";
import { format, parseISO, isValid } from "date-fns";
import { it } from "date-fns/locale";
import { AlertTriangle, Download, Pencil, Target, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { eur } from "@/lib/format";

type Movement = {
  id: string;
  date: string;
  description: string;
  category: string;
  paymentMethod?: string;
  type: "entrata" | "uscita";
  status: "cassa" | "previsto";
  amount: number;
};

type FixedExpense = {
  id: string;
  description: string;
  category: string;
  amount: number;
  day: number;
  active: boolean;
  month?: number;
};

export type AccountingGoals = {
  dailyEntrate?: number;
  monthlyEntrate?: number;
  monthlyUscite?: number;
  monthlySaldo?: number;
  yearlyEntrate?: number;
  yearlyUscite?: number;
  yearlySaldo?: number;
  cashTarget?: number;
  alertPctFixedOverRevenue?: number;
  monthlyEntrateForecast?: Record<number, number>;
  bepThresholdPct?: number;
};

const MONTH_LABELS = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];

// Palette coerente con il tema chiaro Tecnofra (HSL via tokens)
const C = {
  in: "hsl(var(--primary))",            // entrate / positivo
  out: "hsl(var(--destructive))",       // uscite / negativo
  net: "hsl(195 45% 22%)",              // saldo
  target: "hsl(38 92% 45%)",            // target line
  surplus: "hsl(var(--primary) / 0.10)",
  deficit: "hsl(var(--destructive) / 0.10)",
  pie: [
    "hsl(184 85% 32%)",
    "hsl(0 72% 50%)",
    "hsl(38 92% 50%)",
    "hsl(217 91% 55%)",
    "hsl(262 70% 55%)",
    "hsl(173 80% 36%)",
    "hsl(340 75% 50%)",
    "hsl(120 45% 40%)",
  ],
};

/* ========================== INLINE NUMBER ========================== */
const InlineNumber = ({
  value,
  onChange,
  placeholder = "—",
  className,
  prefix,
  suffix = "€",
  align = "right",
}: {
  value?: number;
  onChange: (n?: number) => void;
  placeholder?: string;
  className?: string;
  prefix?: string;
  suffix?: string;
  align?: "left" | "right" | "center";
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing) setDraft(value === undefined ? "" : String(value));
  }, [value, editing]);
  useEffect(() => {
    if (editing) ref.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const n = draft.trim() === "" ? undefined : Number(draft.replace(",", "."));
    if (n !== undefined && !isFinite(n)) return;
    if (n !== value) onChange(n);
  };

  if (editing) {
    return (
      <Input
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { setEditing(false); setDraft(value === undefined ? "" : String(value)); }
        }}
        className={cn("h-8 font-mono tabular-nums", align === "right" && "text-right", align === "center" && "text-center", className)}
        type="number"
        step="any"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={cn(
        "group inline-flex items-center gap-1.5 font-mono tabular-nums hover:bg-muted/60 rounded px-1.5 py-0.5 transition-colors",
        align === "right" && "justify-end",
        align === "center" && "justify-center",
        className,
      )}
      title="Clicca per modificare"
    >
      {prefix && <span className="text-muted-foreground text-xs">{prefix}</span>}
      <span>
        {value === undefined || value === null
          ? <span className="text-muted-foreground italic">{placeholder}</span>
          : `${eur(value).replace("€", "").trim()}`}
      </span>
      {suffix && <span className="text-muted-foreground text-xs">{suffix}</span>}
      <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-60 text-muted-foreground" />
    </button>
  );
};

/* ============================= KPI CARD ============================= */
const statusColor = (gapPct: number, invert = false) => {
  // gapPct > 0 = sopra target. Invert = vero per "uscite" (sopra target = male)
  const ok = invert ? gapPct <= 0 : gapPct >= 0;
  const warning = Math.abs(gapPct) <= 10;
  if (warning) return "hsl(38 92% 45%)";
  return ok ? "hsl(142 70% 38%)" : "hsl(var(--destructive))";
};

const KpiCard = ({
  label,
  icon: Icon,
  current,
  target,
  onTargetChange,
  invert = false,
  readonly = false,
  fmt = eur,
}: {
  label: string;
  icon: typeof Wallet;
  current: number;
  target?: number;
  onTargetChange?: (n?: number) => void;
  invert?: boolean;
  readonly?: boolean;
  fmt?: (n: number) => string;
}) => {
  const t = target ?? 0;
  const gap = t > 0 ? ((current - t) / t) * 100 : 0;
  const color = t > 0 ? statusColor(gap, invert) : "hsl(var(--muted-foreground))";
  return (
    <Card className="relative overflow-hidden border-2 border-dept bg-paper shadow-soft transition-all hover:shadow-md hover:border-dept">
      <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: color }} />
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-sm bg-dept-soft text-dept">
              <Icon className="h-4 w-4" />
            </span>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
          </div>
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        </div>
        <div className="font-mono text-2xl font-bold tabular-nums" style={{ color: t > 0 ? color : undefined }}>
          {fmt(current)}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-rule/60 pt-2">
          <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Target</span>
          {readonly ? (
            <span className="font-mono text-sm tabular-nums text-muted-foreground">{fmt(target ?? 0)}</span>
          ) : (
            <InlineNumber value={target} onChange={(n) => onTargetChange?.(n)} />
          )}
        </div>
        {t > 0 && (
          <div className="flex items-center gap-1 text-xs font-mono" style={{ color }}>
            {gap >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            <span>{gap >= 0 ? "+" : ""}{gap.toFixed(1)}% vs target</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

/* ========================= MAIN COMPONENT ========================= */
const ObiettivoBlock = ({ label, actual, target, onChange }: { label: string; actual: number; target?: number; onChange: (n?: number) => void }) => {
  const t = target ?? 0;
  const pct = t > 0 ? Math.min(150, (actual / t) * 100) : 0;
  const ok = pct >= 100;
  const color = t === 0 ? "hsl(var(--muted-foreground))" : ok ? "hsl(142 70% 38%)" : pct >= 70 ? "hsl(38 92% 45%)" : "hsl(var(--destructive))";
  return (
    <div className="rounded-sm border-2 border-amber-300/60 bg-background/60 p-3 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">{label}</span>
        {t > 0 && <span className="text-[10px] font-mono tabular-nums" style={{ color }}>{pct.toFixed(0)}%</span>}
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="font-mono text-lg font-bold tabular-nums" style={{ color }}>{eur(actual)}</div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">attuale</div>
        </div>
        <div className="text-right">
          <InlineNumber value={target} onChange={onChange} />
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">obiettivo</div>
        </div>
      </div>
      {t > 0 && (
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div className="h-full transition-all" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
        </div>
      )}
    </div>
  );
};

export const ChartsView = ({
  movements,
  goals,
  setGoals,
  fixedExpenses,
  setFixedExpenses,
  currentCash,
  openingCash,
  cashIn,
  cashOut,
  expectedIn,
  expectedOut,
}: {
  movements: Movement[];
  goals: AccountingGoals;
  setGoals: (g: AccountingGoals) => void;
  fixedExpenses: FixedExpense[];
  setFixedExpenses: (f: FixedExpense[]) => void;
  currentCash: number;
  openingCash: number;
  cashIn: number;
  cashOut: number;
  expectedIn: number;
  expectedOut: number;
}) => {
  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());

  const updateGoal = (k: keyof AccountingGoals, v: AccountingGoals[keyof AccountingGoals]) =>
    setGoals({ ...goals, [k]: v });

  /* ----- aggregazioni per anno selezionato ----- */
  const monthly = useMemo(() => {
    const rows = MONTH_LABELS.map((label, i) => ({
      idx: i,
      label,
      entrateCassa: 0,
      usciteCassa: 0,
      entrateComp: 0,    // competenza (movimenti "previsto")
      usciteComp: 0,
      entrate: 0,        // totali (cassa + competenza)
      uscite: 0,
      fixed: 0,
      hasData: false,    // true se ci sono movimenti in cassa nel mese
    }));
    for (const m of movements) {
      const d = parseISO(m.date);
      if (!isValid(d) || d.getFullYear() !== year) continue;
      const r = rows[d.getMonth()];
      const isCash = m.status === "cassa";
      if (m.type === "entrata") {
        r.entrate += m.amount;
        if (isCash) { r.entrateCassa += m.amount; r.hasData = true; }
        else r.entrateComp += m.amount;
      } else {
        r.uscite += m.amount;
        if (isCash) { r.usciteCassa += m.amount; r.hasData = true; }
        else r.usciteComp += m.amount;
      }
    }
    // fixed mensile (somma spese fisse attive, ipotizzata costante per ogni mese)
    const fixedMonthly = fixedExpenses.filter((e) => e.active).reduce((s, e) => s + e.amount, 0);
    rows.forEach((r) => { r.fixed = fixedMonthly; });
    return rows;
  }, [movements, year, fixedExpenses]);

  const totals = useMemo(() => {
    const entrate = monthly.reduce((s, r) => s + r.entrateCassa, 0);
    const uscite = monthly.reduce((s, r) => s + r.usciteCassa, 0);
    return { entrate, uscite, saldo: entrate - uscite };
  }, [monthly]);

  // Numero di mesi con dati di cassa, per calcolare la media reale (non /12)
  const monthsWithData = monthly.filter((r) => r.hasData).length;

  /* ----- KPI dashboard ----- */
  const fixedMonthly = fixedExpenses.filter((e) => e.active).reduce((s, e) => s + e.amount, 0);
  const fixedQuarterly = fixedMonthly * 3;
  const monthRevenueAvg = monthsWithData > 0 ? totals.entrate / monthsWithData : 0;
  const dailyRevenueAvg = monthRevenueAvg / 30;
  const netCashFlow = totals.saldo;
  // Cassa + competenza futura attesa (entrate previste non ancora incassate)
  const cashPlusFuture = currentCash + expectedIn - expectedOut;
  // Quanti trimestri di spese fisse sono coperti da cassa+competenza
  const quartersCovered = fixedQuarterly > 0 ? cashPlusFuture / fixedQuarterly : 0;

  /* ----- combo chart data: bars=actual cassa, line=target ----- */
  const targetMonthly = goals.monthlyEntrate ?? 0;
  const comboData = monthly.map((r) => ({
    label: r.label,
    idx: r.idx,
    entrate: r.entrateCassa,
    uscite: -r.usciteCassa,
    flusso: r.entrateCassa - r.usciteCassa,
    target: targetMonthly,
  }));

  /* ----- BEP TRIMESTRALE ----- */
  const bepThreshold = goals.bepThresholdPct ?? 35;
  const quarters = useMemo(() => {
    const labels = ["GEN-FEB-MAR", "APR-MAG-GIU", "LUG-AGO-SET", "OTT-NOV-DIC"];
    return labels.map((label, qi) => {
      const months = [qi * 3, qi * 3 + 1, qi * 3 + 2];
      let entrate = 0, uscite = 0;
      let mWithData = 0;
      for (const mi of months) {
        const r = monthly[mi];
        entrate += r.entrateCassa;
        uscite += r.usciteCassa;
        if (r.hasData) mWithData += 1;
      }
      const fixed = fixedMonthly * 3;
      const incidence = entrate > 0 ? (fixed / entrate) * 100 : 0;
      const incCostiTot = entrate > 0 ? (uscite / entrate) * 100 : 0;
      return { label, qi, months, entrate, uscite, fixed, incidence, incCostiTot, mediaMese: mWithData > 0 ? entrate / mWithData : 0, alert: entrate > 0 && incidence > bepThreshold };
    });
  }, [monthly, fixedMonthly, bepThreshold]);

  /* ----- pie data: spese fisse per categoria ----- */
  const fixedByCategory = useMemo(() => {
    const map = new Map<string, { name: string; value: number; ids: string[] }>();
    for (const f of fixedExpenses) {
      if (!f.active) continue;
      const k = (f.category || "Altro").trim() || "Altro";
      const cur = map.get(k) ?? { name: k, value: 0, ids: [] };
      cur.value += f.amount;
      cur.ids.push(f.id);
      map.set(k, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.value - a.value);
  }, [fixedExpenses]);

  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const setCategoryAmount = (cat: string, newTotal: number) => {
    const items = fixedExpenses.filter((e) => e.active && (e.category || "Altro") === cat);
    if (items.length === 0) return;
    const oldTotal = items.reduce((s, e) => s + e.amount, 0);
    const next = fixedExpenses.map((e) => {
      if (!e.active || (e.category || "Altro") !== cat) return e;
      if (oldTotal <= 0) {
        // distribuisco equamente
        return { ...e, amount: Math.round((newTotal / items.length) * 100) / 100 };
      }
      const ratio = e.amount / oldTotal;
      return { ...e, amount: Math.round(newTotal * ratio * 100) / 100 };
    });
    setFixedExpenses(next);
  };

  /* ----- budget alert (BEP annuo) ----- */
  const alertPct = goals.alertPctFixedOverRevenue ?? 35;
  const fixedYearly = fixedMonthly * 12;
  const fixedRatio = totals.entrate > 0 ? (fixedYearly / totals.entrate) * 100 : 0;
  const alertActive = totals.entrate > 0 && fixedRatio >= alertPct;

  /* ----- monthly tracker (entrate previste editabili, le altre derivate) ----- */
  const updateForecast = (i: number, n?: number) => {
    const cur = goals.monthlyEntrateForecast ?? {};
    const next = { ...cur };
    if (n === undefined) delete next[i];
    else next[i] = n;
    updateGoal("monthlyEntrateForecast", next);
  };

  // Tracker: "Competenza" = override manuale OPPURE proiezione
  // = entrate cassa del mese (se ci sono) + entrate previste (status 'previsto') del mese
  // Per i mesi futuri senza dati di cassa, usa la media mobile dei mesi pregressi con dati.
  const trackerRows = monthly.map((r) => {
    const override = goals.monthlyEntrateForecast?.[r.idx];
    const projected = r.hasData
      ? r.entrateCassa + r.entrateComp
      : monthRevenueAvg; // proiezione = media dei mesi con dati
    const competenza = override ?? projected;
    const flusso = r.entrateCassa - r.usciteCassa;
    return {
      idx: r.idx,
      mese: r.label,
      competenza,
      isProjected: override === undefined && !r.hasData,
      reali: r.entrateCassa,
      fisse: r.fixed,
      uscite: r.usciteCassa,
      flusso,
    };
  });

  /* ----- CSV export ----- */
  const exportCsv = () => {
    const header = ["Mese", "Competenza", "Entrate cassa", "Spese fisse", "Uscite cassa", "Flusso netto"];
    const lines = [header.join(";")];
    for (const r of trackerRows) {
      lines.push([r.mese, r.competenza, r.reali, r.fisse, r.uscite, r.flusso].join(";"));
    }
    lines.push([
      "TOTALE",
      trackerRows.reduce((s, r) => s + r.competenza, 0),
      trackerRows.reduce((s, r) => s + r.reali, 0),
      trackerRows.reduce((s, r) => s + r.fisse, 0),
      trackerRows.reduce((s, r) => s + r.uscite, 0),
      trackerRows.reduce((s, r) => s + r.flusso, 0),
    ].join(";"));
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cashflow-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const tooltipFmt = (v: number) => eur(Math.abs(Number(v) || 0));
  const yearOptions = Array.from(new Set([year, now.getFullYear(), now.getFullYear() - 1, now.getFullYear() + 1])).sort();

  return (
    <Card className="border-2 border-dept shadow-soft">
      <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Cash Flow Dashboard</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">Pannello di controllo finanziario · clicca i numeri per modificarli</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex items-center gap-1">
            {yearOptions.map((y) => (
              <Button key={y} size="sm" variant={year === y ? "default" : "outline"} onClick={() => setYear(y)}>{y}</Button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={exportCsv}><Download className="h-4 w-4" />CSV</Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* ====================== OBIETTIVI ====================== */}
        <Card className="border-2 border-amber-300 bg-amber-50/50 dark:bg-amber-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4" />Obiettivi</CardTitle>
            <p className="text-xs text-muted-foreground">Target di fatturato — clicca per modificare</p>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
              <ObiettivoBlock label="Giorno" actual={dailyRevenueAvg} target={goals.dailyEntrate} onChange={(n) => updateGoal("dailyEntrate", n)} />
              <ObiettivoBlock label="Mese" actual={monthRevenueAvg} target={goals.monthlyEntrate} onChange={(n) => updateGoal("monthlyEntrate", n)} />
              <ObiettivoBlock label="Anno" actual={totals.entrate} target={goals.yearlyEntrate} onChange={(n) => updateGoal("yearlyEntrate", n)} />
            </div>
          </CardContent>
        </Card>

        {/* ====================== ALERT BANNER ====================== */}
        <div className="flex flex-wrap items-center gap-3 rounded-sm border-2 px-4 py-3"
          style={{
            borderColor: alertActive ? "hsl(var(--destructive))" : "hsl(var(--border))",
            background: alertActive ? "hsl(var(--destructive) / 0.06)" : "hsl(var(--muted) / 0.4)",
          }}>
          <AlertTriangle className={cn("h-5 w-5 shrink-0", alertActive ? "text-destructive" : "text-muted-foreground")} />
          <div className="flex-1 min-w-[260px] text-sm">
            {totals.entrate <= 0 ? (
              <span className="text-muted-foreground">Nessuna entrata registrata per il {year}.</span>
            ) : alertActive ? (
              <span><strong>Attenzione:</strong> le spese fisse rappresentano il <strong>{fixedRatio.toFixed(1)}%</strong> del fatturato annuo, sopra la soglia di {alertPct}%.</span>
            ) : (
              <span>Le spese fisse sono al <strong>{fixedRatio.toFixed(1)}%</strong> del fatturato annuo (soglia: {alertPct}%).</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Soglia alert</span>
            <InlineNumber value={goals.alertPctFixedOverRevenue} onChange={(n) => updateGoal("alertPctFixedOverRevenue", n)} suffix="%" />
          </div>
        </div>

        {/* ========================== KPI ROW ========================== */}
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="relative overflow-hidden border-2 border-dept bg-paper shadow-soft">
            <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: "hsl(var(--primary))" }} />
            <CardContent className="p-5 space-y-2">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-sm bg-dept-soft text-dept">
                  <Wallet className="h-4 w-4" />
                </span>
                <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Cassa attuale</div>
              </div>
              <div className="font-mono text-2xl font-bold tabular-nums">{eur(currentCash)}</div>
              <div className="text-[10px] text-muted-foreground font-mono leading-relaxed border-t border-rule/60 pt-2 space-y-0.5">
                <div className="flex justify-between"><span>Cassa iniziale</span><span className="tabular-nums">{eur(openingCash)}</span></div>
                <div className="flex justify-between"><span>+ Entrate cassa</span><span className="tabular-nums text-primary">+{eur(cashIn)}</span></div>
                <div className="flex justify-between"><span>− Uscite cassa</span><span className="tabular-nums text-destructive">−{eur(cashOut)}</span></div>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-rule/60 pt-2">
                <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Target</span>
                <InlineNumber value={goals.cashTarget} onChange={(n) => updateGoal("cashTarget", n)} />
              </div>
            </CardContent>
          </Card>
          <KpiCard
            label="Spese fisse trimestrali"
            icon={TrendingDown}
            current={fixedQuarterly}
            target={goals.monthlyUscite ? goals.monthlyUscite * 3 : undefined}
            onTargetChange={(n) => updateGoal("monthlyUscite", n !== undefined ? n / 3 : undefined)}
            invert
          />
          <KpiCard
            label="Ricavi medi / mese"
            icon={TrendingUp}
            current={monthRevenueAvg}
            target={goals.monthlyEntrate}
            onTargetChange={(n) => updateGoal("monthlyEntrate", n)}
          />
          <Card className="relative overflow-hidden border-2 border-dept bg-paper shadow-soft">
            <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: quartersCovered >= 1 ? "hsl(142 70% 38%)" : "hsl(var(--destructive))" }} />
            <CardContent className="p-5 space-y-2">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-sm bg-dept-soft text-dept">
                  <Target className="h-4 w-4" />
                </span>
                <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Copertura trimestri</div>
              </div>
              <div className="font-mono text-2xl font-bold tabular-nums" style={{ color: quartersCovered >= 1 ? "hsl(142 70% 38%)" : "hsl(var(--destructive))" }}>
                {quartersCovered.toFixed(1)}×
              </div>
              <div className="text-[10px] text-muted-foreground font-mono leading-relaxed border-t border-rule/60 pt-2 space-y-0.5">
                <div className="flex justify-between"><span>Cassa + competenza</span><span className="tabular-nums">{eur(cashPlusFuture)}</span></div>
                <div className="flex justify-between"><span>÷ Spese fisse trim.</span><span className="tabular-nums">{eur(fixedQuarterly)}</span></div>
              </div>
              <p className="text-[10px] text-muted-foreground italic">Trimestri di spese fisse coperti</p>
            </CardContent>
          </Card>
        </div>

        {/* ====================== BEP TRIMESTRALE ====================== */}
        <Card className="border-2 border-dept/40">
          <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">BEP trimestrale · {year}</CardTitle>
              <p className="text-xs text-muted-foreground">Incidenza % delle spese fisse sulle entrate per trimestre</p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Soglia max</span>
              <InlineNumber value={goals.bepThresholdPct} onChange={(n) => updateGoal("bepThresholdPct", n)} suffix="%" />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs uppercase tracking-wider">Trimestre</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Entrate</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Media / mese</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Uscite</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Costi fissi</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Inc. CF/Ent.</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Inc. Costi tot/Ent.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quarters.map((q) => (
                  <TableRow key={q.qi} className={cn(q.alert && "bg-destructive/5")}>
                    <TableCell className="font-medium py-2">{q.label}</TableCell>
                    <TableCell className="text-right py-2 font-mono tabular-nums">{eur(q.entrate)}</TableCell>
                    <TableCell className="text-right py-2 font-mono tabular-nums text-muted-foreground">{eur(q.mediaMese)}</TableCell>
                    <TableCell className="text-right py-2 font-mono tabular-nums">{eur(q.uscite)}</TableCell>
                    <TableCell className="text-right py-2 font-mono tabular-nums text-muted-foreground">{eur(q.fixed)}</TableCell>
                    <TableCell className={cn("text-right py-2 font-mono tabular-nums font-semibold", q.alert ? "text-destructive" : q.entrate > 0 ? "text-primary" : "text-muted-foreground")}>
                      {q.entrate > 0 ? `${q.incidence.toFixed(1)}%` : "—"}
                    </TableCell>
                    <TableCell className={cn("text-right py-2 font-mono tabular-nums", q.incCostiTot > 100 ? "text-destructive font-semibold" : "")}>
                      {q.entrate > 0 ? `${q.incCostiTot.toFixed(1)}%` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* ====================== CASH FLOW CHART ====================== */}
        <Card className="border-2 border-dept/40">
          <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Cash flow mensile · {year}</CardTitle>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Target entrate / mese</span>
              <InlineNumber value={goals.monthlyEntrate} onChange={(n) => updateGoal("monthlyEntrate", n)} />
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={340}>
              <ComposedChart data={comboData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.in} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={C.in} stopOpacity={0.55} />
                  </linearGradient>
                  <linearGradient id="gOut" x1="0" y1="1" x2="0" y2="0">
                    <stop offset="0%" stopColor={C.out} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={C.out} stopOpacity={0.55} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  formatter={(value: number, name: string) => [tooltipFmt(value), name]}
                  contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))" }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={0} stroke="hsl(var(--foreground))" strokeOpacity={0.4} />
                <Bar dataKey="entrate" name="Entrate" fill="url(#gIn)" radius={[6, 6, 0, 0]} animationDuration={600} />
                <Bar dataKey="uscite" name="Uscite" fill="url(#gOut)" radius={[0, 0, 6, 6]} animationDuration={600} />
                <Line type="monotone" dataKey="flusso" name="Flusso netto" stroke={C.net} strokeWidth={2.5} dot={{ r: 3 }} animationDuration={600} />
                {targetMonthly > 0 && (
                  <Line type="monotone" dataKey="target" name={`Target entrate (${eur(targetMonthly)})`} stroke={C.target} strokeWidth={2} strokeDasharray="6 4" dot={false} animationDuration={600} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* ============== FIXED COSTS DONUT + MONTHLY TABLE ============== */}
        <div className="grid gap-6 lg:grid-cols-5">
          <Card className="border-2 border-dept/40 lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Spese fisse per categoria</CardTitle>
              <p className="text-xs text-muted-foreground">Clicca uno spicchio per modificare l'importo mensile della categoria</p>
            </CardHeader>
            <CardContent>
              {fixedByCategory.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground border-2 border-dashed border-dept/30 rounded-sm">
                  Nessuna spesa fissa attiva.
                </div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Tooltip formatter={(v: number) => eur(Number(v) || 0)} contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))" }} />
                      <Pie
                        data={fixedByCategory}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={56}
                        outerRadius={92}
                        paddingAngle={2}
                        onClick={(d: { name?: string }) => d?.name && setEditingCategory(d.name)}
                        cursor="pointer"
                      >
                        {fixedByCategory.map((entry, i) => (
                          <Cell key={entry.name} fill={C.pie[i % C.pie.length]} stroke={editingCategory === entry.name ? "hsl(var(--foreground))" : "hsl(var(--background))"} strokeWidth={editingCategory === entry.name ? 3 : 2} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="mt-2 space-y-1.5 max-h-[260px] overflow-auto pr-1">
                    {fixedByCategory.map((cat, i) => (
                      <div key={cat.name} className={cn("flex items-center gap-2 px-2 py-1.5 rounded transition-colors", editingCategory === cat.name ? "bg-muted" : "hover:bg-muted/50")}>
                        <span className="h-3 w-3 rounded-sm shrink-0" style={{ background: C.pie[i % C.pie.length] }} />
                        <button type="button" className="flex-1 text-left text-sm truncate hover:underline" onClick={() => setEditingCategory(cat.name)}>
                          {cat.name}
                        </button>
                        <InlineNumber value={cat.value} onChange={(n) => { setEditingCategory(cat.name); setCategoryAmount(cat.name, n ?? 0); }} />
                      </div>
                    ))}
                    <div className="flex items-center justify-between border-t-2 border-dept/40 mt-2 pt-2 px-2">
                      <span className="text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground">Totale / mese</span>
                      <span className="font-mono font-bold tabular-nums">{eur(fixedMonthly)}</span>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* ====================== MONTHLY TRACKER TABLE ====================== */}
          <Card className="border-2 border-dept/40 lg:col-span-3">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Tracker mensile · {year}</CardTitle>
              <p className="text-xs text-muted-foreground">Le entrate previste sono modificabili. Le righe in rosso indicano flusso negativo.</p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs uppercase tracking-wider">Mese</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right">Competenza</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right">Cassa reale</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right">Spese fisse</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right">Uscite</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right">Flusso</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-center">Stato</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trackerRows.map((r) => {
                      const negative = r.flusso < 0;
                      const ok = r.flusso > 0;
                      return (
                        <TableRow key={r.idx} className={cn(negative && "bg-destructive/5")}>
                          <TableCell className="font-medium py-2">{r.mese}</TableCell>
                          <TableCell className={cn("text-right py-2", r.isProjected && "text-muted-foreground italic")}>
                            <InlineNumber value={r.competenza || undefined} onChange={(n) => updateForecast(r.idx, n)} />
                            {r.isProjected && <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mt-0.5">proiezione</div>}
                          </TableCell>
                          <TableCell className="text-right py-2 font-mono tabular-nums">{eur(r.reali)}</TableCell>
                          <TableCell className="text-right py-2 font-mono tabular-nums text-muted-foreground">{eur(r.fisse)}</TableCell>
                          <TableCell className="text-right py-2 font-mono tabular-nums">{eur(r.uscite)}</TableCell>
                          <TableCell className={cn("text-right py-2 font-mono tabular-nums font-semibold", negative ? "text-destructive" : ok ? "text-primary" : "")}>{eur(r.flusso)}</TableCell>
                          <TableCell className="text-center py-2">
                            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: negative ? "hsl(var(--destructive))" : ok ? "hsl(142 70% 38%)" : "hsl(var(--muted-foreground))" }} />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="border-t-2 border-dept/60 bg-muted/40 font-semibold">
                      <TableCell className="py-2">Totale</TableCell>
                      <TableCell className="text-right py-2 font-mono tabular-nums">{eur(trackerRows.reduce((s, r) => s + r.competenza, 0))}</TableCell>
                      <TableCell className="text-right py-2 font-mono tabular-nums">{eur(trackerRows.reduce((s, r) => s + r.reali, 0))}</TableCell>
                      <TableCell className="text-right py-2 font-mono tabular-nums">{eur(trackerRows.reduce((s, r) => s + r.fisse, 0))}</TableCell>
                      <TableCell className="text-right py-2 font-mono tabular-nums">{eur(trackerRows.reduce((s, r) => s + r.uscite, 0))}</TableCell>
                      <TableCell className={cn("text-right py-2 font-mono tabular-nums", totals.saldo < 0 ? "text-destructive" : "text-primary")}>{eur(totals.saldo)}</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>

        <p className="text-[11px] text-muted-foreground text-center">
          Suggerimento: clicca qualsiasi numero (target KPI, fette del donut, entrate previste, soglia alert) per modificarlo. Premi Invio per confermare.
        </p>
      </CardContent>
    </Card>
  );
};
