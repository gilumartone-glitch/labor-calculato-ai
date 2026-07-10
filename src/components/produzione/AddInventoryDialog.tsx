import { useMemo, useState } from "react";
import { Loader2, PackagePlus, Search, Scissors, Ruler } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProdStore } from "@/lib/produzione/store";
import { Catalog, CatalogMaterial } from "@/components/calculator/types";
import { InvDept } from "@/lib/produzione/types";
import { logAction } from "@/lib/produzione/helpers";
import { nextScrapCode } from "@/lib/produzione/scrap";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  dept: InvDept;
  catalog: Catalog | null;
};

const matKey = (m: CatalogMaterial) =>
  [m.name, m.color, m.height, m.thickness ?? "", m.fireproof ?? "", m.finish ?? ""]
    .map((x) => String(x ?? "").trim().toLowerCase()).join("|");

const dimLabel = (m: CatalogMaterial): string | null => {
  const u = m.heightUnit ?? m.dimUnit ?? "";
  if (m.format === "lastra") {
    if (m.baseWidth && m.height) return `${m.baseWidth}×${m.height}${u}`;
    if (m.height) return `${m.height}${u}`;
    return null;
  }
  return m.height ? `${m.height}${u}` : null;
};
const matLabel = (m: CatalogMaterial) => {
  const bits = [m.color, dimLabel(m), m.thickness && `sp.${m.thickness}`, m.finish, m.fireproof].filter(Boolean);
  return bits.length ? `${m.name} · ${bits.join(" · ")}` : m.name;
};

