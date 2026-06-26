import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, BarChart3, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { fetchDipendenti, type Dipendente } from "@/lib/dipendenti";
import { uid } from "@/lib/format";

export type DayType = "lavoro" | "trasferta" | "ferie" | "permesso" | "malattia" | "festivo";
export type DaySegment = { t: DayType; h: number };
// New format: { segments: [...] }. Legacy format: { h, t } — handled transparently.
export type DayCell = { segments: DaySegment[] } | { h: number; t: DayType };
export type HoursRow = {
  id: string;
  dipendenteId?: string;
  name: string;
  days: Record<number, DayCell>;
};
export type HoursMonth = { rows: HoursRow[] };
export type HoursLog = Record<string, HoursMonth>; // key `${year}-${monthIndex}`

const MONTHS = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
const DAY_NAMES = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];

const TYPE_OPTIONS: { value: DayType; label: string; short: string; color: string; dot: string }[] = [
  { value: "lavoro", label: "Lavoro", short: "L", color: "bg-emerald-100 text-emerald-800 border-emerald-300", dot: "bg-emerald-500" },
  { value: "trasferta", label: "Trasferta", short: "T", color: "bg-blue-100 text-blue-800 border-blue-300", dot: "bg-blue-500" },
  { value: "ferie", label: "Ferie", short: "F", color: "bg-amber-100 text-amber-800 border-amber-300", dot: "bg-amber-500" },
  { value: "permesso", label: "Permesso", short: "P", color: "bg-purple-100 text-purple-800 border-purple-300", dot: "bg-purple-500" },
  { value: "malattia", label: "Malattia", short: "M", color: "bg-rose-100 text-rose-800 border-rose-300", dot: "bg-rose-500" },
  { value: "festivo", label: "Festivo", short: "X", color: "bg-slate-100 text-slate-700 border-slate-300", dot: "bg-slate-400" },
];
const typeMeta = (t: DayType) => TYPE_OPTIONS.find((o) => o.value === t) ?? TYPE_OPTIONS[0];

const getSegments = (cell: DayCell | undefined): DaySegment[] => {
  if (!cell) return [];
  if ("segments" in cell) return cell.segments.filter((s) => s && s.t);
  if (cell.h > 0 || cell.t) return [{ t: cell.t, h: Number(cell.h) || 0 }];
  return [];
};

const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
const monthKey = (year: number, month: number) => `${year}-${month}`;

type RowTotals = {
  ore: number;
  straordinario: number;
  trasfertaGiorni: number;
  trasfertaOre: number;
  ferieGiorni: number;
  permessoOre: number;
  malattiaGiorni: number;
};

const computeRowTotals = (row: HoursRow): RowTotals => {
  let ore = 0, straordinario = 0, trasfertaGiorni = 0, trasfertaOre = 0, ferieGiorni = 0, permessoOre = 0, malattiaGiorni = 0;
  Object.values(row.days || {}).forEach((cell) => {
    const segs = getSegments(cell);
    if (segs.length === 0) return;
    // Sum work hours (lavoro+trasferta) per day for overtime calc
    let workH = 0;
    let hadTrasferta = false;
    let hadFerie = false;
    let hadMalattia = false;
    segs.forEach((s) => {
      const h = Math.max(0, Number(s.h) || 0);
      if (s.t === "lavoro") workH += h;
      else if (s.t === "trasferta") { workH += h; trasfertaOre += h; hadTrasferta = true; }
      else if (s.t === "permesso") permessoOre += h;
      else if (s.t === "ferie") hadFerie = true;
      else if (s.t === "malattia") hadMalattia = true;
    });
    ore += Math.min(workH, 8);
    straordinario += Math.max(workH - 8, 0);
    if (hadTrasferta) trasfertaGiorni += 1;
    if (hadFerie) ferieGiorni += 1;
    if (hadMalattia) malattiaGiorni += 1;
  });
  return { ore, straordinario, trasfertaGiorni, trasfertaOre, ferieGiorni, permessoOre, malattiaGiorni };
};

