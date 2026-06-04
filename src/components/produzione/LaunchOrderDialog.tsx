import { useEffect, useState } from "react";
import { Plus, X, Upload, Loader2, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProdStore } from "@/lib/produzione/store";
import { useLocalStorageState } from "@/hooks/useLocalStorageState";
import {
  ProdDept, ProdPriority, ProdDelivery, DEPT_LABEL, PRIORITY_LABEL, SUB_DEPT_SUFFIX,
} from "@/lib/produzione/types";
import { nextOrderCode, subCode, logAction, notify, getProduzioneWriters, getMagazzinoUsers } from "@/lib/produzione/helpers";
import { MACRO_REPARTI, MacroReparto } from "@/lib/reparti";

const DEPTS: ProdDept[] = [
  "progettazione", "laboratorio", "stampa", "taglio", "tappezzeria", "falegnameria", "stampa_3d", "assemblaggio", "altro",
];

type UploadedFile = { name: string; type: string; path: string; size: number };

type FormState = {
  cliente: string;
  production_name: string;
  customer_order_ref: string;
  data: string;
  note: string;
  depts: ProdDept[];
  deptNotes: Record<string, string>;
  deptAssignees: Record<string, string>;
  attachments: UploadedFile[];
  nesting: boolean;
  priorita: ProdPriority;
  delivery: ProdDelivery;
  warehouseOnly: boolean;
  magazzinoNote: string;
  macroReparto: MacroReparto | "";
};

const STORAGE_KEY = "prod:launch-order";

