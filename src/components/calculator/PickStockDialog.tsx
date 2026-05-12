import { useEffect, useMemo, useState } from "react";
import { Package, Scissors, Search, X, Check, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useProdStore } from "@/lib/produzione/store";
import { InvDept } from "@/lib/produzione/types";
import { PieceLine } from "./types";

const mm = (n: number) => Math.round(n);
const cm = (n: number) => Math.round(n / 10);

/** Etichetta dimensione lastra per una riga magazzino.
 *  Per LASTRE mostra "base × altezza" (es. "305×205 cm");
 *  per ROTOLI mostra solo l'altezza rullo. */
const stockDimLabel = (i: { material_height?: string | null; material_attrs?: any }): string | null => {
  const a = (i.material_attrs ?? {}) as Record<string, any>;
  const fmt = String(a.format ?? "").toLowerCase();
  const u = String(a.dimUnit ?? a.heightUnit ?? "cm");
  const h = String(i.material_height ?? a.height ?? "").trim();
  const b = String(a.baseWidth ?? a.base ?? "").trim();
  if (fmt === "lastra") {
    if (b && h) return `${b}×${h} ${u}`;
    if (h) return `${h} ${u}`;
    return null;
  }
  return h ? `${h} ${u}` : null;
};

interface Props {
  open: boolean;
  onClose: () => void;
  line: PieceLine;
  /** Reparto inventario in cui cercare. */
  dept: InvDept;
  onPick: (next: {
    pickedStockKind: "item" | "scrap" | null;
    pickedStockId: string | null;
    pickedStockLabel: string | null;
  }) => void;
}

/**
 * Selettore "Aggancia pezzo da magazzino" per una riga del preventivo.
 * Mostra lastre intere e pezzi di sfrido compatibili (per nome prodotto,
 * colore, spessore quando presenti). La scelta è una PRENOTAZIONE SOFT:
 * non blocca nulla in magazzino, viene solo memorizzata nello snapshot.
 */