export const AddInventoryDialog = ({ open, onOpenChange, dept, catalog }: Props) => {
  const { user } = useAuth();
  const { inventory, refreshInventory } = useProdStore();
  const [q, setQ] = useState("");
  const [selKey, setSelKey] = useState<string | null>(null);
  const [customSize, setCustomSize] = useState(false);
  // true = crea nuova variante di listino nel magazzino, false = pezzo di sfrido
  const [asVariant, setAsVariant] = useState(false);
  const [qty, setQty] = useState("1");
  const [wMm, setWMm] = useState("");
  const [hMm, setHMm] = useState("");
  const [posizione, setPosizione] = useState("");
  const [saving, setSaving] = useState(false);

  const materials = catalog?.materials ?? [];
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = materials.map((m) => ({ m, key: matKey(m), label: matLabel(m) }));
    if (!t) return list.slice(0, 60);
    return list.filter((r) => r.label.toLowerCase().includes(t)).slice(0, 60);
  }, [materials, q]);

  const selected = useMemo(() => filtered.find((r) => r.key === selKey) ?? materials.map((m) => ({ m, key: matKey(m), label: matLabel(m) })).find((r) => r.key === selKey) ?? null, [filtered, materials, selKey]);

  const reset = () => {
    setQ(""); setSelKey(null); setCustomSize(false); setAsVariant(false);
    setQty("1"); setWMm(""); setHMm(""); setPosizione("");
  };

  const codeFor = (prefix: string) => {
    const existing = inventory.filter((i) => i.code.startsWith(prefix)).map((i) => parseInt(i.code.replace(/\D/g, ""), 10) || 0);
    return `${prefix}${String(Math.max(0, ...existing) + 1).padStart(4, "0")}`;
  };
  const deptPrefix = dept === "tappezzeria" ? "TAP-" : dept === "stampa" ? "LAB-" : dept === "falegnameria" ? "FAL-" : "GEN-";

  const ensureBaseInventory = async (m: CatalogMaterial, key: string) => {
    const um = (m.format ?? "") === "lastra" ? "ls" : (m.unit || "pz");
    const existing = inventory.find((i) => i.reparto === dept && i.material_key === key);
    if (existing) return existing;
    const code = codeFor(deptPrefix);
    const { data, error } = await supabase.from("inventory_items").insert({
      code, kind: "nuovo", nome: m.name, descrizione: matLabel(m),
      qty_intera: 0, qty_sfrido: 0, um,
      posizione: null, soglia_minima: 5, note: null, reparto: dept,
      material_key: key, material_name: m.name,
      material_color: m.color || null, material_height: m.height || null,
      material_attrs: {
        thickness: m.thickness ?? "", finish: m.finish ?? "", fireproof: m.fireproof ?? "",
        composition: m.composition ?? "", weight: m.weight ?? "", format: m.format ?? "",
        baseWidth: m.baseWidth ?? "", dimUnit: m.dimUnit ?? m.heightUnit ?? "", heightUnit: m.heightUnit ?? "",
      },
    }).select().single();
    if (error) throw error;
    return data as any;
  };

  const submit = async () => {
    if (!selected) { toast.error("Seleziona un materiale dal listino"); return; }
    const { m, key, label } = selected;
    setSaving(true);
    try {
      // === CASO 1: lastra intera ===
      if (!customSize) {
        const n = parseFloat(qty.replace(",", "."));
        if (!n || n <= 0) { toast.error("Quantità non valida"); return; }
        const inv = await ensureBaseInventory(m, key);
        const newQty = Number(inv.qty_intera) + n;
        const upd: any = { qty_intera: newQty };
        if (posizione) upd.posizione = posizione;
        const { error } = await supabase.from("inventory_items").update(upd).eq("id", inv.id);
        if (error) throw error;
        await logAction({
          action: "MAGAZZINO_CARICO", entity_type: "inventory", entity_id: inv.id,
          detail: `${inv.code} · +${n} ${inv.um} · ${label}`,
          prev_state: { qty_intera: inv.qty_intera }, new_state: { qty_intera: newQty },
        });
        toast.success(`+${n} → totale ${newQty} ${inv.um}`);
      }
      // === CASO 2a: misura custom come SFRIDO del materiale base ===
      else if (!asVariant) {
        const ww = parseFloat(wMm.replace(",", "."));
        const hh = parseFloat(hMm.replace(",", "."));
        const n = Math.max(1, parseInt(qty || "1", 10));
        if (!ww || !hh || ww <= 0 || hh <= 0) { toast.error("Dimensioni in mm non valide"); return; }
        const inv = await ensureBaseInventory(m, key);
        const thickRaw = (inv.material_attrs as any)?.thickness;
        const thick = thickRaw ? parseFloat(String(thickRaw).replace(",", ".")) || null : null;
        // scraps correnti per numerare il codice
        const { data: existingScraps } = await supabase.from("inventory_scrap_pieces")
          .select("code").eq("inventory_id", inv.id);
        const scrapArr: any[] = existingScraps ?? [];
        const rows: any[] = [];
        for (let i = 0; i < n; i++) {
          const code = nextScrapCode(inv.code, [...scrapArr, ...rows] as any);
          rows.push({
            inventory_id: inv.id, code, w_mm: ww, h_mm: hh, thickness_mm: thick,
            posizione: posizione || null, note: null, status: "libero", created_by: user?.id ?? null,
          });
        }
        const { error } = await supabase.from("inventory_scrap_pieces").insert(rows);
        if (error) throw error;
        await logAction({
          action: "SFRIDO_AGGIUNTO", entity_type: "scrap_piece", entity_id: inv.code,
          detail: `${n}× ${ww}×${hh}mm · ${inv.code} · ${label}`,
        });
        toast.success(`${n} pezzo/i sfrido aggiunti`);
      }
      // === CASO 2b: misura custom come NUOVA VARIANTE ===
      else {
        const ww = parseFloat(wMm.replace(",", "."));
        const hh = parseFloat(hMm.replace(",", "."));
        const n = parseFloat(qty.replace(",", "."));
        if (!ww || !hh || ww <= 0 || hh <= 0) { toast.error("Dimensioni in mm non valide"); return; }
        if (!n || n <= 0) { toast.error("Quantità non valida"); return; }
        const customKey = `${key}|custom-${Math.round(ww)}x${Math.round(hh)}`;
        const already = inventory.find((i) => i.reparto === dept && i.material_key === customKey);
        if (already) {
          const newQty = Number(already.qty_intera) + n;
          const upd: any = { qty_intera: newQty };
          if (posizione) upd.posizione = posizione;
          const { error } = await supabase.from("inventory_items").update(upd).eq("id", already.id);
          if (error) throw error;
          toast.success(`+${n} → totale ${newQty} ${already.um}`);
        } else {
          const code = codeFor(deptPrefix);
          const um = (m.format ?? "") === "lastra" ? "ls" : (m.unit || "pz");
          const desc = `${label} · MISURA CUSTOM ${ww}×${hh}mm`;
          const { error } = await supabase.from("inventory_items").insert({
            code, kind: "nuovo", nome: m.name, descrizione: desc,
            qty_intera: n, qty_sfrido: 0, um,
            posizione: posizione || null, soglia_minima: 0, note: "Variante a misura personalizzata",
            reparto: dept, material_key: customKey, material_name: m.name,
            material_color: m.color || null, material_height: String(hh),
            material_attrs: {
              thickness: m.thickness ?? "", finish: m.finish ?? "", fireproof: m.fireproof ?? "",
              composition: m.composition ?? "", weight: m.weight ?? "", format: m.format ?? "lastra",
              baseWidth: String(ww), dimUnit: "mm", heightUnit: "mm",
              customSize: true, customW_mm: ww, customH_mm: hh,
            },
          });
          if (error) throw error;
          await logAction({
            action: "MAGAZZINO_CREATO", entity_type: "inventory", entity_id: code,
            detail: `${code} · ${desc} · qty ${n}`,
          });
          toast.success(`Nuova variante creata: ${code}`);
        }
      }
      await refreshInventory();
      reset();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Errore");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <PackagePlus className="w-5 h-5" /> Aggiungi a magazzino
          </DialogTitle>
          <DialogDescription>
            Scegli un materiale dal listino, poi inserisci quante lastre intere aggiungere oppure attiva la misura personalizzata.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-sm font-semibold">1. Materiale dal listino</Label>
            <div className="relative mt-1">
              <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-ink/40" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca (es. Forex bianco 3mm)…" className="pl-8" />
            </div>
            <div className="mt-2 max-h-56 overflow-y-auto border rounded-sm bg-background">
              {filtered.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">Nessun materiale trovato</div>
              ) : (
                filtered.map((r) => (
                  <button key={r.key} type="button" onClick={() => setSelKey(r.key)}
                    className={`w-full text-left px-3 py-2 text-sm border-b last:border-b-0 hover:bg-muted/50 ${selKey === r.key ? "bg-primary/15 font-semibold" : ""}`}>
                    {r.label}
                  </button>
                ))
              )}
            </div>
            {selected && (
              <div className="mt-2 text-xs text-primary font-mono">✓ {selected.label}</div>
            )}
          </div>

          <div className="border rounded-sm p-3 bg-muted/20 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={customSize} onChange={(e) => setCustomSize(e.target.checked)} className="w-5 h-5 accent-primary" />
              <Ruler className="w-4 h-4" />
              <span className="text-sm font-semibold">Misura personalizzata</span>
              <span className="text-xs text-muted-foreground">(default: lastra intera)</span>
            </label>

            {customSize && (
              <label className="flex items-center gap-2 cursor-pointer pl-7">
                <input type="checkbox" checked={asVariant} onChange={(e) => setAsVariant(e.target.checked)} className="w-4 h-4 accent-primary" />
                {asVariant
                  ? <PackagePlus className="w-4 h-4 text-primary" />
                  : <Scissors className="w-4 h-4 text-amber-700" />}
                <span className="text-sm">
                  {asVariant
                    ? "Crea come NUOVA VARIANTE di magazzino"
                    : "Aggiungi come PEZZO DI SFRIDO del materiale base"}
                </span>
              </label>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {customSize && (
              <>
                <div>
                  <Label className="text-sm">Larghezza (mm)</Label>
                  <Input type="number" value={wMm} onChange={(e) => setWMm(e.target.value)} placeholder="es. 1200" />
                </div>
                <div>
                  <Label className="text-sm">Altezza (mm)</Label>
                  <Input type="number" value={hMm} onChange={(e) => setHMm(e.target.value)} placeholder="es. 800" />
                </div>
              </>
            )}
            <div>
              <Label className="text-sm">Quantità</Label>
              <Input type="number" min="1" step="1" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div>
              <Label className="text-sm">Posizione (opz.)</Label>
              <Input value={posizione} onChange={(e) => setPosizione(e.target.value)} placeholder="es. A3" />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Annulla</Button>
          <Button onClick={submit} disabled={saving || !selected}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <PackagePlus className="w-4 h-4 mr-2" />}
            Aggiungi
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
