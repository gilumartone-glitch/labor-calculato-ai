import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { TASK_CATEGORIES, TASK_CATEGORY_META, TASK_STATUSES, TASK_STATUS_LABEL, TASK_PRIORITIES, TASK_PRIORITY_META, TaskCategory, TaskStatus, TaskPriority } from "@/lib/tasks/constants";
import { AdminTask, useAdminTasks } from "@/hooks/useAdminTasks";
import { useProdStore } from "@/lib/produzione/store";
import { toast } from "@/hooks/use-toast";
import { Trash2, X } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  task?: AdminTask | null;
  defaultCategory?: TaskCategory;
  linkedCommessaId?: string | null;
  linkedSubProject?: { draftId?: string; subProjectId?: string; name?: string } | null;
};

export const TaskDialog = ({ open, onOpenChange, task, defaultCategory, linkedCommessaId, linkedSubProject }: Props) => {
  const { create, update, remove, listDependencies, addDependency, removeDependency, tasks: allTasks } = useAdminTasks();
  const profiles = useProdStore((s) => s.profiles);
  const subs = useProdStore((s) => s.subs);
  const orders = useProdStore((s) => s.orders);

  const [category, setCategory] = useState<TaskCategory>(defaultCategory ?? "generico");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("da_fare");
  const [priority, setPriority] = useState<TaskPriority>("media");
  const [responsibleId, setResponsibleId] = useState<string>("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [startAt, setStartAt] = useState<string>("");
  const [dueAt, setDueAt] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [deps, setDeps] = useState<any[]>([]);
  const [depKind, setDepKind] = useState<"task" | "sub">("task");
  const [depTargetId, setDepTargetId] = useState<string>("");

  const reloadDeps = async () => {
    if (!task) { setDeps([]); return; }
    const { data } = await listDependencies(task.id);
    setDeps(data);
  };

  useEffect(() => {
    if (!open) return;
    reloadDeps();
    setDepTargetId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id]);

  useEffect(() => {
    if (!open) return;
    if (task) {
      setCategory(task.category);
      setTitle(task.title);
      setDescription(task.description ?? "");
      setStatus(task.status);
      setPriority(task.priority);
      setResponsibleId(task.responsible_id ?? "");
      setAssigneeIds(task.assignee_ids ?? []);
      setStartAt(task.start_at ? task.start_at.slice(0, 16) : "");
      setDueAt(task.due_at ? task.due_at.slice(0, 16) : "");
    } else {
      setCategory(defaultCategory ?? "generico");
      setTitle(""); setDescription(""); setStatus("da_fare"); setPriority("media");
      setResponsibleId(""); setAssigneeIds([]); setStartAt(""); setDueAt("");
    }
  }, [open, task, defaultCategory]);

  const submit = async () => {
    if (!title.trim()) { toast({ title: "Titolo obbligatorio", variant: "destructive" }); return; }
    setSaving(true);
    const payload = {
      category, title: title.trim(),
      description: description.trim() || null,
      status, priority,
      responsible_id: responsibleId || null,
      assignee_ids: assigneeIds,
      start_at: startAt ? new Date(startAt).toISOString() : null,
      due_at: dueAt ? new Date(dueAt).toISOString() : null,
      linked_commessa_id: task?.linked_commessa_id ?? linkedCommessaId ?? null,
      linked_sub_project: task?.linked_sub_project ?? linkedSubProject ?? null,
    };
    const res = task ? await update(task.id, payload as any) : await create(payload as any);
    setSaving(false);
    if ((res as any).error) {
      toast({ title: "Errore salvataggio", description: String((res as any).error?.message ?? (res as any).error), variant: "destructive" });
      return;
    }
    toast({ title: task ? "Task aggiornato" : "Task creato" });
    onOpenChange(false);
  };

  const del = async () => {
    if (!task) return;
    if (!confirm(`Eliminare il task "${task.title}"?`)) return;
    const { error } = await remove(task.id);
    if (error) { toast({ title: "Errore", variant: "destructive" }); return; }
    toast({ title: "Task eliminato" });
    onOpenChange(false);
  };

  const toggleAssignee = (id: string) => {
    setAssigneeIds((a) => a.includes(id) ? a.filter((x) => x !== id) : [...a, id]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold uppercase tracking-wide">
            {task ? "Modifica task" : "Nuovo task"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label className="text-base font-semibold">Titolo *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Es. Fatturare commessa Rossi" className="text-base h-11 mt-1" autoFocus />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-base font-semibold">Categoria</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as TaskCategory)}>
                <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_CATEGORIES.map((c) => {
                    const M = TASK_CATEGORY_META[c];
                    const Icon = M.icon;
                    return (
                      <SelectItem key={c} value={c}>
                        <div className="flex items-center gap-2"><Icon className="w-4 h-4" />{M.label}</div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-base font-semibold">Stato</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_STATUSES.map((s) => <SelectItem key={s} value={s}>{TASK_STATUS_LABEL[s]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-base font-semibold">Priorità</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{TASK_PRIORITY_META[p].label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-base font-semibold">Descrizione</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Dettagli, contesto, link…" className="mt-1 text-base" />
          </div>

          <div>
            <Label className="text-base font-semibold">Responsabile</Label>
            <Select value={responsibleId || "none"} onValueChange={(v) => setResponsibleId(v === "none" ? "" : v)}>
              <SelectTrigger className="h-11 mt-1"><SelectValue placeholder="Nessuno" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nessuno</SelectItem>
                {profiles.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.display_name || p.id}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-base font-semibold">Assegnatari</Label>
            <div className="mt-2 border-2 border-ink/20 rounded-sm p-2 max-h-40 overflow-y-auto space-y-1">
              {profiles.map((p: any) => (
                <label key={p.id} className="flex items-center gap-2 text-sm hover:bg-muted px-2 py-1 rounded cursor-pointer">
                  <Checkbox checked={assigneeIds.includes(p.id)} onCheckedChange={() => toggleAssignee(p.id)} />
                  <span>{p.display_name || p.id}</span>
                </label>
              ))}
              {profiles.length === 0 && <div className="text-xs text-muted-foreground p-2">Nessun utente disponibile.</div>}
            </div>
            {assigneeIds.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {assigneeIds.map((id) => {
                  const p = profiles.find((x: any) => x.id === id) as any;
                  return (
                    <Badge key={id} variant="secondary" className="gap-1">
                      {p?.display_name || id}
                      <button onClick={() => toggleAssignee(id)}><X className="w-3 h-3" /></button>
                    </Badge>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-base font-semibold">Inizio</Label>
              <Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className="h-11 mt-1" />
            </div>
            <div>
              <Label className="text-base font-semibold">Scadenza</Label>
              <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="h-11 mt-1" />
            </div>
          </div>

          {(task?.linked_commessa_id || linkedCommessaId || task?.linked_sub_project || linkedSubProject) && (
            <div className="text-sm bg-muted/50 border border-ink/20 rounded-sm p-2">
              <div className="font-semibold text-xs uppercase text-muted-foreground mb-1">Collegato a</div>
              {(task?.linked_commessa_id || linkedCommessaId) && <div>Commessa: <code className="text-xs">{task?.linked_commessa_id || linkedCommessaId}</code></div>}
              {(task?.linked_sub_project || linkedSubProject) && <div>Sub-progetto: {(task?.linked_sub_project || linkedSubProject)?.name || "—"}</div>}
            </div>
          )}

          <div className="border-2 border-ink/20 rounded-sm p-3 bg-muted/30">
            <Label className="text-base font-semibold">Bloccato da…</Label>
            <p className="text-xs text-muted-foreground mt-1 mb-2">
              Il task resta in stato <b>bloccato</b> finché tutte le dipendenze non sono completate. Si sblocca automaticamente.
            </p>
            {!task ? (
              <div className="text-xs text-muted-foreground italic">Salva prima il task per aggiungere dipendenze.</div>
            ) : (
              <>
                <div className="space-y-1 mb-2">
                  {deps.length === 0 && <div className="text-xs text-muted-foreground italic">Nessuna dipendenza.</div>}
                  {deps.map((d) => {
                    let label = "—";
                    if (d.depends_on_task_id) {
                      const t = allTasks.find((x) => x.id === d.depends_on_task_id);
                      label = `📋 Task: ${t?.title ?? d.depends_on_task_id.slice(0, 8)}${t ? ` (${TASK_STATUS_LABEL[t.status]})` : ""}`;
                    } else if (d.depends_on_sub_order_id) {
                      const s = (subs as any[]).find((x) => x.id === d.depends_on_sub_order_id);
                      const o = s ? (orders as any[]).find((x) => x.id === s.order_id) : null;
                      label = `🏭 Sub-ordine: ${s?.code ?? d.depends_on_sub_order_id.slice(0, 8)}${o ? ` — ${o.cliente ?? o.code}` : ""}`;
                    }
                    return (
                      <div key={d.id} className="flex items-center justify-between bg-background border border-ink/10 rounded px-2 py-1 text-sm">
                        <span>{label}</span>
                        <button
                          onClick={async () => { await removeDependency(d.id); reloadDeps(); }}
                          className="text-red-600 hover:text-red-800"
                          title="Rimuovi"
                        ><X className="w-4 h-4" /></button>
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-2 items-end">
                  <div className="w-32">
                    <Label className="text-xs">Tipo</Label>
                    <Select value={depKind} onValueChange={(v) => { setDepKind(v as any); setDepTargetId(""); }}>
                      <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="task">Task</SelectItem>
                        <SelectItem value="sub">Sub-ordine</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex-1">
                    <Label className="text-xs">Seleziona</Label>
                    <Select value={depTargetId || "none"} onValueChange={(v) => setDepTargetId(v === "none" ? "" : v)}>
                      <SelectTrigger className="h-9 mt-1"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent className="max-h-72">
                        <SelectItem value="none">—</SelectItem>
                        {depKind === "task"
                          ? allTasks
                              .filter((t) => t.id !== task.id && !deps.some((d) => d.depends_on_task_id === t.id))
                              .map((t) => <SelectItem key={t.id} value={t.id}>{t.title} · {TASK_STATUS_LABEL[t.status]}</SelectItem>)
                          : (subs as any[])
                              .filter((s) => !deps.some((d) => d.depends_on_sub_order_id === s.id))
                              .map((s) => {
                                const o = (orders as any[]).find((x) => x.id === s.order_id);
                                return <SelectItem key={s.id} value={s.id}>{s.code} · {o?.cliente ?? o?.code ?? "—"} · {s.status}</SelectItem>;
                              })}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    disabled={!depTargetId}
                    onClick={async () => {
                      const res = await addDependency(task.id, depKind === "task" ? { dependsOnTaskId: depTargetId } : { dependsOnSubOrderId: depTargetId });
                      if ((res as any).error) {
                        toast({ title: "Errore", description: String((res as any).error?.message ?? (res as any).error), variant: "destructive" });
                      } else {
                        setDepTargetId("");
                        reloadDeps();
                      }
                    }}
                  >Aggiungi</Button>
                </div>
              </>
            )}
          </div>
        </div>


        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {task && (
              <Button variant="outline" onClick={del} className="border-red-400 text-red-700 hover:bg-red-50">
                <Trash2 className="w-4 h-4 mr-1" />Elimina
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Annulla</Button>
            <Button onClick={submit} disabled={saving} className="font-bold uppercase">
              {saving ? "Salvo…" : task ? "Salva" : "Crea task"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