export const PickStockDialog = ({ open, onClose, line, dept, onPick }: Props) => {
  const { inventory, scraps, loaded, loadAll } = useProdStore();
  const [q, setQ] = useState("");

  useEffect(() => {
    if (open && !loaded) loadAll();
  }, [open, loaded, loadAll]);

  const productName = (line.productName ?? "").trim().toLowerCase();
  const color = (line.color ?? "").trim().toLowerCase();
  const thickness = (line.thickness ?? "").trim().toLowerCase();

  /** Lastre intere del reparto compatibili col pezzo. */
  const items = useMemo(() => {
    return inventory
      .filter((i) => i.reparto === dept)
      .filter((i) => {
        const n = (i.material_name ?? i.nome ?? "").toLowerCase();
        const c = (i.material_color ?? "").toLowerCase();
        const th = String((i.material_attrs as any)?.thickness ?? "").toLowerCase();
        if (productName && !n.includes(productName)) return false;
        if (color && c && c !== color) return false;
        if (thickness && th && th !== thickness) return false;
        return true;
      })
      .filter((i) => {
        if (!q.trim()) return true;
        const t = q.toLowerCase();
        return (i.code + " " + (i.material_name ?? i.nome ?? "")).toLowerCase().includes(t);
      });
  }, [inventory, dept, productName, color, thickness, q]);

  /** Pezzi di sfrido compatibili (filtrati passando per la lastra madre). */
  const scrapRows = useMemo(() => {
    const invById = new Map(inventory.map((i) => [i.id, i]));
    return scraps
      .filter((s) => s.status === "libero")
      .map((s) => ({ scrap: s, parent: invById.get(s.inventory_id) }))
      .filter(({ parent }) => parent && parent.reparto === dept)
      .filter(({ parent }) => {
        const n = (parent!.material_name ?? parent!.nome ?? "").toLowerCase();
        const c = (parent!.material_color ?? "").toLowerCase();
        if (productName && !n.includes(productName)) return false;
        if (color && c && c !== color) return false;
        return true;
      })
      .filter(({ scrap }) => {
        if (!thickness || !scrap.thickness_mm) return true;
        return String(scrap.thickness_mm).toLowerCase() === thickness;
      })
      .filter(({ scrap, parent }) => {
        if (!q.trim()) return true;
        const t = q.toLowerCase();
        return (scrap.code + " " + (parent?.material_name ?? "")).toLowerCase().includes(t);
      });
  }, [scraps, inventory, dept, productName, color, thickness, q]);

  const labelFor = (kind: "item" | "scrap", id: string): string | null => {
    if (kind === "item") {
      const i = inventory.find((x) => x.id === id);
      if (!i) return null;
      const bits = [i.material_name ?? i.nome, i.material_color, stockDimLabel(i)].filter(Boolean);
      return `Lastra ${i.code} · ${bits.join(" · ")}`;
    }
    const s = scraps.find((x) => x.id === id);
    if (!s) return null;
    const parent = inventory.find((x) => x.id === s.inventory_id);
    return `Sfrido ${s.code} · ${cm(s.w_mm)}×${cm(s.h_mm)} cm${parent ? ` · ${parent.material_name ?? parent.nome}` : ""}`;
  };

  const pick = (kind: "item" | "scrap", id: string) => {
    onPick({ pickedStockKind: kind, pickedStockId: id, pickedStockLabel: labelFor(kind, id) });
    onClose();
  };

  const clear = () => {
    onPick({ pickedStockKind: null, pickedStockId: null, pickedStockLabel: null });
    onClose();
  };

  const empty = items.length === 0 && scrapRows.length === 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Aggancia pezzo da magazzino</DialogTitle>
          <DialogDescription>
            Prenotazione <strong>soft</strong>: la scelta resta come preferenza nel preventivo, ma
            non blocca nulla in magazzino fino al passaggio in produzione.
          </DialogDescription>
        </DialogHeader>

        <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground bg-muted/40 border border-ink/10 rounded-sm p-2">
          Filtro attivo:
          <span className="ml-2 text-ink font-semibold">{line.productName || "—"}</span>
          {line.color && <span> · {line.color}</span>}
          {line.thickness && <span> · sp.{line.thickness}</span>}
        </div>

        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Cerca per codice…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Selezione corrente */}
        {line.pickedStockId && (
          <div className="flex items-center justify-between gap-2 p-3 border border-primary/40 bg-primary/5 rounded-sm">
            <div className="text-sm">
              <div className="label-cap text-primary mb-0.5">Selezione attuale</div>
              <div className="font-mono text-ink">{line.pickedStockLabel ?? "—"}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={clear}>
              <X className="w-4 h-4 mr-1" /> Rimuovi
            </Button>
          </div>
        )}

        {empty && (
          <div className="p-6 text-center border border-dashed border-ink/20 rounded-sm">
            <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
            <div className="text-sm text-muted-foreground">
              Nessun pezzo compatibile in magazzino per questo reparto.
              <br />
              L'operatore sceglierà il pezzo al momento della lavorazione.
            </div>
          </div>
        )}

        {items.length > 0 && (
          <section>
            <h4 className="font-display text-lg flex items-center gap-2 mb-2">
              <Package className="w-4 h-4" /> Lastre intere ({items.length})
            </h4>
            <div className="space-y-1.5">
              {items.map((i) => {
                const selected = line.pickedStockKind === "item" && line.pickedStockId === i.id;
                const lowStock = i.qty_intera < i.soglia_minima;
                return (
                  <button
                    key={i.id}
                    onClick={() => pick("item", i.id)}
                    className={`w-full text-left p-2.5 border rounded-sm transition-colors ${
                      selected
                        ? "border-primary bg-primary/10"
                        : "border-ink/15 hover:border-ink/40 hover:bg-muted/30"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-xs text-muted-foreground">{i.code}</div>
                        <div className="text-sm font-semibold text-ink truncate">
                          {i.material_name ?? i.nome}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {[i.material_color, stockDimLabel(i), (i.material_attrs as any)?.thickness && `sp.${(i.material_attrs as any).thickness}`]
                            .filter(Boolean)
                            .join(" · ")}
                          {i.posizione && <span> · 📍 {i.posizione}</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`text-sm font-mono font-semibold ${lowStock ? "text-destructive" : "text-ink"}`}>
                          {i.qty_intera} {(i.material_attrs as any)?.format === "lastra" ? "ls" : i.um}
                        </div>
                        {selected && <Check className="w-4 h-4 text-primary ml-auto mt-1" />}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {scrapRows.length > 0 && (
          <section>
            <h4 className="font-display text-lg flex items-center gap-2 mb-2">
              <Scissors className="w-4 h-4" /> Pezzi di sfrido ({scrapRows.length})
            </h4>
            <div className="space-y-1.5">
              {scrapRows.map(({ scrap: s, parent }) => {
                const selected = line.pickedStockKind === "scrap" && line.pickedStockId === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => pick("scrap", s.id)}
                    className={`w-full text-left p-2.5 border rounded-sm transition-colors ${
                      selected
                        ? "border-primary bg-primary/10"
                        : "border-ink/15 hover:border-ink/40 hover:bg-muted/30"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-xs text-muted-foreground">{s.code}</div>
                        <div className="text-sm font-semibold text-ink">
                          {cm(s.w_mm)} × {cm(s.h_mm)} cm
                          {s.thickness_mm && <span className="text-muted-foreground"> · sp.{s.thickness_mm}</span>}
                        </div>
                        {parent && (
                          <div className="text-xs text-muted-foreground truncate">
                            da {parent.material_name ?? parent.nome}
                            {parent.material_color && ` · ${parent.material_color}`}
                          </div>
                        )}
                        {s.posizione && <div className="text-xs text-muted-foreground">📍 {s.posizione}</div>}
                      </div>
                      {selected && <Check className="w-4 h-4 text-primary shrink-0" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
};