type Props = {
  hoursLog: HoursLog;
  setHoursLog: (next: HoursLog) => void;
  canEdit: boolean;
};

export const HoursLogView = ({ hoursLog, setHoursLog, canEdit }: Props) => {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [activeMonth, setActiveMonth] = useState<number>(now.getMonth());
  const [dipendenti, setDipendenti] = useState<Dipendente[]>([]);
  const [statsFor, setStatsFor] = useState<{ name: string; dipendenteId?: string } | null>(null);

  useEffect(() => {
    fetchDipendenti(true).then(setDipendenti).catch(() => setDipendenti([]));
  }, []);

  const updateMonth = (m: number, updater: (prev: HoursMonth) => HoursMonth) => {
    const key = monthKey(year, m);
    const prev = hoursLog[key] ?? { rows: [] };
    setHoursLog({ ...hoursLog, [key]: updater(prev) });
  };

  const ensureMonthSeeded = (m: number) => {
    const key = monthKey(year, m);
    if (hoursLog[key] && hoursLog[key].rows.length > 0) return;
    const rows: HoursRow[] = dipendenti.map((d) => ({
      id: uid(),
      dipendenteId: d.id,
      name: d.nome,
      days: {},
    }));
    setHoursLog({ ...hoursLog, [key]: { rows } });
  };

  // Auto-seed when switching month
  useEffect(() => {
    if (dipendenti.length > 0) ensureMonthSeeded(activeMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMonth, year, dipendenti.length]);

  const importFromDipendenti = (m: number) => {
    const key = monthKey(year, m);
    const prev = hoursLog[key] ?? { rows: [] };
    const existingIds = new Set(prev.rows.map((r) => r.dipendenteId).filter(Boolean));
    const added: HoursRow[] = [];
    dipendenti.forEach((d) => {
      if (!existingIds.has(d.id)) {
        added.push({ id: uid(), dipendenteId: d.id, name: d.nome, days: {} });
      }
    });
    if (added.length === 0) {
      toast.info("Nessun nuovo dipendente da importare");
      return;
    }
    setHoursLog({ ...hoursLog, [key]: { rows: [...prev.rows, ...added] } });
    toast.success(`Importati ${added.length} dipendenti`);
  };

  return (
    <Card className="border-2 border-dept shadow-soft">
      <CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>Calcolo ore — presenze giornaliere</CardTitle>
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground">Anno</label>
          <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || now.getFullYear())} className="w-24 h-8" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Tabs value={String(activeMonth)} onValueChange={(v) => setActiveMonth(Number(v))}>
          <TabsList className="flex flex-wrap h-auto justify-start gap-1 bg-muted/40 p-1">
            {MONTHS.map((label, m) => {
              const key = monthKey(year, m);
              const month = hoursLog[key] ?? { rows: [] };
              const totals = month.rows.reduce(
                (acc, r) => {
                  const t = computeRowTotals(r);
                  acc.ore += t.ore + t.straordinario;
                  return acc;
                },
                { ore: 0 },
              );
              return (
                <TabsTrigger key={m} value={String(m)} className="flex flex-col items-center gap-0 px-3 py-1.5 data-[state=active]:bg-dept data-[state=active]:text-dept-foreground">
                  <span className="text-xs font-semibold">{label.slice(0, 3)}</span>
                  <span className="text-[10px] opacity-70">{totals.ore > 0 ? `${totals.ore.toFixed(0)}h` : "—"}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>
          {MONTHS.map((label, m) => {
            const key = monthKey(year, m);
            const month = hoursLog[key] ?? { rows: [] };
            return (
              <TabsContent key={m} value={String(m)} className="mt-3">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-base font-bold text-dept">{label} {year}</h3>
                  <span className="text-xs text-muted-foreground">{month.rows.length} dipendenti</span>
                </div>
                <MonthTable
                  year={year}
                  month={m}
                  data={month}
                  onChange={(next) => updateMonth(m, () => next)}
                  canEdit={canEdit}
                  dipendenti={dipendenti}
                  onImportDipendenti={() => importFromDipendenti(m)}
                  onOpenStats={(name, dipendenteId) => setStatsFor({ name, dipendenteId })}
                />
              </TabsContent>
            );
          })}
        </Tabs>
      </CardContent>
      <EmployeeStatsDialog
        open={!!statsFor}
        onClose={() => setStatsFor(null)}
        target={statsFor}
        year={year}
        hoursLog={hoursLog}
      />
    </Card>
  );
};

const MonthTable = ({
  year, month, data, onChange, canEdit, dipendenti, onImportDipendenti, onOpenStats,
}: {
  year: number; month: number; data: HoursMonth;
  onChange: (next: HoursMonth) => void;
  canEdit: boolean;
  dipendenti: Dipendente[];
  onImportDipendenti: () => void;
  onOpenStats: (name: string, dipendenteId?: string) => void;
}) => {
  const nDays = daysInMonth(year, month);
  const days = useMemo(() => Array.from({ length: nDays }, (_, i) => i + 1), [nDays]);

  const updateRow = (rowId: string, mutate: (row: HoursRow) => HoursRow) => {
    onChange({ rows: data.rows.map((r) => (r.id === rowId ? mutate(r) : r)) });
  };
  const removeRow = (rowId: string) => onChange({ rows: data.rows.filter((r) => r.id !== rowId) });
  const addRow = (name: string, dipendenteId?: string) => {
    onChange({ rows: [...data.rows, { id: uid(), name, dipendenteId, days: {} }] });
  };

  const setDaySegments = (rowId: string, dayNum: number, segments: DaySegment[]) => {
    updateRow(rowId, (r) => {
      const nextDays = { ...r.days };
      const clean = segments.filter((s) => s && s.t && (Number(s.h) || 0) > 0);
      if (clean.length === 0) {
        delete nextDays[dayNum];
      } else {
        nextDays[dayNum] = { segments: clean };
      }
      return { ...r, days: nextDays };
    });
  };

  return (
    <div className="space-y-2">
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onImportDipendenti}>
            <RefreshCw className="mr-1 h-3 w-3" />Importa da Dipendenti
          </Button>
          <AddRowControl dipendenti={dipendenti} existing={data.rows} onAdd={addRow} />
        </div>
      )}
      <div className="overflow-auto rounded-md border">
        <table className="text-xs">
          <thead className="bg-muted/50 sticky top-0">
            <tr>
              <th className="sticky left-0 z-10 bg-muted/50 px-2 py-1 text-left font-semibold min-w-[160px]">Dipendente</th>
              {days.map((d) => {
                const date = new Date(year, month, d);
                const dow = date.getDay();
                const weekend = dow === 0 || dow === 6;
                return (
                  <th key={d} className={`px-1 py-1 text-center font-medium min-w-[56px] ${weekend ? "bg-amber-50" : ""}`}>
                    <div className="font-bold">{d}</div>
                    <div className="text-[10px] text-muted-foreground">{DAY_NAMES[dow]}</div>
                  </th>
                );
              })}
              <th className="px-2 py-1 text-right font-semibold bg-emerald-50">Ore</th>
              <th className="px-2 py-1 text-right font-semibold bg-emerald-50">Str.</th>
              <th className="px-2 py-1 text-right font-semibold bg-blue-50">Trasf.</th>
              <th className="px-2 py-1 text-right font-semibold bg-amber-50">Ferie</th>
              <th className="px-2 py-1 text-right font-semibold bg-purple-50">Perm.</th>
              <th className="px-2 py-1 text-right font-semibold bg-rose-50">Mal.</th>
              {canEdit && <th className="px-1 py-1"></th>}
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && (
              <tr><td colSpan={nDays + 8} className="px-4 py-6 text-center text-muted-foreground">Nessun dipendente. Apri il mese per popolare la lista o usa "Importa da Dipendenti".</td></tr>
            )}
            {data.rows.map((row) => {
              const totals = computeRowTotals(row);
              return (
                <tr key={row.id} className="border-t hover:bg-muted/30">
                  <td className="sticky left-0 z-10 bg-paper px-2 py-1 font-medium">
                    <button
                      className="text-left hover:underline flex items-center gap-1"
                      onClick={() => onOpenStats(row.name, row.dipendenteId)}
                      title="Vedi statistiche"
                    >
                      <BarChart3 className="h-3 w-3 text-dept" />
                      {row.name}
                    </button>
                  </td>
                  {days.map((d) => {
                    const date = new Date(year, month, d);
                    const dow = date.getDay();
                    const weekend = dow === 0 || dow === 6;
                    const segs = getSegments(row.days[d]);
                    return (
                      <td key={d} className={`p-0.5 align-top ${weekend ? "bg-amber-50/40" : ""}`}>
                        <DayCellEditor
                          segments={segs}
                          canEdit={canEdit}
                          onChange={(next) => setDaySegments(row.id, d, next)}
                          headerLabel={`${row.name} — ${d}/${month + 1}/${year}`}
                        />
                      </td>
                    );
                  })}
                  <td className="px-2 py-1 text-right font-mono bg-emerald-50/40">{totals.ore.toFixed(1)}</td>
                  <td className="px-2 py-1 text-right font-mono bg-emerald-50/40">{totals.straordinario.toFixed(1)}</td>
                  <td className="px-2 py-1 text-right font-mono bg-blue-50/40">{totals.trasfertaGiorni}</td>
                  <td className="px-2 py-1 text-right font-mono bg-amber-50/40">{totals.ferieGiorni}</td>
                  <td className="px-2 py-1 text-right font-mono bg-purple-50/40">{totals.permessoOre.toFixed(1)}</td>
                  <td className="px-2 py-1 text-right font-mono bg-rose-50/40">{totals.malattiaGiorni}</td>
                  {canEdit && (
                    <td className="px-1 py-1">
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeRow(row.id)} title="Rimuovi">
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
        <span className="font-semibold">Legenda:</span>
        {TYPE_OPTIONS.map((o) => (
          <span key={o.value} className={`px-1.5 py-0.5 rounded border ${o.color}`}>{o.short} = {o.label}</span>
        ))}
        <span>· Ore lavoro+trasferta &gt; 8 = straordinario · Clicca una cella per inserire più voci (es. 6h L + 2h P)</span>
      </div>
    </div>
  );
};

const DayCellEditor = ({
  segments, canEdit, onChange, headerLabel,
}: { segments: DaySegment[]; canEdit: boolean; onChange: (next: DaySegment[]) => void; headerLabel: string }) => {
  const totalH = segments.reduce((s, x) => s + (Number(x.h) || 0), 0);
  const summary = (
    <div className="flex w-full flex-col items-stretch">
      <div className="rounded border px-1 py-0.5 text-center text-xs font-mono bg-paper hover:bg-muted/50 transition min-h-[22px]">
        {totalH > 0 ? totalH.toFixed(totalH % 1 ? 1 : 0) : <span className="text-muted-foreground">·</span>}
      </div>
      <div className="flex flex-wrap gap-0.5 justify-center mt-0.5 min-h-[14px]">
        {segments.length === 0 && <span className="text-[9px] text-muted-foreground/60">—</span>}
        {segments.map((s, i) => {
          const meta = typeMeta(s.t);
          return (
            <span key={i} className={`text-[9px] leading-none px-1 py-[1px] rounded border ${meta.color}`} title={`${s.h}h ${meta.label}`}>
              {meta.short}{s.h % 1 === 0 ? s.h : s.h.toFixed(1)}
            </span>
          );
        })}
      </div>
    </div>
  );

  if (!canEdit) return summary;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="block w-full">{summary}</button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        <div className="text-xs font-semibold mb-2">{headerLabel}</div>
        <SegmentsEditor segments={segments} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
};

const SegmentsEditor = ({ segments, onChange }: { segments: DaySegment[]; onChange: (next: DaySegment[]) => void }) => {
  const [draft, setDraft] = useState<DaySegment[]>(segments.length ? segments : [{ t: "lavoro", h: 0 }]);

  useEffect(() => {
    setDraft(segments.length ? segments : [{ t: "lavoro", h: 0 }]);
  }, [segments]);

  const apply = (next: DaySegment[]) => {
    setDraft(next);
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {draft.map((s, i) => {
        const meta = typeMeta(s.t);
        return (
          <div key={i} className="flex items-center gap-1">
            <select
              value={s.t}
              onChange={(e) => {
                const next = [...draft];
                next[i] = { ...next[i], t: e.target.value as DayType };
                apply(next);
              }}
              className={`rounded border px-1 py-1 text-xs ${meta.color}`}
            >
              {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <Input
              type="number" min={0} max={24} step={0.5}
              value={s.h || ""}
              onChange={(e) => {
                const next = [...draft];
                next[i] = { ...next[i], h: Number(e.target.value) || 0 };
                apply(next);
              }}
              className="h-7 w-16 text-xs"
              placeholder="ore"
            />
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => apply(draft.filter((_, j) => j !== i))} title="Rimuovi voce">
              <X className="h-3 w-3" />
            </Button>
          </div>
        );
      })}
      <div className="flex justify-between items-center pt-1 border-t">
        <Button size="sm" variant="outline" className="h-7" onClick={() => apply([...draft, { t: "permesso", h: 0 }])}>
          <Plus className="h-3 w-3 mr-1" />Aggiungi voce
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => apply([])}>Svuota</Button>
      </div>
      <div className="text-[10px] text-muted-foreground">
        Esempio: 6h <span className="font-semibold">Lavoro</span> + 2h <span className="font-semibold">Permesso</span> nello stesso giorno.
      </div>
    </div>
  );
};

const AddRowControl = ({
  dipendenti, existing, onAdd,
}: { dipendenti: Dipendente[]; existing: HoursRow[]; onAdd: (name: string, dipendenteId?: string) => void }) => {
  const [mode, setMode] = useState<"idle" | "free" | "pick">("idle");
  const [name, setName] = useState("");
  const existingIds = new Set(existing.map((r) => r.dipendenteId).filter(Boolean));
  const available = dipendenti.filter((d) => !existingIds.has(d.id));

  if (mode === "idle") {
    return (
      <>
        <Button size="sm" variant="outline" onClick={() => setMode("pick")}>
          <Plus className="mr-1 h-3 w-3" />Aggiungi dipendente
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setMode("free")}>
          <Plus className="mr-1 h-3 w-3" />Aggiungi nome libero
        </Button>
      </>
    );
  }
  if (mode === "pick") {
    return (
      <div className="flex gap-2 items-center">
        <select className="rounded border px-2 py-1 text-sm" defaultValue="" onChange={(e) => {
          const id = e.target.value;
          const d = available.find((x) => x.id === id);
          if (d) { onAdd(d.nome, d.id); setMode("idle"); }
        }}>
          <option value="">Seleziona dipendente…</option>
          {available.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
        </select>
        <Button size="sm" variant="ghost" onClick={() => setMode("idle")}>Annulla</Button>
      </div>
    );
  }
  return (
    <div className="flex gap-2 items-center">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome…" className="h-8 w-48" />
      <Button size="sm" onClick={() => { if (name.trim()) { onAdd(name.trim()); setName(""); setMode("idle"); } }}>Aggiungi</Button>
      <Button size="sm" variant="ghost" onClick={() => setMode("idle")}>Annulla</Button>
    </div>
  );
};

const EmployeeStatsDialog = ({
  open, onClose, target, year, hoursLog,
}: { open: boolean; onClose: () => void; target: { name: string; dipendenteId?: string } | null; year: number; hoursLog: HoursLog }) => {
  if (!target) return null;

  const monthlyStats = MONTHS.map((label, m) => {
    const key = `${year}-${m}`;
    const month = hoursLog[key];
    if (!month) return { label, ...emptyTotals() };
    const row = month.rows.find((r) => (target.dipendenteId && r.dipendenteId === target.dipendenteId) || r.name === target.name);
    if (!row) return { label, ...emptyTotals() };
    return { label, ...computeRowTotals(row) };
  });

  const annual = monthlyStats.reduce(
    (acc, m) => ({
      ore: acc.ore + m.ore,
      straordinario: acc.straordinario + m.straordinario,
      trasfertaGiorni: acc.trasfertaGiorni + m.trasfertaGiorni,
      trasfertaOre: acc.trasfertaOre + m.trasfertaOre,
      ferieGiorni: acc.ferieGiorni + m.ferieGiorni,
      permessoOre: acc.permessoOre + m.permessoOre,
      malattiaGiorni: acc.malattiaGiorni + m.malattiaGiorni,
    }),
    emptyTotals(),
  );

  const bestMonth = [...monthlyStats].sort((a, b) => b.ore - a.ore)[0];
  const worstMonth = [...monthlyStats].filter((m) => m.ore > 0).sort((a, b) => a.ore - b.ore)[0];
  const maxOre = Math.max(...monthlyStats.map((m) => m.ore), 1);
  const lavorativiAnno = 220;
  const oreAttese = lavorativiAnno * 8;
  const presenzaPct = oreAttese > 0 ? Math.min(100, (annual.ore / oreAttese) * 100) : 0;

  let totalOreAll = 0, countAll = 0;
  Object.values(hoursLog).forEach((m) => {
    m.rows.forEach((r) => {
      totalOreAll += computeRowTotals(r).ore;
      countAll += 1;
    });
  });
  const avgOreAzienda = countAll > 0 ? totalOreAll / countAll : 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Statistiche — {target.name}</DialogTitle>
          <DialogDescription>Anno {year}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
          <StatCard label="Ore totali" value={annual.ore.toFixed(1)} color="emerald" />
          <StatCard label="Straordinario" value={annual.straordinario.toFixed(1)} color="emerald" />
          <StatCard label="Giorni trasferta" value={String(annual.trasfertaGiorni)} color="blue" />
          <StatCard label="Giorni ferie" value={String(annual.ferieGiorni)} color="amber" />
          <StatCard label="Ore permesso" value={annual.permessoOre.toFixed(1)} color="purple" />
          <StatCard label="Giorni malattia" value={String(annual.malattiaGiorni)} color="rose" />
        </div>

        <Card className="mb-4">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Indicatori sintetici</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Indicator label="Presenza vs attese" value={`${presenzaPct.toFixed(1)}%`} sub={`${annual.ore.toFixed(0)}h / ${oreAttese}h`} />
            <Indicator label="Media mensile" value={`${(annual.ore / 12).toFixed(1)}h`} sub="ordinarie" />
            <Indicator label="Vs media azienda" value={`${avgOreAzienda > 0 ? ((annual.ore / avgOreAzienda) * 100).toFixed(0) : "—"}%`} sub={`media: ${avgOreAzienda.toFixed(0)}h`} />
            <Indicator label="Rapporto straord/ord" value={annual.ore > 0 ? `${((annual.straordinario / annual.ore) * 100).toFixed(1)}%` : "—"} sub="indice di intensità" />
            <Indicator label="Mese top" value={bestMonth?.ore ? bestMonth.label : "—"} sub={bestMonth?.ore ? `${bestMonth.ore.toFixed(1)}h` : ""} />
            <Indicator label="Mese più scarico" value={worstMonth?.ore ? worstMonth.label : "—"} sub={worstMonth?.ore ? `${worstMonth.ore.toFixed(1)}h` : ""} />
            <Indicator label="Assenze totali" value={String(annual.ferieGiorni + annual.malattiaGiorni)} sub="ferie + malattia (giorni)" />
            <Indicator label="Bilancio str.+trasf." value={`${annual.straordinario.toFixed(0)}h + ${annual.trasfertaGiorni}gg`} sub="extra effort" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Andamento mensile</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {monthlyStats.map((m) => (
                <div key={m.label} className="flex items-center gap-2 text-xs">
                  <div className="w-20 font-medium">{m.label}</div>
                  <div className="flex-1 h-4 bg-muted rounded relative overflow-hidden">
                    <div className="h-full bg-emerald-400" style={{ width: `${(m.ore / maxOre) * 100}%` }} />
                    {m.straordinario > 0 && (
                      <div className="absolute top-0 h-full bg-orange-400 opacity-80" style={{ left: `${(m.ore / maxOre) * 100}%`, width: `${(m.straordinario / maxOre) * 100}%` }} />
                    )}
                  </div>
                  <div className="w-32 text-right font-mono text-[11px]">
                    {m.ore.toFixed(1)}h
                    {m.straordinario > 0 && <span className="text-orange-600"> +{m.straordinario.toFixed(1)}str</span>}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-4 text-[10px] mt-3 text-muted-foreground">
              <span><span className="inline-block w-3 h-3 bg-emerald-400 align-middle rounded-sm mr-1" />Ore ordinarie</span>
              <span><span className="inline-block w-3 h-3 bg-orange-400 align-middle rounded-sm mr-1" />Straordinario</span>
            </div>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Dettaglio per mese</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-2 py-1 text-left">Mese</th>
                    <th className="px-2 py-1 text-right">Ore</th>
                    <th className="px-2 py-1 text-right">Straord.</th>
                    <th className="px-2 py-1 text-right">Trasf. (gg)</th>
                    <th className="px-2 py-1 text-right">Ferie (gg)</th>
                    <th className="px-2 py-1 text-right">Perm. (h)</th>
                    <th className="px-2 py-1 text-right">Mal. (gg)</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyStats.map((m) => (
                    <tr key={m.label} className="border-t">
                      <td className="px-2 py-1 font-medium">{m.label}</td>
                      <td className="px-2 py-1 text-right font-mono">{m.ore.toFixed(1)}</td>
                      <td className="px-2 py-1 text-right font-mono">{m.straordinario.toFixed(1)}</td>
                      <td className="px-2 py-1 text-right font-mono">{m.trasfertaGiorni}</td>
                      <td className="px-2 py-1 text-right font-mono">{m.ferieGiorni}</td>
                      <td className="px-2 py-1 text-right font-mono">{m.permessoOre.toFixed(1)}</td>
                      <td className="px-2 py-1 text-right font-mono">{m.malattiaGiorni}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 font-bold bg-muted/30">
                    <td className="px-2 py-1">TOTALE</td>
                    <td className="px-2 py-1 text-right font-mono">{annual.ore.toFixed(1)}</td>
                    <td className="px-2 py-1 text-right font-mono">{annual.straordinario.toFixed(1)}</td>
                    <td className="px-2 py-1 text-right font-mono">{annual.trasfertaGiorni}</td>
                    <td className="px-2 py-1 text-right font-mono">{annual.ferieGiorni}</td>
                    <td className="px-2 py-1 text-right font-mono">{annual.permessoOre.toFixed(1)}</td>
                    <td className="px-2 py-1 text-right font-mono">{annual.malattiaGiorni}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  );
};

const emptyTotals = (): RowTotals => ({ ore: 0, straordinario: 0, trasfertaGiorni: 0, trasfertaOre: 0, ferieGiorni: 0, permessoOre: 0, malattiaGiorni: 0 });

const StatCard = ({ label, value, color }: { label: string; value: string; color: string }) => {
  const map: Record<string, string> = {
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-900",
    blue: "bg-blue-50 border-blue-200 text-blue-900",
    amber: "bg-amber-50 border-amber-200 text-amber-900",
    purple: "bg-purple-50 border-purple-200 text-purple-900",
    rose: "bg-rose-50 border-rose-200 text-rose-900",
  };
  return (
    <div className={`rounded-md border p-2 ${map[color] || "bg-muted"}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-lg font-bold font-mono">{value}</div>
    </div>
  );
};

const Indicator = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="rounded border bg-paper p-2">
    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    <div className="font-mono text-base font-semibold">{value}</div>
    {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
  </div>
);
