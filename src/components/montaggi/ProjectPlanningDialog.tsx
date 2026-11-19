import { useEffect, useState } from "react";
import { CalendarDays, Save, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PlanningDatePicker } from "./PlanningDatePicker";
import { buildProjectPlanning, type DepartmentDates, type PlanningDay } from "@/lib/project-planning";

type Project = { id: string; code: string; cliente: string; production_name: string | null; source_commessa_id: string | null };
type Department = DepartmentDates & { subIds: string[]; label: string };
type Person = { id: string; display_name: string | null };

export function ProjectPlanningDialog({ open, projectId, onClose, onSaved }: {
  open: boolean; projectId?: string | null; onClose: () => void; onSaved: (date: string) => void;
}) {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [search, setSearch] = useState("");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [existing, setExisting] = useState<PlanningDay[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [deadline, setDeadline] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSelected(null); setDepartments([]); setExisting([]); setSearch(""); setError(""); setLoading(true);
    (async () => {
      const { data, error } = await supabase.from("production_orders")
        .select("id, code, cliente, production_name, source_commessa_id")
        .not("source_commessa_id", "is", null).not("status", "in", "(annullato,chiuso,spedito)").order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) setError("Non riesco a caricare i progetti.");
      const list = data ?? [];
      setProjects(list);
      if (projectId) setSelected(list.find(project => project.source_commessa_id === projectId) ?? null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, projectId]);

  useEffect(() => {
    const commessaId = selected?.source_commessa_id;
    if (!selected || !commessaId) return;
    let cancelled = false;
    setLoading(true); setError(""); setDepartments([]);
    (async () => {
      const [plan, subs, commessa, profiles] = await Promise.all([
        supabase.from("montaggi_planning").select("id, commessa_id, cantiere_label, operator_id, date, hours, notes, reparto, created_by, completed_at").eq("commessa_id", commessaId).order("date"),
        supabase.from("production_sub_orders").select("id, dept, start_date, end_date, due_date, operator_ids, assignee_id").eq("order_id", selected.id).order("ordine"),
        supabase.from("commesse").select("data_scadenza").eq("id", commessaId).single(),
        supabase.from("profiles").select("id, display_name").order("display_name"),
      ]);
      if (cancelled) return;
      if (plan.error || subs.error || commessa.error || profiles.error) { setError("Non riesco a caricare tutte le date del progetto."); setLoading(false); return; }
      const rows = plan.data ?? [];
      setExisting(rows); setPeople(profiles.data ?? []); setDeadline(commessa.data?.data_scadenza ?? "");
      const keys = Array.from(new Set([...(subs.data ?? []).map(sub => sub.dept), ...rows.map(row => row.reparto ?? "montaggi")]));
      setDepartments(keys.map(dept => {
        const plans = rows.filter(row => (row.reparto ?? "montaggi") === dept);
        const items = (subs.data ?? []).filter(sub => sub.dept === dept);
        const starts = [...plans.map(row => row.date), ...items.map(sub => sub.start_date)].filter((v): v is string => !!v).sort();
        const ends = [...plans.map(row => row.date), ...items.map(sub => sub.end_date)].filter((v): v is string => !!v).sort();
        const fallback = items.find(sub => sub.due_date)?.due_date ?? commessa.data?.data_scadenza ?? new Date().toISOString().slice(0, 10);
        return { dept, label: dept.replace(/_/g, " "), start: starts[0] ?? fallback, end: ends.at(-1) ?? starts[0] ?? fallback,
          due: items.find(sub => sub.due_date)?.due_date ?? "", subIds: items.map(sub => sub.id),
          operators: Array.from(new Set([...plans.map(row => row.operator_id), ...items.flatMap(sub => sub.operator_ids.length ? sub.operator_ids : sub.assignee_id ? [sub.assignee_id] : [])])),
        };
      }));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [selected]);

  const patch = (dept: string, change: Partial<Department>) => setDepartments(list => list.map(item => item.dept === dept ? { ...item, ...change } : item));
  const save = async () => {
    const id = selected?.source_commessa_id;
    if (!user || !selected || !id || !departments.length) return;
    setSaving(true); setError("");
    try {
      const result = buildProjectPlanning(existing, departments, { id, label: selected.production_name || selected.cliente, userId: user.id }, () => crypto.randomUUID());
      // Keep existing identities; never delete the plan before a successful write.
      if (result.rows.length) {
        const { error } = await supabase.from("montaggi_planning").upsert(result.rows, { onConflict: "id" });
        if (error) throw error;
      }
      if (result.removedIds.length) {
        const { error } = await supabase.from("montaggi_planning").delete().in("id", result.removedIds);
        if (error) throw error;
      }
      for (const department of departments) {
        if (!department.subIds.length) continue;
        const { error } = await supabase.from("production_sub_orders").update({ start_date: department.start, end_date: department.end, due_date: department.due || null }).in("id", department.subIds);
        if (error) throw error;
      }
      const { error } = await supabase.from("commesse").update({ data_scadenza: deadline || null }).eq("id", id);
      if (error) throw error;
      toast.success(existing.length ? "Date del progetto aggiornate" : "Progetto reinserito in Pianificazione");
      onSaved(departments.map(item => item.start).sort()[0]); onClose();
    } catch (error) { setError(error instanceof Error ? error.message : "Salvataggio non completato. Riapri il progetto per controllare le date e riprova."); }
    finally { setSaving(false); }
  };

  const filtered = projects.filter(project => `${project.code} ${project.cliente} ${project.production_name ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  return <Dialog open={open} onOpenChange={value => !value && !saving && onClose()}>
    <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5" />{selected ? `Date progetto · ${selected.code}` : "Progetti Flow"}</DialogTitle></DialogHeader>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {loading ? <p className="text-muted-foreground">Caricamento…</p> : !selected ? <>
        <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input aria-label="Cerca progetto Flow" placeholder="Cerca cliente, progetto o numero ordine" className="pl-9" value={search} onChange={event => setSearch(event.target.value)} /></div>
        <div className="divide-y divide-border max-h-[55vh] overflow-y-auto">{filtered.map(project => <Button key={project.id} variant="ghost" className="w-full h-auto justify-start py-3 whitespace-normal text-left" onClick={() => setSelected(project)}><span><strong>{project.code}</strong><span className="block">{project.production_name || project.cliente}</span></span></Button>)}{!filtered.length && <p className="py-4 text-muted-foreground">Nessun progetto trovato.</p>}</div>
      </> : <div className="space-y-5">
        <div><strong>{selected.production_name || selected.cliente}</strong><span className="block text-sm text-muted-foreground">{existing.length ? `${existing.length} impegni pianificati` : "Nessun impegno pianificato"}</span></div>
        <div className="space-y-1"><span className="text-sm font-medium">Consegna progetto</span><div className="max-w-56"><PlanningDatePicker label="Consegna progetto" value={deadline} onChange={setDeadline} /></div></div>
        {departments.map(department => <section key={department.dept} className="border-t border-border pt-4 space-y-3">
          <h3 className="font-semibold capitalize">{department.label}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{([['start', 'Inizio'], ['end', 'Fine'], ['due', 'Scadenza']] as const).map(([key, label]) => <div key={key} className="space-y-1"><span className="text-sm">{label}</span><PlanningDatePicker label={`${label} ${department.label}`} value={department[key]} onChange={value => patch(department.dept, { [key]: value })} /></div>)}</div>
          {!existing.some(row => (row.reparto ?? "montaggi") === department.dept) && <div className="space-y-2"><span className="text-sm font-medium">Operai</span><div className="flex flex-wrap gap-3">{people.map(person => <label key={person.id} className="flex items-center gap-2 text-sm"><Checkbox checked={department.operators.includes(person.id)} onCheckedChange={checked => patch(department.dept, { operators: checked ? [...department.operators, person.id] : department.operators.filter(id => id !== person.id) })} />{person.display_name || "Utente"}</label>)}</div></div>}
        </section>)}
      </div>}
      <DialogFooter className="gap-2"><Button variant="outline" disabled={saving} onClick={onClose}>Chiudi</Button>{selected && <Button disabled={loading || saving || !departments.length || !!error} onClick={save}><Save className="h-4 w-4" />{saving ? "Salvataggio…" : existing.length ? "Salva date" : "Reinserisci in Pianificazione"}</Button>}</DialogFooter>
    </DialogContent>
  </Dialog>;
}