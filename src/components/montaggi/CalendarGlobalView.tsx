import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
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

type Reparto = "montaggi" | "laboratorio" | "tappezzeria" | "vendite" | "magazzino" | "falegnameria" | "stampa" | "taglio" | "stampa_3d" | "assemblaggio" | "progettazione" | "altro";
type CalendarMode = "montaggi" | "lavorazioni";
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
type ProfileLite = { id: string; display_name: string | null; settori?: string[] | null };

const OPERATORS_KEY = "montaggi:operai:v1";

const REPARTI: Reparto[] = ["montaggi", "laboratorio", "tappezzeria", "vendite", "magazzino", "falegnameria", "stampa", "taglio", "stampa_3d", "assemblaggio", "progettazione", "altro"];
const REPARTO_LABEL: Record<Reparto, string> = {
  montaggi: "Montaggi",
  laboratorio: "Laboratorio",
  tappezzeria: "Tappezzeria",
  vendite: "Vendite",
  magazzino: "Magazzino",
  falegnameria: "Falegnameria",
  stampa: "Stampa",
  taglio: "Taglio",
  stampa_3d: "Stampa 3D",
  assemblaggio: "Assemblaggio",
  progettazione: "Progettazione",
  altro: "Altro",
};
const REPARTO_BG: Record<Reparto, string> = {
  montaggi: "#F59E0B",
  laboratorio: "#0EA5E9",
  tappezzeria: "#A855F7",
  vendite: "#10B981",
  magazzino: "#334155",
  falegnameria: "#92400E",
  stampa: "#DC2626",
  taglio: "#7C3AED",
  stampa_3d: "#0891B2",
  assemblaggio: "#65A30D",
  progettazione: "#475569",
  altro: "#6B7280",
};

// Reparti gestiti per modalità
const MODE_REPARTI: Record<CalendarMode, Reparto[]> = {
  montaggi: ["montaggi"],
  lavorazioni: ["laboratorio", "tappezzeria", "vendite", "magazzino", "falegnameria", "stampa", "taglio", "stampa_3d", "assemblaggio", "progettazione"],
};

const colorForCantiere = (label: string) => {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const saturation = 70 + ((h >>> 8) % 12);
  const lightness = 32 + ((h >>> 16) % 10);
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
};
// Colore del chip = cantiere (per distinguere chiaramente impegni diversi)
// Accento sul bordo sinistro = reparto (tipo di impegno)
const chipColorForAssignment = (a: Pick<Assignment, "reparto" | "cantiere_label">) => {
  return colorForCantiere(a.cantiere_label);
};
const repartoAccent = (a: Pick<Assignment, "reparto">) => {
  const r = (a.reparto ?? "montaggi") as Reparto;
  return REPARTO_BG[r] ?? REPARTO_BG.altro;
};
const fmtDate = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const parseDateKey = (value: string) => {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d: Date) => { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0,0,0,0); return x; };
const dayLabel = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

const prettyOpName = (raw: string) => {
  const s = raw.startsWith("proj:") ? raw.slice(5) : raw;
  return s.split("-").filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
};


const DAYS = 14;
const TARGET_HOURS_PER_DAY = 8;

// Cache di modulo per evitare loading blank al re-mount (cambio tab)
type CacheEntry = { assignments: Assignment[]; prodSubs: ProdSub[]; profiles: ProfileLite[]; startKey: string };
const dataCache = new Map<string, CacheEntry>();

type CalendarGlobalViewProps = {
  /** @deprecated usa selectedReparti */
  mode?: CalendarMode;
  /** Reparti su cui filtrare il calendario. Vuoto = "Tutti" (stampa, taglio, tappezzeria, montaggi). */
  selectedReparti?: Reparto[];
};

/** Reparti disponibili come filtri rapidi a tab nella pianificazione. */
const FILTER_REPARTI: Reparto[] = ["stampa", "taglio", "tappezzeria", "montaggi", "magazzino"];

