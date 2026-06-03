import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Users,
  HardHat,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { format } from "date-fns";
import { it } from "date-fns/locale";

type Planning = {
  id: string;
  commessa_id: string | null;
  cantiere_label: string;
  operator_id: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  hours: number;
  role: string | null;
  notes: string | null;
  created_by: string;
};

type Profile = { id: string; display_name: string | null };
type Commessa = { id: string; titolo: string; cliente: string | null };

const FULL_DAY_HOURS = 8;
const OVERLOAD_HOURS = 9;

const startOfWeek = (d: Date) => {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // Mon=0
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
};

const fmtIso = (d: Date) => format(d, "yyyy-MM-dd");

const DAY_COLORS = [
  "bg-sky-100 border-sky-300 text-sky-900",
  "bg-emerald-100 border-emerald-300 text-emerald-900",
  "bg-amber-100 border-amber-300 text-amber-900",
  "bg-violet-100 border-violet-300 text-violet-900",
  "bg-rose-100 border-rose-300 text-rose-900",
  "bg-cyan-100 border-cyan-300 text-cyan-900",
  "bg-orange-100 border-orange-300 text-orange-900",
  "bg-lime-100 border-lime-300 text-lime-900",
];

const cantiereColor = (key: string) => {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return DAY_COLORS[h % DAY_COLORS.length];
};

