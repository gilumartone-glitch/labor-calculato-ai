import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowLeft, Loader2, Package, Search, AlertTriangle, Scissors, ArrowDownToLine, ArrowUpFromLine, Wand2, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { InvItem, ScrapPiece, SCRAP_STATUS_LABEL } from "@/lib/produzione/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { nextScrapCode } from "@/lib/produzione/scrap";
import { logAction } from "@/lib/produzione/helpers";
import { toast } from "sonner";

type Tab = "stampa" | "tappezzeria";
const TAB_LABEL: Record<Tab, string> = { stampa: "Laboratorio", tappezzeria: "Tappezzeria" };

const MagazzinoView = () => {
  const { user, loading: authLoading } = useAuth();
  const { loading: permLoading, isAdmin, approved, can } = usePermissions();
  const canWrite = isAdmin || can("produzione", "write");
  const [tab, setTab] = useState<Tab>("stampa");
  const [items, setItems] = useState<InvItem[]>([]);
  const [scraps, setScraps] = useState<ScrapPiece[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<InvItem | null>(null);
  const [moveMode, setMoveMode] = useState<null | "carico" | "scarico">(null);
  const [moveQty, setMoveQty] = useState("1");
  const [moveBusy, setMoveBusy] = useState(false);
  const [transformOpen, setTransformOpen] = useState(false);

  const reload = async () => {
    const [{ data: inv }, { data: sc }] = await Promise.all([
      supabase.from("inventory_items").select("*").order("code", { ascending: true }),
      supabase.from("inventory_scrap_pieces").select("*").order("code", { ascending: true }),
    ]);
    setItems((inv ?? []) as any);
    setScraps((sc ?? []) as any);
    if (selected) {
      const fresh = (inv ?? []).find((i: any) => i.id === selected.id);
      if (fresh) setSelected(fresh as any);
    }
  };

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: inv }, { data: sc }] = await Promise.all([
        supabase.from("inventory_items").select("*").order("code", { ascending: true }),
        supabase.from("inventory_scrap_pieces").select("*").order("code", { ascending: true }),
      ]);
      if (cancelled) return;
      setItems((inv ?? []) as any);
      setScraps((sc ?? []) as any);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  const applyMove = async () => {
    if (!selected || !moveMode) return;
    const n = parseFloat(moveQty.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) { toast.error("Quantità non valida"); return; }
    const delta = moveMode === "carico" ? n : -n;
    const next = Number(selected.qty_intera) + delta;
    if (next < 0) { toast.error("Quantità in magazzino insufficiente"); return; }
    setMoveBusy(true);
    try {
      const { error } = await supabase.from("inventory_items").update({ qty_intera: next }).eq("id", selected.id);
      if (error) throw error;
      await logAction({
        action: moveMode === "carico" ? "MAGAZZINO_CARICO" : "MAGAZZINO_SCARICO",
        entity_type: "inventory",
        entity_id: selected.id,
        detail: `${selected.code} · ${selected.nome} · ${moveMode === "carico" ? "+" : "-"}${n} ${selected.um}`,
        prev_state: { qty_intera: Number(selected.qty_intera) },
        new_state: { qty_intera: next },
      });
      toast.success(`${moveMode === "carico" ? "Caricati" : "Scaricati"} ${n} ${selected.um}`);
      setMoveMode(null);
      setMoveQty("1");
      await reload();
    } catch (e: any) {
      toast.error(e.message ?? "Errore");
    } finally {
      setMoveBusy(false);
    }
  };

  const filtered = useMemo(() => {
    const list = items.filter((i) => i.reparto === tab);
    if (!q.trim()) return list;
    const t = q.toLowerCase();
    return list.filter((i) =>
      (i.code + " " + i.nome + " " + (i.descrizione ?? "") + " " + (i.posizione ?? "")).toLowerCase().includes(t)
    );
  }, [items, tab, q]);

  const totals = useMemo(() => {
    const list = items.filter((i) => i.reparto === tab);
    const low = list.filter((i) => Number(i.qty_intera) < Number(i.soglia_minima)).length;
    const sc = scraps.filter((p) => list.some((i) => i.id === p.inventory_id)).length;
    return { total: list.length, low, sc };
  }, [items, scraps, tab]);

  if (authLoading || permLoading) {
    return <div className="min-h-screen grid place-items-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!user) return <Navigate to="/auth" replace />;
  if (!isAdmin && !approved) return <Navigate to="/hub" replace />;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b-2 border-ink bg-paper">
        <div className="w-full px-8 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link to="/hub" className="inline-flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground hover:text-ink">
              <ArrowLeft className="w-3 h-3" /> Hub
            </Link>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-primary">// Postazione</div>
              <h1 className="font-display text-3xl font-semibold leading-none flex items-center gap-2">
                <Package className="w-7 h-7" /> Magazzino
              </h1>
            </div>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/40" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca…" className="pl-9 h-11 w-96 text-base" />
          </div>
        </div>
      </header>

      <main className="w-full px-8 py-6 space-y-5">
        <div className="flex gap-1 border-b-2 border-ink/15">
          {(["stampa", "tappezzeria"] as Tab[]).map((d) => {
            const active = d === tab;
            const count = items.filter((i) => i.reparto === d).length;
            return (
              <button
                key={d}
                onClick={() => setTab(d)}
                className={`px-6 py-3 text-sm uppercase tracking-wider font-bold border-b-2 -mb-[2px] transition-colors ${
                  active ? "border-primary text-primary" : "border-transparent text-ink/50 hover:text-ink"
                }`}
              >
                {TAB_LABEL[d]} <span className="font-mono text-xs text-ink/40 ml-2">({count})</span>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="border-2 border-ink/15 bg-paper rounded-sm p-4">
            <div className="font-mono text-xs uppercase text-muted-foreground">Articoli</div>
            <div className="font-display text-3xl font-bold">{totals.total}</div>
          </div>
          <div className="border-2 border-ink/15 bg-paper rounded-sm p-4">
            <div className="font-mono text-xs uppercase text-muted-foreground flex items-center gap-1">
              <Scissors className="w-3.5 h-3.5" /> Pezzi sfrido
            </div>
            <div className="font-display text-3xl font-bold">{totals.sc}</div>
          </div>
          <div className="border-2 border-ink/15 bg-paper rounded-sm p-4">
            <div className="font-mono text-xs uppercase text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" /> Sotto soglia
            </div>
            <div className="font-display text-3xl font-bold text-amber-600">{totals.low}</div>
          </div>
        </div>

        <div className="border-2 border-ink/15 rounded-sm bg-paper overflow-hidden">
          {loading ? (
            <div className="p-10 grid place-items-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              Nessun articolo in magazzino per <strong>{TAB_LABEL[tab]}</strong>.
            </div>
          ) : (
            <div className="max-h-[calc(100vh-340px)] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wider font-bold sticky top-0 z-10">
                  <tr>
                    <th className="text-left px-4 py-3 w-36">Codice</th>
                    <th className="text-left px-4 py-3">Materiale</th>
                    <th className="text-right px-4 py-3 w-32">Qty</th>
                    <th className="text-center px-4 py-3 w-28">Sfrido</th>
                    <th className="text-left px-4 py-3 w-20">UM</th>
                    <th className="text-left px-4 py-3 w-40">Posizione</th>
                    <th className="text-right px-4 py-3 w-24">Soglia</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((i) => {
                    const myScraps = scraps.filter((p) => p.inventory_id === i.id).length;
                    const low = Number(i.qty_intera) < Number(i.soglia_minima);
                    return (
                      <tr
                        key={i.id}
                        onClick={() => setSelected(i)}
                        className={`border-t cursor-pointer hover:bg-muted/40 ${low ? "bg-amber-50/40" : ""}`}
                      >
                        <td className="px-4 py-3 font-mono text-sm font-bold">{i.code}</td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-base">{i.nome}</div>
                          {i.descrizione && <div className="text-xs text-muted-foreground mt-0.5">{i.descrizione}</div>}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono text-base ${low ? "text-destructive font-bold" : ""}`}>
                          {Number(i.qty_intera)}
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-sm">
                          {myScraps > 0 ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-sm bg-primary/10 text-primary font-bold">
                              <Scissors className="w-3 h-3" /> {myScraps}
                            </span>
                          ) : <span className="text-ink/30">—</span>}
                        </td>
                        <td className="px-4 py-3 text-sm font-mono text-ink/60">{i.um}</td>
                        <td className="px-4 py-3 text-sm">{i.posizione ?? <span className="text-ink/30">—</span>}</td>
                        <td className="px-4 py-3 text-right font-mono text-sm text-ink/60">{Number(i.soglia_minima)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      <Dialog open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <DialogContent className="max-w-3xl">
          {selected && (() => {
            const itemScraps = scraps.filter((p) => p.inventory_id === selected.id);
            const low = Number(selected.qty_intera) < Number(selected.soglia_minima);
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-2xl">
                    <Package className="w-6 h-6" /> {selected.nome}
                  </DialogTitle>
                  <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                    {selected.code} · {TAB_LABEL[selected.reparto as Tab] ?? selected.reparto}
                  </div>
                </DialogHeader>

                <div className="space-y-4">
                  {selected.descrizione && (
                    <p className="text-sm text-muted-foreground">{selected.descrizione}</p>
                  )}

                  <div className="grid grid-cols-4 gap-3">
                    <div className="border border-ink/15 rounded-sm p-3">
                      <div className="font-mono text-[10px] uppercase text-muted-foreground">Quantità</div>
                       <div className={`font-display text-2xl font-bold ${low ? "text-destructive" : ""}`}>
                         {Number(selected.qty_intera)} <span className="text-sm font-normal text-ink/50">{Number(selected.qty_intera) === 1 ? "lastra" : "lastre"}</span>
                       </div>
                    </div>
                    <div className="border border-ink/15 rounded-sm p-3">
                      <div className="font-mono text-[10px] uppercase text-muted-foreground">Soglia min.</div>
                      <div className="font-display text-2xl font-bold">{Number(selected.soglia_minima)}</div>
                    </div>
                    <div className="border border-ink/15 rounded-sm p-3">
                      <div className="font-mono text-[10px] uppercase text-muted-foreground">Posizione</div>
                      <div className="font-display text-lg">{selected.posizione ?? "—"}</div>
                    </div>
                    <div className="border border-ink/15 rounded-sm p-3">
                      <div className="font-mono text-[10px] uppercase text-muted-foreground flex items-center gap-1">
                        <Scissors className="w-3 h-3" /> Sfridi
                      </div>
                      <div className="font-display text-2xl font-bold">{itemScraps.length}</div>
                    </div>
                  </div>

                  {canWrite && (
                    <div className="flex flex-wrap gap-2 border-y border-ink/15 py-3">
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setMoveMode("carico"); setMoveQty("1"); }}>
                        <ArrowDownToLine className="w-4 h-4" /> Carico
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setMoveMode("scarico"); setMoveQty("1"); }}>
                        <ArrowUpFromLine className="w-4 h-4" /> Scarico
                      </Button>
                      <Button size="sm" variant="default" className="gap-1.5" onClick={() => setTransformOpen(true)} disabled={Number(selected.qty_intera) < 1}>
                        <Wand2 className="w-4 h-4" /> Trasforma
                      </Button>
                    </div>
                  )}

                  {moveMode && (
                    <div className="border-2 border-primary/40 bg-primary/5 rounded-sm p-3 flex items-end gap-3">
                      <div className="flex-1">
                        <div className="font-mono text-[10px] uppercase text-muted-foreground mb-1">
                          {moveMode === "carico" ? "Quantità da caricare" : "Quantità da scaricare"} ({selected.um})
                        </div>
                        <Input
                          autoFocus
                          type="number"
                          step="0.01"
                          min="0"
                          value={moveQty}
                          onChange={(e) => setMoveQty(e.target.value)}
                          className="h-10 text-base"
                        />
                      </div>
                      <Button onClick={applyMove} disabled={moveBusy} className="gap-1.5">
                        {moveBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        Conferma
                      </Button>
                      <Button variant="ghost" onClick={() => setMoveMode(null)} disabled={moveBusy}>Annulla</Button>
                    </div>
                  )}

                  {selected.note && (
                    <div className="border-l-4 border-amber-400 bg-amber-50/40 px-3 py-2 text-sm">
                      {selected.note}
                    </div>
                  )}

                  <div>
                    <h3 className="font-display text-lg font-semibold mb-2 flex items-center gap-2">
                      <Scissors className="w-4 h-4" /> Pezzi di sfrido
                    </h3>
                    {itemScraps.length === 0 ? (
                      <div className="border-2 border-dashed border-ink/15 rounded-sm p-6 text-center text-sm text-muted-foreground">
                        Nessun pezzo di sfrido tracciato.
                      </div>
                    ) : (
                      <div className="border-2 border-ink/15 rounded-sm overflow-hidden max-h-72 overflow-y-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/50 text-xs uppercase tracking-wider font-bold sticky top-0">
                            <tr>
                              <th className="text-left px-3 py-2">Codice</th>
                              <th className="text-right px-3 py-2">Misure (cm)</th>
                              <th className="text-right px-3 py-2">Sp.</th>
                              <th className="text-left px-3 py-2">Posizione</th>
                              <th className="text-left px-3 py-2">Stato</th>
                              {canWrite && <th className="px-3 py-2 w-10"></th>}
                            </tr>
                          </thead>
                          <tbody>
                            {itemScraps.map((p) => (
                              <tr key={p.id} className="border-t">
                                <td className="px-3 py-2 font-mono text-xs font-bold">{p.code}</td>
                                <td className="px-3 py-2 text-right font-mono">{Math.round(Number(p.w_mm) / 10)} × {Math.round(Number(p.h_mm) / 10)}</td>
                                <td className="px-3 py-2 text-right font-mono text-xs">{p.thickness_mm ? `${p.thickness_mm}` : "—"}</td>
                                <td className="px-3 py-2 text-xs">{p.posizione ?? <span className="text-ink/30">—</span>}</td>
                                <td className="px-3 py-2">
                                  <span className={`inline-block px-2 py-0.5 text-[10px] uppercase tracking-wider font-bold rounded-sm ${
                                    p.status === "libero" ? "bg-emerald-100 text-emerald-800" :
                                    p.status === "riservato" ? "bg-amber-100 text-amber-800" :
                                    "bg-ink/10 text-ink/60"
                                  }`}>
                                    {SCRAP_STATUS_LABEL[p.status]}
                                  </span>
                                </td>
                                {canWrite && (
                                  <td className="px-2 py-2 text-right">
                                    <button
                                      title="Elimina pezzo"
                                      className="p-1 text-ink/40 hover:text-destructive"
                                      onClick={async () => {
                                        if (!confirm(`Eliminare il pezzo ${p.code}?`)) return;
                                        const { error } = await supabase.from("inventory_scrap_pieces").delete().eq("id", p.id);
                                        if (error) { toast.error(error.message); return; }
                                        await logAction({ action: "SFRIDO_RIMOSSO", entity_type: "scrap_piece", entity_id: p.code, detail: `${p.code} eliminato` });
                                        toast.success("Pezzo eliminato");
                                        await reload();
                                      }}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      <TransformDialog
        open={transformOpen}
        onOpenChange={setTransformOpen}
        item={selected}
        scraps={scraps}
        onDone={reload}
      />
    </div>
  );
};

export default MagazzinoView;

/* ============================ TRANSFORM DIALOG ============================ */

type Piece = { id: string; w: string; h: string; qty: string; posizione: string };
const newPiece = (): Piece => ({ id: Math.random().toString(36).slice(2, 9), w: "", h: "", qty: "1", posizione: "" });

const TransformDialog = ({
  open, onOpenChange, item, scraps, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  item: InvItem | null;
  scraps: ScrapPiece[];
  onDone: () => Promise<void> | void;
}) => {
  // sourceId: "lastra" oppure id di uno sfrido
  const [sourceId, setSourceId] = useState<string>("lastra");
  const [consume, setConsume] = useState("1");
  const [pieces, setPieces] = useState<Piece[]>([newPiece()]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setSourceId("lastra"); setConsume("1"); setPieces([newPiece()]); }
  }, [open]);

  if (!item) return null;

  const itemScraps = scraps.filter((p) => p.inventory_id === item.id && p.status === "libero");
  const isScrapSource = sourceId !== "lastra";
  const sourceScrap = isScrapSource ? itemScraps.find((s) => s.id === sourceId) : null;

  const inheritedThickness = (() => {
    const raw = (item.material_attrs as any)?.thickness;
    if (raw === undefined || raw === null || raw === "") return null;
    const n = parseFloat(String(raw).replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  const submit = async () => {
    let consumeN = 1;
    if (!isScrapSource) {
      consumeN = parseFloat(consume.replace(",", "."));
      if (!Number.isFinite(consumeN) || consumeN <= 0) { toast.error("Quantità da trasformare non valida"); return; }
      if (consumeN > Number(item.qty_intera)) { toast.error("Quantità superiore a quella disponibile"); return; }
    } else if (!sourceScrap) {
      toast.error("Seleziona un pezzo di sfrido valido"); return;
    }

    const valid = pieces
      .map((p) => ({
        w: parseFloat(p.w.replace(",", ".")),
        h: parseFloat(p.h.replace(",", ".")),
        qty: Math.max(1, Math.floor(parseFloat(p.qty.replace(",", ".")) || 0)),
        posizione: p.posizione.trim() || null,
      }))
      .filter((p) => Number.isFinite(p.w) && p.w > 0 && Number.isFinite(p.h) && p.h > 0);
    if (valid.length === 0) { toast.error("Inserisci almeno un pezzo valido"); return; }

    setBusy(true);
    try {
      let newQty = Number(item.qty_intera);
      if (isScrapSource && sourceScrap) {
        // Elimina lo sfrido consumato
        const { error: delErr } = await supabase.from("inventory_scrap_pieces").delete().eq("id", sourceScrap.id);
        if (delErr) throw delErr;
      } else {
        // Scarica le lastre intere
        newQty = Number(item.qty_intera) - consumeN;
        const { error: upErr } = await supabase.from("inventory_items").update({ qty_intera: newQty }).eq("id", item.id);
        if (upErr) throw upErr;
      }

      // 2. Inserisce i nuovi pezzi sfrido
      const myScraps = scraps.filter((p) => p.inventory_id === item.id && p.id !== sourceScrap?.id);
      const inserts: any[] = [];
      const fakeExisting = [...myScraps];
      const sourceLabel = isScrapSource && sourceScrap
        ? `${sourceScrap.code} (${Number(sourceScrap.w_mm)}×${Number(sourceScrap.h_mm)}mm)`
        : `${item.code} (lastra)`;
      for (const p of valid) {
        for (let k = 0; k < p.qty; k++) {
          const code = nextScrapCode(item.code, fakeExisting);
          const row = {
            inventory_id: item.id,
            code,
            w_mm: p.w,
            h_mm: p.h,
            thickness_mm: sourceScrap?.thickness_mm ?? inheritedThickness,
            posizione: p.posizione,
            note: `Da trasformazione di ${sourceLabel}`,
            status: "libero" as const,
          };
          inserts.push(row);
          fakeExisting.push({ ...row, id: code, created_at: "", updated_at: "", reserved_for_order: null, reserved_for_sub: null } as any);
        }
      }
      const { error: insErr } = await supabase.from("inventory_scrap_pieces").insert(inserts);
      if (insErr) throw insErr;

      await logAction({
        action: "MAGAZZINO_TRASFORMA",
        entity_type: "inventory",
        entity_id: item.id,
        detail: `${item.code} · sorgente: ${sourceLabel} → ${inserts.length} pezzi`,
        prev_state: { qty_intera: Number(item.qty_intera) },
        new_state: { qty_intera: newQty, generated: inserts.length, source: sourceLabel },
      });

      toast.success(`Trasformazione completata: ${inserts.length} pezzi creati`);
      await onDone();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Errore");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="w-5 h-5" /> Trasforma — {item.nome}
          </DialogTitle>
          <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            {item.code} · disponibili {Number(item.qty_intera)} lastre
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <div className="border-2 border-ink/15 rounded-sm p-3 bg-muted/20 space-y-3">
            <div className="font-mono text-[10px] uppercase text-muted-foreground">Sorgente da trasformare</div>
            <select
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              className="h-10 w-full rounded-sm border border-ink/20 bg-background px-2 text-sm"
            >
              <option value="lastra" disabled={Number(item.qty_intera) < 1}>
                Lastra intera ({Number(item.qty_intera)} disponibili)
              </option>
              {itemScraps.length > 0 && <option disabled>──── Pezzi di sfrido ────</option>}
              {itemScraps.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {Number(s.w_mm)} × {Number(s.h_mm)} mm{s.posizione ? ` · ${s.posizione}` : ""}
                </option>
              ))}
            </select>

            {!isScrapSource && (
              <div>
                <div className="font-mono text-[10px] uppercase text-muted-foreground mb-1">Numero di lastre da trasformare</div>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={consume}
                  onChange={(e) => setConsume(e.target.value)}
                  className="h-10 text-base"
                />
              </div>
            )}
            {isScrapSource && sourceScrap && (
              <div className="text-xs text-muted-foreground">
                Verrà consumato 1 pezzo di sfrido <span className="font-mono font-bold">{sourceScrap.code}</span> ({Number(sourceScrap.w_mm)} × {Number(sourceScrap.h_mm)} mm).
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-display text-base font-semibold">Pezzi generati</h4>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setPieces((ps) => [...ps, newPiece()])}>
                <Plus className="w-3.5 h-3.5" /> Aggiungi pezzo
              </Button>
            </div>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {pieces.map((p, i) => (
                <div key={p.id} className="grid grid-cols-12 gap-2 items-center border border-ink/10 rounded-sm p-2">
                  <div className="col-span-3">
                    <div className="font-mono text-[9px] uppercase text-muted-foreground">Largh. (mm)</div>
                    <Input value={p.w} onChange={(e) => setPieces((ps) => ps.map((x) => x.id === p.id ? { ...x, w: e.target.value } : x))} className="h-9" inputMode="decimal" />
                  </div>
                  <div className="col-span-3">
                    <div className="font-mono text-[9px] uppercase text-muted-foreground">Alt. (mm)</div>
                    <Input value={p.h} onChange={(e) => setPieces((ps) => ps.map((x) => x.id === p.id ? { ...x, h: e.target.value } : x))} className="h-9" inputMode="decimal" />
                  </div>
                  <div className="col-span-2">
                    <div className="font-mono text-[9px] uppercase text-muted-foreground">Qtà</div>
                    <Input value={p.qty} onChange={(e) => setPieces((ps) => ps.map((x) => x.id === p.id ? { ...x, qty: e.target.value } : x))} className="h-9" inputMode="numeric" />
                  </div>
                  <div className="col-span-3">
                    <div className="font-mono text-[9px] uppercase text-muted-foreground">Posizione</div>
                    <Input value={p.posizione} onChange={(e) => setPieces((ps) => ps.map((x) => x.id === p.id ? { ...x, posizione: e.target.value } : x))} className="h-9" placeholder="opz." />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    {pieces.length > 1 && (
                      <button title="Rimuovi" onClick={() => setPieces((ps) => ps.filter((x) => x.id !== p.id))} className="p-1 text-ink/40 hover:text-destructive">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-ink/10">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Annulla</Button>
            <Button onClick={submit} disabled={busy} className="gap-1.5">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              Esegui trasformazione
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};