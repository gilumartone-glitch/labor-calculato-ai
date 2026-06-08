import { useEffect, useMemo, useState } from "react";
import { Wand2, Loader2, Sparkles, Check, ArrowLeftRight, Layers, Scissors, Send } from "lucide-react";
import { toast } from "sonner";
import { ProdLayout } from "@/components/produzione/ProdLayout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useProdStore } from "@/lib/produzione/store";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Catalog, CatalogMaterial, DepartmentKey } from "@/components/calculator/types";
import { loadCatalogCloud } from "@/lib/catalog";
import { InvDept, INV_DEPT_LABEL, ProdDept, SUB_DEPT_SUFFIX } from "@/lib/produzione/types";
import { sheetSizeFromCatalog, suggestSourcesForRow, fmtMm, reservePiece, Suggestion } from "@/lib/produzione/scrap";
import { nextOrderCode, subCode, logAction, notify, getProduzioneWriters } from "@/lib/produzione/helpers";

const DEPTS: Exclude<InvDept, "generale">[] = ["tappezzeria", "stampa", "falegnameria"];
const DEPT_TO_PROD: Record<Exclude<InvDept, "generale">, ProdDept> = {
  tappezzeria: "tappezzeria",
  stampa: "stampa",
  falegnameria: "taglio",
};

const matKey = (m: CatalogMaterial) =>
  [m.name, m.color, m.height, m.thickness ?? "", m.fireproof ?? "", m.finish ?? ""]
    .map((x) => String(x ?? "").trim().toLowerCase())
    .join("|");

const matLabel = (m: CatalogMaterial) => {
  const bits = [m.color, m.height && `${m.height}${m.heightUnit ?? ""}`, m.thickness && `sp.${m.thickness}`, m.finish, m.fireproof].filter(Boolean);
  return bits.length ? `${m.name} · ${bits.join(" · ")}` : m.name;
};

