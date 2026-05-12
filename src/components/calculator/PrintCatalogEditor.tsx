import { Catalog, PrintMode, PrintOp, PrintType } from "./types";
import { eur } from "@/lib/format";
import { Printer } from "lucide-react";

interface Props {
  catalog: Catalog;
  onCatalogChange: (c: Catalog) => void;
}

const TYPE_LABEL: Record<PrintType, string> = {
  uv: "Stampa UV",
  solvente: "Stampa a solvente",
};
const MODE_LABEL: Record<PrintMode, string> = {
  standard: "Standard",
  fronte_retro: "Fronte / Retro",
  bianco: "Con bianco (UV)",
};

/** Editor inline per i prezzi €/m² delle voci di stampa (UV/Solvente × modalità). */
export const PrintCatalogEditor = ({ catalog, onCatalogChange }: Props) => {
  const printOps = catalog.printOps ?? [];
  if (printOps.length === 0) return null;

  // ordino: UV prima, poi standard < fronte_retro < bianco
  const order: Record<PrintMode, number> = { standard: 0, fronte_retro: 1, bianco: 2 };
  const sorted = [...printOps].sort((a, b) => {
    if (a.type !== b.type) return a.type === "uv" ? -1 : 1;
    return order[a.mode] - order[b.mode];
  });

  const update = (id: string, patch: Partial<PrintOp>) =>
    onCatalogChange({
      ...catalog,
      printOps: printOps.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    });

  const total = printOps.reduce((s, p) => s + (p.pricePerSqm || 0), 0);

  return (
    <div>
      <header className="flex items-baseline justify-between gap-4 mb-3">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-xs text-primary font-bold tracking-widest inline-flex items-center gap-1.5">
            <Printer className="w-3 h-3" />§ LISTINO STAMPA
          </span>
          <h3 className="font-display text-lg font-semibold leading-none">
            Prezzi acquisto €/m²
          </h3>
        </div>
        <div className="font-mono text-[10px] text-muted-foreground">
          {printOps.length} voci · ricarico applicato a livello reparto
        </div>
      </header>
      <div className="rule-line mb-3" />
      <div className="grid grid-cols-12 gap-2 px-2 mb-2 label-cap">
        <div className="col-span-4">Tipo</div>
        <div className="col-span-5">Modalità</div>
        <div className="col-span-3 text-right">Prezzo €/m²</div>
      </div>
      <div className="space-y-1.5">
        {sorted.map((p) => (
          <div
            key={p.id}
            className="grid grid-cols-12 gap-2 items-center p-2 border border-ink/10 rounded-sm bg-paper"
          >
            <div className="col-span-4 font-mono text-xs">{TYPE_LABEL[p.type]}</div>
            <div className="col-span-5 text-sm">{MODE_LABEL[p.mode]}</div>
            <div className="col-span-3">
              <div className="flex items-baseline gap-1 justify-end">
                <input
                  type="number"
                  step="0.01"
                  value={p.pricePerSqm === 0 ? "" : p.pricePerSqm}
                  onChange={(e) =>
                    update(p.id, { pricePerSqm: parseFloat(e.target.value) || 0 })
                  }
                  placeholder="0.00"
                  className="input-bare font-mono text-sm text-right w-24"
                />
                <span className="text-xs text-muted-foreground">€/m²</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      {total === 0 && (
        <div className="mt-2 font-mono text-[10px] text-muted-foreground">
          Imposta i prezzi d'acquisto per attivare il calcolo della stampa sui pezzi.
        </div>
      )}
    </div>
  );
};