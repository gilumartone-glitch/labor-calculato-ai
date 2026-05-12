import { X, Search, Edit3, Flame, Link2 } from "lucide-react";
import { motion } from "framer-motion";
import { useState, useEffect } from "react";
import { CatalogMaterial, MaterialLine } from "./types";
import { getCatalogTree } from "@/lib/catalog";
import { eur } from "@/lib/format";
import { CustomerType, priceMultiplier } from "@/lib/pricing";

interface MaterialRowProps {
  index: number;
  line: MaterialLine;
  catalog: CatalogMaterial[];
  onChange: (line: MaterialLine) => void;
  onRemove: () => void;
  canRemove: boolean;
  /** Tipo cliente attivo: applica i moltiplicatori di vendita */
  customerType?: CustomerType;
}

export const MaterialRow = ({
  index, line, catalog, onChange, onRemove, canRemove, customerType,
}: MaterialRowProps) => {
  const tree = getCatalogTree(catalog);
  const [manual, setManual] = useState(!line.catalogId && !!line.name);
  const useCatalog = catalog.length > 0 && !manual;
  const isGhost = !!line.ghostFromPieceId;

  const colorOptions = useCatalog ? tree.colorsFor(line.name) : [];
  const heightOptions = useCatalog ? tree.heightsFor(line.name, line.color) : [];
  const fireproofOptions = useCatalog ? tree.fireproofsFor(line.name, line.color, line.height) : [];

  const total = line.quantity * line.unitCost;

  const applyVariant = (v: CatalogMaterial | undefined, fallback: Partial<MaterialLine>) => {
    const mode = fallback.priceMode ?? line.priceMode;
    const purchase = v ? (mode === "piece" ? v.pricePiece : v.priceCut) : line.unitCost;
    const mult = customerType ? priceMultiplier(customerType, mode) : 1;
    const newCost = v ? purchase * mult : line.unitCost;
    onChange({
      ...line,
      ...fallback,
      catalogId: v?.id ?? null,
      weight: v?.weight ?? line.weight,
      composition: v?.composition ?? line.composition,
      fireproof: v?.fireproof ?? line.fireproof,
      heightUnit: v?.heightUnit ?? line.heightUnit,
      unit: v?.unit ?? line.unit,
      unitCost: newCost,
    });
  };

  // Se il customerType cambia (o cambia priceMode) e la riga è collegata al listino,
  // ricalcola unitCost con il moltiplicatore attuale.
  useEffect(() => {
    if (isGhost) return; // le ghost rows sono ricalcolate dal parent
    if (!line.catalogId) return;
    const v = tree.findVariant(line.name, line.color, line.height, line.fireproof);
    if (!v) return;
    const purchase = line.priceMode === "piece" ? v.pricePiece : v.priceCut;
    const mult = customerType ? priceMultiplier(customerType, line.priceMode) : 1;
    const newCost = purchase * mult;
    if (Math.abs(newCost - line.unitCost) > 1e-6) {
      onChange({ ...line, unitCost: newCost });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerType, line.priceMode, line.catalogId, isGhost]);

  const pickName = (name: string) => {
    const colors = tree.colorsFor(name);
    const color = colors[0] || "";
    const heights = tree.heightsFor(name, color);
    const height = heights[0] || "";
    const fps = tree.fireproofsFor(name, color, height);
    const fp = fps[0] ?? "";
    const v = tree.findVariant(name, color, height, fp);
    applyVariant(v, { name, color, height });
  };

  const pickColor = (color: string) => {
    const heights = tree.heightsFor(line.name, color);
    const height = heights[0] || "";
    const fps = tree.fireproofsFor(line.name, color, height);
    const fp = fps[0] ?? "";
    const v = tree.findVariant(line.name, color, height, fp);
    applyVariant(v, { color, height });
  };

  const pickHeight = (height: string) => {
    const fps = tree.fireproofsFor(line.name, line.color, height);
    const fp = fps[0] ?? "";
    const v = tree.findVariant(line.name, line.color, height, fp);
    applyVariant(v, { height });
  };

  const pickFireproof = (fireproof: string) => {
    const v = tree.findVariant(line.name, line.color, line.height, fireproof);
    applyVariant(v, { fireproof });
  };

  const pickMode = (mode: "piece" | "cut") => {
    const v = tree.findVariant(line.name, line.color, line.height, line.fireproof);
    applyVariant(v, { priceMode: mode });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -10 }}
      transition={{ duration: 0.25 }}
      className={`py-3 border-b border-dashed border-ink/20 last:border-0 ${
        isGhost ? "bg-primary/5 -mx-4 px-4 rounded-sm" : ""
      }`}
    >
      {isGhost && (
        <div className="mb-2 inline-flex items-center gap-1.5 px-2 py-0.5 bg-primary text-primary-foreground rounded-sm text-[10px] font-mono uppercase tracking-wider font-bold">
          <Link2 className="w-3 h-3" />
          Auto · {line.ghostSourceLabel ?? "altro reparto"}
        </div>
      )}
      <fieldset disabled={isGhost} className={isGhost ? "opacity-95" : ""}>
      <div className="grid grid-cols-12 gap-3 items-end">
        <div className="col-span-1 font-mono text-xs text-muted-foreground pb-2">
          {String(index + 1).padStart(2, "0")}
        </div>

        {useCatalog ? (
          <>
            <div className="col-span-3">
              <label className="label-cap block mb-1">Prodotto</label>
              <select
                value={line.name}
                onChange={(e) => pickName(e.target.value)}
                className="input-bare w-full text-sm bg-paper"
              >
                <option value="">— scegli —</option>
                {tree.names.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="label-cap block mb-1">Colore</label>
              <select
                value={line.color}
                onChange={(e) => pickColor(e.target.value)}
                disabled={!colorOptions.length}
                className="input-bare w-full text-sm bg-paper disabled:opacity-40"
              >
                {colorOptions.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="label-cap block mb-1">Altezza</label>
              <select
                value={line.height}
                onChange={(e) => pickHeight(e.target.value)}
                disabled={!heightOptions.length}
                className="input-bare w-full text-sm bg-paper disabled:opacity-40"
              >
                {heightOptions.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className="col-span-1">
              <label className="label-cap block mb-1">Q.tà</label>
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                value={line.quantity === 0 ? "" : line.quantity}
                onChange={(e) =>
                  onChange({ ...line, quantity: parseFloat(e.target.value) || 0 })
                }
                className="input-bare w-full font-mono text-sm"
              />
            </div>
            <div className="col-span-1 text-right pb-2">
              <div className="label-cap mb-1">€/{line.unit || "u"}</div>
              <div className="font-mono text-sm">{eur(line.unitCost)}</div>
            </div>
          </>
        ) : (
          <>
            <div className="col-span-3">
              <label className="label-cap block mb-1">Nome prodotto</label>
              <input
                type="text"
                placeholder="es. Velluto blu"
                value={line.name}
                onChange={(e) => onChange({ ...line, name: e.target.value, catalogId: null })}
                className="input-bare w-full text-sm"
              />
            </div>
            <div className="col-span-2">
              <label className="label-cap block mb-1">Colore</label>
              <input
                type="text"
                value={line.color}
                onChange={(e) => onChange({ ...line, color: e.target.value })}
                className="input-bare w-full text-sm"
              />
            </div>
            <div className="col-span-2">
              <label className="label-cap block mb-1">Altezza</label>
              <input
                type="text"
                placeholder="h140"
                value={line.height}
                onChange={(e) => onChange({ ...line, height: e.target.value })}
                className="input-bare w-full text-sm"
              />
            </div>
            <div className="col-span-1">
              <label className="label-cap block mb-1">Q.tà</label>
              <input
                type="number"
                step="0.01"
                value={line.quantity === 0 ? "" : line.quantity}
                onChange={(e) =>
                  onChange({ ...line, quantity: parseFloat(e.target.value) || 0 })
                }
                className="input-bare w-full font-mono text-sm"
              />
            </div>
            <div className="col-span-1">
              <label className="label-cap block mb-1">€/{line.unit || "u"}</label>
              <input
                type="number"
                step="0.01"
                value={line.unitCost === 0 ? "" : line.unitCost}
                onChange={(e) =>
                  onChange({ ...line, unitCost: parseFloat(e.target.value) || 0 })
                }
                className="input-bare w-full font-mono text-sm"
              />
            </div>
          </>
        )}

        <div className="col-span-2 text-right">
          <div className="label-cap mb-1">Totale</div>
          <div className="font-mono text-base font-semibold tabular-nums">{eur(total)}</div>
        </div>

        <div className="col-span-1 flex justify-end gap-1 pb-1">
          {catalog.length > 0 && (
            <button
              type="button"
              onClick={() => setManual(!manual)}
              aria-label={manual ? "Usa listino" : "Inserimento manuale"}
              title={manual ? "Usa listino" : "Inserimento manuale"}
              className="w-7 h-7 grid place-items-center rounded-sm border border-ink/30 text-ink/60 hover:bg-ink hover:text-paper transition-colors"
            >
              {manual ? <Search className="w-3 h-3" /> : <Edit3 className="w-3 h-3" />}
            </button>
          )}
          <button
            type="button"
            onClick={onRemove}
            disabled={!canRemove}
            aria-label="Rimuovi"
            className="w-7 h-7 grid place-items-center rounded-sm border border-ink/30 text-ink/60 hover:bg-destructive hover:text-destructive-foreground hover:border-destructive disabled:opacity-30 transition-colors"
          >
            <X className="w-3.5 h-3.5" strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {/* Attributi extra + selettore Pezza/Taglio */}
      <div className="col-start-2 col-span-10 mt-2 pl-[8.333%] flex flex-wrap items-center gap-2">
        {/* Selettore Pezza / Taglio (solo se collegato al listino con entrambi i prezzi) */}
        {line.catalogId && (() => {
          const v = tree.findVariant(line.name, line.color, line.height, line.fireproof);
          if (!v) return null;
          return (
            <div className="inline-flex border border-ink/30 rounded-sm overflow-hidden text-[10px] font-mono uppercase tracking-wider">
              <button
                type="button"
                onClick={() => pickMode("piece")}
                className={`px-2 py-0.5 transition-colors ${
                  line.priceMode === "piece"
                    ? "bg-ink text-paper font-semibold"
                    : "text-ink/60 hover:bg-muted"
                }`}
                title={`Pezza intera: ${eur(v.pricePiece)}/${v.unit}`}
              >
                Pezza · {eur(v.pricePiece)}
              </button>
              <button
                type="button"
                onClick={() => pickMode("cut")}
                className={`px-2 py-0.5 transition-colors border-l border-ink/30 ${
                  line.priceMode === "cut"
                    ? "bg-ink text-paper font-semibold"
                    : "text-ink/60 hover:bg-muted"
                }`}
                title={`Al taglio: ${eur(v.priceCut)}/${v.unit}`}
              >
                Taglio · {eur(v.priceCut)}
              </button>
            </div>
          );
        })()}

          {/* Selettore Ignifugo (se più varianti disponibili per questa altezza) */}
          {useCatalog && fireproofOptions.length > 1 && (
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 border border-ink/30 rounded-sm">
              <Flame className="w-2.5 h-2.5 text-primary" />
              <span className="label-cap">Ignifugo</span>
              <select
                value={line.fireproof}
                onChange={(e) => pickFireproof(e.target.value)}
                className="input-bare text-[10px] font-mono uppercase tracking-wider bg-transparent py-0 pr-4"
              >
                {fireproofOptions.map((fp) => (
                  <option key={fp || "__none__"} value={fp}>
                    {fp || "—"}
                  </option>
                ))}
              </select>
            </div>
          )}

          {line.weight && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-muted text-muted-foreground rounded-sm text-[10px] font-mono uppercase tracking-wider">
              peso · {line.weight} g/m²
            </span>
          )}
          {line.composition && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-muted text-muted-foreground rounded-sm text-[10px] font-mono uppercase tracking-wider">
              comp · {line.composition}
            </span>
          )}
          {line.fireproof && fireproofOptions.length <= 1 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary/15 text-primary rounded-sm text-[10px] font-mono uppercase tracking-wider font-semibold">
              <Flame className="w-2.5 h-2.5" />
              {line.fireproof}
            </span>
          )}
      </div>
      </fieldset>
    </motion.div>
  );
};
