import type { Catalog, PieceLine, PerimeterSide } from "@/components/calculator/types";
import { TechnicalDrawing, DrawingSide } from "@/components/calculator/TechnicalDrawing";
import { autoMatchMaterial } from "@/lib/material-match";
import type { DimUnit } from "@/lib/perimeter";

const eur = (n: number) =>
  n.toLocaleString("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });

/** Costruisce drawSides per un pezzo a partire dalle perimeterOps del catalog. */
export const drawSidesFor = (piece: PieceLine, catalog?: Catalog): DrawingSide[] => {
  if (!catalog) return [];
  return piece.perimeters.flatMap((pp) => {
    const op = catalog.perimeterOps.find((o) => o.id === pp.opId);
    if (!op) return [];
    return pp.sides.map((s: PerimeterSide) => ({
      side: s,
      label: op.name,
      color: op.color || "hsl(220 14% 35%)",
    }));
  });
};

const KV = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between gap-2 border-b border-dashed border-ink/10 py-0.5">
    <span className="text-muted-foreground">{k}</span>
    <span className="font-mono">{v}</span>
  </div>
);

export type PieceDetailProps = {
  piece: PieceLine;
  deptLabel: string;
  catalog?: Catalog;
  index: number;
  /** Reparto operatore: se valorizzato, mostra solo le lavorazioni pertinenti. */
  filterDept?: "stampa" | "taglio" | "tappezzeria" | "falegnameria" | "progettazione" | "stampa_3d" | "altro";
};

/** Card pezzo riusabile da Flow + Produzione. */
export const PieceDetail = ({ piece, deptLabel, catalog, index, filterDept }: PieceDetailProps) => {
  const sides = drawSidesFor(piece, catalog);
  const explicitVariant =
    catalog?.materials.find((m) => m.id === (piece.variantId ?? piece.catalogMaterialId)) ?? null;
  const autoMatched = catalog
    ? autoMatchMaterial(
        catalog.materials,
        piece.productName ?? explicitVariant?.name ?? "",
        piece.color ?? "",
        piece.fireproof ?? "",
        piece.height ?? 0,
        (piece.dimUnit ?? "cm") as DimUnit,
      )
    : null;
  const variant =
    autoMatched?.material ??
    explicitVariant ??
    catalog?.materials.find(
      (m) =>
        (m.name ?? "").trim().toLowerCase() === (piece.productName ?? "").trim().toLowerCase() &&
        (!piece.color || (m.color ?? "").trim().toLowerCase() === piece.color.trim().toLowerCase()) &&
        (!piece.thickness || (m.thickness ?? "").trim() === piece.thickness.trim()) &&
        (!piece.finish || (m.finish ?? "").trim().toLowerCase() === piece.finish.trim().toLowerCase()),
    );
  const printOp = piece.printOpId ? catalog?.printOps?.find((p) => p.id === piece.printOpId) : undefined;

  const fabricHeight =
    variant?.height
      ? `${variant.height} ${variant.heightUnit || variant.dimUnit || "cm"}`
      : piece.matchedHeight
        ? `${piece.matchedHeight} ${piece.matchedHeightUnit || "cm"}`
        : "—";

  // Filtro lavorazioni in base al reparto (operatore vede solo ciò che lo riguarda).
  const perimetersFiltered = piece.perimeters.filter((pp) => {
    if (!filterDept) return true;
    const op = catalog?.perimeterOps.find((o) => o.id === pp.opId);
    if (!op) return true;
    const cat = (op.category ?? "perimetrale").toLowerCase();
    if (filterDept === "stampa") return cat === "stampa";
    if (filterDept === "taglio") return cat === "taglio";
    if (filterDept === "tappezzeria") return cat === "perimetrale" || cat === "altre";
    if (filterDept === "falegnameria") return cat === "taglio" || cat === "altre" || cat === "perimetrale";
    return true;
  });

  const showPrint = !filterDept || filterDept === "stampa";

  return (
    <div className="border border-ink/15 rounded-sm p-4 grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4 bg-paper">
      <div className="bg-ink/5 rounded-sm p-2 grid place-items-center">
        <TechnicalDrawing
          width={piece.width}
          height={piece.height}
          unit={piece.dimUnit}
          sides={sides}
          shape={piece.shape ?? "rect"}
          widthBottom={piece.widthBottom}
          canvasWidth={260}
          canvasHeight={200}
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="font-display text-base font-semibold">
            #{index} · {piece.productName || "Pezzo"}
            {(piece.quantity ?? 1) > 1 && (
              <span className="ml-2 text-xs font-mono text-muted-foreground">× {piece.quantity}</span>
            )}
          </h4>
          <span className="text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 bg-ink/10 text-ink/70 rounded-sm">
            {deptLabel}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <KV k="Dimensioni" v={`${piece.width} × ${piece.height} ${piece.dimUnit}`} />
          <KV k="Altezza tessuto" v={fabricHeight} />
          {piece.color && <KV k="Colore" v={piece.color} />}
          {piece.fireproof && <KV k="Ignifugo" v={piece.fireproof} />}
          {piece.thickness && <KV k="Spessore" v={piece.thickness} />}
          {piece.finish && <KV k="Finitura" v={piece.finish} />}
          {variant && (
            <KV
              k="Variante"
              v={`${variant.name}${variant.height ? ` h${variant.height}${variant.heightUnit ?? ""}` : ""}`}
            />
          )}
          {showPrint && printOp && <KV k="Stampa" v={`${printOp.type} · ${printOp.mode}`} />}
        </div>

        {perimetersFiltered.length > 0 && (
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mt-2 mb-1">
              Lavorazioni{filterDept ? ` (${filterDept})` : " perimetrali"}
            </div>
            <ul className="space-y-1">
              {perimetersFiltered.map((pp) => {
                const op = catalog?.perimeterOps.find((o) => o.id === pp.opId);
                return (
                  <li key={pp.id} className="flex items-center gap-2 text-xs">
                    <span
                      className="w-3 h-3 rounded-sm border border-ink/30"
                      style={{ background: op?.color ?? "transparent" }}
                    />
                    <span className="font-semibold">{op?.name ?? "?"}</span>
                    <span className="text-muted-foreground">
                      → {pp.sides.length > 0 ? pp.sides.join(", ") : "intera"}
                      {pp.quantity ? ` × ${pp.quantity}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {!filterDept && (piece.customWorks ?? []).length > 0 && (
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mt-2 mb-1">
              Lavorazioni libere
            </div>
            <ul className="space-y-0.5 text-xs">
              {(piece.customWorks ?? []).map((cw) => (
                <li key={cw.id} className="flex justify-between">
                  <span>{cw.name}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">{eur(cw.price)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {piece.note && (
          <div className="text-xs italic text-muted-foreground border-l-2 border-ink/20 pl-2 mt-2">
            {piece.note}
          </div>
        )}
      </div>
    </div>
  );
};