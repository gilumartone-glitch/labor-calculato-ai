import { useMemo } from "react";
import { PerimeterSide, PieceShape } from "./types";

export type DrawingSide = {
  side: PerimeterSide;
  /** etichetta breve (es. "Orli") */
  label: string;
  color: string;
};

interface TechnicalDrawingProps {
  width: number;
  height: number;
  unit: "cm" | "m" | "mm";
  /** larghezza del canvas SVG in px */
  canvasWidth?: number;
  /** altezza del canvas SVG in px */
  canvasHeight?: number;
  /** lati con lavorazioni applicate, evidenziati sul rettangolo */
  sides?: DrawingSide[];
  /** forma del pezzo: rect (default), triangle, trapezoid */
  shape?: PieceShape;
  /** per trapezoid: base minore (in `unit`); per triangle è ignorato */
  widthBottom?: number;
}

/**
 * Disegno tecnico stile blueprint del pezzo.
 * - Rettangolo proporzionale alle misure (clamp per non sforare il canvas)
 * - Linee di quota con frecce, etichette base/altezza
 * - Crocini diagonali per riferimento d'area
 * - Etichette tecniche minime (scala, area, perimetro)
 */
export const TechnicalDrawing = ({
  width,
  height,
  unit,
  canvasWidth = 320,
  canvasHeight = 220,
  sides = [],
  shape = "rect",
  widthBottom,
}: TechnicalDrawingProps) => {
  const empty = !width || !height || width <= 0 || height <= 0;

  const layout = useMemo(() => {
    const padX = 46; // spazio per quote verticali a sinistra/destra
    const padY = 42; // spazio per quote orizzontali sopra/sotto
    const innerW = canvasWidth - padX * 2;
    const innerH = canvasHeight - padY * 2;
    if (empty) return null;

    const ratio = width / height;
    let w = innerW;
    let h = w / ratio;
    if (h > innerH) {
      h = innerH;
      w = h * ratio;
    }
    const x = (canvasWidth - w) / 2;
    const y = (canvasHeight - h) / 2;
    // scala approssimativa: 1 px = ? unit
    const scale = width / w;
    return { x, y, w, h, scale };
  }, [width, height, canvasWidth, canvasHeight, empty]);

  // Calcoli area e perimetro in metri
  const factor = unit === "m" ? 1 : unit === "cm" ? 0.01 : 0.001;
  const wM = width * factor;
  const hM = height * factor;
  const wbM = (widthBottom ?? width) * factor;
  const area =
    shape === "triangle"
      ? (wM * hM) / 2
      : shape === "trapezoid"
      ? ((wM + wbM) * hM) / 2
      : wM * hM;
  const perim =
    shape === "triangle"
      ? wM + 2 * Math.sqrt((wM / 2) ** 2 + hM ** 2)
      : shape === "trapezoid"
      ? wM + wbM + 2 * Math.sqrt(((wM - wbM) / 2) ** 2 + hM ** 2)
      : (wM + hM) * 2;

  const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString("it-IT", { maximumFractionDigits: 2 }) : "—");

  return (
    <div className="border border-ink/20 rounded-sm bg-paper overflow-hidden max-h-[260px] mx-auto">
      <div className="flex items-center justify-between px-2 py-1 border-b border-ink/15 bg-muted/30 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
        <span>// Disegno tecnico</span>
        <span>{empty ? "—" : `1:${layout ? Math.round(layout.scale * (unit === "m" ? 100 : unit === "cm" ? 1 : 0.1)) : "—"}`}</span>
      </div>

      <svg
        viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
        className="block w-full h-auto max-h-[230px]"
        preserveAspectRatio="xMidYMid meet"
        style={{ aspectRatio: `${canvasWidth} / ${canvasHeight}` }}
      >
        <defs>
          <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="currentColor" strokeWidth="0.3" opacity="0.08" />
          </pattern>
          <marker id="arrowEnd" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
          </marker>
          <marker id="arrowStart" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M10,0 L0,5 L10,10 z" fill="currentColor" />
          </marker>
        </defs>

        {/* griglia di sfondo */}
        <rect width={canvasWidth} height={canvasHeight} fill="url(#grid)" className="text-ink" />

        {empty ? (
          <text
            x={canvasWidth / 2}
            y={canvasHeight / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-muted-foreground"
            fontFamily="ui-monospace, SFMono-Regular, monospace"
            fontSize="11"
          >
            inserisci base × altezza
          </text>
        ) : layout && (
          <g className="text-ink">
            {/* diagonali (riferimento area) */}
            <line x1={layout.x} y1={layout.y} x2={layout.x + layout.w} y2={layout.y + layout.h} stroke="currentColor" strokeWidth="0.4" opacity="0.25" strokeDasharray="2 3" />
            <line x1={layout.x + layout.w} y1={layout.y} x2={layout.x} y2={layout.y + layout.h} stroke="currentColor" strokeWidth="0.4" opacity="0.25" strokeDasharray="2 3" />

            {/* sagoma del pezzo in base alla forma */}
            {(() => {
              const x = layout.x, y = layout.y, w = layout.w, h = layout.h;
              if (shape === "triangle") {
                const points = `${x + w / 2},${y} ${x + w},${y + h} ${x},${y + h}`;
                return (
                  <polygon
                    points={points}
                    fill="currentColor"
                    fillOpacity="0.04"
                    stroke="currentColor"
                    strokeWidth="1.2"
                  />
                );
              }
              if (shape === "trapezoid") {
                const ratio = wbM > 0 && wM > 0 ? wbM / wM : 0.6;
                const wb = w * ratio;
                const off = (w - wb) / 2;
                const points = `${x},${y} ${x + w},${y} ${x + w - off},${y + h} ${x + off},${y + h}`;
                return (
                  <polygon
                    points={points}
                    fill="currentColor"
                    fillOpacity="0.04"
                    stroke="currentColor"
                    strokeWidth="1.2"
                  />
                );
              }
              return (
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  fill="currentColor"
                  fillOpacity="0.04"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
              );
            })()}

            {/* Lati con lavorazioni applicate */}
            {sides.length > 0 && (() => {
              // raggruppo per lato per offset paralleli quando ci sono più lavorazioni sullo stesso lato
              const grouped: Record<PerimeterSide, DrawingSide[]> = { top: [], bottom: [], left: [], right: [] };
              for (const s of sides) grouped[s.side].push(s);
              const STROKE = 3;
              const GAP = 1.5;
              const elements: JSX.Element[] = [];
              (Object.keys(grouped) as PerimeterSide[]).forEach((side) => {
                grouped[side].forEach((s, i) => {
                  const offset = i * (STROKE + GAP);
                  let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
                  let labelX = 0, labelY = 0, rotate = 0, anchor: "start" | "middle" | "end" = "middle";
                  if (side === "top") {
                    const y = layout.y - offset;
                    x1 = layout.x; x2 = layout.x + layout.w; y1 = y; y2 = y;
                    labelX = layout.x + layout.w / 2;
                    labelY = layout.y - offset - 5;
                  } else if (side === "bottom") {
                    const y = layout.y + layout.h + offset;
                    x1 = layout.x; x2 = layout.x + layout.w; y1 = y; y2 = y;
                    labelX = layout.x + 4;
                    labelY = y - 3;
                    anchor = "start";
                  } else if (side === "left") {
                    const x = layout.x - offset;
                    x1 = x; x2 = x; y1 = layout.y; y2 = layout.y + layout.h;
                    labelX = x - 5;
                    labelY = layout.y + layout.h / 2;
                    rotate = -90;
                  } else {
                    const x = layout.x + layout.w + offset;
                    x1 = x; x2 = x; y1 = layout.y; y2 = layout.y + layout.h;
                    labelX = x + 5;
                    labelY = layout.y + layout.h / 2;
                    rotate = 90;
                  }
                  elements.push(
                    <g key={`${side}-${i}`}>
                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke={s.color}
                        strokeWidth={STROKE}
                        strokeLinecap="square"
                        opacity="0.95"
                      />
                      {/* etichetta solo per la prima lavorazione del lato per evitare sovrapposizioni */}
                      {i === 0 && (
                        <text
                          x={labelX}
                          y={labelY}
                          fill={s.color}
                          fontFamily="ui-monospace, SFMono-Regular, monospace"
                          fontSize="8"
                          fontWeight="700"
                          textAnchor={anchor}
                          transform={rotate ? `rotate(${rotate} ${labelX} ${labelY})` : undefined}
                          style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}
                        >
                          {grouped[side].length > 1 ? `${s.label} +${grouped[side].length - 1}` : s.label}
                        </text>
                      )}
                    </g>
                  );
                });
              });
              return <>{elements}</>;
            })()}

            {/* linee di estensione + quota BASE (sotto) */}
            <line x1={layout.x} y1={layout.y + layout.h} x2={layout.x} y2={layout.y + layout.h + 18} stroke="currentColor" strokeWidth="0.5" />
            <line x1={layout.x + layout.w} y1={layout.y + layout.h} x2={layout.x + layout.w} y2={layout.y + layout.h + 18} stroke="currentColor" strokeWidth="0.5" />
            <line
              x1={layout.x}
              y1={layout.y + layout.h + 12}
              x2={layout.x + layout.w}
              y2={layout.y + layout.h + 12}
              stroke="currentColor"
              strokeWidth="0.8"
              markerStart="url(#arrowStart)"
              markerEnd="url(#arrowEnd)"
            />
            <text
              x={layout.x + layout.w / 2}
              y={layout.y + layout.h + 26}
              textAnchor="middle"
              fill="currentColor"
              fontFamily="ui-monospace, SFMono-Regular, monospace"
              fontSize="10"
              fontWeight="600"
            >
              {shape === "trapezoid" ? `B ${fmt(width)} ${unit}` : `${fmt(width)} ${unit}`}
            </text>

            {/* Per trapezoid mostro anche la base minore al centro orizzontale, sopra la base maggiore visiva */}
            {shape === "trapezoid" && widthBottom !== undefined && widthBottom > 0 && (
              <text
                x={layout.x + layout.w / 2}
                y={layout.y - 6}
                textAnchor="middle"
                fill="currentColor"
                fontFamily="ui-monospace, SFMono-Regular, monospace"
                fontSize="9"
                fontWeight="600"
                opacity="0.85"
              >
                b {fmt(widthBottom)} {unit}
              </text>
            )}

            {/* linee di estensione + quota ALTEZZA (destra) */}
            <line x1={layout.x + layout.w} y1={layout.y} x2={layout.x + layout.w + 18} y2={layout.y} stroke="currentColor" strokeWidth="0.5" />
            <line x1={layout.x + layout.w} y1={layout.y + layout.h} x2={layout.x + layout.w + 18} y2={layout.y + layout.h} stroke="currentColor" strokeWidth="0.5" />
            <line
              x1={layout.x + layout.w + 12}
              y1={layout.y}
              x2={layout.x + layout.w + 12}
              y2={layout.y + layout.h}
              stroke="currentColor"
              strokeWidth="0.8"
              markerStart="url(#arrowStart)"
              markerEnd="url(#arrowEnd)"
            />
            <text
              x={layout.x + layout.w + 26}
              y={layout.y + layout.h / 2}
              textAnchor="middle"
              fill="currentColor"
              fontFamily="ui-monospace, SFMono-Regular, monospace"
              fontSize="10"
              fontWeight="600"
              transform={`rotate(90 ${layout.x + layout.w + 26} ${layout.y + layout.h / 2})`}
            >
              {fmt(height)} {unit}
            </text>

            {/* Etichetta angolo superiore-sinistra */}
            <text x={layout.x + 4} y={layout.y - 4} fill="currentColor" fontFamily="ui-monospace, SFMono-Regular, monospace" fontSize="8" opacity="0.55">
              ⌐ A
            </text>
          </g>
        )}
      </svg>

      <div className="grid grid-cols-2 px-2 py-1 border-t border-ink/15 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
        <div>area · <span className="text-ink font-semibold">{empty ? "—" : `${fmt(area)} m²`}</span></div>
        <div className="text-right">perim · <span className="text-ink font-semibold">{empty ? "—" : `${fmt(perim)} m`}</span></div>
      </div>
    </div>
  );
};