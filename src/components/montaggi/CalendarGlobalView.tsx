import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Users, Building2, AlertTriangle, Plus, Trash2, Save, Search, Factory } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSharedCloudState } from "@/hooks/useSharedCloudState";
import { uid } from "@/lib/format";

type Reparto = "montaggi" | "laboratorio" | "tappezzeria" | "falegnameria" | "altro";
type Operator = { id: string; name: string; role?: string; userId?: string; reparti?: Reparto[] };
type Assignment = {
  id: string;
  commessa_id: string | null;
  cantiere_label: string;
  operator_id: string;
  date: string;
  hours: number;
  notes: string | null;
  created_by: string;
  reparto?: Reparto;
};
type ProdSub = {
  id: string;
  assignee_id: string | null;
  dept: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  due_date: string | null;
  order_id: string;
};
type ProfileLite = { id: string; display_name: string | null };

const OPERATORS_KEY = "montaggi:operai:v1";

const REPARTI: Reparto[] = ["montaggi", "laboratorio", "tappezzeria", "falegnameria", "altro"];
const REPARTO_LABEL: Record<Reparto, string> = {
  montaggi: "Montaggi",
  laboratorio: "Laboratorio",
  tappezzeria: "Tappezzeria",
  falegnameria: "Falegnameria",
  altro: "Altro",
};
const REPARTO_BG: Record<Reparto, string> = {
  montaggi: "#F59E0B",
  laboratorio: "#0EA5E9",
  tappezzeria: "#A855F7",
  falegnameria: "#92400E",
  altro: "#6B7280",
};

const COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6", "#F97316"];
const colorForCantiere = (label: string) => {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
};
const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d: Date) => { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0,0,0,0); return x; };
const dayLabel = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

const prettyOpName = (raw: string) => {
  const s = raw.startsWith("proj:") ? raw.slice(5) : raw;
  return s.split("-").filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
};

const DAYS = 14;
const TARGET_HOURS_PER_DAY = 8;