export const LaunchOrderDialog = ({ open, onOpenChange, warehouseOnlyDefault }: { open: boolean; onOpenChange: (v: boolean) => void; warehouseOnlyDefault?: boolean }) => {
  const { user } = useAuth();
  const refresh = useProdStore((s) => s.refreshOrders);
  const profiles = useProdStore((s) => s.profiles);

  const initial: FormState = {
    cliente: "", production_name: "", customer_order_ref: "",
    data: new Date().toISOString().slice(0, 10), note: "",
    depts: [], deptNotes: {}, deptAssignees: {}, attachments: [], nesting: false,
    priorita: "normale", delivery: "corriere",
    warehouseOnly: !!warehouseOnlyDefault, magazzinoNote: "",
    macroReparto: "",
  };
  const [form, setForm, clearForm] = useLocalStorageState<FormState>(STORAGE_KEY, initial);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Quando viene aperto in "solo magazzino" via prop, sincronizza
  useEffect(() => {
    if (open && warehouseOnlyDefault && !form.warehouseOnly) {
      setForm((f) => ({ ...f, warehouseOnly: true }));
    }
  }, [open, warehouseOnlyDefault]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  const reset = () => {
    setForm({ ...initial, warehouseOnly: !!warehouseOnlyDefault });
    clearForm();
  };

  const toggleDept = (d: ProdDept) => {
    setForm((f) => ({ ...f, depts: f.depts.includes(d) ? f.depts.filter((x) => x !== d) : [...f.depts, d] }));
  };

  const moveDept = (idx: number, dir: -1 | 1) => {
    setForm((f) => {
      const j = idx + dir;
      if (j < 0 || j >= f.depts.length) return f;
      const next = [...f.depts];
      [next[idx], next[j]] = [next[j], next[idx]];
      return { ...f, depts: next };
    });
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !user) return;
    setUploading(true);
    try {
      const uploaded: UploadedFile[] = [];
      for (const f of Array.from(files)) {
        const ext = f.name.split(".").pop() ?? "bin";
        const path = `orders/_new/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
        const { error } = await supabase.storage.from("prod-files").upload(path, f, { upsert: false, contentType: f.type });
        if (error) { toast.error(`${f.name}: ${error.message}`); continue; }
        uploaded.push({ name: f.name, type: f.type || ext, path, size: f.size });
      }
      patch({ attachments: [...form.attachments, ...uploaded] });
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = async (idx: number) => {
    const a = form.attachments[idx];
    if (a?.path) await supabase.storage.from("prod-files").remove([a.path]);
    patch({ attachments: form.attachments.filter((_, j) => j !== idx) });
  };

  const operatorsForDept = (d: ProdDept) =>
    profiles.filter((p) => Array.isArray(p.settori) && (p.settori as any).includes(d));

  const submit = async () => {
    if (!user) return;
    const { cliente, production_name, customer_order_ref, depts, warehouseOnly, deptNotes, deptAssignees, magazzinoNote, attachments,
      nesting, priorita, delivery, data, note } = form;
    if (!cliente.trim()) { toast.error("Cliente obbligatorio"); return; }
    if (!warehouseOnly && depts.length === 0) { toast.error("Seleziona almeno un reparto (oppure spunta 'Senza lavorazione')"); return; }
    setSaving(true);
    try {
      const code = await nextOrderCode();
      const { data: order, error } = await supabase.from("production_orders").insert({
        code, cliente, data, note: note || null,
        priorita, delivery, status: "in_corso",
        attachments, nesting_included: nesting, created_by: user.id,
        production_name: production_name.trim() || null,
        customer_order_ref: customer_order_ref.trim() || null,
      } as any).select().single();
      if (error) throw error;

      const sequence: ProdDept[] = warehouseOnly ? ["magazzino"] : [...depts, "magazzino"];
      const seqNotes: Record<string, string> = { ...deptNotes, magazzino: magazzinoNote };
      const insertedIds: string[] = [];
      const assigneeNotifyTargets: Array<{ userId: string; dept: ProdDept; subId: string }> = [];
      for (let i = 0; i < sequence.length; i++) {
        const d = sequence[i];
        const assignee = deptAssignees[d] || null;
        const { data: row, error: e2 } = await supabase.from("production_sub_orders").insert({
          order_id: order.id,
          code: subCode(code, SUB_DEPT_SUFFIX[d], 1),
          dept: d,
          ordine: i,
          note: seqNotes[d] || null,
          files: [],
          depends_on: i === 0 ? null : insertedIds[i - 1],
          assignee_id: assignee,
        } as any).select("id").single();
        if (e2) throw e2;
        insertedIds.push(row.id);
        if (assignee && assignee !== user.id) assigneeNotifyTargets.push({ userId: assignee, dept: d, subId: row.id });
      }

      await logAction({
        action: "FLOW_LANCIATO",
        entity_type: "order", entity_id: order.id,
        detail: `Ordine ${code} lanciato per ${cliente} (sequenza: ${sequence.map((d) => DEPT_LABEL[d]).join(" → ")})`,
        new_state: { code, sequence, warehouseOnly, priorita, files: attachments.length, assignees: deptAssignees },
      });

      const writers = await getProduzioneWriters(sequence);
      const targets = writers.filter((u) => u !== user.id);
      if (targets.length > 0) {
        await notify({
          userIds: targets,
          type: "ordine_creato",
          message: `Nuovo ordine ${code} per ${cliente} — ${PRIORITY_LABEL[priorita]}`,
          order_id: order.id,
          link: `/produzione/board?order=${order.id}`,
          is_urgent: priorita !== "normale",
        });
      }

      // Notifica diretta agli operatori assegnati
      for (const t of assigneeNotifyTargets) {
        await notify({
          userIds: [t.userId],
          type: "ordine_creato",
          message: `Assegnato a te: ${code} · ${DEPT_LABEL[t.dept]} (${cliente})`,
          order_id: order.id,
          link: `/produzione/board?order=${order.id}`,
          is_urgent: priorita !== "normale",
        });
      }

      if (warehouseOnly) {
        const magUsers = (await getMagazzinoUsers()).filter((u) => u !== user.id);
        if (magUsers.length > 0) {
          await notify({
            userIds: magUsers,
            type: "magazzino_da_preparare",
            message: `Da preparare: ${code} · ${cliente}`,
            order_id: order.id,
            link: "/produzione/preparazione",
            is_urgent: priorita !== "normale",
          });
        }
      }

      toast.success(`${code} lanciato!`);
      reset();
      onOpenChange(false);
      await refresh();
    } catch (e: any) {
      toast.error(e.message ?? "Errore");
    } finally {
      setSaving(false);
    }
  };

  const { cliente, production_name, customer_order_ref, data, note, depts, deptNotes, deptAssignees, attachments, nesting, priorita, delivery, warehouseOnly, magazzinoNote } = form;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">{warehouseOnly ? "Solo magazzino" : "Lancia nel Flow"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between border-2 border-primary/30 bg-primary/5 rounded-sm px-3 py-2">
            <div>
              <Label className="m-0">Senza lavorazione (solo magazzino)</Label>
              <div className="text-[10px] text-muted-foreground">Prodotti già pronti — il magazzino li prepara per la consegna</div>
            </div>
            <Switch checked={warehouseOnly} onCheckedChange={(v) => patch({ warehouseOnly: v })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Cliente *</Label>
              <Input value={cliente} onChange={(e) => patch({ cliente: e.target.value })} />
            </div>
            <div>
              <Label>Data</Label>
              <Input type="date" value={data} onChange={(e) => patch({ data: e.target.value })} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Nome produzione / Tipo lavorazione</Label>
              <Input
                value={production_name}
                onChange={(e) => patch({ production_name: e.target.value })}
                placeholder="Es. Tagli pannelli forex 3mm"
              />
              <div className="text-[10px] text-muted-foreground mt-1">Visibile all'operatore in cima alla scheda</div>
            </div>
            <div>
              <Label>Rif. ordine cliente</Label>
              <Input
                value={customer_order_ref}
                onChange={(e) => patch({ customer_order_ref: e.target.value })}
                placeholder="Es. PO-1234"
              />
            </div>
          </div>

          <div>
            <Label>Note generali</Label>
            <Textarea rows={2} value={note} onChange={(e) => patch({ note: e.target.value })} placeholder="Descrivi cosa va fatto, materiali, misure, qualsiasi cosa utile a chi riceverà la lavorazione" />
          </div>

          {!warehouseOnly && (
          <div>
            <Label className="mb-2 block">Sequenza lavorazioni * <span className="text-[10px] font-mono text-muted-foreground">(nell'ordine in cui vanno eseguite)</span></Label>
            <div className="space-y-3">
              {/* Progettazione */}
              <div className="flex flex-wrap gap-2">
                {(["progettazione"] as ProdDept[]).map((d) => (
                  <button key={d} type="button" onClick={() => toggleDept(d)}
                    className={`px-3 py-1.5 text-[11px] uppercase tracking-wider font-bold border-2 rounded-sm transition-colors ${depts.includes(d) ? "bg-primary text-primary-foreground border-primary" : "border-ink/20 text-ink/60 hover:border-ink"}`}>
                    {DEPT_LABEL[d]}
                  </button>
                ))}
              </div>
              {/* Lavorazione (gruppo) */}
              <div className="border-l-2 border-ink/15 pl-3">
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1.5">Lavorazione</div>
                <div className="flex flex-wrap gap-2">
                  {(["laboratorio", "stampa", "taglio", "tappezzeria", "falegnameria", "stampa_3d"] as ProdDept[]).map((d) => (
                    <button key={d} type="button" onClick={() => toggleDept(d)}
                      className={`px-3 py-1.5 text-[11px] uppercase tracking-wider font-bold border-2 rounded-sm transition-colors ${depts.includes(d) ? "bg-primary text-primary-foreground border-primary" : "border-ink/20 text-ink/60 hover:border-ink"}`}>
                      {DEPT_LABEL[d]}
                    </button>
                  ))}
                </div>
              </div>
              {/* Uffici / altro */}
              <div className="flex flex-wrap gap-2">
                {(["assemblaggio", "altro"] as ProdDept[]).map((d) => (
                  <button key={d} type="button" onClick={() => toggleDept(d)}
                    className={`px-3 py-1.5 text-[11px] uppercase tracking-wider font-bold border-2 rounded-sm transition-colors ${depts.includes(d) ? "bg-primary text-primary-foreground border-primary" : "border-ink/20 text-ink/60 hover:border-ink"}`}>
                    {DEPT_LABEL[d]}
                  </button>
                ))}
              </div>
            </div>
            {depts.length > 0 && (
              <div className="mt-3 space-y-2 border-l-2 border-primary/30 pl-3">
                {depts.map((d, i) => {
                  const ops = operatorsForDept(d);
                  return (
                  <div key={d} className="border border-ink/15 rounded-sm p-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="font-mono text-[11px] font-bold">
                        <span className="text-primary">#{i + 1}</span> · {DEPT_LABEL[d]}
                        {i > 0 && <span className="text-[10px] text-muted-foreground ml-2">⇠ dipende da {DEPT_LABEL[depts[i - 1]]}</span>}
                      </div>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => moveDept(i, -1)} disabled={i === 0} className="p-1 border border-ink/20 rounded-sm disabled:opacity-30"><ArrowUp className="w-3 h-3" /></button>
                        <button type="button" onClick={() => moveDept(i, 1)} disabled={i === depts.length - 1} className="p-1 border border-ink/20 rounded-sm disabled:opacity-30"><ArrowDown className="w-3 h-3" /></button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        value={deptNotes[d] ?? ""}
                        onChange={(e) => patch({ deptNotes: { ...deptNotes, [d]: e.target.value } })}
                        placeholder={`Istruzioni per ${DEPT_LABEL[d]}`}
                      />
                      <select
                        value={deptAssignees[d] ?? ""}
                        onChange={(e) => patch({ deptAssignees: { ...deptAssignees, [d]: e.target.value } })}
                        className="h-10 px-2 border-2 border-input rounded-md bg-background text-sm"
                      >
                        <option value="">Operatore (facoltativo)…</option>
                        {ops.map((o) => (
                          <option key={o.id} value={o.id}>{o.display_name ?? o.id.slice(0, 8)}</option>
                        ))}
                        {ops.length === 0 && (
                          <option disabled value="__none">Nessun operatore con settore {DEPT_LABEL[d]}</option>
                        )}
                      </select>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
            <div className="mt-2 text-[10px] font-mono text-muted-foreground">↳ Magazzino sarà aggiunto automaticamente in coda</div>
          </div>
          )}

          <div>
            <Label>Note per il magazzino</Label>
            <Input value={magazzinoNote} onChange={(e) => patch({ magazzinoNote: e.target.value })} placeholder="Imballo speciale, articoli particolari, ecc." />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Priorità</Label>
              <select value={priorita} onChange={(e) => patch({ priorita: e.target.value as ProdPriority })} className="w-full h-10 px-3 border-2 border-input rounded-md bg-background text-sm">
                <option value="normale">Normale</option>
                <option value="urgente">Urgente</option>
                <option value="bloccante">Bloccante</option>
              </select>
            </div>
            <div>
              <Label>Consegna</Label>
              <select value={delivery} onChange={(e) => patch({ delivery: e.target.value as ProdDelivery })} className="w-full h-10 px-3 border-2 border-input rounded-md bg-background text-sm">
                <option value="ritiro">Ritiro cliente</option>
                <option value="mezzo_proprio">Mezzo proprio</option>
                <option value="corriere">Corriere</option>
              </select>
            </div>
          </div>

          {!warehouseOnly && (
          <div>
            <Label className="mb-2 block">Allegati per gli operatori</Label>
            <label className="flex items-center justify-center gap-2 border-2 border-dashed border-ink/30 hover:border-primary rounded-sm py-4 cursor-pointer text-[12px] text-muted-foreground hover:text-primary">
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {uploading ? "Caricamento…" : "Trascina qui o clicca per caricare PDF, DXF, immagini, ecc."}
              <input type="file" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
            </label>
            {attachments.length > 0 && (
              <ul className="mt-2 space-y-1">
                {attachments.map((a, i) => (
                  <li key={i} className="flex items-center justify-between text-[11px] font-mono bg-muted px-2 py-1 rounded-sm">
                    <span className="truncate">{a.name} <span className="text-muted-foreground">({Math.round(a.size / 1024)} KB)</span></span>
                    <button onClick={() => removeAttachment(i)} className="text-ink/40 hover:text-destructive">
                      <X className="w-3 h-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          )}

          {!warehouseOnly && (
          <div className="flex items-center justify-between border-2 border-ink/15 rounded-sm px-3 py-2">
            <Label className="m-0">Nesting incluso?</Label>
            <Switch checked={nesting} onCheckedChange={(v) => patch({ nesting: v })} />
          </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-2">
          <button type="button" onClick={reset} className="text-[11px] uppercase tracking-wider text-muted-foreground hover:text-destructive font-mono">
            Pulisci modulo
          </button>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Annulla</Button>
            <Button onClick={submit} disabled={saving}>{saving ? "Lancio…" : (warehouseOnly ? "Invia al magazzino" : "Lancia nel Flow")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
