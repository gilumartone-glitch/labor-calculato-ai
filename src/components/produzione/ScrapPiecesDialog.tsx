import { useMemo, useState } from "react";
import { Plus, Trash2, Loader2, Package2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProdStore } from "@/lib/produzione/store";
import { InvItem, ScrapPiece, SCRAP_STATUS_LABEL } from "@/lib/produzione/types";
import { nextScrapCode, fmtMm } from "@/lib/produzione/scrap";
import { logAction } from "@/lib/produzione/helpers";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  inv: InvItem | null;
  matLabel?: string;
};

export const ScrapPiecesDialog = ({ open, onOpenChange, inv, matLabel }: Props) => {
  const { user } = useAuth();
  const { scraps, refreshInventory } = useProdStore();
  const myScraps = useMemo(
    () => (inv ? scraps.filter((p) => p.inventory_id === inv.id) : []),
    [scraps, inv],
  );

  const [w, setW] = useState("");
  const [h, setH] = useState("");
  const [posizione, setPosizione] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  if (!inv) return null;

  // Spessore ereditato dal materiale (no input manuale).
  const inheritedThickness = (() => {
    const raw = (inv.material_attrs as any)?.thickness;
    if (raw === undefined || raw === null || raw === "") return null;
    const n = parseFloat(String(raw).replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  const add = async () => {
    const ww = parseFloat(w.replace(",", "."));
    const hh = parseFloat(h.replace(",", "."));
    if (!ww || !hh || ww <= 0 || hh <= 0) {
      toast.error("Dimensioni non valide");
      return;
    }
    setSaving(true);
    try {
      const code = nextScrapCode(inv.code, myScraps);
      const { error } = await supabase.from("inventory_scrap_pieces").insert({
        inventory_id: inv.id,
        code,
        w_mm: ww,
        h_mm: hh,
        thickness_mm: inheritedThickness,
        posizione: posizione || null,
        note: note || null,
        status: "libero",
        created_by: user?.id ?? null,
      });
      if (error) throw error;
      await logAction({
        action: "SFRIDO_AGGIUNTO",
        entity_type: "scrap_piece",
        entity_id: code,
        detail: `${code} · ${fmtMm(ww, hh)} · ${inv.code}`,
        new_state: { w_mm: ww, h_mm: hh, posizione },
      });
      setW(""); setH(""); setPosizione(""); setNote("");
      await refreshInventory();
      toast.success(`${code} aggiunto`);
    } catch (e: any) {
      toast.error(e.message ?? "Errore");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: ScrapPiece) => {
    if (!confirm(`Eliminare il pezzo ${p.code}?`)) return;
    const { error } = await supabase.from("inventory_scrap_pieces").delete().eq("id", p.id);
    if (error) { toast.error(error.message); return; }
    await logAction({
      action: "SFRIDO_ELIMINATO",
      entity_type: "scrap_piece",
      entity_id: p.code,
      detail: `${p.code} eliminato da ${inv.code}`,
      prev_state: { w_mm: p.w_mm, h_mm: p.h_mm },
    });
    await refreshInventory();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <Package2 className="w-5 h-5" /> Pezzi di sfrido · <span className="font-mono text-sm text-primary">{inv.code}</span>
          </DialogTitle>
          <DialogDescription className="text-[12px]">{matLabel ?? inv.nome}</DialogDescription>
        </DialogHeader>

        {/* form aggiungi */}
        <div className="border-2 border-ink/15 rounded-sm p-3 bg-muted/20 space-y-2">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Aggiungi pezzo</div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-[10px]">Larghezza (mm)</Label>
              <Input value={w} onChange={(e) => setW(e.target.value)} placeholder="1200" />
            </div>
            <div>
              <Label className="text-[10px]">Altezza (mm)</Label>
              <Input value={h} onChange={(e) => setH(e.target.value)} placeholder="800" />
            </div>
            <div>
              <Label className="text-[10px]">Posizione</Label>
              <Input value={posizione} onChange={(e) => setPosizione(e.target.value)} placeholder="A3" />
            </div>
          </div>
          {inheritedThickness !== null && (
            <div className="font-mono text-[10px] text-muted-foreground">
              Spessore ereditato dal materiale: <span className="text-ink font-bold">{inheritedThickness} mm</span>
            </div>
          )}
          <div>
            <Label className="text-[10px]">Note</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="es. graffio in alto a destra" />
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={add} disabled={saving}>
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3 mr-1" />}
              Aggiungi pezzo
            </Button>
          </div>
        </div>

        {/* lista */}
        <div className="border-2 border-ink/15 rounded-sm overflow-hidden">
          {myScraps.length === 0 ? (
            <div className="p-6 text-center text-[12px] text-muted-foreground">Nessun pezzo di sfrido per questo materiale.</div>
          ) : (
            <table className="w-full text-[12px]">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-wider font-bold">
                <tr>
                  <th className="text-left px-2 py-1.5">Codice</th>
                  <th className="text-left px-2 py-1.5">Dimensioni</th>
                  <th className="text-left px-2 py-1.5">Posizione</th>
                  <th className="text-left px-2 py-1.5">Stato</th>
                  <th className="px-2 py-1.5 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {myScraps.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="px-2 py-1.5 font-mono text-[11px] font-bold">{p.code}</td>
                    <td className="px-2 py-1.5 font-mono">{fmtMm(p.w_mm, p.h_mm)}</td>
                    <td className="px-2 py-1.5">{p.posizione ?? "—"}</td>
                    <td className="px-2 py-1.5">
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${
                          p.status === "libero" ? "border-emerald-600 text-emerald-700" :
                          p.status === "riservato" ? "border-amber-600 text-amber-700" :
                          "border-ink/30 text-ink/50"
                        }`}
                      >
                        {SCRAP_STATUS_LABEL[p.status]}
                      </Badge>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <button onClick={() => remove(p)} className="text-ink/40 hover:text-destructive">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};