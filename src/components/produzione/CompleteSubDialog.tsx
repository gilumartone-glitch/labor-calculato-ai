import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Loader2, CheckCircle2, Layers, Scissors, Package2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProdStore } from "@/lib/produzione/store";
import { ProdSubOrder, ProdOrder, InvItem, ScrapPiece, DEPT_LABEL, ProdDept } from "@/lib/produzione/types";
import { fmtMm, nextScrapCode } from "@/lib/produzione/scrap";
import { logAction, notify } from "@/lib/produzione/helpers";
import { collectSnapshotDepartments, collectSnapshotPieces, type ProdSnapshot } from "@/lib/produzione/snapshot";
import { NestingPreview } from "@/components/calculator/NestingPreview";
import { mergeCatalogs } from "@/lib/nesting";

/** Estrae i codici magazzino citati nelle note (es. "(TAP-0001)"). */
const parseInvCodes = (note: string | null): string[] => {
  if (!note) return [];
  const out: string[] = [];
  const re = /\(([A-Z]{2,4}-\d{3,5})\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(note))) out.push(m[1]);
  return Array.from(new Set(out));
};

/** True se nelle note compare "Usa: lastra intera". */
const usesWholeSheet = (note: string | null) => !!note && /usa:\s*lastra\s+intera/i.test(note);

type Residuo = {
  inventoryId: string;
  invCode: string;
  matLabel: string;
  w: string;
  h: string;
  thickness: string;
  posizione: string;
  note: string;
};

type ScrapInsertRow = {
  inventory_id: string;
  code: string;
  w_mm: number;
  h_mm: number;
  thickness_mm: number | null;
  posizione: string | null;
  note: string;
  status: "libero";
  created_by: string;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sub: ProdSubOrder | null;
  order?: ProdOrder | null;
  /** chiamato dopo che il consumo è stato registrato; il chiamante deve fare l'update di `status: completato` */
  onConfirmed: () => Promise<void> | void;
};

