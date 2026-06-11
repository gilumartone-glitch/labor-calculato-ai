import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Save, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useLavorazioneTemplates,
  type LavorazioneTemplate,
  type TemplateMateriale,
} from "@/lib/montaggi/lavorazioni";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick?: (t: LavorazioneTemplate) => void;
};

const emptyDraft = (): Omit<LavorazioneTemplate, "id" | "created_at" | "updated_at" | "created_by"> => ({
  nome: "",
  descrizione: "",
  ore_stimate: 1,
  costo_orario_default: 25,
  materiali: [],
  note: "",
});

export const TemplateManagerDialog = ({ open, onOpenChange, onPick }: Props) => {
  const { items, create, update, remove } = useLavorazioneTemplates();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft());
  const [busy, setBusy] = useState(false);

  const startNew = () => { setEditingId(null); setDraft(emptyDraft()); };
  const startEdit = (t: LavorazioneTemplate) => {
    setEditingId(t.id);
    setDraft({
      nome: t.nome,
      descrizione: t.descrizione ?? "",
      ore_stimate: Number(t.ore_stimate) || 0,
      costo_orario_default: Number(t.costo_orario_default) || 0,
      materiali: t.materiali ?? [],
      note: t.note ?? "",
    });
  };

  const save = async () => {
    if (!draft.nome.trim()) { toast.error("Dai un nome alla causale"); return; }
    setBusy(true);
    try {
      if (editingId) {
        await update(editingId, draft as any);
        toast.success("Causale aggiornata");
      } else {
        const created = await create(draft);
        toast.success("Causale creata");
        if (onPick) { onPick(created); onOpenChange(false); return; }
      }
      startNew();
    } catch (e: any) { toast.error(e.message ?? "Errore"); }
    finally { setBusy(false); }
  };

  const del = async (id: string) => {
    if (!confirm("Eliminare questa causale?")) return;
    try { await remove(id); if (editingId === id) startNew(); }
    catch (e: any) { toast.error(e.message ?? "Errore"); }
  };

  const updateMat = (i: number, patch: Partial<TemplateMateriale>) => {
    setDraft((d) => ({ ...d, materiali: d.materiali.map((m, idx) => idx === i ? { ...m, ...patch } : m) }));
  };
  const addMat = () => setDraft((d) => ({ ...d, materiali: [...d.materiali, { nome: "", quantita: 1, unita: "pz", costo_unitario: 0 }] }));
  const delMat = (i: number) => setDraft((d) => ({ ...d, materiali: d.materiali.filter((_, idx) => idx !== i) }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Causali di montaggio</DialogTitle>
          <DialogDescription>
            Crea template riusabili (es. "Posa in opera pavimento", "Ignifugazione") con ore stimate, costo orario e materiali tipici.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[260px_1fr]">
          <div className="space-y-2 max-h-[60vh] overflow-y-auto rounded-md border border-border p-2">
            <Button size="sm" className="w-full" variant="outline" onClick={startNew}>
              <Plus className="h-4 w-4" />Nuova causale
            </Button>
            {items.length === 0 && <p className="text-xs text-muted-foreground p-2">Nessuna causale ancora salvata.</p>}
            {items.map((t) => (
              <div key={t.id} className={`flex items-center gap-1 rounded-sm border p-2 text-sm ${editingId === t.id ? "border-dept bg-dept-soft" : "border-border bg-background"}`}>
                <button type="button" onClick={() => onPick ? (onPick(t), onOpenChange(false)) : startEdit(t)} className="flex-1 text-left">
                  <div className="font-medium">{t.nome}</div>
                  <div className="text-xs text-muted-foreground">{t.ore_stimate}h · €{t.costo_orario_default}/h</div>
                </button>
                <Button size="icon" variant="ghost" onClick={() => startEdit(t)} title="Modifica"><Pencil className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="ghost" onClick={() => del(t.id)} title="Elimina"><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            ))}
          </div>

          <div className="space-y-3 rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold">{editingId ? "Modifica causale" : "Nuova causale"}</h4>
              {editingId && <Button size="sm" variant="ghost" onClick={startNew}><X className="h-4 w-4" />Annulla</Button>}
            </div>
            <div>
              <Label>Nome causale</Label>
              <Input value={draft.nome} onChange={(e) => setDraft((d) => ({ ...d, nome: e.target.value }))} placeholder="Es. Posa in opera pavimento" />
            </div>
            <div>
              <Label>Descrizione</Label>
              <Textarea rows={2} value={draft.descrizione ?? ""} onChange={(e) => setDraft((d) => ({ ...d, descrizione: e.target.value }))} placeholder="Cosa comprende questa lavorazione…" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Ore stimate</Label>
                <Input type="number" min={0} step="0.25" value={draft.ore_stimate}
                  onChange={(e) => setDraft((d) => ({ ...d, ore_stimate: Number(e.target.value) || 0 }))} />
              </div>
              <div>
                <Label>Costo orario default (€)</Label>
                <Input type="number" min={0} step="0.5" value={draft.costo_orario_default}
                  onChange={(e) => setDraft((d) => ({ ...d, costo_orario_default: Number(e.target.value) || 0 }))} />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Materiali tipici</Label>
                <Button size="sm" variant="outline" onClick={addMat}><Plus className="h-3.5 w-3.5" />Materiale</Button>
              </div>
              {draft.materiali.length === 0 && <p className="text-xs text-muted-foreground">Opzionale: lista dei materiali normalmente usati per questa lavorazione.</p>}
              {draft.materiali.map((m, i) => (
                <div key={i} className="grid gap-2 grid-cols-[1fr_70px_70px_90px_30px] items-center">
                  <Input placeholder="Nome" value={m.nome} onChange={(e) => updateMat(i, { nome: e.target.value })} />
                  <Input type="number" placeholder="Qtà" value={m.quantita} onChange={(e) => updateMat(i, { quantita: Number(e.target.value) || 0 })} />
                  <Input placeholder="UM" value={m.unita ?? ""} onChange={(e) => updateMat(i, { unita: e.target.value })} />
                  <Input type="number" placeholder="€/u" value={m.costo_unitario ?? 0} onChange={(e) => updateMat(i, { costo_unitario: Number(e.target.value) || 0 })} />
                  <Button size="icon" variant="ghost" onClick={() => delMat(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              ))}
            </div>

            <div>
              <Label>Note</Label>
              <Textarea rows={2} value={draft.note ?? ""} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button onClick={save} disabled={busy}>
                <Save className="h-4 w-4" />{editingId ? "Salva modifiche" : "Crea causale"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
