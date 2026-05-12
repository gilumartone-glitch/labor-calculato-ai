import { X, Search, Edit3, Clock, Hash, Ruler, Wand2 } from "lucide-react";
import { motion } from "framer-motion";
import { useState } from "react";
import { CatalogOperation, OperationLine } from "./types";
import { eur } from "@/lib/format";
import { TechnicalDrawing } from "./TechnicalDrawing";

interface OperationRowProps {
  index: number;
  line: OperationLine;
  catalog: CatalogOperation[];
  onChange: (line: OperationLine) => void;
  onRemove: () => void;
  canRemove: boolean;
}

export const OperationRow = ({
  index, line, catalog, onChange, onRemove, canRemove,
}: OperationRowProps) => {
  const [manual, setManual] = useState(!line.catalogId && !!line.name);
  const [showDraw, setShowDraw] = useState<boolean>(!!(line.width && line.height));
  const useCatalog = catalog.length > 0 && !manual;
  const total = line.quantity * line.rate;

  const dimUnit: "cm" | "m" | "mm" = line.dimUnit ?? "cm";
  const w = line.width ?? 0;
  const h = line.height ?? 0;
  const factor = dimUnit === "m" ? 1 : dimUnit === "cm" ? 0.01 : 0.001;
  const areaM2 = w * h * factor * factor;
  const perimM = (w + h) * 2 * factor;

  const suggestQty = () => {
    if (!w || !h) return;
    // se la modalità è "ora", non sovrascriviamo le ore
    if (line.mode === "ora") return;
    // proponiamo l'area in m² come quantità di default
    onChange({ ...line, quantity: Number(areaM2.toFixed(3)) });
  };

  const pickFromCatalog = (id: string) => {
    const op = catalog.find((c) => c.id === id);
    if (!op) return;
    onChange({
      ...line,
      catalogId: op.id,
      name: op.name,
      mode: op.type,
      unit: op.unit,
      rate: op.price,
    });
  };

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

      {useCatalog ? (
        <div className="col-span-5">
          <label className="label-cap block mb-1">Lavorazione (da listino)</label>
          <select
            value={line.catalogId ?? ""}
            onChange={(e) => pickFromCatalog(e.target.value)}
            className="input-bare w-full text-sm bg-paper"
          >
            <option value="">— scegli —</option>
            {catalog.map((op) => (
              <option key={op.id} value={op.id}>
                {op.name} · {op.type === "ora" ? `${eur(op.price)}/h` : `${eur(op.price)}/${op.unit}`}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <>
          <div className="col-span-3">
            <label className="label-cap block mb-1">Descrizione</label>
            <input
              type="text"
              placeholder="es. Cucitura"
              value={line.name}
              onChange={(e) => onChange({ ...line, name: e.target.value, catalogId: null })}
              className="input-bare w-full text-sm"
            />
          </div>
          <div className="col-span-2">
            <label className="label-cap block mb-1">Modalità</label>
            <div className="flex border border-ink/40 rounded-sm overflow-hidden h-[30px]">
              <button
                type="button"
                onClick={() => onChange({ ...line, mode: "unità", unit: "pz" })}
                className={`flex-1 text-[10px] uppercase tracking-wider font-semibold transition-colors ${
                  line.mode === "unità" ? "bg-ink text-paper" : "bg-transparent text-ink/60"
                }`}
              >
                <Hash className="w-3 h-3 inline mr-1" />
                Unità
              </button>
              <button
                type="button"
                onClick={() => onChange({ ...line, mode: "ora", unit: "h" })}
                className={`flex-1 text-[10px] uppercase tracking-wider font-semibold transition-colors ${
                  line.mode === "ora" ? "bg-ink text-paper" : "bg-transparent text-ink/60"
                }`}
              >
                <Clock className="w-3 h-3 inline mr-1" />
                Ora
              </button>
            </div>
          </div>
        </>
      )}

      <div className="col-span-1">
        <label className="label-cap block mb-1">{line.mode === "ora" ? "Ore" : "Q.tà"}</label>
        <input
          type="number"
          step="0.25"
          value={line.quantity === 0 ? "" : line.quantity}
          onChange={(e) =>
            onChange({ ...line, quantity: parseFloat(e.target.value) || 0 })
          }
          className="input-bare w-full font-mono text-sm"
        />
      </div>

      {useCatalog ? (
        <div className="col-span-1 text-right pb-2">
          <div className="label-cap mb-1">{line.mode === "ora" ? "€/h" : `€/${line.unit}`}</div>
          <div className="font-mono text-sm">{eur(line.rate)}</div>
        </div>
      ) : (
        <div className="col-span-2">
          <label className="label-cap block mb-1">{line.mode === "ora" ? "€/ora" : "€/" + line.unit}</label>
          <div className="flex items-baseline gap-1">
            <input
              type="number"
              step="0.5"
              value={line.rate === 0 ? "" : line.rate}
              onChange={(e) =>
                onChange({ ...line, rate: parseFloat(e.target.value) || 0 })
              }
              className="input-bare w-full font-mono text-sm"
            />
            <span className="text-xs text-muted-foreground font-mono">€</span>
          </div>
        </div>
      )}

      <div className="col-span-2 text-right">
        <div className="label-cap mb-1">Totale</div>
        <div className="font-mono text-base font-semibold tabular-nums">{eur(total)}</div>
      </div>

      <div className={`${useCatalog ? "col-span-2" : "col-span-1"} flex justify-end gap-1 pb-1`}>
        {catalog.length > 0 && (
          <button
            type="button"
            onClick={() => setManual(!manual)}
            aria-label={manual ? "Usa listino" : "Manuale"}
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

      {/* Toggle disegno tecnico */}
      <div className="mt-2 ml-8">
        <button
          type="button"
          onClick={() => setShowDraw((s) => !s)}
          className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground hover:text-ink transition-colors"
        >
          <Ruler className="w-3 h-3" />
          {showDraw ? "Nascondi disegno" : "Aggiungi disegno tecnico"}
        </button>
      </div>

      {showDraw && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
          className="mt-2 ml-8 grid grid-cols-12 gap-3 items-start"
        >
          <div className="col-span-12 md:col-span-5 space-y-2">
            <div className="grid grid-cols-12 gap-2">
              <div className="col-span-5">
                <label className="label-cap block mb-1">Base</label>
                <input
                  type="number"
                  step="0.1"
                  value={line.width ?? ""}
                  onChange={(e) => onChange({ ...line, width: parseFloat(e.target.value) || 0, dimUnit })}
                  placeholder="0"
                  className="input-bare w-full font-mono text-sm"
                />
              </div>
              <div className="col-span-5">
                <label className="label-cap block mb-1">Altezza</label>
                <input
                  type="number"
                  step="0.1"
                  value={line.height ?? ""}
                  onChange={(e) => onChange({ ...line, height: parseFloat(e.target.value) || 0, dimUnit })}
                  placeholder="0"
                  className="input-bare w-full font-mono text-sm"
                />
              </div>
              <div className="col-span-2">
                <label className="label-cap block mb-1">U.</label>
                <select
                  value={dimUnit}
                  onChange={(e) => onChange({ ...line, dimUnit: e.target.value as "cm" | "m" | "mm" })}
                  className="input-bare w-full text-xs font-mono bg-paper py-1"
                >
                  <option value="cm">cm</option>
                  <option value="m">m</option>
                  <option value="mm">mm</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-muted-foreground px-1">
              <span>area · <span className="text-ink font-semibold">{areaM2 ? areaM2.toLocaleString("it-IT", { maximumFractionDigits: 3 }) : "—"} m²</span></span>
              <span>perim · <span className="text-ink font-semibold">{perimM ? perimM.toLocaleString("it-IT", { maximumFractionDigits: 2 }) : "—"} m</span></span>
            </div>

            {line.mode === "unità" && w > 0 && h > 0 && (
              <button
                type="button"
                onClick={suggestQty}
                className="w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 border border-dashed border-primary/60 rounded-sm text-[10px] uppercase tracking-wider font-semibold text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
                title="Imposta la quantità all'area calcolata (m²)"
              >
                <Wand2 className="w-3 h-3" />
                Usa area come q.tà ({areaM2.toLocaleString("it-IT", { maximumFractionDigits: 3 })} m²)
              </button>
            )}
          </div>

          <div className="col-span-12 md:col-span-7">
            <TechnicalDrawing width={w} height={h} unit={dimUnit} />
          </div>
        </motion.div>
      )}
    </motion.div>
  );
};