export const PianificazioneSection = () => {
  const { user } = useAuth();
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [plans, setPlans] = useState<Planning[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [commesse, setCommesse] = useState<Commessa[]>([]);
  const [editing, setEditing] = useState<Partial<Planning> | null>(null);
  const [loading, setLoading] = useState(false);

  const weekDays = useMemo(
    () =>
      Array.from({ length: 7 }).map((_, i) => {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        return d;
      }),
    [weekStart],
  );
  const weekStartIso = fmtIso(weekDays[0]);
  const weekEndIso = fmtIso(weekDays[6]);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: pl }, { data: pr }, { data: co }] = await Promise.all([
      supabase
        .from("montaggi_planning")
        .select("*")
        .gte("date", weekStartIso)
        .lte("date", weekEndIso)
        .order("date", { ascending: true }),
      supabase.from("profiles").select("id, display_name").order("display_name"),
      supabase
        .from("commesse")
        .select("id, titolo, cliente")
        .neq("stato", "annullato")
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    setPlans((pl ?? []) as Planning[]);
    setProfiles((pr ?? []) as Profile[]);
    setCommesse((co ?? []) as Commessa[]);
    setLoading(false);
  }, [weekStartIso, weekEndIso]);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime
  useEffect(() => {
    const ch = supabase
      .channel("montaggi-planning-rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "montaggi_planning" },
        () => void load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  const operatorMap = useMemo(
    () => new Map(profiles.map((p) => [p.id, p.display_name || "—"])),
    [profiles],
  );
  const commessaMap = useMemo(
    () => new Map(commesse.map((c) => [c.id, c])),
    [commesse],
  );

  // Operators with at least one assignment OR all profiles — we show all for assignment ease
  const operators = profiles;

  const plansByCell = useMemo(() => {
    const map = new Map<string, Planning[]>();
    for (const p of plans) {
      const key = `${p.operator_id}|${p.date}`;
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    return map;
  }, [plans]);

  const hoursByOperator = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of plans) {
      map.set(p.operator_id, (map.get(p.operator_id) ?? 0) + Number(p.hours || 0));
    }
    return map;
  }, [plans]);

  const cantieriThisWeek = useMemo(() => {
    const set = new Map<string, { label: string; count: number; hours: number }>();
    for (const p of plans) {
      const key = p.commessa_id ?? p.cantiere_label || "—";
      const label = p.commessa_id
        ? commessaMap.get(p.commessa_id)?.titolo ?? p.cantiere_label || "Cantiere"
        : p.cantiere_label || "Cantiere";
      const cur = set.get(key) ?? { label, count: 0, hours: 0 };
      cur.count += 1;
      cur.hours += Number(p.hours || 0);
      set.set(key, cur);
    }
    return Array.from(set.entries()).map(([k, v]) => ({ key: k, ...v }));
  }, [plans, commessaMap]);

  const openNew = (operatorId: string, dateIso: string) => {
    setEditing({
      operator_id: operatorId,
      date: dateIso,
      hours: FULL_DAY_HOURS,
      cantiere_label: "",
      commessa_id: null,
    });
  };

  const save = async () => {
    if (!editing || !user) return;
    if (!editing.operator_id || !editing.date) {
      toast.error("Operatore e data obbligatori");
      return;
    }
    const payload = {
      operator_id: editing.operator_id,
      date: editing.date,
      hours: Number(editing.hours ?? FULL_DAY_HOURS),
      cantiere_label: editing.cantiere_label ?? "",
      commessa_id: editing.commessa_id || null,
      start_time: editing.start_time || null,
      end_time: editing.end_time || null,
      role: editing.role || null,
      notes: editing.notes || null,
    };
    if (editing.id) {
      const { error } = await supabase
        .from("montaggi_planning")
        .update(payload)
        .eq("id", editing.id);
      if (error) return toast.error(error.message);
      toast.success("Assegnazione aggiornata");
    } else {
      const { error } = await supabase
        .from("montaggi_planning")
        .insert({ ...payload, created_by: user.id });
      if (error) return toast.error(error.message);
      toast.success("Assegnazione creata");
    }
    setEditing(null);
    await load();
  };

  const remove = async () => {
    if (!editing?.id) return;
    if (!confirm("Eliminare questa assegnazione?")) return;
    const { error } = await supabase
      .from("montaggi_planning")
      .delete()
      .eq("id", editing.id);
    if (error) return toast.error(error.message);
    toast.success("Eliminata");
    setEditing(null);
    await load();
  };

  const shiftWeek = (delta: number) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + delta * 7);
    setWeekStart(d);
  };

  const goToday = () => setWeekStart(startOfWeek(new Date()));

  // Ottimizzazione: trova operatori sotto-utilizzati e suggerisce
  const suggestions = useMemo(() => {
    const target = FULL_DAY_HOURS * 5; // 5 giorni lavorativi
    const items = operators
      .map((op) => ({
        op,
        hours: hoursByOperator.get(op.id) ?? 0,
      }))
      .filter((x) => x.hours > 0 || operators.length <= 10);
    const overload = items.filter((x) => x.hours > OVERLOAD_HOURS * 5);
    const underuse = items.filter((x) => x.hours > 0 && x.hours < target * 0.5);
    return { overload, underuse, target };
  }, [operators, hoursByOperator]);

  return (
    <div className="space-y-4">
      <Card className="border-2 border-dept shadow-soft">
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5" />
              Pianificazione cantieri & montaggi
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Settimana del {format(weekDays[0], "d MMM", { locale: it })} —{" "}
              {format(weekDays[6], "d MMM yyyy", { locale: it })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => shiftWeek(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={goToday}>
              Oggi
            </Button>
            <Button size="sm" variant="outline" onClick={() => shiftWeek(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <div className="min-w-[900px]">
              {/* Header giorni */}
              <div className="grid grid-cols-[180px_repeat(7,minmax(0,1fr))] gap-1 text-xs font-mono">
                <div className="px-2 py-2 font-semibold uppercase tracking-wider text-muted-foreground">
                  Operatore
                </div>
                {weekDays.map((d) => {
                  const isToday = fmtIso(d) === fmtIso(new Date());
                  return (
                    <div
                      key={d.toISOString()}
                      className={`px-2 py-2 text-center font-semibold uppercase tracking-wider ${
                        isToday ? "bg-primary/10 text-primary rounded-sm" : "text-muted-foreground"
                      }`}
                    >
                      <div>{format(d, "EEE", { locale: it })}</div>
                      <div className="text-base font-bold normal-case">
                        {format(d, "d MMM", { locale: it })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Righe operatori */}
              <div className="mt-1 space-y-1">
                {operators.length === 0 && !loading && (
                  <p className="rounded-sm border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">
                    Nessun operatore disponibile. Aggiungi profili dalla sezione Admin.
                  </p>
                )}
                {operators.map((op) => {
                  const total = hoursByOperator.get(op.id) ?? 0;
                  const isOver = total > OVERLOAD_HOURS * 5;
                  return (
                    <div
                      key={op.id}
                      className="grid grid-cols-[180px_repeat(7,minmax(0,1fr))] gap-1"
                    >
                      <div className="flex flex-col justify-center rounded-sm border border-border bg-background px-3 py-2">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          <HardHat className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="truncate">{op.display_name || "—"}</span>
                        </div>
                        <div
                          className={`mt-0.5 text-[10px] font-mono ${
                            isOver ? "text-rose-600" : "text-muted-foreground"
                          }`}
                        >
                          {total}h / settimana {isOver && "· overload"}
                        </div>
                      </div>
                      {weekDays.map((d) => {
                        const dateIso = fmtIso(d);
                        const cellPlans = plansByCell.get(`${op.id}|${dateIso}`) ?? [];
                        const dayHours = cellPlans.reduce(
                          (s, p) => s + Number(p.hours || 0),
                          0,
                        );
                        const dayOver = dayHours > OVERLOAD_HOURS;
                        return (
                          <button
                            type="button"
                            key={dateIso}
                            onClick={() => openNew(op.id, dateIso)}
                            className={`group relative min-h-[88px] rounded-sm border p-1.5 text-left transition hover:border-primary hover:bg-primary/5 ${
                              dayOver
                                ? "border-rose-400 bg-rose-50/40"
                                : "border-border bg-background"
                            }`}
                          >
                            <div className="space-y-1">
                              {cellPlans.map((p) => {
                                const key = p.commessa_id ?? p.cantiere_label;
                                const label = p.commessa_id
                                  ? commessaMap.get(p.commessa_id)?.titolo ?? "Cantiere"
                                  : p.cantiere_label || "Cantiere";
                                return (
                                  <div
                                    key={p.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditing(p);
                                    }}
                                    className={`cursor-pointer truncate rounded-sm border px-1.5 py-1 text-[11px] font-medium leading-tight ${cantiereColor(
                                      key || "x",
                                    )}`}
                                    title={`${label} · ${p.hours}h${
                                      p.notes ? " · " + p.notes : ""
                                    }`}
                                  >
                                    <div className="truncate">{label}</div>
                                    <div className="font-mono text-[9px] opacity-75">
                                      {p.hours}h
                                      {p.start_time
                                        ? ` · ${p.start_time.slice(0, 5)}`
                                        : ""}
                                    </div>
                                  </div>
                                );
                              })}
                              {cellPlans.length === 0 && (
                                <div className="grid h-full place-items-center py-3 text-muted-foreground opacity-0 group-hover:opacity-100">
                                  <Plus className="h-4 w-4" />
                                </div>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Cantieri della settimana */}
        <Card className="border border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <HardHat className="h-4 w-4" />
              Cantieri di questa settimana
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {cantieriThisWeek.length === 0 && (
              <p className="text-sm text-muted-foreground">Nessun cantiere pianificato.</p>
            )}
            {cantieriThisWeek
              .sort((a, b) => b.hours - a.hours)
              .map((c) => (
                <div
                  key={c.key}
                  className={`flex items-center justify-between rounded-sm border px-3 py-2 text-sm ${cantiereColor(
                    c.key,
                  )}`}
                >
                  <span className="truncate font-medium">{c.label}</span>
                  <span className="font-mono text-xs">
                    {c.count} turni · {c.hours}h
                  </span>
                </div>
              ))}
          </CardContent>
        </Card>

        {/* Ottimizzazione carico */}
        <Card className="border border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" />
              Ottimizzazione carico operatori
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-sm border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              Obiettivo: ~{suggestions.target}h a settimana per operatore (5 giorni × 8h).
            </div>
            {suggestions.overload.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-rose-700">
                  <AlertTriangle className="h-3.5 w-3.5" /> Sovraccarichi
                </div>
                {suggestions.overload.map(({ op, hours }) => (
                  <div
                    key={op.id}
                    className="flex justify-between rounded-sm bg-rose-50 px-2 py-1 text-xs"
                  >
                    <span>{op.display_name}</span>
                    <span className="font-mono">{hours}h</span>
                  </div>
                ))}
              </div>
            )}
            {suggestions.underuse.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-700">
                  <Users className="h-3.5 w-3.5" /> Sotto-utilizzati
                </div>
                {suggestions.underuse.map(({ op, hours }) => (
                  <div
                    key={op.id}
                    className="flex justify-between rounded-sm bg-amber-50 px-2 py-1 text-xs"
                  >
                    <span>{op.display_name}</span>
                    <span className="font-mono">{hours}h</span>
                  </div>
                ))}
              </div>
            )}
            {suggestions.overload.length === 0 && suggestions.underuse.length === 0 && (
              <div className="flex items-center gap-2 text-xs text-emerald-700">
                <CheckCircle2 className="h-4 w-4" /> Carico bilanciato.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Dialog assegnazione */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? "Modifica assegnazione" : "Nuova assegnazione"}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Operatore</Label>
                  <Select
                    value={editing.operator_id ?? ""}
                    onValueChange={(v) => setEditing({ ...editing, operator_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Operatore" />
                    </SelectTrigger>
                    <SelectContent>
                      {profiles.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.display_name || "—"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Data</Label>
                  <Input
                    type="date"
                    value={editing.date ?? ""}
                    onChange={(e) => setEditing({ ...editing, date: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <Label>Cantiere (commessa Flow)</Label>
                <Select
                  value={editing.commessa_id ?? "__none"}
                  onValueChange={(v) =>
                    setEditing({
                      ...editing,
                      commessa_id: v === "__none" ? null : v,
                      cantiere_label:
                        v === "__none"
                          ? editing.cantiere_label
                          : commessaMap.get(v)?.titolo ?? editing.cantiere_label,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Collega a una commessa" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— Cantiere libero —</SelectItem>
                    {commesse.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.titolo}
                        {c.cliente ? ` · ${c.cliente}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Etichetta cantiere (se libero)</Label>
                <Input
                  value={editing.cantiere_label ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, cantiere_label: e.target.value })
                  }
                  placeholder="Es. Cantiere via Roma"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Ore</Label>
                  <Input
                    type="number"
                    step="0.5"
                    min={0}
                    value={editing.hours ?? FULL_DAY_HOURS}
                    onChange={(e) =>
                      setEditing({ ...editing, hours: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <Label>Inizio</Label>
                  <Input
                    type="time"
                    value={editing.start_time ?? ""}
                    onChange={(e) =>
                      setEditing({ ...editing, start_time: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label>Fine</Label>
                  <Input
                    type="time"
                    value={editing.end_time ?? ""}
                    onChange={(e) =>
                      setEditing({ ...editing, end_time: e.target.value })
                    }
                  />
                </div>
              </div>

              <div>
                <Label>Ruolo / mansione</Label>
                <Input
                  value={editing.role ?? ""}
                  onChange={(e) => setEditing({ ...editing, role: e.target.value })}
                  placeholder="Es. capo squadra, montatore, autista"
                />
              </div>

              <div>
                <Label>Note</Label>
                <Textarea
                  rows={2}
                  value={editing.notes ?? ""}
                  onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                  placeholder="Indirizzo, materiali da portare, contatti…"
                />
              </div>
            </div>
          )}
          <DialogFooter className="flex justify-between sm:justify-between">
            <div>
              {editing?.id && (
                <Button variant="destructive" size="sm" onClick={remove}>
                  <Trash2 className="h-4 w-4" /> Elimina
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>
                Annulla
              </Button>
              <Button onClick={save}>Salva</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
