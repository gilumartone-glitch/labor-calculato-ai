import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Plus, Trash2, AlertTriangle, ChevronLeft, ChevronRight, Globe, Hammer, X, MapPin, Package, Wrench, Link2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSharedCloudState } from "@/hooks/useSharedCloudState";
import { useCloudWorkspace } from "@/hooks/useCloudWorkspace";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { uid } from "@/lib/format";

/** ============================================================
 *  TIPI E COSTANTI
 *  ============================================================ */
type Operator = { id: string; name: string; role?: string; color?: string; userId?: string; reparti?: string[] };
type Reparto = "montaggi" | "laboratorio" | "tappezzeria" | "falegnameria" | "altro";
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

const OPERATORS_KEY = "montaggi:operai:v1";

const COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6", "#F97316"];
const colorForCantiere = (label: string) => {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
};

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
const dayLabel = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
const startOfWeek = (d: Date) => {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
};
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

const collectWorkersFromArchives = (): Operator[] => {
  if (typeof window === "undefined") return [];
  const out = new Map<string, Operator>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (!key.startsWith("officina:montaggi-module:v2") && !key.startsWith("officina:falegnameria-module:v1")) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const workers: Array<{ name?: string }> = Array.isArray(parsed?.workers) ? parsed.workers : [];
      for (const w of workers) {
        const name = (w?.name ?? "").trim();
        if (!name) continue;
        if (!out.has(name.toLowerCase())) {
          out.set(name.toLowerCase(), { id: uid(), name, role: "" });
        }
      }
    }
  } catch { /* ignore */ }
  return Array.from(out.values());
};

/** ============================================================
 *  PROPS
 *  ============================================================ */
type Props = {
  draftId: string;
  cantiereLabel: string;
  mode?: "project" | "global";
  defaultWorkers?: Array<{ name: string; role?: string }>;
  projectAddress?: string;
  projectMaterials?: Array<{ name: string; qty?: number; unit?: string }>;
  projectTools?: Array<{ name: string; qty?: number }>;
  /** Numero di giorni mostrati nel calendario (default 7). Usa 14 per panoramica 2 settimane. */
  daysCount?: number;
};

type ProfileLite = { id: string; display_name: string | null; settori?: string[] | null };

/** ============================================================
 *  COMPONENTE PRINCIPALE
 *  ============================================================ */
