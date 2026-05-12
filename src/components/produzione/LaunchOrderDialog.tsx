import { useState } from "react";
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
import {
  ProdDept, ProdPriority, ProdDelivery, DEPT_LABEL, PRIORITY_LABEL, SUB_DEPT_SUFFIX,
} from "@/lib/produzione/types";
import { nextOrderCode, subCode, logAction, notify, getProduzioneWriters, getMagazzinoUsers } from "@/lib/produzione/helpers";

const DEPTS: ProdDept[] = [
  "grafica", "stampa", "taglio", "tappezzeria", "stampa_3d", "falegnameria", "assemblaggio", "altro",
];

type UploadedFile = { name: string; type: string; path: string; size: number };

export const LaunchOrderDialog = ({ open, onOpenChange, warehouseOnlyDefault }: { open: boolean; onOpenChange: (v: boolean) => void; warehouseOnlyDefault?: boolean }) => {
  const { user } = useAuth();
  const refresh = useProdStore((s) => s.refreshOrders);

  const [cliente, setCliente] = useState("");
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [depts, setDepts] = useState<ProdDept[]>([]);
  const [deptNotes, setDeptNotes] = useState<Record<string, string>>({});
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [nesting, setNesting] = useState(false);
  const [priorita, setPriorita] = useState<ProdPriority>("normale");
  const [delivery, setDelivery] = useState<ProdDelivery>("corriere");
  const [warehouseOnly, setWarehouseOnly] = useState<boolean>(!!warehouseOnlyDefault);
  const [magazzinoNote, setMagazzinoNote] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setCliente(""); setNote(""); setDepts([]); setDeptNotes({});
    setAttachments([]); setNesting(false);
    setPriorita("normale"); setDelivery("corriere");
    setWarehouseOnly(!!warehouseOnlyDefault); setMagazzinoNote("");
  };

  const toggleDept = (d: ProdDept) => {
    setDepts((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);
  };

  const moveDept = (idx: number, dir: -1 | 1) => {
    setDepts((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
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
      setAttachments((p) => [...p, ...uploaded]);
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = async (idx: number) => {
    const a = attachments[idx];
    if (a?.path) await supabase.storage.from("prod-files").remove([a.path]);
    setAttachments((p) => p.filter((_, j) => j !== idx));
  };

  const submit = async () => {
    if (!user) return;
    if (!cliente.trim()) { toast.error("Cliente obbligatorio"); return; }
    if (!warehouseOnly && depts.length === 0) { toast.error("Seleziona almeno un reparto (oppure spunta 'Senza lavorazione')"); return; }
    setSaving(true);
    try {
      const code = await nextOrderCode();
      const { data: order, error } = await supabase.from("production_orders").insert({
        code, cliente, data, note: note || null,
        priorita, delivery, status: "in_corso",
        attachments, nesting_included: nesting, created_by: user.id,
      }).select().single();
      if (error) throw error;

      // Sequenza: prima i reparti scelti (se non 'senza lavorazione'), POI sempre Magazzino in coda.
      const sequence: ProdDept[] = warehouseOnly ? ["magazzino"] : [...depts, "magazzino"];
      const seqNotes: Record<string, string> = { ...deptNotes, magazzino: magazzinoNote };
      const insertedIds: string[] = [];
      for (let i = 0; i < sequence.length; i++) {
        const d = sequence[i];
        const { data: row, error: e2 } = await supabase.from("production_sub_orders").insert({
          order_id: order.id,
          code: subCode(code, SUB_DEPT_SUFFIX[d], 1),
          dept: d,
          ordine: i,
          note: seqNotes[d] || null,
          files: [],
          depends_on: i === 0 ? null : insertedIds[i - 1],
        }).select("id").single();
        if (e2) throw e2;
        insertedIds.push(row.id);
      }

      await logAction({
        action: "FLOW_LANCIATO",
        entity_type: "order", entity_id: order.id,
        detail: `Ordine ${code} lanciato per ${cliente} (sequenza: ${sequence.map((d) => DEPT_LABEL[d]).join(" → ")})`,
        new_state: { code, sequence, warehouseOnly, priorita, files: attachments.length },
      });

      const writers = await getProduzioneWriters();
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

      // Notifica al responsabile magazzino se l'ordine parte direttamente dal magazzino
      // (cioè è 'senza lavorazione' — altrimenti riceverà la notifica al completamento dell'ultimo sub di lavorazione)
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
            <Switch checked={warehouseOnly} onCheckedChange={setWarehouseOnly} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Cliente *</Label>
              <Input value={cliente} onChange={(e) => setCliente(e.target.value)} />
            </div>
            <div>
              <Label>Data</Label>
              <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Note generali</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          {!warehouseOnly && (
          <div>
            <Label className="mb-2 block">Sequenza lavorazioni * <span className="text-[10px] font-mono text-muted-foreground">(nell'ordine in cui vanno eseguite)</span></Label>
            <div className="flex flex-wrap gap-2">
              {DEPTS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDept(d)}
                  className={`px-3 py-1.5 text-[11px] uppercase tracking-wider font-bold border-2 rounded-sm transition-colors ${
                    depts.includes(d) ? "bg-primary text-primary-foreground border-primary" : "border-ink/20 text-ink/60 hover:border-ink"
                  }`}
                >
                  {DEPT_LABEL[d]}
                </button>
              ))}
            </div>
            {depts.length > 0 && (
              <div className="mt-3 space-y-2 border-l-2 border-primary/30 pl-3">
                {depts.map((d, i) => (
                  <div key={d} className="border border-ink/15 rounded-sm p-2">
                    <div className="flex items-center justify-between mb-1">
                      <div className="font-mono text-[11px] font-bold">
                        <span className="text-primary">#{i + 1}</span> · {DEPT_LABEL[d]}
                        {i > 0 && <span className="text-[10px] text-muted-foreground ml-2">⇠ dipende da {DEPT_LABEL[depts[i - 1]]}</span>}
                      </div>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => moveDept(i, -1)} disabled={i === 0} className="p-1 border border-ink/20 rounded-sm disabled:opacity-30"><ArrowUp className="w-3 h-3" /></button>
                        <button type="button" onClick={() => moveDept(i, 1)} disabled={i === depts.length - 1} className="p-1 border border-ink/20 rounded-sm disabled:opacity-30"><ArrowDown className="w-3 h-3" /></button>
                      </div>
                    </div>
                    <Input
                      value={deptNotes[d] ?? ""}
                      onChange={(e) => setDeptNotes({ ...deptNotes, [d]: e.target.value })}
                      placeholder={`Istruzioni per ${DEPT_LABEL[d]}`}
                    />
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2 text-[10px] font-mono text-muted-foreground">↳ Magazzino sarà aggiunto automaticamente in coda</div>
          </div>
          )}

          <div>
            <Label>Note per il magazzino</Label>
            <Input value={magazzinoNote} onChange={(e) => setMagazzinoNote(e.target.value)} placeholder="Imballo speciale, articoli particolari, ecc." />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Priorità</Label>
              <select value={priorita} onChange={(e) => setPriorita(e.target.value as ProdPriority)} className="w-full h-10 px-3 border-2 border-input rounded-md bg-background text-sm">
                <option value="normale">Normale</option>
                <option value="urgente">Urgente</option>
                <option value="bloccante">Bloccante</option>
              </select>
            </div>
            <div>
              <Label>Consegna</Label>
              <select value={delivery} onChange={(e) => setDelivery(e.target.value as ProdDelivery)} className="w-full h-10 px-3 border-2 border-input rounded-md bg-background text-sm">
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
            <Switch checked={nesting} onCheckedChange={setNesting} />
          </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annulla</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Lancio…" : (warehouseOnly ? "Invia al magazzino" : "Lancia nel Flow")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};