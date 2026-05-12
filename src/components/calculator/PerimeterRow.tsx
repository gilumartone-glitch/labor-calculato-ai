import { motion } from "framer-motion";
import { X, Layers } from "lucide-react";
import { CatalogPerimeterOp, PerimeterLine, PerimeterSide } from "./types";
import { eur } from "@/lib/format";
import { perimeterCost, perimeterMeters, sideLengthM, SIDE_LABEL, SIDE_LABEL_SHORT } from "@/lib/perimeter";
import { TechnicalDrawing, DrawingSide } from "./TechnicalDrawing";

interface Props {
  index: number;
  line: PerimeterLine;
  catalog: CatalogPerimeterOp[];
  /** dimensioni di default ereditate dal pezzo del reparto (ultima OperationLine con misure) */
  defaultWidth?: number;
  defaultHeight?: number;
  defaultDimUnit?: "cm" | "m" | "mm";
  onChange: (line: PerimeterLine) => void;
  onRemove: () => void;
}

const SIDES: PerimeterSide[] = ["top", "right", "bottom", "left"];

export const PerimeterRow = ({
  index, line, catalog, onChange, onRemove,
  defaultWidth, defaultHeight, defaultDimUnit,
}: Props) => {
  const op = catalog.find((c) => c.id === line.catalogId) ?? null;
  const meters = perimeterMeters(line);
  const total = perimeterCost(line);

  const pickOp = (id: string) => {
    const next = catalog.find((c) => c.id === id);
    if (!next) {
      onChange({ ...line, catalogId: null, name: "", pricePerMeter: 0, color: undefined });
      return;
    }
    onChange({
      ...line,
      catalogId: next.id,
      name: next.name,
      pricePerMeter: next.pricePerMeter,
      color: next.color,
      // se non sono ancora state impostate dimensioni, eredita quelle suggerite
      width: line.width || defaultWidth || 0,
      height: line.height || defaultHeight || 0,
      dimUnit: line.dimUnit || defaultDimUnit || "cm",
    });
  };

  const toggleSide = (side: PerimeterSide) => {
    const has = line.sides.includes(side);
    onChange({
      ...line,
      sides: has ? line.sides.filter((s) => s !== side) : [...line.sides, side],
    });
  };

  const drawSides: DrawingSide[] = line.sides.map((s) => ({
    side: s,
    label: line.name || op?.name || "—",
    color: line.color || op?.color || "hsl(220 14% 35%)",
  }));

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -10 }}
      transition={{ duration: 0.25 }}
      className="py-3 border-b border-dashed border-ink/20 last:border-0"
    >
      <div className="grid grid-cols-12 gap-3 items-end">
        <div className="col-span-1 font-mono text-xs text-muted-foreground pb-2">
          {String(index + 1).padStart(2, "0")}
        </div>

        <div className="col-span-12 md:col-span-3">
          <label className="label-cap block mb-1">Tipo</label>
          {catalog.length === 0 ? (
            <div className="text-[11px] text-destructive font-mono">
              Listino vuoto · apri "Listino perimetrali"
            </div>
          ) : (
            <select
              value={line.catalogId ?? ""}
              onChange={(e) => pickOp(e.target.value)}
              className="input-bare w-full text-sm bg-paper"
            >
              <option value="">— scegli —</option>
              {catalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {eur(c.pricePerMeter)}/m
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Lati */}
        <div className="col-span-12 md:col-span-4">
          <label className="label-cap block mb-1 inline-flex items-center gap-1.5">
            <Layers className="w-3 h-3 text-primary" />
            Lati ({line.sides.length}/4)
          </label>
          <div className="grid grid-cols-4 gap-1">
            {SIDES.map((s) => {
              const active = line.sides.includes(s);
              const len = sideLengthM(s, line.width, line.height, line.dimUnit);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleSide(s)}
                  title={`${SIDE_LABEL[s]} · ${len.toLocaleString("it-IT", { maximumFractionDigits: 2 })} m`}
                  className={`px-1.5 py-1.5 rounded-sm border text-[10px] uppercase tracking-wider font-bold transition-colors ${
                    active
                      ? "border-current text-paper"
                      : "border-ink/30 text-ink/60 hover:border-ink"
                  }`}
                  style={active ? { backgroundColor: line.color || op?.color || "hsl(220 14% 35%)", borderColor: "transparent" } : undefined}
                >
                  <div>{SIDE_LABEL_SHORT[s]} {SIDE_LABEL[s]}</div>
                  <div className="font-mono opacity-80 text-[9px]">
                    {len > 0 ? `${len.toLocaleString("it-IT", { maximumFractionDigits: 2 })}m` : "—"}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Dimensioni */}
        <div className="col-span-12 md:col-span-3">
          <label className="label-cap block mb-1">Pezzo · base × altezza ({line.dimUnit})</label>
          <div className="grid grid-cols-12 gap-1">
            <input
              type="number"
              step="0.1"
              value={line.width || ""}
              onChange={(e) => onChange({ ...line, width: parseFloat(e.target.value) || 0 })}
              placeholder="b"
              className="col-span-5 input-bare font-mono text-sm text-right"
            />
            <span className="col-span-2 text-center text-muted-foreground self-center">×</span>
            <input
              type="number"
              step="0.1"
              value={line.height || ""}
              onChange={(e) => onChange({ ...line, height: parseFloat(e.target.value) || 0 })}
              placeholder="h"
              className="col-span-5 input-bare font-mono text-sm text-right"
            />
          </div>
        </div>

        <div className="col-span-12 md:col-span-1 text-right pb-2">
          <div className="label-cap mb-1">Totale</div>
          <div className="font-mono text-base font-semibold tabular-nums">{eur(total)}</div>
          <div className="font-mono text-[10px] text-muted-foreground">
            {meters.toLocaleString("it-IT", { maximumFractionDigits: 2 })} m
          </div>
        </div>
      </div>

      {/* Disegno + remove */}
      <div className="mt-3 ml-8 grid grid-cols-12 gap-3 items-start">
        <div className="col-span-12 md:col-span-7">
          <TechnicalDrawing
            width={line.width}
            height={line.height}
            unit={line.dimUnit}
            sides={drawSides}
          />
        </div>
        <div className="col-span-12 md:col-span-5 flex items-start justify-between gap-3">
          <div className="font-mono text-[10px] text-muted-foreground space-y-0.5">
            <div>// {line.sides.length === 0 ? "nessun lato selezionato" : `${meters.toLocaleString("it-IT", { maximumFractionDigits: 2 })} m × ${eur(line.pricePerMeter)}/m`}</div>
            {line.sides.length > 0 && (
              <div className="text-ink">
                = <span className="font-bold">{eur(total)}</span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Rimuovi"
            className="w-7 h-7 grid place-items-center rounded-sm border border-ink/30 text-ink/60 hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-colors shrink-0"
          >
            <X className="w-3.5 h-3.5" strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </motion.div>
  );
};