export const PianificazioneSection = ({
  draftId,
  cantiereLabel,
  mode = "project",
  defaultWorkers,
  projectAddress,
  projectMaterials,
  projectTools,
  daysCount = 7,
}: Props) => {
  const { user } = useAuth();
  const view: "progetto" | "panoramica" = mode === "global" ? "panoramica" : "progetto";
  const [weekStart, setWeekStart] = useState<Date>(startOfWeek(new Date()));
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ operatorId: string; date: string; existing?: Assignment } | null>(null);
  const [profiles, setProfiles] = useState<ProfileLite[]>([]);
  const [dipendentiList, setDipendentiList] = useState<Array<{ id: string; nome: string; funzione: string | null; profile_id: string | null; reparti: string[]; macro_reparti: string[] }>>([]);
  const [linkingOp, setLinkingOp] = useState<Operator | null>(null);

  // Inline add operator
  const [newOpNames, setNewOpNames] = useState("");
  // Bulk range — supporta più operai contemporaneamente
  const [bulk, setBulk] = useState<{ operatorIds: string[]; from: string; to: string; hours: number; includeWeekends: boolean }>(() => ({
    operatorIds: [],
    from: fmtDate(new Date()),
    to: fmtDate(addDays(new Date(), 2)),
    hours: 8,
    includeWeekends: false,
  }));

  const ops = useSharedCloudState<Operator[]>(OPERATORS_KEY, []);
  const extras = useCloudWorkspace<Operator[]>(`montaggi:planning-extras:${draftId}`, []);

  const slugName = (name: string) => `proj:${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  const projectOperators = useMemo<Operator[]>(() => {
    if (view !== "progetto") return [];
    const out: Operator[] = [];
    const seen = new Set<string>();
    // extras first (so linked userId etc. is preserved)
    for (const e of extras.state ?? []) {
      const name = (e.name ?? "").trim();
      if (!name) continue;
      const k = name.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ id: e.id || slugName(name), name, role: e.role ?? "", userId: e.userId });
    }
    for (const w of defaultWorkers ?? []) {
      const name = (w.name ?? "").trim();
      if (!name) continue;
      const k = name.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ id: slugName(name), name, role: w.role ?? "" });
    }
    return out;
  }, [view, defaultWorkers, extras.state]);

  // Operai dal personale (profili) con settore "montaggi" assegnato
  const profileOps = useMemo<Operator[]>(() => {
    if (view !== "progetto") return [];
    const seen = new Set(projectOperators.map((o) => (o.name ?? "").trim().toLowerCase()));
    return profiles
      .filter((p) => Array.isArray(p.settori) && p.settori.includes("montaggi"))
      .filter((p) => {
        const n = (p.display_name ?? "").trim().toLowerCase();
        if (!n) return false;
        if (seen.has(n)) return false;
        seen.add(n);
        return true;
      })
      .map((p) => ({
        id: p.id,
        name: p.display_name ?? p.id.slice(0, 8),
        role: "",
        userId: p.id,
      }));
  }, [profiles, projectOperators, view]);

  const operators = view === "progetto" ? [...projectOperators, ...profileOps] : ops.state;

  /** Seed in global mode */
  const seededRef = (typeof window !== "undefined") ? (window as unknown as { __montaggiOpsSeeded?: boolean }) : { __montaggiOpsSeeded: true };
  useEffect(() => {
    if (view !== "panoramica") return;
    if (!ops.ready || seededRef.__montaggiOpsSeeded) return;
    if (ops.state.length > 0) { seededRef.__montaggiOpsSeeded = true; return; }
    const seed = collectWorkersFromArchives();
    if (seed.length > 0) {
      seededRef.__montaggiOpsSeeded = true;
      ops.setState(seed);
    }
    // eslint-disable-next-line
  }, [ops.ready, view]);

  /** Aggiungi uno o più operai (anche separati da virgola o invio) */
  const addOperatorsInline = () => {
    const names = newOpNames.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (names.length === 0) { toast.info("Inserisci almeno un nome"); return; }
    const existing = new Set(operators.map((o) => o.name.trim().toLowerCase()));
    const fresh = names.filter((n) => !existing.has(n.toLowerCase()));
    if (fresh.length === 0) { toast.info("Tutti i nomi sono già presenti"); return; }
    if (view === "progetto") {
      const additions = fresh.map((name) => ({ id: slugName(name), name, role: "" } as Operator));
      extras.setState([...(extras.state ?? []), ...additions]);
    } else {
      const additions = fresh.map((name) => ({ id: uid(), name, role: "" } as Operator));
      ops.setState([...ops.state, ...additions]);
    }
    setNewOpNames("");
    toast.success(`Aggiunti ${fresh.length} operai`);
  };

  /** Profili (per linking + notifiche) */
  useEffect(() => {
    if (view !== "progetto") return;
    (async () => {
      const { data } = await supabase.from("profiles").select("id, display_name, settori").order("display_name");
      setProfiles((data ?? []) as ProfileLite[]);
    })();
  }, [view]);

  /** Carica assegnazioni */
  const loadAssignments = async () => {
    setLoading(true);
    const from = fmtDate(addDays(weekStart, -7));
    const to = fmtDate(addDays(weekStart, 35));
    const { data, error } = await supabase
      .from("montaggi_planning")
      .select("*")
      .gte("date", from)
      .lte("date", to)
      .order("date");
    if (error) {
      toast.error("Errore caricamento pianificazione");
      setLoading(false);
      return;
    }
    setAssignments((data ?? []) as Assignment[]);
    setLoading(false);
  };

  useEffect(() => { loadAssignments(); /* eslint-disable-next-line */ }, [weekStart.getTime()]);

  useEffect(() => {
    const ch = supabase.channel(`montaggi_planning_${draftId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "montaggi_planning" }, () => loadAssignments())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, []);

  /** Compose info block (address + tools + materials) for notifications */
  const buildProjectInfoBlock = () => {
    const toolsTxt = (projectTools ?? []).length > 0 ? `\n🧰 Attrezzi:\n${(projectTools ?? []).map((t) => `• ${t.name}${t.qty ? ` ×${t.qty}` : ""}`).join("\n")}` : "";
    const matTxt = (projectMaterials ?? []).length > 0 ? `\n📦 Materiali:\n${(projectMaterials ?? []).map((m) => `• ${m.name}${m.qty ? ` ×${m.qty}${m.unit ? ` ${m.unit}` : ""}` : ""}`).join("\n")}` : "";
    const addrTxt = projectAddress ? `\n📍 ${projectAddress}` : "";
    return `${addrTxt}${toolsTxt}${matTxt}`;
  };

  /** Trova userId collegato a un operator */
  const userIdForOperator = (operatorId: string): string | undefined => {
    const op = operators.find((o) => o.id === operatorId);
    return op?.userId;
  };

  /** Notifica automatica all'operaio collegato */
  const autoNotify = async (operatorId: string, action: "creata" | "aggiornata" | "eliminata", info: { date: string; hours: number; cantiere: string }) => {
    const userId = userIdForOperator(operatorId);
    if (!userId) return; // operaio non collegato: niente notifica
    const dateLabel = new Date(info.date).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short" });
    const verbo = action === "creata" ? "📅 Nuovo impegno" : action === "aggiornata" ? "✏️ Impegno aggiornato" : "❌ Impegno annullato";
    const message = `${verbo} — ${dateLabel}\nCantiere: ${info.cantiere} (${info.hours}h)${action !== "eliminata" ? buildProjectInfoBlock() : ""}`;
    await supabase.from("prod_notifications").insert({
      user_id: userId,
      type: "chat_messaggio",
      message,
      is_urgent: false,
    });
  };

  const saveAssignment = async (payload: { operator_id: string; date: string; hours: number; commessa_id: string | null; cantiere_label: string; notes?: string | null; reparto?: Reparto; id?: string }) => {
    if (!user) return toast.error("Non autenticato");
    if (payload.id) {
      const { error } = await supabase.from("montaggi_planning").update({
        operator_id: payload.operator_id,
        date: payload.date,
        hours: payload.hours,
        commessa_id: payload.commessa_id,
        cantiere_label: payload.cantiere_label,
        notes: payload.notes ?? null,
        reparto: payload.reparto ?? "montaggi",
      }).eq("id", payload.id);
      if (error) return toast.error(error.message);
      autoNotify(payload.operator_id, "aggiornata", { date: payload.date, hours: payload.hours, cantiere: payload.cantiere_label });
    } else {
      const { error } = await supabase.from("montaggi_planning").insert({
        operator_id: payload.operator_id,
        date: payload.date,
        hours: payload.hours,
        commessa_id: payload.commessa_id,
        cantiere_label: payload.cantiere_label,
        notes: payload.notes ?? null,
        reparto: payload.reparto ?? "montaggi",
        created_by: user.id,
      });
      if (error) return toast.error(error.message);
      autoNotify(payload.operator_id, "creata", { date: payload.date, hours: payload.hours, cantiere: payload.cantiere_label });
    }
    setEditing(null);
    loadAssignments();
  };

  /** Quick assign: click sul + → crea subito 8h sul cantiere corrente, senza dialog */
  const quickAssign = async (operatorId: string, date: string) => {
    if (!user) return toast.error("Non autenticato");
    const cantiere = view === "progetto" ? cantiereLabel : "Cantiere";
    const commessaId = view === "progetto" ? draftId : null;
    const { error } = await supabase.from("montaggi_planning").insert({
      operator_id: operatorId,
      date,
      hours: 8,
      commessa_id: commessaId,
      cantiere_label: cantiere,
      notes: null,
      reparto: "montaggi",
      created_by: user.id,
    });
    if (error) return toast.error(error.message);
    autoNotify(operatorId, "creata", { date, hours: 8, cantiere });
    loadAssignments();
  };

  const deleteAssignment = async (id: string) => {
    const target = assignments.find((a) => a.id === id);
    const { error } = await supabase.from("montaggi_planning").delete().eq("id", id);
    if (error) return toast.error(error.message);
    if (target) autoNotify(target.operator_id, "eliminata", { date: target.date, hours: target.hours, cantiere: target.cantiere_label });
    loadAssignments();
  };

  /** Bulk range assignment — uno o più operai */
  const applyBulkRange = async () => {
    if (!user) return toast.error("Non autenticato");
    if (!bulk.operatorIds.length) return toast.info("Seleziona almeno un operaio");
    const from = new Date(bulk.from);
    const to = new Date(bulk.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return toast.error("Intervallo date non valido");
    const rows: Array<{ operator_id: string; date: string; hours: number; commessa_id: string | null; cantiere_label: string; created_by: string; reparto: Reparto }> = [];
    const dates: string[] = [];
    const cur = new Date(from);
    while (cur <= to) {
      const dow = (cur.getDay() + 6) % 7;
      if (bulk.includeWeekends || dow < 5) {
        dates.push(fmtDate(cur));
      }
      cur.setDate(cur.getDate() + 1);
    }
    for (const opId of bulk.operatorIds) {
      for (const d of dates) {
        rows.push({
          operator_id: opId,
          date: d,
          hours: bulk.hours,
          commessa_id: view === "progetto" ? draftId : null,
          cantiere_label: cantiereLabel,
          created_by: user.id,
          reparto: "montaggi",
        });
      }
    }
    if (rows.length === 0) return toast.info("Nessun giorno selezionato");
    const { error } = await supabase.from("montaggi_planning").insert(rows);
    if (error) return toast.error(error.message);
    // Notifica riassuntiva ad ogni operaio collegato
    for (const opId of bulk.operatorIds) {
      const userId = userIdForOperator(opId);
      if (userId) {
        const dateList = dates.map((d) => new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })).join(", ");
        await supabase.from("prod_notifications").insert({
          user_id: userId,
          type: "chat_messaggio",
          message: `📅 Nuovi impegni — Cantiere: ${cantiereLabel} (${bulk.hours}h/giorno)\nGiornate: ${dateList}${buildProjectInfoBlock()}`,
          is_urgent: false,
        });
      }
    }
    toast.success(`Aggiunte ${rows.length} giornate`);
    loadAssignments();
  };

  /** Linking (manuale) */
  const updateExtraOperator = (id: string, patch: Partial<Operator>) => {
    const cur = extras.state ?? [];
    const found = cur.find((o) => o.id === id);
    if (!found) {
      const op = projectOperators.find((o) => o.id === id);
      if (!op) return;
      extras.setState([...cur, { ...op, ...patch }]);
    } else {
      extras.setState(cur.map((o) => o.id === id ? { ...o, ...patch } : o));
    }
  };

  /** Indici */
  const indexMap = useMemo(() => {
    const map = new Map<string, Map<string, Assignment[]>>();
    for (const a of assignments) {
      if (!map.has(a.operator_id)) map.set(a.operator_id, new Map());
      const dayMap = map.get(a.operator_id)!;
      const list = dayMap.get(a.date) ?? [];
      list.push(a);
      dayMap.set(a.date, list);
    }
    return map;
  }, [assignments]);

  const weekDays = useMemo(() => Array.from({ length: daysCount }, (_, i) => addDays(weekStart, i)), [weekStart, daysCount]);

  const weeklyLoad = useMemo(() => {
    const map = new Map<string, number>();
    for (const op of operators) {
      let total = 0;
      for (const d of weekDays) {
        const list = indexMap.get(op.id)?.get(fmtDate(d)) ?? [];
        total += list.reduce((s, a) => s + Number(a.hours || 0), 0);
      }
      map.set(op.id, total);
    }
    return map;
  }, [operators, weekDays, indexMap]);

  /** ============================================================
   *  RENDER
   *  ============================================================ */
  return (
    <div className="space-y-6">
      {/* Info cantiere (solo in project mode) */}
      {view === "progetto" && (projectAddress || (projectMaterials && projectMaterials.length > 0) || (projectTools && projectTools.length > 0)) && (
        <Card className="border-2 border-dept shadow-soft">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Hammer className="h-4 w-4" />Info cantiere — {cantiereLabel}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1">
              <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wider"><MapPin className="h-3 w-3" />Indirizzo</Label>
              <p className="text-sm">{projectAddress || <span className="text-muted-foreground">Da indicare nel tab Progetto</span>}</p>
            </div>
            <div className="space-y-1">
              <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wider"><Package className="h-3 w-3" />Materiali ({projectMaterials?.length ?? 0})</Label>
              <ul className="space-y-0.5 text-xs max-h-32 overflow-auto">
                {(projectMaterials ?? []).map((m, i) => (
                  <li key={i} className="text-sm">• {m.name}{m.qty ? <span className="font-mono text-muted-foreground"> ×{m.qty}{m.unit ? ` ${m.unit}` : ""}</span> : null}</li>
                ))}
                {(!projectMaterials || projectMaterials.length === 0) && <li className="text-muted-foreground">Nessun materiale</li>}
              </ul>
            </div>
            <div className="space-y-1">
              <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wider"><Wrench className="h-3 w-3" />Attrezzi ({projectTools?.length ?? 0})</Label>
              <ul className="space-y-0.5 text-xs max-h-32 overflow-auto">
                {(projectTools ?? []).map((t, i) => (
                  <li key={i} className="text-sm">• {t.name}{t.qty ? <span className="font-mono text-muted-foreground"> ×{t.qty}</span> : null}</li>
                ))}
                {(!projectTools || projectTools.length === 0) && <li className="text-muted-foreground">Nessun attrezzo</li>}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Header */}
      <Card className="border-2 border-dept shadow-soft">
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5" />Pianificazione montaggi</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {mode === "global" ? (<><Globe className="h-3 w-3 mr-1" />Panoramica globale</>) : (<><Hammer className="h-3 w-3 mr-1" />Cantiere: {cantiereLabel}</>)}
            </Badge>
            <div className="flex items-center gap-1">
              <Button size="icon" variant="outline" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft className="h-4 w-4" /></Button>
              <div className="px-3 text-sm font-mono">
                {weekDays[0].toLocaleDateString("it-IT", { day: "2-digit", month: "short" })} – {weekDays[weekDays.length - 1].toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })}
              </div>
              <Button size="icon" variant="outline" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight className="h-4 w-4" /></Button>
              <Button size="sm" variant="outline" onClick={() => setWeekStart(startOfWeek(new Date()))}>Oggi</Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Calendario */}
      <Card className="border-2 border-dept shadow-soft overflow-hidden">
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Caricamento…</div>
          ) : operators.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">Nessun operaio. Aggiungine uno qui sotto.</div>
          ) : (
            <table className="w-full border-collapse min-w-[800px]">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wider border-b border-border w-[220px]">Operaio</th>
                  {weekDays.map((d, i) => {
                    const isToday = fmtDate(d) === fmtDate(new Date());
                    return (
                      <th key={i} className={`px-2 py-2 text-center text-xs uppercase tracking-wider border-b border-border ${isToday ? "bg-dept-soft" : ""}`}>
                        <div>{dayLabel[i % 7]}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{d.getDate()}/{d.getMonth() + 1}</div>
                      </th>
                    );
                  })}
                  <th className="px-2 py-2 text-center text-xs uppercase tracking-wider border-b border-border w-[80px]">Tot h</th>

                </tr>
              </thead>
              <tbody>
                {operators.map((op) => {
                  const total = weeklyLoad.get(op.id) ?? 0;
                  const overloaded = total > 45;
                  const linkedProfile = op.userId ? profiles.find((p) => p.id === op.userId) : null;
                  return (
                    <tr key={op.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 border-b border-border">
                        <div className="font-medium text-sm">{op.name}</div>
                        {op.role && <div className="text-[10px] text-muted-foreground">{op.role}</div>}
                        {view === "progetto" && (
                          <button type="button" onClick={() => setLinkingOp(op)} className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-dept">
                            <Link2 className="h-2.5 w-2.5" />
                            {linkedProfile ? linkedProfile.display_name ?? "Utente collegato" : "Collega utente"}
                          </button>
                        )}
                      </td>
                      {weekDays.map((d) => {
                        const dateStr = fmtDate(d);
                        const list = indexMap.get(op.id)?.get(dateStr) ?? [];
                        const isCurrentProject = view === "progetto" && list.some((a) => a.cantiere_label === cantiereLabel || a.commessa_id === draftId);
                        const otherProjects = view === "progetto" && list.length > 0 && !isCurrentProject;
                        return (
                          <td key={dateStr} className={`p-1 border-b border-l border-border align-top ${otherProjects ? "bg-amber-50 dark:bg-amber-950/20" : ""}`}>
                            <div className="space-y-1">
                              {list.map((a) => {
                                const isCurrent = a.cantiere_label === cantiereLabel || a.commessa_id === draftId;
                                return (
                                  <button
                                    key={a.id}
                                    type="button"
                                    onClick={() => setEditing({ operatorId: op.id, date: dateStr, existing: a })}
                                    className="w-full text-left px-1.5 py-1 rounded text-[10px] font-medium text-white hover:opacity-80 transition flex items-center justify-between gap-1"
                                    style={{ backgroundColor: colorForCantiere(a.cantiere_label), opacity: view === "progetto" && !isCurrent ? 0.5 : 1 }}
                                    title={`${a.cantiere_label} · ${a.hours}h${a.notes ? ` · ${a.notes}` : ""}`}
                                  >
                                    <span className="truncate">{a.cantiere_label}</span>
                                    <span className="font-mono shrink-0">{a.hours}h</span>
                                  </button>
                                );
                              })}
                              <button
                                type="button"
                                onClick={() => quickAssign(op.id, dateStr)}
                                onDoubleClick={() => setEditing({ operatorId: op.id, date: dateStr })}
                                className="w-full px-1.5 py-1 rounded text-[10px] text-muted-foreground hover:bg-dept/10 hover:text-dept transition flex items-center justify-center gap-1"
                                title="Click: aggiungi 8h sul cantiere corrente · Doppio click: opzioni avanzate"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                              {otherProjects && (
                                <div className="flex items-center gap-1 text-[9px] text-amber-700 dark:text-amber-400">
                                  <AlertTriangle className="h-2.5 w-2.5" />impegnato
                                </div>
                              )}
                            </div>
                          </td>
                        );
                      })}
                      <td className={`px-2 py-2 border-b border-l border-border text-center font-mono text-sm ${overloaded ? "text-red-600 font-bold" : total < 20 ? "text-amber-600" : ""}`}>
                        {total}h
                      </td>
                    </tr>
                  );
                })}

              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Assegnazione rapida per intervallo */}
      {view === "progetto" && (
        <Card className="border-2 border-dept shadow-soft">
          <CardHeader><CardTitle className="text-base">Assegna intervallo veloce</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-2 md:grid-cols-[1fr_140px_140px_100px_auto_auto]">
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs">Operai ({bulk.operatorIds.length} selezionati)</Label>
                  <div className="flex gap-1">
                    <button type="button" className="text-[10px] underline text-muted-foreground hover:text-foreground" onClick={() => setBulk({ ...bulk, operatorIds: operators.map((o) => o.id) })}>Tutti</button>
                    <button type="button" className="text-[10px] underline text-muted-foreground hover:text-foreground" onClick={() => setBulk({ ...bulk, operatorIds: [] })}>Nessuno</button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto border border-input rounded-md p-1.5 bg-background">
                  {operators.length === 0 ? (
                    <span className="text-[11px] text-muted-foreground italic px-1">Nessun operaio</span>
                  ) : operators.map((o) => {
                    const selected = bulk.operatorIds.includes(o.id);
                    return (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => setBulk({ ...bulk, operatorIds: selected ? bulk.operatorIds.filter((x) => x !== o.id) : [...bulk.operatorIds, o.id] })}
                        className={`text-[11px] px-2 py-0.5 rounded-sm border transition-colors ${selected ? "bg-primary text-primary-foreground border-primary" : "bg-background border-input hover:bg-muted"}`}
                      >
                        {o.name}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-1"><Label className="text-xs">Dal</Label><Input type="date" value={bulk.from} onChange={(e) => setBulk({ ...bulk, from: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Al</Label><Input type="date" value={bulk.to} onChange={(e) => setBulk({ ...bulk, to: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Ore/giorno</Label><Input type="number" min={0} max={24} step={0.5} value={bulk.hours} onChange={(e) => setBulk({ ...bulk, hours: Number(e.target.value) })} /></div>
              <label className="flex items-end gap-2 text-xs pb-2"><input type="checkbox" checked={bulk.includeWeekends} onChange={(e) => setBulk({ ...bulk, includeWeekends: e.target.checked })} />Sab/Dom</label>
              <div className="flex items-end"><Button onClick={applyBulkRange}><Plus className="h-4 w-4" />Aggiungi</Button></div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">Crea assegnazioni multiple per il cantiere corrente. Per impegni in altri cantieri, usa il <span className="font-semibold">+</span> in calendario.</p>
          </CardContent>
        </Card>
      )}

      {/* Cantieri attivi */}
      <Card className="border-2 border-dept shadow-soft">
        <CardHeader>
          <CardTitle className="text-base">Cantieri attivi questa settimana</CardTitle>
        </CardHeader>
        <CardContent>
          {(() => {
            const inWeek = assignments.filter((a) => weekDays.some((d) => fmtDate(d) === a.date));
            const grouped = new Map<string, number>();
            for (const a of inWeek) {
              grouped.set(a.cantiere_label, (grouped.get(a.cantiere_label) ?? 0) + Number(a.hours || 0));
            }
            const list = [...grouped.entries()].sort((a, b) => b[1] - a[1]);
            if (list.length === 0) return <p className="text-sm text-muted-foreground">Nessun cantiere assegnato in questa settimana.</p>;
            return (
              <div className="flex flex-wrap gap-2">
                {list.map(([label, hours]) => (
                  <Badge key={label} variant="outline" className="text-xs" style={{ borderColor: colorForCantiere(label), color: colorForCantiere(label) }}>
                    {label} · <span className="font-mono ml-1">{hours}h</span>
                  </Badge>
                ))}
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Aggiungi operai inline (sotto l'ultimo lavoratore) */}
      <Card className="border-2 border-dept shadow-soft border-dashed">
        <CardHeader><CardTitle className="text-base">Aggiungi uno o più operai</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[260px] space-y-1">
              <Label className="text-xs">Nomi (separa con virgola per aggiungerne più di uno)</Label>
              <Input
                placeholder="Es. Mario Rossi, Luigi Bianchi"
                value={newOpNames}
                onChange={(e) => setNewOpNames(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOperatorsInline(); } }}
              />
            </div>
            <Button onClick={addOperatorsInline}><Plus className="h-4 w-4" />Aggiungi</Button>
          </div>
        </CardContent>
      </Card>

      {/* Dialog edit */}
      {editing && (
        <AssignmentDialog
          editing={editing}
          operators={operators}
          defaultCantiere={cantiereLabel}
          defaultCommessaId={draftId}
          lockCantiere={view === "progetto"}
          onClose={() => setEditing(null)}
          onSave={saveAssignment}
          onDelete={editing.existing ? () => deleteAssignment(editing.existing!.id) : undefined}
          allCantieri={Array.from(new Set([cantiereLabel, ...assignments.map((a) => a.cantiere_label)])).filter(Boolean)}
        />
      )}

      {/* Dialog linking utente */}
      {linkingOp && (
        <Dialog open onOpenChange={() => setLinkingOp(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Collega utente a {linkingOp.name}</DialogTitle></DialogHeader>
            <div className="space-y-2 py-2">
              <Label>Utente</Label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                defaultValue={linkingOp.userId ?? ""}
                onChange={(e) => {
                  updateExtraOperator(linkingOp.id, { userId: e.target.value || undefined });
                }}
              >
                <option value="">— Nessun utente —</option>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.display_name ?? p.id.slice(0, 8)}</option>)}
              </select>
              <p className="text-[11px] text-muted-foreground">Solo gli operai collegati a un utente possono ricevere le notifiche con il piano di lavoro, gli attrezzi e l'indirizzo.</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setLinkingOp(null)}>Chiudi</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

/** ============================================================
 *  DIALOG ASSEGNAMENTO
 *  ============================================================ */
type DialogProps = {
  editing: { operatorId: string; date: string; existing?: Assignment };
  operators: Operator[];
  defaultCantiere: string;
  defaultCommessaId: string;
  allCantieri: string[];
  lockCantiere?: boolean;
  onClose: () => void;
  onSave: (p: { operator_id: string; date: string; hours: number; commessa_id: string | null; cantiere_label: string; notes?: string | null; reparto?: Reparto; id?: string }) => void;
  onDelete?: () => void;
};

const AssignmentDialog = ({ editing, operators, defaultCantiere, defaultCommessaId, allCantieri, lockCantiere, onClose, onSave, onDelete }: DialogProps) => {
  const ex = editing.existing;
  const [operatorId, setOperatorId] = useState(ex?.operator_id ?? editing.operatorId);
  const [date, setDate] = useState(ex?.date ?? editing.date);
  const [hours, setHours] = useState(ex?.hours ?? 8);
  const [cantiere, setCantiere] = useState(ex?.cantiere_label ?? defaultCantiere);
  const [notes, setNotes] = useState(ex?.notes ?? "");
  const [reparto, setReparto] = useState<Reparto>((ex?.reparto as Reparto) ?? "montaggi");

  const canLock = lockCantiere && (!ex || ex.cantiere_label === defaultCantiere);
  const effectiveCantiere = canLock ? defaultCantiere : cantiere;
  const isCurrentProject = effectiveCantiere === defaultCantiere;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{ex ? "Modifica assegnamento" : "Nuovo assegnamento"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
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
            <Label>Reparto</Label>
            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={reparto} onChange={(e) => setReparto(e.target.value as Reparto)}>
              <option value="montaggi">Montaggi</option>
              <option value="laboratorio">Laboratorio</option>
              <option value="tappezzeria">Tappezzeria</option>
              <option value="falegnameria">Falegnameria</option>
              <option value="altro">Altro</option>
            </select>
          </div>
          {!canLock && (
            <div className="space-y-1.5">
              <Label>Cantiere</Label>
              <Input list="cantieri-list" value={cantiere} onChange={(e) => setCantiere(e.target.value)} placeholder="Nome cantiere o progetto" />
              <datalist id="cantieri-list">
                {allCantieri.map((c) => <option key={c} value={c} />)}
              </datalist>
              <p className="text-[10px] text-muted-foreground">Cantiere corrente: <span className="font-semibold">{defaultCantiere}</span>.</p>
            </div>
          )}
          {canLock && (
            <div className="rounded-sm border border-border bg-muted/40 p-2 text-xs">
              <span className="text-muted-foreground">Cantiere:</span> <span className="font-semibold">{defaultCantiere}</span>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Note (opzionale)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Es. ritrovo ore 7, trasferta…" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          {onDelete && <Button variant="destructive" size="sm" onClick={onDelete}><Trash2 className="h-4 w-4" />Elimina</Button>}
          <div className="flex-1" />
          <Button variant="outline" onClick={onClose}><X className="h-4 w-4" />Annulla</Button>
          <Button onClick={() => onSave({
            id: ex?.id,
            operator_id: operatorId,
            date,
            hours,
            commessa_id: isCurrentProject ? defaultCommessaId : null,
            cantiere_label: effectiveCantiere.trim() || defaultCantiere,
            notes: notes.trim() || null,
            reparto,
          })}>Salva</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