const ProdFindMaterial = () => {
  const { user } = useAuth();
  const { inventory, scraps, refreshInventory } = useProdStore();
  const [tab, setTab] = useState<Exclude<InvDept, "generale">>("falegnameria");
  const [catalogs, setCatalogs] = useState<Record<DepartmentKey, Catalog | null>>({ tappezzeria: null, stampa: null, falegnameria: null });
  const [loading, setLoading] = useState(true);

  const [matId, setMatId] = useState<string>("");
  const [w, setW] = useState("");
  const [h, setH] = useState("");
  const [qty, setQty] = useState("1");
  const [allowRotate, setAllowRotate] = useState(true);

  const [picked, setPicked] = useState<Suggestion | null>(null);
  const [launching, setLaunching] = useState(false);
  const [cliente, setCliente] = useState("");
  const [note, setNote] = useState("");
  const [openLaunch, setOpenLaunch] = useState(false);

  useEffect(() => {
    (async () => {
      const [t, s, f] = await Promise.all([
        loadCatalogCloud("tappezzeria"),
        loadCatalogCloud("stampa"),
        loadCatalogCloud("falegnameria"),
      ]);
      setCatalogs({ tappezzeria: t, stampa: s, falegnameria: f });
      setLoading(false);
    })();
  }, []);

  const cat = catalogs[tab as DepartmentKey];
  const materials = cat?.materials ?? [];

  const selectedMat = useMemo(() => materials.find((m) => m.id === matId) ?? null, [materials, matId]);

  const inv = useMemo(() => {
    if (!selectedMat) return null;
    const k = matKey(selectedMat);
    return inventory.find((i) => i.reparto === tab && i.material_key === k) ?? null;
  }, [selectedMat, inventory, tab]);

  const sheet = useMemo(() => sheetSizeFromCatalog(selectedMat), [selectedMat]);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!inv || !selectedMat) return [];
    const ww = parseFloat(w.replace(",", "."));
    const hh = parseFloat(h.replace(",", "."));
    if (!ww || !hh) return [];
    const myScraps = scraps.filter((p) => p.inventory_id === inv.id);
    return suggestSourcesForRow(inv, myScraps, sheet, { w_mm: ww, h_mm: hh, allowRotate });
  }, [inv, selectedMat, scraps, sheet, w, h, allowRotate]);

  // Ordina materiali alfabeticamente
  const sortedMats = useMemo(() => [...materials].sort((a, b) => matLabel(a).localeCompare(matLabel(b), "it")), [materials]);

  const launch = async () => {
    if (!user || !selectedMat || !inv || !picked) return;
    if (!cliente.trim()) { toast.error("Cliente obbligatorio"); return; }
    setLaunching(true);
    try {
      const code = await nextOrderCode();
      const ww = parseFloat(w.replace(",", "."));
      const hh = parseFloat(h.replace(",", "."));
      const qtyN = Math.max(1, parseInt(qty || "1", 10));
      const sourceLabel = picked.kind === "intera"
        ? `lastra intera ${fmtMm(picked.source_w, picked.source_h)}`
        : `sfrido ${picked.piece!.code} (${fmtMm(picked.piece!.w_mm, picked.piece!.h_mm)})${picked.piece!.posizione ? ` · pos ${picked.piece!.posizione}` : ""}`;
      const subNote = [
        `Materiale: ${matLabel(selectedMat)} (${inv.code})`,
        `Pezzo richiesto: ${fmtMm(ww, hh)} × ${qtyN}${picked.rotated ? " (RUOTATO 90°)" : ""}`,
        `Usa: ${sourceLabel}`,
        note ? `Note: ${note}` : null,
      ].filter(Boolean).join("\n");

      const { data: order, error } = await supabase.from("production_orders").insert({
        code,
        cliente,
        data: new Date().toISOString().slice(0, 10),
        note: `Lavorazione automatica · ${matLabel(selectedMat)}`,
        priorita: "normale",
        delivery: "ritiro",
        status: "in_corso",
        attachments: [],
        nesting_included: false,
        created_by: user.id,
      }).select().single();
      if (error) throw error;

      const prodDept = DEPT_TO_PROD[tab];
      const { data: sub, error: e2 } = await supabase.from("production_sub_orders").insert({
        order_id: order.id,
        code: subCode(code, SUB_DEPT_SUFFIX[prodDept], 1),
        dept: prodDept,
        ordine: 0,
        note: subNote,
        files: [],
      }).select().single();
      if (e2) throw e2;

      // riserva sfrido se applicabile
      if (picked.kind === "sfrido" && picked.piece) {
        await reservePiece(picked.piece.id, order.id, sub.id);
      }

      await logAction({
        action: "LAVORAZIONE_PIANIFICATA",
        entity_type: "order",
        entity_id: order.id,
        detail: `${code} · ${matLabel(selectedMat)} · ${fmtMm(ww, hh)} × ${qtyN} · usa ${picked.kind === "sfrido" ? picked.piece!.code : "lastra intera"}`,
        new_state: { material: inv.code, piece: picked.piece?.code ?? null, w: ww, h: hh, qty: qtyN, rotated: picked.rotated },
      });

      const writers = await getProduzioneWriters();
      const targets = writers.filter((u) => u !== user.id);
      if (targets.length > 0) {
        await notify({
          userIds: targets,
          type: "subordine_assegnato",
          message: `${code} · ${INV_DEPT_LABEL[tab]} · usa ${picked.kind === "sfrido" ? picked.piece!.code : "lastra intera"} (${fmtMm(picked.source_w, picked.source_h)})`,
          order_id: order.id,
          link: `/produzione/board?sub=${sub.id}`,
          is_urgent: false,
        });
      }

      toast.success(`${code} creato e assegnato a ${INV_DEPT_LABEL[tab]}`);
      await refreshInventory();
      setOpenLaunch(false);
      setPicked(null);
      setCliente(""); setNote("");
    } catch (e: any) {
      toast.error(e.message ?? "Errore");
    } finally {
      setLaunching(false);
    }
  };

  return (
    <ProdLayout>
      <div className="p-6 space-y-4 max-w-6xl mx-auto">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-primary">// Produzione</div>
          <h1 className="font-display text-2xl font-semibold flex items-center gap-2">
            <Wand2 className="w-6 h-6" /> Trova materiale
          </h1>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Inserisci il materiale e le dimensioni del pezzo da ricavare. Il sistema suggerisce lastre intere e pezzi di sfrido compatibili (con rotazione 90° se permessa).
          </p>
        </div>

        {/* Tabs reparto */}
        <div className="flex gap-1 border-b-2 border-ink/15">
          {DEPTS.map((d) => {
            const active = d === tab;
            return (
              <button
                key={d}
                onClick={() => { setTab(d); setMatId(""); setPicked(null); }}
                className={`px-4 py-2 text-[12px] uppercase tracking-wider font-bold border-b-2 -mb-[2px] transition-colors ${
                  active ? "border-primary text-primary" : "border-transparent text-ink/50 hover:text-ink"
                }`}
              >
                {INV_DEPT_LABEL[d]}
              </button>
            );
          })}
        </div>

        {/* Form ricerca */}
        <div className="border-2 border-ink/15 rounded-sm bg-paper p-4 space-y-3">
          {loading ? (
            <div className="grid place-items-center py-6 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : (
            <>
              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-6">
                  <Label className="text-[10px] uppercase tracking-wider">Materiale</Label>
                  <select
                    value={matId}
                    onChange={(e) => { setMatId(e.target.value); setPicked(null); }}
                    className="w-full h-10 px-2 border-2 border-input rounded-md bg-background text-sm"
                  >
                    <option value="">— Seleziona —</option>
                    {sortedMats.map((m) => (
                      <option key={m.id} value={m.id}>{matLabel(m)}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <Label className="text-[10px] uppercase tracking-wider">Larghezza (mm)</Label>
                  <Input value={w} onChange={(e) => { setW(e.target.value); setPicked(null); }} placeholder="600" />
                </div>
                <div className="col-span-2">
                  <Label className="text-[10px] uppercase tracking-wider">Altezza (mm)</Label>
                  <Input value={h} onChange={(e) => { setH(e.target.value); setPicked(null); }} placeholder="400" />
                </div>
                <div className="col-span-2">
                  <Label className="text-[10px] uppercase tracking-wider">Pezzi</Label>
                  <Input value={qty} onChange={(e) => setQty(e.target.value)} type="number" min="1" />
                </div>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={allowRotate} onChange={(e) => setAllowRotate(e.target.checked)} />
                  Permetti rotazione 90°
                </label>
                {selectedMat && (
                  <div className="font-mono text-ink/60">
                    {inv ? <>Codice magazzino: <strong className="text-ink">{inv.code}</strong> · Intere disponibili: <strong className="text-ink">{inv.qty_intera}</strong></> : <span className="text-amber-700">Materiale non ancora tracciato in magazzino</span>}
                    {sheet && <> · Lastra: <strong className="text-ink">{fmtMm(sheet.w, sheet.h)}</strong></>}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Risultati */}
        {selectedMat && w && h && (
          <div className="border-2 border-ink/15 rounded-sm bg-paper">
            <div className="px-4 py-2 bg-muted/40 border-b font-mono text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5" /> Suggerimenti ({suggestions.length})
            </div>
            {suggestions.length === 0 ? (
              <div className="p-6 text-center text-[12px] text-muted-foreground">
                {!inv ? "Aggiungi prima il materiale al magazzino dalla pagina Magazzino." : "Nessuna lastra intera o pezzo di sfrido compatibile."}
              </div>
            ) : (
              <ul className="divide-y">
                {suggestions.map((s, i) => {
                  const eff = s.utilization * 100;
                  return (
                    <li key={i} className="p-3 flex items-center gap-3 hover:bg-muted/20">
                      <div className="w-8 text-center font-mono text-[10px] text-ink/40">#{i + 1}</div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {s.kind === "intera" ? (
                            <Badge className="gap-1"><Layers className="w-3 h-3" /> Lastra intera</Badge>
                          ) : (
                            <Badge variant="secondary" className="gap-1"><Scissors className="w-3 h-3" /> Sfrido <span className="font-mono">{s.piece!.code}</span></Badge>
                          )}
                          <span className="font-mono text-[12px] font-bold">{fmtMm(s.source_w, s.source_h)}</span>
                          {s.rotated && <Badge variant="outline" className="gap-1 text-[10px]"><ArrowLeftRight className="w-3 h-3" /> ruotato</Badge>}
                          {s.piece?.posizione && <span className="text-[10px] text-ink/50">pos. {s.piece.posizione}</span>}
                        </div>
                        <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full ${eff >= 80 ? "bg-emerald-500" : eff >= 50 ? "bg-amber-500" : "bg-destructive"}`} style={{ width: `${Math.min(100, eff)}%` }} />
                        </div>
                        <div className="text-[10px] font-mono text-ink/60 mt-0.5">
                          Utilizzo {eff.toFixed(1)}% · spreco {(s.waste_mm2 / 1_000_000).toFixed(3)} m²
                        </div>
                      </div>
                      <Button size="sm" onClick={() => { setPicked(s); setOpenLaunch(true); }} className="gap-1">
                        <Check className="w-3.5 h-3.5" /> Usa
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Dialog conferma lavorazione */}
      <Dialog open={openLaunch} onOpenChange={setOpenLaunch}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2"><Send className="w-4 h-4" /> Lancia lavorazione</DialogTitle>
          </DialogHeader>
          {picked && selectedMat && (
            <div className="space-y-3">
              <div className="border-2 border-ink/15 rounded-sm p-3 bg-muted/20 text-[12px] space-y-1">
                <div><span className="text-ink/50">Materiale:</span> <strong>{matLabel(selectedMat)}</strong> {inv && <span className="font-mono text-[11px]">({inv.code})</span>}</div>
                <div><span className="text-ink/50">Pezzo:</span> <strong className="font-mono">{fmtMm(parseFloat(w.replace(",",".")), parseFloat(h.replace(",",".")))} × {qty}</strong>{picked.rotated && " (ruotato 90°)"}</div>
                <div><span className="text-ink/50">Origine:</span> {picked.kind === "intera" ? <>Lastra intera <strong className="font-mono">{fmtMm(picked.source_w, picked.source_h)}</strong></> : <>Sfrido <strong className="font-mono">{picked.piece!.code}</strong> ({fmtMm(picked.piece!.w_mm, picked.piece!.h_mm)}{picked.piece!.posizione ? ` · pos ${picked.piece!.posizione}` : ""})</>}</div>
                <div><span className="text-ink/50">Reparto:</span> <strong>{INV_DEPT_LABEL[tab]}</strong></div>
              </div>
              <div>
                <Label>Cliente *</Label>
                <Input value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="es. Mario Rossi" />
              </div>
              <div>
                <Label>Note operatore</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="indicazioni aggiuntive" />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={() => setOpenLaunch(false)}>Annulla</Button>
                <Button onClick={launch} disabled={launching}>
                  {launching ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Send className="w-3 h-3 mr-1" /> Crea ordine</>}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </ProdLayout>
  );
};

export default ProdFindMaterial;