export const CalendarGlobalView = ({ mode, selectedReparti }: CalendarGlobalViewProps) => {
  const { user } = useAuth();

  // Costruisci allowedReparti dai filtri scelti (prop nuova) oppure dalla vecchia mode.
  const allowedReparti = useMemo<Reparto[]>(() => {
    if (selectedReparti && selectedReparti.length > 0) return selectedReparti;
    if (selectedReparti && selectedReparti.length === 0) return FILTER_REPARTI;
    if (mode) return MODE_REPARTI[mode];
    return FILTER_REPARTI;
  }, [selectedReparti, mode]);
  const defaultReparto = allowedReparti[0];
  const repartiKey = useMemo(() => [...allowedReparti].sort().join(","), [allowedReparti]);
  const includesMontaggi = allowedReparti.includes("montaggi");
  const nonMontaggiReparti = useMemo(() => allowedReparti.filter((r) => r !== "montaggi"), [allowedReparti]);

  const [view, setView] = useState<"operai" | "cantieri">("operai");
  const [start, setStart] = useState<Date>(startOfWeek(new Date()));
  // Inizializza dalla cache di modulo per evitare flash al re-mount
  const initialCache = dataCache.get(`${repartiKey}|${fmtDate(startOfWeek(new Date()))}`);
  const [assignments, setAssignments] = useState<Assignment[]>(initialCache?.assignments ?? []);
  const [prodSubs, setProdSubs] = useState<ProdSub[]>(initialCache?.prodSubs ?? []);
  const [profiles, setProfiles] = useState<ProfileLite[]>(initialCache?.profiles ?? []);
  const [loading, setLoading] = useState(!initialCache);
  const [editing, setEditing] = useState<{ operatorId: string; date: string; existing?: Assignment } | null>(null);

  // Filtri
  const [filterText, setFilterText] = useState("");
  const [filterCantiere, setFilterCantiere] = useState<string>("all");

  // Reset filtro quando cambiano i reparti selezionati
  useEffect(() => { setFilterCantiere("all"); }, [repartiKey]);


  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Gestione operai (con buffer locale + salva esplicito)
  const ops = useSharedCloudState<Operator[]>(OPERATORS_KEY, []);
  const [opsDraft, setOpsDraft] = useState<Operator[] | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (ops.ready && opsDraft === null) setOpsDraft(ops.state); }, [ops.ready, ops.state, opsDraft]);

  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDays(start, i)), [start]);
  const dayStrs = useMemo(() => days.map(fmtDate), [days]);

  // Carica solo la finestra corrente. Niente realtime su ogni modifica: gli update sono ottimistici
  // e restano locali, così la griglia non si ricarica continuamente mentre lavori.
  const profilesLoadedRef = useRef(initialCache ? true : false);
  const cacheKey = useMemo(() => `${repartiKey}|${dayStrs[0]}`, [repartiKey, dayStrs]);

  const load = useCallback(async () => {
    const cached = dataCache.get(cacheKey);
    // Mostra "Caricamento…" solo se non abbiamo dati visibili
    if (!cached) setLoading(true);
    const firstDay = dayStrs[0];
    const lastDay = dayStrs[dayStrs.length - 1];
    let planQuery = supabase.from("montaggi_planning")
      .select("*")
      .gte("date", firstDay)
      .lte("date", lastDay);
    // I record con reparto=null sono considerati "montaggi" (legacy)
    if (includesMontaggi && nonMontaggiReparti.length === 0) {
      planQuery = planQuery.or("reparto.eq.montaggi,reparto.is.null");
    } else if (includesMontaggi) {
      planQuery = planQuery.or(`reparto.is.null,reparto.in.(${allowedReparti.join(",")})`);
    } else {
      planQuery = planQuery.in("reparto", allowedReparti);
    }
    const planP = planQuery.order("date").then((r) => r);
    const subP = nonMontaggiReparti.length > 0
      ? supabase.from("production_sub_orders")
        .select("id, assignee_id, dept, status, started_at, completed_at, due_date, order_id")
        .in("dept", nonMontaggiReparti)
        .or(`due_date.gte.${firstDay},started_at.gte.${firstDay},completed_at.gte.${firstDay}`)
        .then((r) => r)
      : Promise.resolve({ data: [], error: null });
    const profP = profilesLoadedRef.current
      ? null
      : supabase.from("profiles").select("id, display_name, settori").order("display_name").then((r) => r);
    const [planRes, subRes, profRes] = await Promise.all([planP, subP, profP]);
    const planData = planRes?.data; const e1 = planRes?.error;
    const subData = subRes?.data;
    if (e1) { toast.error("Errore caricamento"); setLoading(false); return; }
    const nextAssignments = (planData ?? []) as Assignment[];
    const nextProdSubs = (subData ?? []) as ProdSub[];
    setAssignments(nextAssignments);
    setProdSubs(nextProdSubs);
    let nextProfiles = profiles;
    if (profRes) {
      nextProfiles = (profRes.data ?? []) as ProfileLite[];
      setProfiles(nextProfiles);
      profilesLoadedRef.current = true;
    }
    dataCache.set(cacheKey, { assignments: nextAssignments, prodSubs: nextProdSubs, profiles: nextProfiles, startKey: dayStrs[0] });
    setLoading(false);
  }, [allowedReparti, cacheKey, dayStrs, includesMontaggi, nonMontaggiReparti, profiles]);



  useEffect(() => {
    const cached = dataCache.get(cacheKey);
    if (cached) {
      setAssignments(cached.assignments);
      setProdSubs(cached.prodSubs);
      if (cached.profiles.length > 0) {
        setProfiles(cached.profiles);
        profilesLoadedRef.current = true;
      }
      setLoading(false);
    } else {
      setAssignments([]);
      setProdSubs([]);
      setLoading(true);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  useEffect(() => {
    if (!loading || assignments.length > 0 || prodSubs.length > 0 || profiles.length > 0) {
      dataCache.set(cacheKey, { assignments, prodSubs, profiles, startKey: dayStrs[0] });
    }
  }, [assignments, prodSubs, profiles, loading, cacheKey, dayStrs]);

  // Indice operatore → giorno → assegnazioni (incluso impegni produzione)
  type CellItem =
    | { kind: "cantiere"; a: Assignment }
    | { kind: "prod"; sub: ProdSub };

  const allOperators = opsDraft ?? ops.state;

  // Filtra le assegnazioni per modalità (montaggi vs lavorazioni)
  const modeAssignments = useMemo(() => {
    return assignments.filter((a) => allowedReparti.includes((a.reparto ?? "montaggi") as Reparto));
  }, [assignments, allowedReparti]);

  // Solo gli operai usati nelle assegnazioni della modalità corrente vengono considerati "manuali"
  const allOperatorsForMode = useMemo(() => {
    return allOperators.filter((o) => {
      const reps = o.reparti ?? ["montaggi"];
      return reps.some((r) => allowedReparti.includes(r as Reparto));
    });
  }, [allOperators, allowedReparti]);

  const orphanOps = useMemo(() => {
    const known = new Set(allOperatorsForMode.map((o) => o.id));
    const set = new Set<string>();
    modeAssignments.forEach((a) => { if (!known.has(a.operator_id)) set.add(a.operator_id); });
    return Array.from(set).map((id) => {
      const prof = profiles.find((p) => p.id === id);
      return {
        id,
        name: prof?.display_name ?? prettyOpName(id),
        userId: prof ? id : undefined,
        role: "",
        reparti: [defaultReparto],
      } as Operator;
    });
  }, [allOperatorsForMode, modeAssignments, defaultReparto, profiles]);

  // Operai dal personale (profili) che hanno almeno uno dei settori della modalità
  const profileOps = useMemo(() => {
    const known = new Set([...allOperatorsForMode.map((o) => o.id), ...orphanOps.map((o) => o.id)]);
    return profiles
      .filter((p) => Array.isArray(p.settori) && p.settori.some((s) => allowedReparti.includes(s as Reparto)) && !known.has(p.id))
      .map((p) => ({
        id: p.id,
        name: p.display_name ?? prettyOpName(p.id),
        role: "",
        userId: p.id,
        reparti: (p.settori ?? []).filter((s) => allowedReparti.includes(s as Reparto)) as Reparto[],
      } as Operator));
  }, [profiles, allOperatorsForMode, orphanOps, allowedReparti]);

  const displayedOps = [...allOperatorsForMode, ...orphanOps, ...profileOps];

  const allCantieriSet = useMemo(() => Array.from(new Set(modeAssignments.map((a) => a.cantiere_label))).sort(), [modeAssignments]);

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
      const from = new Date(Math.max(parseDateKey(startStr).getTime(), parseDateKey(dayStrs[0]).getTime()));
      const to = new Date(Math.min(parseDateKey(endStr).getTime(), parseDateKey(dayStrs[dayStrs.length - 1]).getTime()));
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
      return true;
    });
  }, [displayedOps, filterText]);

  const filteredAssignments = useMemo(() => {
    return modeAssignments.filter((a) => {
      if (filterCantiere !== "all" && a.cantiere_label !== filterCantiere) return false;
      return true;
    });
  }, [modeAssignments, filterCantiere]);


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

  // === Save / Delete assignment (OTTIMISTICO) ===
  // Aggiorniamo subito lo stato locale; il realtime poi riallinea (debounced).
  const saveAssignment = async (
    p: { id?: string; operator_id: string; date: string; hours: number; cantiere_label: string; notes?: string | null; reparto?: Reparto },
    opts?: { silent?: boolean; closeDialog?: boolean },
  ) => {
    if (!user) return toast.error("Non autenticato");
    if (!p.cantiere_label.trim()) return toast.error("Inserisci il nome del cantiere");
    const reparto = p.reparto ?? defaultReparto;
    if (p.id) {
      const prev = assignments;
      setAssignments((cur) => cur.map((x) => x.id === p.id ? {
        ...x, operator_id: p.operator_id, date: p.date, hours: p.hours,
        cantiere_label: p.cantiere_label, notes: p.notes ?? null, reparto,
      } : x));
      const { error } = await supabase.from("montaggi_planning").update({
        operator_id: p.operator_id, date: p.date, hours: p.hours,
        cantiere_label: p.cantiere_label, notes: p.notes ?? null, reparto,
      }).eq("id", p.id);
      if (error) { setAssignments(prev); return toast.error(error.message); }
      if (!opts?.silent) toast.success("Impegno aggiornato");
    } else {
      const tempId = `tmp_${uid()}`;
      const optimistic: Assignment = {
        id: tempId, commessa_id: null, cantiere_label: p.cantiere_label,
        operator_id: p.operator_id, date: p.date, hours: p.hours,
        notes: p.notes ?? null, created_by: user.id, reparto,
      };
      setAssignments((cur) => [...cur, optimistic]);
      const { data, error } = await supabase.from("montaggi_planning").insert({
        operator_id: p.operator_id, date: p.date, hours: p.hours,
        cantiere_label: p.cantiere_label, notes: p.notes ?? null, reparto,
        commessa_id: null, created_by: user.id,
      }).select().single();
      if (error) {
        setAssignments((cur) => cur.filter((x) => x.id !== tempId));
        return toast.error(error.message);
      }
      setAssignments((cur) => cur.map((x) => x.id === tempId ? (data as Assignment) : x));
      if (!opts?.silent) toast.success("Impegno aggiunto");
    }
    if (opts?.closeDialog !== false) setEditing(null);
  };
  const deleteAssignment = async (id: string, opts?: { silent?: boolean }) => {
    const prev = assignments;
    setAssignments((cur) => cur.filter((x) => x.id !== id));
    const { error } = await supabase.from("montaggi_planning").delete().eq("id", id);
    if (error) { setAssignments(prev); return toast.error(error.message); }
    if (!opts?.silent) toast.success("Impegno eliminato");
    setEditing(null);
  };

  // === Spostamento veloce: drag HTML nativo, molto più leggero di @dnd-kit sulla griglia grande ===
  const moveAssignment = (dragId: string, targetOp: string, targetDate: string) => {
    const a = modeAssignments.find((x) => x.id === dragId);
    if (!a) return;
    if (a.operator_id === targetOp && a.date === targetDate) return;
    saveAssignment(
      { id: a.id, operator_id: targetOp, date: targetDate, hours: a.hours, cantiere_label: a.cantiere_label, notes: a.notes, reparto: a.reparto },
      { silent: true, closeDialog: false },
    );
  };

  const handleDropAssignment = (dragId: string, targetOp: string, targetDate: string) => {
    setDraggingId(null);
    moveAssignment(dragId, targetOp, targetDate);
  };

  const allCantieriList = useMemo(() => Array.from(new Set(modeAssignments.map((a) => a.cantiere_label).filter(Boolean))).sort(), [modeAssignments]);

  return (
    <div className="space-y-4">
      {/* === Header navigazione === */}
      <Card className="border-2 border-dept shadow-soft">
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5" />Pianificazione · 2 settimane</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">Reparti attivi: {allowedReparti.map((r) => REPARTO_LABEL[r]).join(", ")}. Trascina o clicca su un impegno per spostarlo.</p>

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
          <Select value={filterCantiere} onValueChange={(v) => setFilterCantiere(v)}>
            <SelectTrigger className="w-[220px] h-9"><SelectValue placeholder="Cantiere" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti i cantieri</SelectItem>
              {allCantieriSet.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          {(filterText || filterCantiere !== "all") && (
            <Button size="sm" variant="ghost" onClick={() => { setFilterText(""); setFilterCantiere("all"); }}>Reset</Button>
          )}
        </CardContent>
      </Card>


      {/* === Calendario === */}
      <Card className="border-2 border-dept shadow-soft overflow-hidden">
        <CardContent className="p-0 overflow-x-auto">
          {loading && assignments.length === 0 && prodSubs.length === 0 ? (
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
                            <DroppableCell
                              key={dateStr}
                              id={`${op.id}|${dateStr}`}
                              className={`p-0.5 border-b border-l border-border align-top ${isWeekStart ? "border-l-2 border-l-dept" : ""} ${isToday ? "bg-dept-soft/30" : ""}`}
                              draggingId={draggingId}
                              onDropAssignment={(dragId) => handleDropAssignment(dragId, op.id, dateStr)}
                            >
                              <div className="space-y-1 min-h-[64px]">
                                {list.map((a) => (
                                  <DraggableChip
                                    key={a.id}
                                    assignment={a}
                                    onOpenDialog={() => setEditing({ operatorId: op.id, date: dateStr, existing: a })}
                                    onDragState={setDraggingId}
                                  />
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
                            </DroppableCell>
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
                          <td key={dateStr} className={`p-1 border-b border-l border-border align-top ${isWeekStart ? "border-l-2 border-l-dept" : ""} ${isToday ? "bg-dept-soft/30" : ""} ${isWeekend ? "bg-muted/30" : ""}`}>
                            <div className="space-y-1 min-h-[64px]">
                              {list.map((a) => {
                                const rep = (a.reparto ?? "montaggi") as Reparto;
                                const opName = displayedOps.find((o) => o.id === a.operator_id)?.name ?? prettyOpName(a.operator_id);
                                return (
                                  <button
                                    key={a.id}
                                    type="button"
                                    onClick={() => setEditing({ operatorId: a.operator_id, date: dateStr, existing: a })}
                                    className="w-full text-left px-2 py-1.5 rounded-md text-[11px] font-bold text-white hover:opacity-90 hover:scale-[1.02] active:scale-95 transition-all border-l-[5px] shadow-md ring-1 ring-black/10 leading-tight"
                                    style={{
                                      backgroundColor: chipColorForAssignment(a),
                                      borderLeftColor: repartoAccent(a),
                                    }}
                                    title={`${REPARTO_LABEL[rep]} · ${opName} · ${a.hours}h · clic per modificare`}
                                  >
                                    <div className="truncate">{opName}</div>
                                    <div className="flex items-center justify-between gap-1 mt-0.5 opacity-95">
                                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-black/25 truncate">{REPARTO_LABEL[rep]}</span>
                                      <span className="text-[10px] font-extrabold bg-white/25 px-1.5 py-0.5 rounded">{a.hours}h</span>
                                    </div>
                                  </button>
                                );
                              })}
                              {list.length === 0 && !isWeekend && <div className="text-[10px] text-muted-foreground/40 text-center pt-2">—</div>}
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
          <span className="text-muted-foreground ml-auto">Colore chip = cantiere · bordo sinistro = reparto. La griglia non si ricarica più dopo ogni modifica.</span>
        </CardContent>
      </Card>

      {/* === Dialog modifica/aggiunta impegno === */}
      {editing && (
        <EditAssignmentDialog
          editing={editing}
          operators={displayedOps}
          allCantieri={allCantieriList}
          allowedReparti={allowedReparti}
          defaultReparto={defaultReparto}
          onClose={() => setEditing(null)}
          onSave={saveAssignment}
          onDelete={editing.existing ? () => deleteAssignment(editing.existing!.id) : undefined}
        />
      )}
    </div>
  );
};

/** ============================================================
 *  DraggableChip — assegnazione in calendario
 *  - drag HTML nativo: meno componenti e meno listener sulla griglia grande
 *  - click = popover modifica veloce
 *  - doppio click = dialog completo
 *  ============================================================ */
type DraggableChipProps = {
  assignment: Assignment;
  onOpenDialog: () => void;
  onDragState: (id: string | null) => void;
};

const DraggableChip = ({ assignment: a, onOpenDialog, onDragState }: DraggableChipProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const rep = (a.reparto ?? "montaggi") as Reparto;

  return (
    <button
      type="button"
      draggable
      onClick={onOpenDialog}
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", a.id); e.dataTransfer.effectAllowed = "move"; setIsDragging(true); onDragState(a.id); }}
      onDragEnd={() => { setIsDragging(false); onDragState(null); }}
      className="w-full text-left px-2 py-1.5 rounded-md text-[11px] font-bold text-white hover:opacity-90 hover:scale-[1.02] active:scale-95 transition-all cursor-grab active:cursor-grabbing border-l-[5px] shadow-md ring-1 ring-black/10 leading-tight"
      style={{
        backgroundColor: chipColorForAssignment(a),
        borderLeftColor: repartoAccent(a),
        opacity: isDragging ? 0.4 : 1,
      }}
      title={`${REPARTO_LABEL[rep]} · ${a.cantiere_label} · ${a.hours}h · clic per modificare, trascina per spostare`}
    >
      <div className="truncate uppercase tracking-tight">{a.cantiere_label}</div>
      <div className="flex items-center justify-between gap-1 mt-0.5 opacity-95">
        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-black/25 truncate">{REPARTO_LABEL[rep]}</span>
        <span className="text-[10px] font-extrabold bg-white/25 px-1.5 py-0.5 rounded">{a.hours}h</span>
      </div>
    </button>
  );
};

/** ============================================================
 *  DroppableCell — cella calendario che accetta i chip
 *  ============================================================ */
type DroppableCellProps = { id: string; className?: string; children: ReactNode; draggingId: string | null; onDropAssignment: (dragId: string) => void };
const DroppableCell = ({ id, className, children, draggingId, onDropAssignment }: DroppableCellProps) => {
  const [isOver, setIsOver] = useState(false);
  return (
    <td
      onDragOver={(e: DragEvent<HTMLTableCellElement>) => { if (!draggingId) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
      onDragEnter={() => { if (draggingId) setIsOver(true); }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e: DragEvent<HTMLTableCellElement>) => { e.preventDefault(); setIsOver(false); const dragId = e.dataTransfer.getData("text/plain"); if (dragId) onDropAssignment(dragId); }}
      className={`${className ?? ""} ${isOver ? "ring-2 ring-inset ring-primary bg-primary/10" : ""}`}
    >
      {children}
    </td>
  );
};

/** Dialog inline per modificare/aggiungere un impegno dal calendario globale */
type EditDialogProps = {
  editing: { operatorId: string; date: string; existing?: Assignment };
  operators: Operator[];
  allCantieri: string[];
  allowedReparti: Reparto[];
  defaultReparto: Reparto;
  onClose: () => void;
  onSave: (p: { id?: string; operator_id: string; date: string; hours: number; cantiere_label: string; notes?: string | null; reparto?: Reparto }) => void;
  onDelete?: () => void;
};

const EditAssignmentDialog = ({ editing, operators, allCantieri, allowedReparti, defaultReparto, onClose, onSave, onDelete }: EditDialogProps) => {
  const ex = editing.existing;
  const [operatorId, setOperatorId] = useState(ex?.operator_id ?? editing.operatorId);
  const [date, setDate] = useState(ex?.date ?? editing.date);
  const [hours, setHours] = useState<number>(ex?.hours ?? 8);
  const [cantiere, setCantiere] = useState(ex?.cantiere_label ?? "");
  const [notes, setNotes] = useState(ex?.notes ?? "");
  const [reparto, setReparto] = useState<Reparto>((ex?.reparto as Reparto) ?? defaultReparto);

  const currentOperator = operators.find((o) => o.id === operatorId);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>{ex ? "Dettagli attività" : "Nuovo impegno"}</span>
            <span
              className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-sm"
              style={{ backgroundColor: `${REPARTO_BG[reparto]}22`, color: REPARTO_BG[reparto], border: `1px solid ${REPARTO_BG[reparto]}55` }}
            >
              {REPARTO_LABEL[reparto]}
            </span>
          </DialogTitle>
        </DialogHeader>
        {ex && (
          <div
            className="rounded-sm border-2 p-3 space-y-2"
            style={{ borderColor: `${REPARTO_BG[reparto]}55`, backgroundColor: `${REPARTO_BG[reparto]}0d` }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Cantiere / Commessa</div>
                <div className="text-lg font-bold leading-tight break-words">{cantiere || "—"}</div>
              </div>
              <div
                className="shrink-0 text-sm font-mono font-bold px-2 py-1 rounded-sm text-white"
                style={{ backgroundColor: REPARTO_BG[reparto] }}
              >
                {hours}h
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Operaio</div>
                <div className="font-bold">{currentOperator?.name ?? "—"}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Data</div>
                <div className="font-mono font-bold">
                  {(() => { try { return new Date(date).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }); } catch { return date; } })()}
                </div>
              </div>
            </div>
            {notes && (
              <div>
                <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Note</div>
                <div className="text-xs whitespace-pre-wrap">{notes}</div>
              </div>
            )}
          </div>
        )}
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Tipo di attività / Reparto</Label>
            <select
              className="h-11 w-full rounded-md border-2 border-input bg-background px-3 text-sm font-bold uppercase tracking-wider"
              style={{ borderColor: REPARTO_BG[reparto], color: REPARTO_BG[reparto] }}
              value={reparto}
              onChange={(e) => setReparto(e.target.value as Reparto)}
            >
              {(allowedReparti.length > 1 ? allowedReparti : REPARTI).map((r) => (
                <option key={r} value={r}>{REPARTO_LABEL[r]}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Operaio</Label>
            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={operatorId} onChange={(e) => setOperatorId(e.target.value)}>
              {operators.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>Data</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Ore</Label>
              <Input type="number" min={0} max={24} step={0.5} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Cantiere</Label>
            <Input list="cantieri-list-global" placeholder="Nome cantiere" value={cantiere} onChange={(e) => setCantiere(e.target.value)} />
            <datalist id="cantieri-list-global">
              {allCantieri.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label>Note</Label>
            <Input value={notes ?? ""} onChange={(e) => setNotes(e.target.value)} placeholder="Note opzionali" />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          {onDelete && (
            <Button variant="destructive" onClick={onDelete} className="mr-auto">
              <Trash2 className="h-4 w-4" />Elimina
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>Annulla</Button>
          <Button onClick={() => onSave({ id: ex?.id, operator_id: operatorId, date, hours, cantiere_label: cantiere, notes, reparto })}>
            <Save className="h-4 w-4" />Salva
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
