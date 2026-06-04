import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Users, Building2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSharedCloudState } from "@/hooks/useSharedCloudState";

type Operator = { id: string; name: string; role?: string };
type Assignment = {
  id: string;
  commessa_id: string | null;
  cantiere_label: string;
  operator_id: string;
  date: string;
  hours: number;
  notes: string | null;
  created_by: string;
};

const OPERATORS_KEY = "montaggi:operai:v1";

const COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6", "#F97316"];
const colorForCantiere = (label: string) => {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
};
const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const startOfWeek = (d: Date) => {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
};

const dayLabel = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

const prettyOpName = (raw: string) => {
  const s = raw.startsWith("proj:") ? raw.slice(5) : raw;
  return s
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
};

const DAYS = 14;
const TARGET_HOURS_PER_DAY = 8;

/** Calendario globale: vista a 2 settimane con toggle Per operaio / Per cantiere. */
export const CalendarGlobalView = () => {
  const [view, setView] = useState<"operai" | "cantieri">("operai");
  const [start, setStart] = useState<Date>(startOfWeek(new Date()));
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const ops = useSharedCloudState<Operator[]>(OPERATORS_KEY, []);

  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDays(start, i)), [start]);
  const dayStrs = useMemo(() => days.map(fmtDate), [days]);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("montaggi_planning")
      .select("*")
      .gte("date", dayStrs[0])
      .lte("date", dayStrs[dayStrs.length - 1])
      .order("date");
    if (error) {
      toast.error("Errore caricamento");
      setLoading(false);
      return;
    }
    setAssignments((data ?? []) as Assignment[]);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dayStrs[0]]);

  useEffect(() => {
    const ch = supabase.channel("calendar_global")
      .on("postgres_changes", { event: "*", schema: "public", table: "montaggi_planning" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, []);

  // Indice: operator_id → date → assignments
  const byOp = useMemo(() => {
    const m = new Map<string, Map<string, Assignment[]>>();
    for (const a of assignments) {
      if (!m.has(a.operator_id)) m.set(a.operator_id, new Map());
      const dayMap = m.get(a.operator_id)!;
      const list = dayMap.get(a.date) ?? [];
      list.push(a);
      dayMap.set(a.date, list);
    }
    return m;
  }, [assignments]);

  // Indice: cantiere_label → date → assignments
  const byCantiere = useMemo(() => {
    const m = new Map<string, Map<string, Assignment[]>>();
    for (const a of assignments) {
      if (!m.has(a.cantiere_label)) m.set(a.cantiere_label, new Map());
      const dayMap = m.get(a.cantiere_label)!;
      const list = dayMap.get(a.date) ?? [];
      list.push(a);
      dayMap.set(a.date, list);
    }
    return m;
  }, [assignments]);

  const allCantieri = useMemo(() => Array.from(byCantiere.keys()).sort(), [byCantiere]);
  const allOperators = ops.state;
  // Operai noti ma anche operai che compaiono solo nei dati (fallback)
  const orphanOps = useMemo(() => {
    const known = new Set(allOperators.map((o) => o.id));
    const out: Operator[] = [];
    for (const id of byOp.keys()) {
      if (!known.has(id)) out.push({ id, name: prettyOpName(id), role: "" });
    }
    return out;
  }, [allOperators, byOp]);
  const displayedOps = [...allOperators, ...orphanOps];

  const todayStr = fmtDate(new Date());

  return (
    <div className="space-y-4">
      <Card className="border-2 border-dept shadow-soft">
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5" />Calendario montaggi · 2 settimane</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Verifica chi è sovraccarico e dove servono più operai. Modifica le assegnazioni dal singolo progetto.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={view} onValueChange={(v) => setView(v as any)}>
              <TabsList>
                <TabsTrigger value="operai"><Users className="h-3.5 w-3.5 mr-1" />Per operaio</TabsTrigger>
                <TabsTrigger value="cantieri"><Building2 className="h-3.5 w-3.5 mr-1" />Per cantiere</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex items-center gap-1">
              <Button size="icon" variant="outline" onClick={() => setStart(addDays(start, -7))}><ChevronLeft className="h-4 w-4" /></Button>
              <div className="px-3 text-sm font-mono">
                {days[0].toLocaleDateString("it-IT", { day: "2-digit", month: "short" })} – {days[days.length - 1].toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })}
              </div>
              <Button size="icon" variant="outline" onClick={() => setStart(addDays(start, 7))}><ChevronRight className="h-4 w-4" /></Button>
              <Button size="sm" variant="outline" onClick={() => setStart(startOfWeek(new Date()))}>Oggi</Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card className="border-2 border-dept shadow-soft overflow-hidden">
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Caricamento…</div>
          ) : view === "operai" ? (
            <table className="w-full border-collapse min-w-[1100px]">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wider border-b border-border w-[200px]">Operaio</th>
                  {days.map((d, i) => {
                    const isToday = fmtDate(d) === todayStr;
                    const isWeekStart = i === 7;
                    return (
                      <th key={i} className={`px-1 py-2 text-center text-xs border-b border-border ${isToday ? "bg-dept-soft" : ""} ${isWeekStart ? "border-l-2 border-l-dept" : ""}`}>
                        <div className="font-semibold">{dayLabel[i % 7]}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{d.getDate()}/{d.getMonth() + 1}</div>
                      </th>
                    );
                  })}
                  <th className="px-2 py-2 text-center text-xs uppercase border-b border-border border-l-2 border-l-dept w-[70px]">Tot</th>
                </tr>
              </thead>
              <tbody>
                {displayedOps.length === 0 ? (
                  <tr><td colSpan={DAYS + 2} className="p-6 text-center text-sm text-muted-foreground">Nessun operaio. Aggiungili dal singolo progetto.</td></tr>
                ) : displayedOps.map((op) => {
                  const dayMap = byOp.get(op.id) ?? new Map();
                  let total = 0;
                  for (const d of dayStrs) {
                    const list = (dayMap.get(d) ?? []) as Assignment[];
                    total += list.reduce((s, a) => s + Number(a.hours || 0), 0);
                  }
                  const targetWeek = TARGET_HOURS_PER_DAY * 5 * 2; // 80h su 2 sett.
                  const overload = total > targetWeek + 10;
                  const underload = total < targetWeek - 16;
                  return (
                    <tr key={op.id} className="hover:bg-muted/20">
                      <td className="px-3 py-1.5 border-b border-border align-top">
                        <div className="font-medium text-sm">{op.name}</div>
                        {op.role && <div className="text-[10px] text-muted-foreground">{op.role}</div>}
                      </td>
                      {days.map((d, i) => {
                        const dateStr = fmtDate(d);
                        const list = (dayMap.get(dateStr) ?? []) as Assignment[];
                        const dayHours = list.reduce((s, a) => s + Number(a.hours || 0), 0);
                        const isWeekStart = i === 7;
                        const isToday = dateStr === todayStr;
                        return (
                          <td key={dateStr} className={`p-0.5 border-b border-l border-border align-top ${isWeekStart ? "border-l-2 border-l-dept" : ""} ${isToday ? "bg-dept-soft/30" : ""}`}>
                            <div className="space-y-0.5 min-h-[42px]">
                              {list.map((a) => (
                                <div
                                  key={a.id}
                                  className="px-1 py-0.5 rounded text-[9px] font-medium text-white truncate"
                                  style={{ backgroundColor: colorForCantiere(a.cantiere_label) }}
                                  title={`${a.cantiere_label} · ${a.hours}h${a.notes ? ` · ${a.notes}` : ""}`}
                                >
                                  {a.cantiere_label.slice(0, 10)} {a.hours}h
                                </div>
                              ))}
                              {dayHours > TARGET_HOURS_PER_DAY + 1 && (
                                <div className="flex items-center gap-0.5 text-[9px] text-rose-600">
                                  <AlertTriangle className="h-2 w-2" />{dayHours}h
                                </div>
                              )}
                            </div>
                          </td>
                        );
                      })}
                      <td className={`px-2 py-1.5 border-b border-l-2 border-l-dept text-center font-mono text-sm ${overload ? "text-rose-600 font-bold" : underload ? "text-amber-600" : ""}`}>
                        {total}h
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <table className="w-full border-collapse min-w-[1100px]">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wider border-b border-border w-[200px]">Cantiere</th>
                  {days.map((d, i) => {
                    const isToday = fmtDate(d) === todayStr;
                    const isWeekStart = i === 7;
                    return (
                      <th key={i} className={`px-1 py-2 text-center text-xs border-b border-border ${isToday ? "bg-dept-soft" : ""} ${isWeekStart ? "border-l-2 border-l-dept" : ""}`}>
                        <div className="font-semibold">{dayLabel[i % 7]}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{d.getDate()}/{d.getMonth() + 1}</div>
                      </th>
                    );
                  })}
                  <th className="px-2 py-2 text-center text-xs uppercase border-b border-border border-l-2 border-l-dept w-[80px]">Pers·g</th>
                </tr>
              </thead>
              <tbody>
                {allCantieri.length === 0 ? (
                  <tr><td colSpan={DAYS + 2} className="p-6 text-center text-sm text-muted-foreground">Nessun cantiere attivo nel periodo.</td></tr>
                ) : allCantieri.map((c) => {
                  const dayMap = byCantiere.get(c) ?? new Map();
                  let totPersonDays = 0;
                  for (const d of dayStrs) {
                    const list = (dayMap.get(d) ?? []) as Assignment[];
                    totPersonDays += new Set(list.map((a) => a.operator_id)).size;
                  }
                  return (
                    <tr key={c} className="hover:bg-muted/20">
                      <td className="px-3 py-1.5 border-b border-border align-top">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: colorForCantiere(c) }} />
                          <span className="font-medium text-sm truncate">{c}</span>
                        </div>
                      </td>
                      {days.map((d, i) => {
                        const dateStr = fmtDate(d);
                        const list = (dayMap.get(dateStr) ?? []) as Assignment[];
                        const isWeekStart = i === 7;
                        const isToday = dateStr === todayStr;
                        const dow = (d.getDay() + 6) % 7;
                        const isWeekend = dow >= 5;
                        return (
                          <td key={dateStr} className={`p-0.5 border-b border-l border-border align-top ${isWeekStart ? "border-l-2 border-l-dept" : ""} ${isToday ? "bg-dept-soft/30" : ""} ${isWeekend ? "bg-muted/30" : ""}`}>
                            <div className="space-y-0.5 min-h-[42px]">
                              {list.map((a) => {
                                const opName = displayedOps.find((o) => o.id === a.operator_id)?.name ?? prettyOpName(a.operator_id);
                                return (
                                  <div
                                    key={a.id}
                                    className="px-1 py-0.5 rounded text-[9px] bg-background border border-border truncate"
                                    title={`${opName} · ${a.hours}h`}
                                  >
                                    {opName} {a.hours}h
                                  </div>
                                );
                              })}
                              {list.length === 0 && !isWeekend && (
                                <div className="text-[9px] text-muted-foreground/40 text-center">—</div>
                              )}
                            </div>
                          </td>
                        );
                      })}
                      <td className="px-2 py-1.5 border-b border-l-2 border-l-dept text-center font-mono text-sm">
                        {totPersonDays}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Legenda */}
      <Card className="border border-border">
        <CardContent className="p-3 flex flex-wrap items-center gap-3 text-xs">
          <Badge variant="outline" className="border-rose-500 text-rose-600">
            <AlertTriangle className="h-3 w-3 mr-1" />Sovraccarico (&gt;90h/2sett. o &gt;{TARGET_HOURS_PER_DAY}h/g)
          </Badge>
          <Badge variant="outline" className="border-amber-500 text-amber-600">Sottocarico (&lt;64h/2sett.)</Badge>
          <span className="text-muted-foreground">Le modifiche si fanno dal singolo progetto in <strong>Assegnazione</strong>.</span>
        </CardContent>
      </Card>
    </div>
  );
};
