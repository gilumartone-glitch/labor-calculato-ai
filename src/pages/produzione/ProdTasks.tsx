import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ProdLayout } from "@/components/produzione/ProdLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Plus, Filter, Search, CalendarClock, User as UserIcon } from "lucide-react";
import { useAdminTasks, AdminTask } from "@/hooks/useAdminTasks";
import { TaskDialog } from "@/components/tasks/TaskDialog";
import {
  TASK_CATEGORIES, TASK_CATEGORY_META, TaskCategory,
  TASK_STATUSES, TASK_STATUS_LABEL, TaskStatus,
  TASK_PRIORITY_META,
} from "@/lib/tasks/constants";
import { useProdStore } from "@/lib/produzione/store";
import { cn } from "@/lib/utils";

const KANBAN_COLS: TaskStatus[] = ["da_fare", "in_corso", "in_attesa", "bloccato", "completato"];

const ProdTasks = () => {
  const { tasks, loading, update } = useAdminTasks();
  const profiles = useProdStore((s) => s.profiles);
  const [openDialog, setOpenDialog] = useState(false);
  const [editing, setEditing] = useState<AdminTask | null>(null);
  const [catFilter, setCatFilter] = useState<TaskCategory | "all">("all");
  const [q, setQ] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const taskId = searchParams.get("task");
    if (!taskId || loading) return;
    const found = tasks.find((t) => t.id === taskId);
    if (!found) return;
    setEditing(found);
    setOpenDialog(true);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("task");
      return next;
    }, { replace: true });
  }, [loading, searchParams, setSearchParams, tasks]);

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (catFilter !== "all" && t.category !== catFilter) return false;
      if (q && !(`${t.title} ${t.description ?? ""}`.toLowerCase().includes(q.toLowerCase()))) return false;
      return true;
    });
  }, [tasks, catFilter, q]);

  const byCol = useMemo(() => {
    const map: Record<TaskStatus, AdminTask[]> = { da_fare: [], in_corso: [], in_attesa: [], bloccato: [], completato: [], annullato: [] };
    filtered.forEach((t) => { (map[t.status] ||= []).push(t); });
    return map;
  }, [filtered]);

  const nameOf = (id?: string | null) => {
    if (!id) return null;
    const p = profiles.find((x: any) => x.id === id) as any;
    return p?.display_name || id.slice(0, 6);
  };

  const openNew = () => { setEditing(null); setOpenDialog(true); };
  const openEdit = (t: AdminTask) => { setEditing(t); setOpenDialog(true); };

  const moveTo = async (t: AdminTask, s: TaskStatus) => {
    await update(t.id, { status: s, ...(s === "completato" ? { completed_at: new Date().toISOString() } : {}) } as any);
  };

  return (
    <ProdLayout>
      <div className="p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="font-display text-3xl font-bold uppercase tracking-tight">Task</h1>
            <p className="text-sm text-muted-foreground mt-1">Amministrazione, acquisti, vendite, marketing, HR e generici — tutto ciò che non è produzione.</p>
          </div>
          <Button onClick={openNew} className="font-bold uppercase h-11">
            <Plus className="w-4 h-4 mr-1" />Nuovo task
          </Button>
        </div>

        <div className="flex items-center gap-2 flex-wrap border-2 border-ink/15 bg-paper rounded-sm p-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <button
            onClick={() => setCatFilter("all")}
            className={cn("px-3 py-1.5 text-sm font-semibold uppercase rounded-sm border-2",
              catFilter === "all" ? "bg-ink text-paper border-ink" : "bg-paper border-ink/20 hover:border-ink/40")}
          >Tutti</button>
          {TASK_CATEGORIES.map((c) => {
            const M = TASK_CATEGORY_META[c]; const Icon = M.icon;
            const active = catFilter === c;
            return (
              <button
                key={c}
                onClick={() => setCatFilter(c)}
                className={cn("px-3 py-1.5 text-sm font-semibold rounded-sm border-2 flex items-center gap-1.5",
                  active ? `${M.bg} ${M.color} border-current` : "bg-paper border-ink/20 hover:border-ink/40")}
              >
                <Icon className="w-4 h-4" />{M.label}
              </button>
            );
          })}
          <div className="relative ml-auto">
            <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca…" className="pl-8 h-9 w-56" />
          </div>
        </div>

        {loading && <div className="text-sm text-muted-foreground">Carico…</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          {KANBAN_COLS.map((col) => (
            <div key={col} className="bg-muted/40 border-2 border-ink/15 rounded-sm p-2 min-h-[280px]">
              <div className="flex items-center justify-between mb-2 px-1">
                <div className="font-bold uppercase text-sm tracking-wide">{TASK_STATUS_LABEL[col]}</div>
                <Badge variant="secondary" className="text-xs">{byCol[col].length}</Badge>
              </div>
              <div className="space-y-2">
                {byCol[col].map((t) => {
                  const M = TASK_CATEGORY_META[t.category];
                  const Icon = M.icon;
                  const prio = TASK_PRIORITY_META[t.priority];
                  const overdue = t.due_at && new Date(t.due_at) < new Date() && t.status !== "completato";
                  return (
                    <div
                      key={t.id}
                      onClick={() => openEdit(t)}
                      className="bg-paper border-2 border-ink/20 rounded-sm p-2.5 cursor-pointer hover:border-ink hover:shadow-[3px_3px_0_0_hsl(var(--ink))] transition-all"
                    >
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <div className={cn("inline-flex items-center gap-1 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded", M.bg, M.color)}>
                          <Icon className="w-3 h-3" />{M.label}
                        </div>
                        <Badge variant="outline" className={cn("text-[10px] py-0 px-1.5", prio.className)}>{prio.label}</Badge>
                      </div>
                      <div className="font-semibold text-sm leading-tight mb-1">{t.title}</div>
                      {t.description && <div className="text-xs text-muted-foreground line-clamp-2 mb-1.5">{t.description}</div>}
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
                        {t.responsible_id && (
                          <span className="inline-flex items-center gap-1"><UserIcon className="w-3 h-3" />{nameOf(t.responsible_id)}</span>
                        )}
                        {t.due_at && (
                          <span className={cn("inline-flex items-center gap-1", overdue && "text-red-700 font-semibold")}>
                            <CalendarClock className="w-3 h-3" />{new Date(t.due_at).toLocaleDateString("it-IT")}
                          </span>
                        )}
                        {t.assignee_ids.length > 0 && <span>· {t.assignee_ids.length} assegn.</span>}
                      </div>
                      <div className="flex gap-1 mt-2" onClick={(e) => e.stopPropagation()}>
                        {KANBAN_COLS.filter((s) => s !== col).slice(0, 3).map((s) => (
                          <button
                            key={s}
                            onClick={() => moveTo(t, s)}
                            className="text-[10px] px-1.5 py-0.5 border border-ink/20 rounded hover:bg-ink hover:text-paper"
                            title={`Sposta a ${TASK_STATUS_LABEL[s]}`}
                          >{TASK_STATUS_LABEL[s]}</button>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {byCol[col].length === 0 && (
                  <div className="text-xs text-muted-foreground italic text-center py-6">Nessun task</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <TaskDialog open={openDialog} onOpenChange={setOpenDialog} task={editing} />
    </ProdLayout>
  );
};

export default ProdTasks;