export const CalendarGlobalView = () => {
  const { user } = useAuth();
  const [view, setView] = useState<"operai" | "cantieri">("operai");
  const [start, setStart] = useState<Date>(startOfWeek(new Date()));
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [prodSubs, setProdSubs] = useState<ProdSub[]>([]);
  const [profiles, setProfiles] = useState<ProfileLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ operatorId: string; date: string; existing?: Assignment } | null>(null);

  // Filtri
  const [filterText, setFilterText] = useState("");
  const [filterReparto, setFilterReparto] = useState<"all" | Reparto>("all");
  const [filterCantiere, setFilterCantiere] = useState<string>("all");

  // Gestione operai (con buffer locale + salva esplicito)
  const ops = useSharedCloudState<Operator[]>(OPERATORS_KEY, []);
  const [opsDraft, setOpsDraft] = useState<Operator[] | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (ops.ready && opsDraft === null) setOpsDraft(ops.state); }, [ops.ready, ops.state, opsDraft]);

  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDays(start, i)), [start]);
  const dayStrs = useMemo(() => days.map(fmtDate), [days]);

  const load = async () => {
    setLoading(true);
    const [{ data: planData, error: e1 }, { data: subData }, { data: profData }] = await Promise.all([
      supabase.from("montaggi_planning").select("*").gte("date", dayStrs[0]).lte("date", dayStrs[dayStrs.length - 1]).order("date"),
      supabase.from("production_sub_orders").select("id, assignee_id, dept, status, started_at, completed_at, due_date, order_id"),
      supabase.from("profiles").select("id, display_name").order("display_name"),
    ]);
    if (e1) { toast.error("Errore caricamento"); setLoading(false); return; }
    setAssignments((planData ?? []) as Assignment[]);
    setProdSubs((subData ?? []) as ProdSub[]);
    setProfiles((profData ?? []) as ProfileLite[]);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dayStrs[0]]);

  useEffect(() => {
    const ch = supabase.channel("calendar_global")
      .on("postgres_changes", { event: "*", schema: "public", table: "montaggi_planning" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "production_sub_orders" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, []);

  // Indice operatore → giorno → assegnazioni (incluso impegni produzione)
  type CellItem =
    | { kind: "cantiere"; a: Assignment }
    | { kind: "prod"; sub: ProdSub };

  const allOperators = opsDraft ?? ops.state;

  const orphanOps = useMemo(() => {
    const known = new Set(allOperators.map((o) => o.id));
    const set = new Set<string>();
    assignments.forEach((a) => { if (!known.has(a.operator_id)) set.add(a.operator_id); });
    return Array.from(set).map((id) => ({ id, name: prettyOpName(id), role: "", reparti: ["montaggi" as Reparto] } as Operator));
  }, [allOperators, assignments]);
  const displayedOps = [...allOperators, ...orphanOps];

  const allCantieriSet = useMemo(() => Array.from(new Set(assignments.map((a) => a.cantiere_label))).sort(), [assignments]);

  // Calcola gli impegni "produzione" per (userId, data)
  const prodByUserDay = useMemo(() => {
    const m = new Map<string, Map<string, ProdSub[]>>();
    for (const s of prodSubs) {
      if (!s.assignee_id) continue;
      // intervallo coperto: da started_at (o due_date) a completed_at (o today)
      const startStr = s.started_at ? s.started_at.slice(0, 10) : s.due_date ?? null;
      if (!startStr) continue;
      const endStr = s.completed_at
        ? s.completed_at.slice(0, 10)
        : s.status === "completato" ? startStr
        : fmtDate(new Date());
      // se l'intervallo non interseca la finestra, salta
      if (endStr < dayStrs[0] || startStr > dayStrs[dayStrs.length - 1]) continue;
      const from = new Date(Math.max(new Date(startStr).getTime(), new Date(dayStrs[0]).getTime()));
      const to = new Date(Math.min(new Date(endStr).getTime(), new Date(dayStrs[dayStrs.length - 1]).getTime()));
      const cur = new Date(from);
      while (cur <= to) {
        const ds = fmtDate(cur);
        if (!m.has(s.assignee_id)) m.set(s.assignee_id, new Map());
        const dayMap = m.get(s.assignee_id)!;
        const list = dayMap.get(ds) ?? [];
        list.push(s);
        dayMap.set(ds, list);
        cur.setDate(cur.getDate() + 1);
      }
    }
    return m;
  }, [prodSubs, dayStrs]);

  // Filtraggio
  const filteredOps = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return displayedOps.filter((o) => {
      if (q && !o.name.toLowerCase().includes(q)) return false;
      if (filterReparto !== "all" && !(o.reparti ?? ["montaggi"]).includes(filterReparto)) return false;
      return true;
    });
  }, [displayedOps, filterText, filterReparto]);

  const filteredAssignments = useMemo(() => {
    return assignments.filter((a) => {
      if (filterCantiere !== "all" && a.cantiere_label !== filterCantiere) return false;
      if (filterReparto !== "all" && (a.reparto ?? "montaggi") !== filterReparto) return false;
      return true;
    });
  }, [assignments, filterReparto, filterCantiere]);

  const byOp = useMemo(() => {
    const m = new Map<string, Map<string, Assignment[]>>();
    for (const a of filteredAssignments) {
      if (!m.has(a.operator_id)) m.set(a.operator_id, new Map());
      const dayMap = m.get(a.operator_id)!;
      const list = dayMap.get(a.date) ?? [];
      list.push(a);
      dayMap.set(a.date, list);
    }
    return m;
  }, [filteredAssignments]);

  const byCantiere = useMemo(() => {
    const m = new Map<string, Map<string, Assignment[]>>();
    for (const a of filteredAssignments) {
      if (!m.has(a.cantiere_label)) m.set(a.cantiere_label, new Map());
      const dayMap = m.get(a.cantiere_label)!;
      const list = dayMap.get(a.date) ?? [];
      list.push(a);
      dayMap.set(a.date, list);
    }
    return m;
  }, [filteredAssignments]);

  const allCantieri = useMemo(() => Array.from(byCantiere.keys()).sort(), [byCantiere]);
  const todayStr = fmtDate(new Date());

  // === Worker manager handlers ===
  const updateDraft = (next: Operator[]) => { setOpsDraft(next); setDirty(true); };
  const addOperator = () => updateDraft([...(opsDraft ?? []), { id: uid(), name: "Nuovo operaio", role: "", reparti: ["montaggi"] }]);
  const patchOperator = (id: string, p: Partial<Operator>) => updateDraft((opsDraft ?? []).map((o) => o.id === id ? { ...o, ...p } : o));
  const removeOperator = (id: string) => updateDraft((opsDraft ?? []).filter((o) => o.id !== id));
  const saveOperators = async () => {
    if (!opsDraft) return;
    await ops.setState(opsDraft);
    setDirty(false);
    toast.success("Operai salvati");
  };
  const resetOperators = () => { setOpsDraft(ops.state); setDirty(false); };

  const toggleReparto = (op: Operator, r: Reparto) => {
    const cur = new Set(op.reparti ?? ["montaggi"]);
    if (cur.has(r)) cur.delete(r); else cur.add(r);
    if (cur.size === 0) cur.add("montaggi");
    patchOperator(op.id, { reparti: Array.from(cur) as Reparto[] });
  };

  // === Save / Delete assignment dal calendario globale ===
  const saveAssignment = async (p: { id?: string; operator_id: string; date: string; hours: number; cantiere_label: string; notes?: string | null; reparto?: Reparto }) => {
    if (!user) return toast.error("Non autenticato");
    if (!p.cantiere_label.trim()) return toast.error("Inserisci il nome del cantiere");
    if (p.id) {
      const { error } = await supabase.from("montaggi_planning").update({
        operator_id: p.operator_id, date: p.date, hours: p.hours,
        cantiere_label: p.cantiere_label, notes: p.notes ?? null, reparto: p.reparto ?? "montaggi",
      }).eq("id", p.id);
      if (error) return toast.error(error.message);
      toast.success("Impegno aggiornato");
    } else {
      const { error } = await supabase.from("montaggi_planning").insert({
        operator_id: p.operator_id, date: p.date, hours: p.hours,
        cantiere_label: p.cantiere_label, notes: p.notes ?? null, reparto: p.reparto ?? "montaggi",
        commessa_id: null, created_by: user.id,
      });
      if (error) return toast.error(error.message);
      toast.success("Impegno aggiunto");
    }
    setEditing(null);
    load();
  };
  const deleteAssignment = async (id: string) => {
    const { error } = await supabase.from("montaggi_planning").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Impegno eliminato");
    setEditing(null);
    load();
  };
  const allCantieriList = useMemo(() => Array.from(new Set(assignments.map((a) => a.cantiere_label).filter(Boolean))).sort(), [assignments]);

  return (
    <div className="space-y-4">
      {/* === Header navigazione === */}
      <Card className="border-2 border-dept shadow-soft">
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5" />Pianificazione · 2 settimane</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">Operai, cantieri e impegni di laboratorio/tappezzeria. Le assegnazioni si fanno dal singolo progetto.</p>
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

      {/* === Filtri === */}
      <Card className="border border-border">
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8 h-9" placeholder="Filtra per nome operaio…" value={filterText} onChange={(e) => setFilterText(e.target.value)} />
          </div>
          <Select value={filterReparto} onValueChange={(v) => setFilterReparto(v as any)}>
            <SelectTrigger className="w-[180px] h-9"><SelectValue placeholder="Reparto" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti i reparti</SelectItem>
              {REPARTI.map((r) => <SelectItem key={r} value={r}>{REPARTO_LABEL[r]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterCantiere} onValueChange={(v) => setFilterCantiere(v)}>
            <SelectTrigger className="w-[220px] h-9"><SelectValue placeholder="Cantiere" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti i cantieri</SelectItem>
              {allCantieriSet.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          {(filterText || filterReparto !== "all" || filterCantiere !== "all") && (
            <Button size="sm" variant="ghost" onClick={() => { setFilterText(""); setFilterReparto("all"); setFilterCantiere("all"); }}>Reset</Button>
          )}
        </CardContent>
      </Card>

      {/* === Calendario === */}
      <Card className="border-2 border-dept shadow-soft overflow-hidden">
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Caricamento…</div>
          ) : view === "operai" ? (
            <table className="w-full border-collapse min-w-[1100px]">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wider border-b border-border w-[220px]">Operaio</th>
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
                {filteredOps.length === 0 ? (
                  <tr><td colSpan={DAYS + 2} className="p-6 text-center text-sm text-muted-foreground">Nessun operaio corrispondente ai filtri.</td></tr>
                ) : filteredOps.map((op) => {
                  const dayMap = byOp.get(op.id) ?? new Map();
                  const prodMap = op.userId ? (prodByUserDay.get(op.userId) ?? new Map()) : new Map();
                  let total = 0;
                  for (const d of dayStrs) {
                    const list = (dayMap.get(d) ?? []) as Assignment[];
                    total += list.reduce((s, a) => s + Number(a.hours || 0), 0);
                  }
                  const targetWeek = TARGET_HOURS_PER_DAY * 5 * 2;
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
                        const prodList = (prodMap.get(dateStr) ?? []) as ProdSub[];
                        const dayHours = list.reduce((s, a) => s + Number(a.hours || 0), 0);
                        const isWeekStart = i === 7;
                        const isToday = dateStr === todayStr;
                        return (
                          <td key={dateStr} className={`p-0.5 border-b border-l border-border align-top ${isWeekStart ? "border-l-2 border-l-dept" : ""} ${isToday ? "bg-dept-soft/30" : ""}`}>
                            <div className="space-y-0.5 min-h-[42px]">
                              {list.map((a) => (
                                <button
                                  key={a.id}
                                  type="button"
                                  onClick={() => setEditing({ operatorId: op.id, date: dateStr, existing: a })}
                                  className="w-full text-left px-1 py-0.5 rounded text-[9px] font-medium text-white truncate hover:opacity-80 transition"
                                  style={{ backgroundColor: colorForCantiere(a.cantiere_label) }}
                                  title={`${a.cantiere_label} · ${a.hours}h · clic per modificare`}
                                >
                                  {a.cantiere_label.slice(0, 10)} {a.hours}h
                                </button>
                              ))}
                              {prodList.map((s) => {
                                const r = (s.dept as Reparto) in REPARTO_BG ? (s.dept as Reparto) : "altro";
                                return (
                                  <div key={s.id} className="px-1 py-0.5 rounded text-[9px] font-medium text-white truncate flex items-center gap-0.5"
                                    style={{ backgroundColor: REPARTO_BG[r], opacity: 0.85 }}
                                    title={`${REPARTO_LABEL[r]} · ${s.status}`}>
                                    <Factory className="h-2 w-2" />{REPARTO_LABEL[r].slice(0, 8)}
                                  </div>
                                );
                              })}
                              <button
                                type="button"
                                onClick={() => setEditing({ operatorId: op.id, date: dateStr })}
                                className="w-full px-1 py-0.5 rounded text-[9px] text-muted-foreground hover:bg-dept/10 hover:text-dept transition flex items-center justify-center"
                                title="Aggiungi impegno"
                              >
                                <Plus className="h-2.5 w-2.5" />
                              </button>
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
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wider border-b border-border w-[220px]">Cantiere</th>
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
                  <tr><td colSpan={DAYS + 2} className="p-6 text-center text-sm text-muted-foreground">Nessun cantiere nel periodo selezionato.</td></tr>
                ) : allCantieri.map((c) => {
                  const dayMap = byCantiere.get(c) ?? new Map();
                  let totPersonDays = 0;
                  for (const d of dayStrs) {
                    const list = (dayMap.get(d) ?? []) as Assignment[];
                    totPersonDays += new Set(list.map((a) => a.operator_id)).size;
                  }
                  // reparto dominante del cantiere
                  const reps = new Map<string, number>();
                  (byCantiere.get(c) ? Array.from(byCantiere.get(c)!.values()).flat() : []).forEach((a) => {
                    const r = a.reparto ?? "montaggi";
                    reps.set(r, (reps.get(r) ?? 0) + 1);
                  });
                  const reparto = (Array.from(reps.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "montaggi") as Reparto;
                  return (
                    <tr key={c} className="hover:bg-muted/20">
                      <td className="px-3 py-1.5 border-b border-border align-top">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: colorForCantiere(c) }} />
                          <span className="font-medium text-sm truncate">{c}</span>
                        </div>
                        <span className="text-[9px] px-1 rounded inline-block mt-0.5" style={{ backgroundColor: `${REPARTO_BG[reparto]}22`, color: REPARTO_BG[reparto] }}>{REPARTO_LABEL[reparto]}</span>
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
                                  <div key={a.id} className="px-1 py-0.5 rounded text-[9px] bg-background border border-border truncate" title={`${opName} · ${a.hours}h`}>
                                    {opName} {a.hours}h
                                  </div>
                                );
                              })}
                              {list.length === 0 && !isWeekend && <div className="text-[9px] text-muted-foreground/40 text-center">—</div>}
                            </div>
                          </td>
                        );
                      })}
                      <td className="px-2 py-1.5 border-b border-l-2 border-l-dept text-center font-mono text-sm">{totPersonDays}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* === Gestione operai === */}
      <Card className="border-2 border-dept shadow-soft">
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" />Operai</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={addOperator}><Plus className="h-4 w-4" />Aggiungi</Button>
            {dirty && <Button size="sm" variant="ghost" onClick={resetOperators}>Annulla</Button>}
            <Button size="sm" onClick={saveOperators} disabled={!dirty}><Save className="h-4 w-4" />Salva</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {(opsDraft ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessun operaio. Premi "Aggiungi" per inserirne uno.</p>
          ) : (opsDraft ?? []).map((op) => (
            <div key={op.id} className="border border-border rounded-sm p-2 space-y-2 bg-background">
              <div className="grid gap-2 md:grid-cols-[1fr_1fr_1.5fr_auto]">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase">Nome</Label>
                  <Input value={op.name} onChange={(e) => patchOperator(op.id, { name: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase">Ruolo</Label>
                  <Input value={op.role ?? ""} onChange={(e) => patchOperator(op.id, { role: e.target.value })} placeholder="Es. Montatore senior" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase">Utente collegato</Label>
                  <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={op.userId ?? ""} onChange={(e) => patchOperator(op.id, { userId: e.target.value || undefined })}>
                    <option value="">— Nessun utente —</option>
                    {profiles.map((p) => <option key={p.id} value={p.id}>{p.display_name ?? p.id.slice(0, 8)}</option>)}
                  </select>
                </div>
                <div className="flex items-end">
                  <Button size="icon" variant="ghost" onClick={() => removeOperator(op.id)} title="Elimina"><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Label className="text-[10px] uppercase w-full">Reparti</Label>
                {REPARTI.map((r) => {
                  const active = (op.reparti ?? ["montaggi"]).includes(r);
                  return (
                    <button key={r} type="button" onClick={() => toggleReparto(op, r)}
                      className={`text-[10px] px-2 py-1 rounded border ${active ? "text-white" : "text-muted-foreground bg-background"}`}
                      style={active ? { backgroundColor: REPARTO_BG[r], borderColor: REPARTO_BG[r] } : { borderColor: "hsl(var(--border))" }}>
                      {REPARTO_LABEL[r]}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {dirty && <p className="text-[11px] text-amber-600">Modifiche non salvate — premi "Salva".</p>}
        </CardContent>
      </Card>

      {/* === Legenda === */}
      <Card className="border border-border">
        <CardContent className="p-3 flex flex-wrap items-center gap-3 text-xs">
          <Badge variant="outline" className="border-rose-500 text-rose-600"><AlertTriangle className="h-3 w-3 mr-1" />Sovraccarico (&gt;90h/2sett.)</Badge>
          <Badge variant="outline" className="border-amber-500 text-amber-600">Sottocarico (&lt;64h/2sett.)</Badge>
          {REPARTI.map((r) => (
            <span key={r} className="inline-flex items-center gap-1 text-[10px]">
              <span className="w-2 h-2 rounded" style={{ backgroundColor: REPARTO_BG[r] }} />{REPARTO_LABEL[r]}
            </span>
          ))}
          <span className="text-muted-foreground ml-auto">Gli impegni di laboratorio/tappezzeria provengono dai sub-ordini di produzione assegnati.</span>
        </CardContent>
      </Card>
    </div>
  );
};
