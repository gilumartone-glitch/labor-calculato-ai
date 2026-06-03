import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Plus, Trash2, Users, AlertTriangle, ChevronLeft, ChevronRight, Globe, Hammer, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSharedCloudState } from "@/hooks/useSharedCloudState";
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
type Operator = { id: string; name: string; role?: string; color?: string };
type Assignment = {
  id: string;
  commessa_id: string | null;
  cantiere_label: string;
  operator_id: string;
  date: string; // YYYY-MM-DD
  hours: number;
  notes: string | null;
  created_by: string;
};

const OPERATORS_KEY = "montaggi:operai:v1";
const DEFAULT_OPERATORS: Operator[] = [
  { id: uid(), name: "Operaio 1", role: "Montatore" },
  { id: uid(), name: "Operaio 2", role: "Montatore" },
  { id: uid(), name: "Operaio 3", role: "Aiutante" },
];

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
  const day = (x.getDay() + 6) % 7; // lun=0
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
};
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

/** ============================================================
 *  IMPORT DA ARCHIVIO SQUADRE (localStorage dei progetti Montaggi)
 *  ============================================================ */
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
  cantiereLabel: string; // nome del progetto Montaggi corrente
  /** "project" = solo vista cantiere corrente (default), "global" = panoramica globale */
  mode?: "project" | "global";
};

/** ============================================================
 *  COMPONENTE PRINCIPALE
 *  ============================================================ */