export const CompleteSubDialog = ({ open, onOpenChange, sub, order, onConfirmed }: Props) => {
  const { user } = useAuth();
  const { inventory, scraps, refreshInventory, subs, profiles } = useProdStore();

  // Lavorazione successiva (chi dipende da me)
  const nextSub = useMemo(
    () => (sub ? subs.find((s) => s.depends_on === sub.id) ?? null : null),
    [sub, subs],
  );
  const nextDeptOps = useMemo(() => {
    if (!nextSub) return [] as typeof profiles;
    return profiles.filter((p) => Array.isArray(p.settori) && (p.settori as any).includes(nextSub.dept));
  }, [nextSub, profiles]);
  const [nextAssignee, setNextAssignee] = useState<string>("");
  useEffect(() => {
    if (open && nextSub) setNextAssignee(nextSub.assignee_id ?? "");
  }, [open, nextSub]);

  // Pezzi sfrido riservati per questo sub
  const reservedPieces: ScrapPiece[] = useMemo(
    () => (sub ? scraps.filter((p) => p.reserved_for_sub === sub.id) : []),
    [scraps, sub],
  );

  const pickedStock = useMemo(() => {
    if (!sub || !order?.snapshot) return [];
    const depts = collectSnapshotDepartments(order.snapshot as ProdSnapshot);
    return collectSnapshotPieces(depts)
      // Questo dialog si apre solo per l'ULTIMO sub dell'ordine: l'operatore
      // che chiude la lavorazione è responsabile della movimentazione di tutti
      // i materiali del progetto (lastre intere consumate + sfridi residui),
      // quindi consideriamo i pickedStock di TUTTI i reparti.
      .filter(({ piece }) => !!piece.pickedStockId)
      .flatMap(({ piece }) => String(piece.pickedStockId).split(",").map((tok) => {
        const t = tok.trim();
        // Token "kind:id" (mixed) oppure solo id (kind ereditato dal piece)
        const m = t.match(/^(item|scrap):(.+)$/);
        if (m) return { kind: m[1] as "item" | "scrap", id: m[2].trim(), label: piece.pickedStockLabel ?? "" };
        const k = piece.pickedStockKind;
        const inheritedKind: "item" | "scrap" | null = k === "item" || k === "scrap" ? k : null;
        return { kind: inheritedKind, id: t, label: piece.pickedStockLabel ?? "" };
      }))
      .filter((p, idx, arr) => p.id && arr.findIndex((x) => x.kind === p.kind && x.id === p.id) === idx);
  }, [sub, order]);

  const pickedScrapPieces = useMemo(
    () => pickedStock
      .filter((p) => p.kind === "scrap")
      .map((p) => scraps.find((s) => s.id === p.id))
      .filter(Boolean) as ScrapPiece[],
    [pickedStock, scraps],
  );

  /** Pezzi del reparto + catalog (per il nesting di riepilogo). */
  const mergedNesting = useMemo(() => {
    if (!sub || !order?.snapshot) return null as null | { catalog: any; pieces: any[] };
    const depts = collectSnapshotDepartments(order.snapshot as ProdSnapshot);
    const allItems = collectSnapshotPieces(depts);
    // Mostra il nesting di TUTTI i reparti: chi chiude vede l'intero progetto.
    const items = allItems.filter((it) => it.catalog);
    if (items.length === 0) return null;
    const seen = new Set<string>();
    const pieces: any[] = [];
    for (const it of items) {
      const key = it.piece.id ?? `${it.piece.productName}|${it.piece.width}|${it.piece.height}|${pieces.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pieces.push(it.piece);
    }
    const catalogs = Array.from(new Set(items.map((it) => it.catalog)));
    const catalog = mergeCatalogs(catalogs as any[]);
    return { catalog, pieces };
  }, [sub, order]);

  // Materiali (inv) coinvolti: dai pezzi riservati + da quelli citati nelle note
  const involvedInv: InvItem[] = useMemo(() => {
    if (!sub) return [];
    const ids = new Set<string>();
    for (const p of reservedPieces) ids.add(p.inventory_id);
    for (const p of pickedStock) {
      if (p.kind === "item") ids.add(p.id);
      if (p.kind === "scrap") {
        const s = pickedScrapPieces.find((x) => x.id === p.id);
        if (s) ids.add(s.inventory_id);
      }
    }
    const codes = parseInvCodes(sub.note);
    for (const c of codes) {
      const i = inventory.find((x) => x.code === c);
      if (i) ids.add(i.id);
    }
    return Array.from(ids).map((id) => inventory.find((i) => i.id === id)!).filter(Boolean);
  }, [sub, reservedPieces, pickedStock, pickedScrapPieces, inventory]);

  const wholeSheet = useMemo(() => (sub ? usesWholeSheet(sub.note) : false), [sub]);

  // residui da inserire
  const [residui, setResidui] = useState<Residuo[]>([]);
  // checkbox: scala 1 lastra intera dalla giacenza?
  const [decrementWhole, setDecrementWhole] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  // reset quando cambia il sub
  useEffect(() => {
    if (!open) return;
    setResidui([]);
    const init: Record<string, boolean> = {};
    const pickedWholeIds = new Set(pickedStock.filter((p) => p.kind === "item").map((p) => p.id));
    for (const i of involvedInv) if (wholeSheet || pickedWholeIds.has(i.id)) init[i.id] = true;
    setDecrementWhole(init);
  }, [open, sub?.id, wholeSheet, involvedInv, pickedStock]);

  const addResiduo = (inv: InvItem) => {
    setResidui((p) => [...p, {
      inventoryId: inv.id,
      invCode: inv.code,
      matLabel: [inv.material_name ?? inv.nome, inv.material_color, inv.material_height, inv.material_attrs?.thickness && `sp.${inv.material_attrs.thickness}`].filter(Boolean).join(" · "),
      w: "", h: "", thickness: inv.material_attrs?.thickness ?? "", posizione: "", note: "",
    }]);
  };

  const updateResiduo = (idx: number, patch: Partial<Residuo>) => {
    setResidui((p) => p.map((r, i) => i === idx ? { ...r, ...patch } : r));
  };

  const removeResiduo = (idx: number) => setResidui((p) => p.filter((_, i) => i !== idx));

  const confirm = async () => {
    if (!sub || !user) return;
    // valida residui (input in cm)
    for (const r of residui) {
      const w = parseFloat(r.w.replace(",", "."));
      const h = parseFloat(r.h.replace(",", "."));
      if (!w || !h || w <= 0 || h <= 0) {
        toast.error("Tutti i residui devono avere base × altezza validi (cm)");
        return;
      }
    }
    setSaving(true);
    try {
      const scrapsToConsume = Array.from(new Map([...reservedPieces, ...pickedScrapPieces].map((p) => [p.id, p])).values());

      // 1) consuma pezzi sfrido riservati o agganciati dal preventivo
      if (scrapsToConsume.length > 0) {
        const { error } = await supabase
          .from("inventory_scrap_pieces")
          .update({ status: "usato" })
          .in("id", scrapsToConsume.map((p) => p.id));
        if (error) throw error;
        await logAction({
          action: "SFRIDO_CONSUMATO",
          entity_type: "sub_order",
          entity_id: sub.id,
          detail: `${sub.code} · consumati ${scrapsToConsume.map((p) => p.code).join(", ")}`,
          new_state: { pieces: scrapsToConsume.map((p) => p.code) },
        });
      }

      // 2) decrementa lastre intere segnate
      for (const inv of involvedInv) {
        if (!decrementWhole[inv.id]) continue;
        const pickedQty = pickedStock.filter((p) => p.kind === "item" && p.id === inv.id).length;
        const newQty = Math.max(0, Number(inv.qty_intera) - Math.max(1, pickedQty));
        const { error } = await supabase.from("inventory_items").update({ qty_intera: newQty }).eq("id", inv.id);
        if (error) throw error;
        await logAction({
          action: "MAGAZZINO_SCARICO",
          entity_type: "inventory", entity_id: inv.id,
          detail: `${inv.code} · -${Math.max(1, pickedQty)} lastra/e intera/e (sub ${sub.code})`,
          prev_state: { qty_intera: inv.qty_intera }, new_state: { qty_intera: newQty },
        });
      }

      // 3) inserisci residui come nuovi pezzi sfrido (status libero)
      if (residui.length > 0) {
        // raggruppo per inventory_id per generare codici progressivi non duplicati
        const byInv: Record<string, Residuo[]> = {};
        for (const r of residui) (byInv[r.inventoryId] ??= []).push(r);
        const rows: ScrapInsertRow[] = [];
        for (const [invId, list] of Object.entries(byInv)) {
          const inv = involvedInv.find((i) => i.id === invId)!;
          // partenza da quelli già presenti per quel materiale
          const existing = scraps.filter((p) => p.inventory_id === invId);
          const generated: ScrapPiece[] = [...existing];
          for (const r of list) {
            const code = nextScrapCode(inv.code, generated);
            const fakePiece = { id: `tmp-${code}`, inventory_id: invId, code } as ScrapPiece;
            generated.push(fakePiece);
            // input in cm → salviamo in mm (×10) coerentemente con lo schema esistente.
            const wCm = parseFloat(r.w.replace(",", "."));
            const hCm = parseFloat(r.h.replace(",", "."));
            rows.push({
              inventory_id: invId,
              code,
              w_mm: Math.round(wCm * 10),
              h_mm: Math.round(hCm * 10),
              thickness_mm: r.thickness ? parseFloat(r.thickness.replace(",", ".")) : null,
              posizione: r.posizione || null,
              note: r.note ? `${r.note} (residuo da ${sub.code})` : `Residuo da ${sub.code}`,
              status: "libero",
              created_by: user.id,
            });
          }
        }
        const { error } = await supabase.from("inventory_scrap_pieces").insert(rows);
        if (error) throw error;
        await logAction({
          action: "SFRIDO_RESIDUO_INSERITO",
          entity_type: "sub_order", entity_id: sub.id,
          detail: `${sub.code} · ${rows.length} pezzo/i residuo/i`,
          new_state: { pieces: rows.map((r) => `${r.code} ${r.w_mm}×${r.h_mm}`) },
        });
      }

      await refreshInventory();
      await onConfirmed();
      toast.success(`Sub ${sub.code} completato`);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    } finally {
      setSaving(false);
    }
  };

  if (!sub) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" /> Conferma lavorazione · <span className="font-mono text-sm text-primary">{sub.code}</span>
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            Conferma che hai effettivamente usato i materiali indicati e registra gli sfridi rimasti dalla lavorazione.
          </DialogDescription>
        </DialogHeader>

        {/* Promemoria istruzioni del sub-ordine */}
        {sub.note && (
          <div className="border-2 border-ink/15 rounded-sm p-3 bg-muted/20 text-[12px] whitespace-pre-wrap font-mono text-ink/80">
            {sub.note}
          </div>
        )}

        {/* Nesting consigliato per questo reparto */}
        {mergedNesting && (
          <NestingPreview
            pieces={mergedNesting.pieces}
            catalog={mergedNesting.catalog}
            title="Nesting globale · lastre & sfridi consigliati"
          />
        )}

        {/* Materiali coinvolti */}
        {involvedInv.length === 0 && reservedPieces.length === 0 && pickedStock.length === 0 ? (
          <div className="border-2 border-dashed border-ink/15 rounded-sm p-4 text-center text-[12px] text-muted-foreground">
            Nessun materiale di magazzino collegato a questo sub-ordine.<br />
            Puoi comunque aggiungere manualmente sfridi residui qui sotto.
          </div>
        ) : (
          <div className="space-y-2">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Materiali utilizzati</div>
            {involvedInv.map((inv) => {
              const pieces = Array.from(new Map([...reservedPieces, ...pickedScrapPieces].filter((p) => p.inventory_id === inv.id).map((p) => [p.id, p])).values());
              const pickedQty = pickedStock.filter((p) => p.kind === "item" && p.id === inv.id).length;
              return (
                <div key={inv.id} className="border-2 border-ink/15 rounded-sm p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-[13px]">{inv.material_name ?? inv.nome}</div>
                      <div className="text-[10px] text-muted-foreground">
                        <span className="font-mono font-bold text-ink">{inv.code}</span> · {[inv.material_color, inv.material_height].filter(Boolean).join(" · ")} · Intere in stock: {inv.qty_intera}
                      </div>
                    </div>
                  </div>

                  {/* lastra intera */}
                  <label className="flex items-center gap-2 text-[12px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!decrementWhole[inv.id]}
                      onChange={(e) => setDecrementWhole((p) => ({ ...p, [inv.id]: e.target.checked }))}
                    />
                    <Layers className="w-3.5 h-3.5" /> Ho usato <strong>{Math.max(1, pickedQty)} lastra/e intera/e</strong> (scala dalla giacenza)
                  </label>

                  {/* sfridi consumati */}
                  {pieces.length > 0 && (
                    <div className="border-l-2 border-amber-500 pl-3 space-y-1">
                      <div className="text-[10px] uppercase tracking-wider font-bold text-amber-700 flex items-center gap-1">
                        <Scissors className="w-3 h-3" /> Sfridi che verranno marcati come USATI
                      </div>
                      {pieces.map((p) => (
                        <div key={p.id} className="text-[12px] font-mono flex items-center gap-2">
                          <Badge variant="secondary" className="font-mono text-[10px]">{p.code}</Badge>
                          {fmtMm(p.w_mm, p.h_mm)}
                          {p.posizione && <span className="text-ink/50">· pos {p.posizione}</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  <Button size="sm" variant="outline" onClick={() => addResiduo(inv)} className="gap-1 h-7">
                    <Plus className="w-3 h-3" /> Aggiungi sfrido residuo per questo materiale
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {/* Residui da inserire */}
        {residui.length > 0 && (
          <div className="border-2 border-ink/15 rounded-sm overflow-hidden">
            <div className="px-3 py-2 bg-amber-50 border-b font-mono text-[10px] uppercase tracking-widest text-amber-800 flex items-center gap-2">
              <Package2 className="w-3.5 h-3.5" /> Sfridi residui da registrare ({residui.length})
            </div>
            <div className="divide-y">
              {residui.map((r, idx) => (
                <div key={idx} className="p-3 grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-12 text-[10px] font-mono text-ink/60">
                    Materiale: <strong className="text-ink">{r.invCode}</strong> — {r.matLabel}
                  </div>
                  <div className="col-span-2">
                    <Label className="text-[10px]">Base (cm) *</Label>
                    <Input value={r.w} onChange={(e) => updateResiduo(idx, { w: e.target.value })} placeholder="80" />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-[10px]">Altezza (cm) *</Label>
                    <Input value={r.h} onChange={(e) => updateResiduo(idx, { h: e.target.value })} placeholder="40" />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-[10px]">Sp. (mm)</Label>
                    <Input value={r.thickness} onChange={(e) => updateResiduo(idx, { thickness: e.target.value })} placeholder="3" />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-[10px]">Posizione</Label>
                    <Input value={r.posizione} onChange={(e) => updateResiduo(idx, { posizione: e.target.value })} placeholder="A3" />
                  </div>
                  <div className="col-span-3">
                    <Label className="text-[10px]">Note</Label>
                    <Input value={r.note} onChange={(e) => updateResiduo(idx, { note: e.target.value })} placeholder="opzionale" />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button onClick={() => removeResiduo(idx)} className="text-ink/40 hover:text-destructive p-1">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-between items-center pt-2">
          <div className="text-[11px] text-muted-foreground">
            {pickedScrapPieces.length > 0 && <>{pickedScrapPieces.length} sfrido/i agganciati verranno marcati USATI · </>}
            {reservedPieces.length > 0 && <>{reservedPieces.length} sfrido/i riservati verranno marcati USATI · </>}
            {residui.length} residuo/i da creare
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Annulla</Button>
            <Button onClick={confirm} disabled={saving} className="gap-1">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
              Conferma e completa
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};