export const PianificazioneSection = ({ draftId, cantiereLabel, mode = "project" }: Props) => {
  const { user } = useAuth();
  const view: "progetto" | "panoramica" = mode === "global" ? "panoramica" : "progetto";
  const [weekStart, setWeekStart] = useState<Date>(startOfWeek(new Date()));
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ operatorId: string; date: string; existing?: Assignment } | null>(null);

  const ops = useSharedCloudState<Operator[]>(OPERATORS_KEY, DEFAULT_OPERATORS);
  const operators = ops.state;
  const setOperators = (next: Operator[]) => ops.setState(next);

  /** Seed automatico la prima volta che l'anagrafica è vuota dopo ready */
  const seededRef = (typeof window !== "undefined") ? (window as unknown as { __montaggiOpsSeeded?: boolean }) : { __montaggiOpsSeeded: true };
  useEffect(() => {
    if (!ops.ready || seededRef.__montaggiOpsSeeded) return;
    if (operators.length > 0) { seededRef.__montaggiOpsSeeded = true; return; }
    const collected = collectWorkersFromArchives();
    if (collected.length > 0) {
      seededRef.__montaggiOpsSeeded = true;
      setOperators(collected);
    }
    // eslint-disable-next-line
  }, [ops.ready]);

  /** Merge manuale da Archivio squadre (bottone) */
  const importFromArchives = () => {
    const collected = collectWorkersFromArchives();
    if (collected.length === 0) {
      toast.info("Nessun nominativo trovato nell'archivio squadre dei progetti Montaggi.");
      return;
    }
    const byName = new Map(operators.map((o) => [o.name.trim().toLowerCase(), o]));
    let added = 0;
    for (const w of collected) {
      const key = w.name.trim().toLowerCase();
      if (!byName.has(key)) { byName.set(key, w); added++; }
    }
    setOperators(Array.from(byName.values()));
    toast.success(added > 0 ? `${added} operai importati dall'archivio.` : "Nessun nuovo nominativo da importare.");
  };


  /** Carica assegnazioni (range largo: 4 settimane intorno per la panoramica) */
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

  /** Realtime: ogni modifica si propaga ad entrambe le viste */
  useEffect(() => {
    const ch = supabase.channel(`montaggi_planning_${draftId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "montaggi_planning" }, () => {
        loadAssignments();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, []);

  /** Salva (upsert) un assegnamento */
  const saveAssignment = async (payload: { operator_id: string; date: string; hours: number; commessa_id: string | null; cantiere_label: string; notes?: string | null; id?: string }) => {
    if (!user) return toast.error("Non autenticato");
    if (payload.id) {
      const { error } = await supabase.from("montaggi_planning").update({
        operator_id: payload.operator_id,
        date: payload.date,
        hours: payload.hours,
        commessa_id: payload.commessa_id,
        cantiere_label: payload.cantiere_label,
        notes: payload.notes ?? null,
      }).eq("id", payload.id);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("montaggi_planning").insert({
        operator_id: payload.operator_id,
        date: payload.date,
        hours: payload.hours,
        commessa_id: payload.commessa_id,
        cantiere_label: payload.cantiere_label,
        notes: payload.notes ?? null,
        created_by: user.id,
      });
      if (error) return toast.error(error.message);
    }
    setEditing(null);
    loadAssignments();
  };

  const deleteAssignment = async (id: string) => {
    const { error } = await supabase.from("montaggi_planning").delete().eq("id", id);
    if (error) return toast.error(error.message);
    loadAssignments();
  };

  /** Index: operatorId → date → assegnazioni */
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

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  /** Carico operatorio settimanale per ogni operaio */
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
   *  ANAGRAFICA OPERAI
   *  ============================================================ */
  const addOperator = () => setOperators([...operators, { id: uid(), name: `Operaio ${operators.length + 1}`, role: "" }]);
  const updateOperator = (id: string, patch: Partial<Operator>) =>
    setOperators(operators.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  const removeOperator = (id: string) => {
    if (!confirm("Rimuovere l'operaio dall'anagrafica? Le assegnazioni esistenti restano nel database.")) return;
    setOperators(operators.filter((o) => o.id !== id));
  };

  /** ============================================================
   *  RENDER
   *  ============================================================ */
  return (
    <div className="space-y-6">
      {/* Header: toggle vista + navigazione settimana */}
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
                {weekDays[0].toLocaleDateString("it-IT", { day: "2-digit", month: "short" })} – {weekDays[6].toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })}
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
            <div className="p-6 text-sm text-muted-foreground">Nessun operaio. Aggiungine uno dall'anagrafica qui sotto.</div>
          ) : (
            <table className="w-full border-collapse min-w-[800px]">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wider border-b border-border w-[200px]">Operaio</th>
                  {weekDays.map((d, i) => {
                    const isToday = fmtDate(d) === fmtDate(new Date());
                    return (
                      <th key={i} className={`px-2 py-2 text-center text-xs uppercase tracking-wider border-b border-border ${isToday ? "bg-dept-soft" : ""}`}>
                        <div>{dayLabel[i]}</div>
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
                  return (
                    <tr key={op.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 border-b border-border">
                        <div className="font-medium text-sm">{op.name}</div>
                        {op.role && <div className="text-[10px] text-muted-foreground">{op.role}</div>}
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
                                onClick={() => setEditing({ operatorId: op.id, date: dateStr })}
                                className="w-full px-1.5 py-1 rounded text-[10px] text-muted-foreground hover:bg-dept/10 hover:text-dept transition flex items-center justify-center gap-1"
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

      {/* Riepilogo cantieri della settimana */}
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

      {/* Anagrafica operai */}
      <Card className="border-2 border-dept shadow-soft">
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2 text-base"><Users className="h-5 w-5" />Anagrafica operai (condivisa)</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={importFromArchives}><Users className="h-4 w-4" />Importa da Archivio squadre</Button>
            <Button size="sm" onClick={addOperator}><Plus className="h-4 w-4" />Aggiungi operaio</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {operators.map((op) => (
            <div key={op.id} className="flex gap-2 items-center">
              <Input value={op.name} onChange={(e) => updateOperator(op.id, { name: e.target.value })} placeholder="Nome operaio" className="flex-1" />
              <Input value={op.role ?? ""} onChange={(e) => updateOperator(op.id, { role: e.target.value })} placeholder="Ruolo" className="flex-1" />
              <Button size="icon" variant="ghost" onClick={() => removeOperator(op.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
            </div>
          ))}
          {operators.length === 0 && <p className="text-sm text-muted-foreground">Nessun operaio in anagrafica. Aggiungine uno per iniziare.</p>}
        </CardContent>
      </Card>

      {/* Dialog edit */}
      {editing && (
        <AssignmentDialog
          editing={editing}
          operators={operators}
          defaultCantiere={cantiereLabel}
          defaultCommessaId={draftId}
          onClose={() => setEditing(null)}
          onSave={saveAssignment}
          onDelete={editing.existing ? () => deleteAssignment(editing.existing!.id) : undefined}
          allCantieri={Array.from(new Set([cantiereLabel, ...assignments.map((a) => a.cantiere_label)])).filter(Boolean)}
        />
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
  onClose: () => void;
  onSave: (p: { operator_id: string; date: string; hours: number; commessa_id: string | null; cantiere_label: string; notes?: string | null; id?: string }) => void;
  onDelete?: () => void;
};

const AssignmentDialog = ({ editing, operators, defaultCantiere, defaultCommessaId, allCantieri, onClose, onSave, onDelete }: DialogProps) => {
  const ex = editing.existing;
  const [operatorId, setOperatorId] = useState(ex?.operator_id ?? editing.operatorId);
  const [date, setDate] = useState(ex?.date ?? editing.date);
  const [hours, setHours] = useState(ex?.hours ?? 8);
  const [cantiere, setCantiere] = useState(ex?.cantiere_label ?? defaultCantiere);
  const [notes, setNotes] = useState(ex?.notes ?? "");

  const isCurrentProject = cantiere === defaultCantiere;

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
            <Label>Cantiere</Label>
            <Input list="cantieri-list" value={cantiere} onChange={(e) => setCantiere(e.target.value)} placeholder="Nome cantiere o progetto" />
            <datalist id="cantieri-list">
              {allCantieri.map((c) => <option key={c} value={c} />)}
            </datalist>
            <p className="text-[10px] text-muted-foreground">Inizia digitando per usare un cantiere esistente o crearne uno nuovo. Il progetto Montaggi corrente è <span className="font-semibold">{defaultCantiere}</span>.</p>
          </div>
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
            cantiere_label: cantiere.trim() || defaultCantiere,
            notes: notes.trim() || null,
          })}>Salva</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
