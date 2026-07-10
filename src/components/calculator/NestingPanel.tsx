import { useEffect, useMemo, useRef, useState } from "react";
import { Layers3, AlertTriangle, ChevronDown, ChevronRight, ChevronLeft, Sparkles, Settings2, Bug, Printer, Download, FileText } from "lucide-react";
import { jsPDF } from "jspdf";
import { toast } from "sonner";
import { Catalog, PieceLine, CatalogMaterial } from "./types";
import {
  computeNesting,
  NestingGroup,
  NestingPieceItem,
  NestingFormatOverride,
  NestingMixedBin,
  recomputeGroupWithOverride,
  recomputeGroupWithMixedBins,
  buildPieceIndexMap,
  piecesOfGroup,
  diagnoseNesting,
  NestingDiagnostic,
  getNestingConfig,
} from "@/lib/nesting";
import { convertLength, DimUnit } from "@/lib/perimeter";
import { eur } from "@/lib/format";
import { CustomerType } from "@/lib/pricing";
import { aggregateWorkBreakdown } from "@/lib/piece";
import { StockHintForGroup } from "./StockHintForGroup";
import { WarehousePlanner } from "./WarehousePlanner";
import { useLocalStorageState } from "@/hooks/useLocalStorageState";
import { mmToCm, mToCm } from "@/lib/fmt";

interface Props {
  pieces: PieceLine[];
  catalog: Catalog;
  customerType?: CustomerType;
  /** Se passata, abilita l'aggancio definitivo (prenotazione soft) ai pezzi del gruppo
   *  direttamente dal pannello di nesting. Riceve la nuova lista pieces da salvare. */
  onPiecesChange?: (pieces: PieceLine[]) => void;
  /** Stato iniziale per ripristinare overrides e bin misti dal salvataggio. */
  initialNestingState?: {
    overrides?: Record<string, NestingFormatOverride | null>;
    mixedBins?: Record<string, NestingMixedBin[] | null>;
  };
  /** Notifica i cambiamenti di stato del nesting per persistenza nello snapshot. */
  onNestingStateChange?: (state: {
    overrides: Record<string, NestingFormatOverride | null>;
    mixedBins: Record<string, NestingMixedBin[] | null>;
  }) => void;
}

const fmt = (n: number, d = 2) =>
  n.toLocaleString("it-IT", { maximumFractionDigits: d, minimumFractionDigits: d });

/** Mostra una lunghezza espressa in metri come cm con precisione al millimetro. */
const fmtCm = (m: number) => mToCm(m);

const materialMetaLabel = (material?: CatalogMaterial | null) =>
  [
    material?.thickness ? `sp. ${material.thickness}` : null,
    material?.finish || null,
  ].filter(Boolean).join(" · ");

/** Colore stabile dato un id (HSL deterministico). */
const colorForPiece = (id: string): string => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${h} 70% 55%)`;
};

/**
 * Opacità unica del riempimento del pezzo in TUTTI i rendering (SVG del nesting
 * e sfondo delle righe della lista "Copertura pezzi"). Modificare qui aggiorna
 * entrambi i posti contemporaneamente — non possono più divergere.
 */
const PIECE_FILL_OPACITY = 0.5;

/**
 * Sfondo CSS che riproduce esattamente `fill={colorForPiece(id)}` +
 * `fillOpacity={PIECE_FILL_OPACITY}` sopra `hsl(var(--background))` dell'SVG.
 * Usato dalle righe della lista per coincidere col pezzo nel nesting.
 */
const pieceBackground = (id: string): string =>
  `color-mix(in srgb, ${colorForPiece(id)} ${PIECE_FILL_OPACITY * 100}%, hsl(var(--background)))`;

/** Etichetta lastra come lettera: 0→A, 1→B, ..., 25→Z, 26→AA. */
const sheetLetter = (idx: number): string => {
  let n = idx;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
};

/** Disegna un SINGOLO foglio (lastra o rotolo) con i suoi pezzi in coordinate locali. */
const SheetSvg = ({
  group,
  sheetWidthM,
  sheetHeightM,
  sheetItems,
  label,
  debug,
  maxW,
  maxH,
  fixedScale,
  kerfM = 0,
}: {
  group: NestingGroup;
  sheetWidthM: number;
  sheetHeightM: number;
  sheetItems: NestingPieceItem[];
  label: string;
  debug: boolean;
  maxW: number;
  maxH: number;
  /** Se valorizzato, usa questa scala (px per metro) invece di adattare al box.
   *  Serve a tenere proporzioni coerenti tra fogli di dimensioni diverse. */
  fixedScale?: number;
  /** Larghezza fresa in metri: le geometrie disegnate vengono rientrate di
   *  halfKerf su ogni lato per mostrare visivamente lo spazio tra i pezzi. */
  kerfM?: number;
}) => {
  const PAD = 28;
  const halfKerf = Math.max(0, kerfM) / 2;
  const scaleW = (maxW - PAD * 2) / sheetWidthM;
  const scaleH = (maxH - PAD * 2) / sheetHeightM;
  const scale = fixedScale ?? Math.min(scaleW, scaleH);
  const innerW = sheetWidthM * scale;
  const innerH = sheetHeightM * scale;
  const W = innerW + PAD * 2;
  const H = innerH + PAD * 2;


  return (
    <div className="flex flex-col items-center gap-1">
      <div className="font-mono text-sm font-bold text-primary uppercase tracking-wider">{label}</div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: W, height: H, maxWidth: "100%" }}
        className="block"
      >
        <defs>
          <pattern id={`grid-${group.key}-${label}`} width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="currentColor" strokeWidth="0.3" opacity="0.08" />
          </pattern>
        </defs>
        {/* sfondo lastra: un solo bordo sottile, niente grid esterna */}
        <rect
          x={PAD}
          y={PAD}
          width={innerW}
          height={innerH}
          fill="hsl(var(--background))"
          stroke="currentColor"
          strokeWidth={0.8}
          className="text-ink/40"
        />
        <rect x={PAD} y={PAD} width={innerW} height={innerH} fill={`url(#grid-${group.key}-${label})`} className="text-ink" />
        {/* quote */}
        <text x={PAD + innerW / 2} y={PAD - 8} textAnchor="middle" className="fill-ink" fontFamily="ui-monospace, monospace" fontSize={20} fontWeight={800}>
          {fmtCm(sheetWidthM)} cm
        </text>
        <text
          x={PAD - 12}
          y={PAD + innerH / 2}
          textAnchor="middle"
          className="fill-ink"
          fontFamily="ui-monospace, monospace"
          fontSize={20}
          fontWeight={800}
          transform={`rotate(-90 ${PAD - 12} ${PAD + innerH / 2})`}
        >
          {fmtCm(sheetHeightM)} cm
        </text>

        {sheetItems.map((it, idx) => {
          const x = PAD + it.x * scale;
          const y = PAD + it.y * scale;
          const w = it.w * scale;
          const h = it.h * scale;
          // Colore SOLIDO pre-composto (identico a quello delle righe della lista).
          // Niente fillOpacity: garantisce che pezzo nel piano e riga in lista siano
          // matematicamente lo stesso colore renderizzato.
          const bg = pieceBackground(it.pieceId);
          const edge = colorForPiece(it.pieceId);
          let shape: JSX.Element;
          if (it.shape === "triangle") {
            const points =
              it.pairRole === "secondary"
                ? `${x},${y} ${x + w},${y} ${x + w / 2},${y + h}`
                : `${x + w / 2},${y} ${x + w},${y + h} ${x},${y + h}`;
            shape = <polygon points={points} fill={bg} stroke={edge} strokeWidth={0.8} />;
          } else if (it.shape === "trapezoid") {
            const wbM = it.widthBottomM ?? it.w;
            const ratio = wbM > 0 && it.w > 0 ? wbM / it.w : 0.6;
            const wb = w * ratio;
            const off = (w - wb) / 2;
            const points =
              it.pairRole === "secondary"
                ? `${x + off},${y} ${x + w - off},${y} ${x + w},${y + h} ${x},${y + h}`
                : `${x},${y} ${x + w},${y} ${x + w - off},${y + h} ${x + off},${y + h}`;
            shape = <polygon points={points} fill={bg} stroke={edge} strokeWidth={0.8} />;
          } else {
            shape = <rect x={x} y={y} width={w} height={h} fill={bg} stroke={edge} strokeWidth={0.8} />;
          }
          return (
            <g key={`${it.pieceId}-${it.copy}-${idx}`}>
              {shape}
              {w > 20 && h > 12 && (() => {
                const fs = Math.min(24, Math.max(13, Math.min(w, h) / 4.5));
                const showDim = h > fs * 2.4;
                const cx = x + w / 2;
                const cy = y + h / 2;
                return (
                  <text
                    x={cx}
                    y={showDim ? cy - fs * 0.15 : cy + fs * 0.35}
                    textAnchor="middle"
                    fontFamily="ui-monospace, monospace"
                    fontSize={fs}
                    fontWeight={800}
                    className="fill-ink"
                    pointerEvents="none"
                    stroke="hsl(var(--background))"
                    strokeWidth={fs * 0.12}
                    paintOrder="stroke"
                    strokeLinejoin="round"
                  >
                    <tspan x={cx}>{it.label}{it.rotated ? " ↻" : ""}</tspan>
                    {showDim && (
                      <tspan x={cx} dy={fs * 1.05} fontWeight={600} fontSize={fs * 0.82}>
                        {fmtCm(it.w)}×{fmtCm(it.h)} cm
                      </tspan>
                    )}
                  </text>
                );
              })()}

              {debug && (
                <g pointerEvents="none">
                  <rect x={x} y={y} width={w} height={h} fill="none" stroke="hsl(0 80% 50%)" strokeWidth={0.8} strokeDasharray="2 2" />
                  <circle cx={x} cy={y} r={1.8} fill="hsl(0 80% 50%)" />
                  <text x={x + 2} y={y - 2} fontFamily="ui-monospace, monospace" fontSize={7} fill="hsl(0 80% 35%)">
                    ({fmt(it.x, 2)},{fmt(it.y, 2)})
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
};

/** Render del gruppo: per le lastre disegna N fogli affiancati; per i rotoli un unico telo verticale. */
const GroupCanvas = ({ group, debug = false }: { group: NestingGroup; debug?: boolean }) => {
  const { rollWidthM, totalLengthM, items } = group;
  const [page, setPage] = useState(0);
  const PER_ROW = 2;
  const ROWS = 3;
  const PER_PAGE = PER_ROW * ROWS; // 6 fogli per pagina
  if (rollWidthM <= 0 || totalLengthM <= 0) return null;

  const isLastra = group.format === "lastra";

  // ---------- ROTOLI: rendering con altezza telo in verticale ----------
  if (!isLastra) {
    const PAD = 22;
    const MAX_W = 560;
    const MAX_H = 320;
    // Dati algoritmo: x/w = dimensione trasversale sull'altezza del rotolo,
    // y/h = lunghezza consumata. A video mostriamo invece il rotolo come in
    // laboratorio: lunghezza in orizzontale, altezza tessuto (h 975) in verticale.
    const scaleW = (MAX_W - PAD * 2) / totalLengthM;
    const scaleH = (MAX_H - PAD * 2) / rollWidthM;
    const scale = Math.min(scaleW, scaleH);
    const innerW = totalLengthM * scale;
    const innerH = rollWidthM * scale;
    const W = innerW + PAD * 2;
    const H = innerH + PAD * 2;
    return (
      <div className="border border-ink/20 rounded-sm bg-paper overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-ink/15 bg-muted/30 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          <span>Telo · {fmtCm(totalLengthM)} × h {fmtCm(rollWidthM)} cm</span>
          <span>scala 1:{Math.round(100 / scale)}</span>
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block w-full h-auto max-h-[360px] mx-auto"
          preserveAspectRatio="xMidYMid meet"
          style={{ aspectRatio: `${W} / ${H}` }}
        >
          <defs>
            <pattern id={`grid-${group.key}`} width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke="currentColor" strokeWidth="0.3" opacity="0.08" />
            </pattern>
          </defs>
          <rect width={W} height={H} fill={`url(#grid-${group.key})`} className="text-ink" />
          <rect x={PAD} y={PAD} width={innerW} height={innerH} fill="hsl(var(--background))" stroke="currentColor" strokeWidth={1.4} className="text-ink" />
          <text x={PAD + innerW / 2} y={PAD - 8} textAnchor="middle" className="fill-ink" fontFamily="ui-monospace, monospace" fontSize={13} fontWeight={700}>
            lunghezza usata {fmtCm(totalLengthM)} cm
          </text>
          <text x={PAD - 10} y={PAD + innerH / 2} textAnchor="middle" className="fill-ink" fontFamily="ui-monospace, monospace" fontSize={13} fontWeight={700} transform={`rotate(-90 ${PAD - 10} ${PAD + innerH / 2})`}>
            altezza telo {fmtCm(rollWidthM)} cm
          </text>
          {items.map((it, idx) => {
            const x = PAD + it.y * scale;
            const y = PAD + it.x * scale;
            const w = it.h * scale;
            const h = it.w * scale;
            const bg = pieceBackground(it.pieceId);
            const edge = colorForPiece(it.pieceId);
            let shape: JSX.Element;
            if (it.shape === "triangle") {
              const points = it.pairRole === "secondary" ? `${x},${y} ${x + w},${y} ${x + w / 2},${y + h}` : `${x + w / 2},${y} ${x + w},${y + h} ${x},${y + h}`;
              shape = <polygon points={points} fill={bg} stroke={edge} strokeWidth={0.8} />;
            } else if (it.shape === "trapezoid") {
              const wbM = it.widthBottomM ?? it.w;
              const ratio = wbM > 0 && it.w > 0 ? wbM / it.w : 0.6;
              const wb = w * ratio;
              const off = (w - wb) / 2;
              const points = it.pairRole === "secondary" ? `${x + off},${y} ${x + w - off},${y} ${x + w},${y + h} ${x},${y + h}` : `${x},${y} ${x + w},${y} ${x + w - off},${y + h} ${x + off},${y + h}`;
              shape = <polygon points={points} fill={bg} stroke={edge} strokeWidth={0.8} />;
            } else {
              shape = <rect x={x} y={y} width={w} height={h} fill={bg} stroke={edge} strokeWidth={0.8} />;
            }
            return (
              <g key={`${it.pieceId}-${it.copy}-${idx}`}>
                {shape}
                {w > 24 && h > 14 && (() => {
                  const fs = Math.min(24, Math.max(13, Math.min(w, h) / 4.5));
                  const showDim = h > fs * 2.4;
                  const cx = x + w / 2;
                  const cy = y + h / 2;
                  return (
                    <text x={cx} y={showDim ? cy - fs * 0.15 : cy + fs * 0.35} textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize={fs} fontWeight={800} className="fill-ink" pointerEvents="none" stroke="hsl(var(--background))" strokeWidth={fs * 0.12} paintOrder="stroke" strokeLinejoin="round">
                      <tspan x={cx}>{it.label}{it.rotated ? " ↻" : ""}</tspan>
                      {showDim && (
                        <tspan x={cx} dy={fs * 1.05} fontWeight={600} fontSize={fs * 0.82}>
                          {fmtCm(it.w)}×{fmtCm(it.h)} cm
                        </tspan>
                      )}
                    </text>
                  );
                })()}

              </g>
            );
          })}
        </svg>
      </div>
    );
  }

  // ---------- LASTRE: griglia di N fogli affiancati ----------
  // Per le lastre la larghezza foglio è `sheetWidthM` (baseWidth catalogo);
  // `rollWidthM` è solo l'altezza variante e NON corrisponde alla base lastra.
  const sheetW = group.sheetWidthM ?? rollWidthM;
  const sheetH = group.sheetHeightM ?? 0;
  const sheetsCount = Math.max(1, group.sheetsNeeded ?? 1);
  // ---- Caso A: BIN ETEROGENEI (sfridi + lastre miste) ----
  // Quando la selezione utente contiene formati diversi, `mixedSheets` è valorizzato.
  // Ogni foglio ha le sue dimensioni e un'etichetta dal magazzino.
  if (group.mixedSheets && group.mixedSheets.length > 0) {
    const allMixed = group.mixedSheets;
    const allBySheet: NestingPieceItem[][] = Array.from({ length: allMixed.length }, () => []);
    for (const it of items) {
      const si = Math.min(allMixed.length - 1, Math.max(0, it.sheetIndex ?? 0));
      allBySheet[si].push(it);
    }
    // Nascondi i bin (sfridi/lastre) che non contengono alcun pezzo: sono stati
    // selezionati nel mix ma il packing non ne ha avuto bisogno.
    const visibleIdx = allMixed
      .map((_, i) => i)
      .filter((i) => allBySheet[i] && allBySheet[i].length > 0);
    const mixed = visibleIdx.map((i) => allMixed[i]);
    const bySheetMix = visibleIdx.map((i) => allBySheet[i]);
    const hiddenCount = allMixed.length - mixed.length;
    if (mixed.length === 0) return null;
    // Layout paginato: 2 fogli per riga × 3 righe = 6 per pagina, con frecce.
    const GAP = 16;
    const PAD = 14;
    // Larghezza pannello disponibile ~880px; 2 colonne = ~420 px per foglio.
    const CARD_W = 420;
    const CARD_H = 260;
    const maxBinW = Math.max(...mixed.map((m) => m.widthM));
    const maxBinH = Math.max(...mixed.map((m) => m.heightM));
    const scaleByW = (CARD_W - PAD * 2) / Math.max(0.001, maxBinW);
    const scaleByH = (CARD_H - PAD * 2) / Math.max(0.001, maxBinH);
    const sharedScale = Math.max(60, Math.min(scaleByW, scaleByH));

    const totalPages = Math.max(1, Math.ceil(mixed.length / PER_PAGE));
    const curPage = Math.min(page, totalPages - 1);
    const startIdx = curPage * PER_PAGE;
    const pageSheets = mixed.slice(startIdx, startIdx + PER_PAGE);
    const pageItems = bySheetMix.slice(startIdx, startIdx + PER_PAGE);

    return (
      <div className="bg-paper">
        <div className="flex items-center justify-between px-1 pb-3 gap-3">
          <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            <strong className="text-ink">{mixed.length}</strong> foglio/i misti · sfridi + lastre dal magazzino
            {hiddenCount > 0 ? ` · ${hiddenCount} non utilizzato/i nascosto/i` : ""}
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] text-muted-foreground">
              area utile: {fmt(group.usedAreaM2)} m² / {fmt(group.totalAreaM2)} m²
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-1 border-2 border-ink/20 rounded-md bg-background">
                <button
                  type="button"
                  onClick={() => setPage(Math.max(0, curPage - 1))}
                  disabled={curPage === 0}
                  className="h-9 w-9 flex items-center justify-center hover:bg-muted disabled:opacity-30"
                  title="Fogli precedenti"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <span className="font-mono text-sm font-bold px-2 min-w-[64px] text-center">
                  {curPage + 1} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(Math.min(totalPages - 1, curPage + 1))}
                  disabled={curPage >= totalPages - 1}
                  className="h-9 w-9 flex items-center justify-center hover:bg-muted disabled:opacity-30"
                  title="Fogli successivi"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>
        </div>
        <div
          className="grid"
          style={{ gridTemplateColumns: `repeat(${PER_ROW}, minmax(0, 1fr))`, gap: GAP }}
        >
          {pageSheets.map((ms, i) => {
            const absIdx = startIdx + i;
            const kindLabel = ms.bin.kind === "scrap" ? "Sfrido" : "Lastra";
            return (
              <SheetSvg
                key={`mixsheet-${absIdx}`}
                group={group}
                sheetWidthM={ms.widthM}
                sheetHeightM={ms.heightM}
                sheetItems={pageItems[i]}
                label={`${kindLabel} ${sheetLetter(absIdx)} · ${ms.bin.label}`}
                debug={debug}
                maxW={ms.widthM * sharedScale + PAD * 2}
                maxH={ms.heightM * sharedScale + PAD * 2}
                fixedScale={sharedScale}
              />
            );
          })}
        </div>
      </div>
    );
  }

  if (sheetH <= 0) return null;

  // ---- Caso B: lastre uniformi (legacy) - paginato 2×3 ----
  const bySheet: NestingPieceItem[][] = Array.from({ length: sheetsCount }, () => []);
  for (const it of items) {
    const si = Math.min(sheetsCount - 1, Math.max(0, it.sheetIndex ?? 0));
    bySheet[si].push(it);
  }
  const GAP = 16;
  const PAD = 14;
  const CARD_W = 420;
  const CARD_H = 260;
  const scaleByW = (CARD_W - PAD * 2) / Math.max(0.001, sheetW);
  const scaleByH = (CARD_H - PAD * 2) / Math.max(0.001, sheetH);
  const sharedScale = Math.max(60, Math.min(scaleByW, scaleByH));

  const totalPages = Math.max(1, Math.ceil(sheetsCount / PER_PAGE));
  const curPage = Math.min(page, totalPages - 1);
  const startIdx = curPage * PER_PAGE;
  const pageSheets = bySheet.slice(startIdx, startIdx + PER_PAGE);

  return (
    <div className="bg-paper">
      <div className="flex items-center justify-between px-1 pb-3 gap-3">
        <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          <strong className="text-ink">{sheetsCount}</strong> lastr{sheetsCount === 1 ? "a" : "e"} · {fmtCm(sheetW)} × {fmtCm(sheetH)} cm ciascuna
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-muted-foreground">
            area utile: {fmt(group.usedAreaM2)} m² / {fmt(group.totalAreaM2)} m²
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1 border-2 border-ink/20 rounded-md bg-background">
              <button
                type="button"
                onClick={() => setPage(Math.max(0, curPage - 1))}
                disabled={curPage === 0}
                className="h-9 w-9 flex items-center justify-center hover:bg-muted disabled:opacity-30"
                title="Fogli precedenti"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="font-mono text-sm font-bold px-2 min-w-[64px] text-center">
                {curPage + 1} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage(Math.min(totalPages - 1, curPage + 1))}
                disabled={curPage >= totalPages - 1}
                className="h-9 w-9 flex items-center justify-center hover:bg-muted disabled:opacity-30"
                title="Fogli successivi"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${PER_ROW}, minmax(0, 1fr))`, gap: GAP }}>
        {pageSheets.map((sheetItems, i) => {
          const absIdx = startIdx + i;
          return (
            <SheetSvg
              key={`sheet-${absIdx}`}
              group={group}
              sheetWidthM={sheetW}
              sheetHeightM={sheetH}
              sheetItems={sheetItems}
              label={`Lastra ${sheetLetter(absIdx)}`}
              debug={debug}
              maxW={sheetW * sharedScale + PAD * 2}
              maxH={sheetH * sharedScale + PAD * 2}
              fixedScale={sharedScale}
            />
          );
        })}
      </div>
    </div>
  );
};


/** Helper: dimensioni in metri di una variante. Per "lastra" usa baseWidth×height,
 *  per "rotolo" usa rollLength (lunghezza) come default × height (altezza rotolo). */
const variantDimsM = (v: CatalogMaterial): { widthM: number; heightM: number; unit: string } => {
  const u = (v.dimUnit || v.heightUnit || "cm") as DimUnit;
  const heightM = convertLength(parseFloat(String(v.height || "0").replace(",", ".")) || 0, u, "m");
  if (v.format === "lastra") {
    const widthM = convertLength(parseFloat(String(v.baseWidth || "0").replace(",", ".")) || 0, u, "m");
    return { widthM, heightM, unit: u };
  }
  // rotolo: la "larghezza" fisica del foglio è l'altezza del rotolo; la "lunghezza"
  // disponibile è rollLength (se nota) — la usiamo come heightM del foglio per il packing.
  const rollLenM = convertLength(parseFloat(String((v as { rollLength?: string }).rollLength || "0").replace(",", ".")) || 0, u, "m");
  return { widthM: heightM, heightM: rollLenM, unit: u };
};

const variantOptionLabel = (v: CatalogMaterial): string => {
  const u = v.dimUnit || v.heightUnit || "cm";
  if (v.format === "lastra") {
    return `Lastra ${v.baseWidth || "?"}×${v.height || "?"} ${u}`;
  }
  const rollLen = (v as { rollLength?: string }).rollLength;
  return rollLen
    ? `Rotolo h ${v.height} ${u} · L ${rollLen} ${u}`
    : `Rotolo h ${v.height} ${u}`;
};

/** Selettore formato per il nesting di un gruppo. Si adatta a lastra o rotolo. */
const FormatSelector = ({
  variants,
  groupFormat,
  activeMaterial,
  override,
  onChange,
}: {
  variants: CatalogMaterial[];
  /** "lastra" | "rotolo": preso dal materiale di riferimento del gruppo */
  groupFormat: "lastra" | "rotolo";
  activeMaterial: CatalogMaterial | null;
  override: NestingFormatOverride | null;
  onChange: (o: NestingFormatOverride | null) => void;
}) => {
  const source = override?.source ?? "catalog";
  const [search, setSearch] = useState("");
  // Mostro solo varianti dello stesso formato del gruppo, con dimensioni valide
  const catalogVariants = variants.filter((m) => {
    if ((m.format ?? "rotolo") !== groupFormat) return false;
    const { widthM, heightM } = variantDimsM(m);
    if (groupFormat === "lastra") return widthM > 0 && heightM > 0;
    // rotolo: serve almeno l'altezza
    return widthM > 0; // widthM = altezza rotolo
  });
  const uniqueCatalogVariants = catalogVariants.filter((variant, index, arr) => {
    const current = variantOptionLabel(variant);
    return arr.findIndex((item) => variantOptionLabel(item) === current) === index;
  });
  const filteredVariants = search.trim()
    ? uniqueCatalogVariants.filter((v) =>
        variantOptionLabel(v).toLowerCase().includes(search.trim().toLowerCase())
      )
    : uniqueCatalogVariants;
  const defaultCatalogVariant =
    (activeMaterial
      ? uniqueCatalogVariants.find((v) => variantOptionLabel(v) === variantOptionLabel(activeMaterial))
      : null) ?? uniqueCatalogVariants[0];

  const isRotolo = groupFormat === "rotolo";

  const setSource = (s: "catalog" | "custom") => {
    if (s === "catalog") {
      const v = defaultCatalogVariant;
      if (!v) return onChange(null);
      const { widthM, heightM } = variantDimsM(v);
      onChange({
        source: "catalog",
        widthM,
        heightM: heightM || override?.heightM || 30, // se rotolo senza rollLength: default 30 m
        quantity: 0,
        label: variantOptionLabel(v),
      });
    } else {
      onChange({
        source: "custom",
        widthM: override?.widthM || 1,
        heightM: override?.heightM || (isRotolo ? 30 : 1),
        quantity: override?.quantity ?? 0,
        label: isRotolo ? "Rotolo personalizzato" : "Formato personalizzato",
      });
    }
  };

  const pickVariantById = (id: string) => {
    const v = uniqueCatalogVariants.find((x) => x.id === id);
    if (!v) return;
    const { widthM, heightM } = variantDimsM(v);
    onChange({
      source: "catalog",
      widthM,
      heightM: heightM || override?.heightM || 30,
      quantity: override?.quantity ?? 0,
      label: variantOptionLabel(v),
    });
  };

  // Trova la variante attualmente selezionata (per il <select>)
  const selectedId =
    override?.source === "catalog"
      ? uniqueCatalogVariants.find((v) => {
          const { widthM, heightM } = variantDimsM(v);
          const matchW = Math.abs(widthM - override.widthM) < 1e-3;
          return isRotolo ? matchW : matchW && Math.abs(heightM - override.heightM) < 1e-3;
        })?.id ?? defaultCatalogVariant?.id ?? ""
      : defaultCatalogVariant?.id ?? "";

  return (
    <div className="border border-ink/20 rounded-sm bg-paper p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          <Settings2 className="w-3 h-3" />
          Formato {isRotolo ? "rotolo" : "lastra"} per il nesting
        </div>
        <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 bg-muted text-muted-foreground rounded-sm">
          {isRotolo ? "Rotolo" : "Lastra"}
        </span>
      </div>
      <div className="flex border border-ink/30 rounded-sm overflow-hidden h-7 max-w-xs">
        {(["catalog", "custom"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSource(s)}
            disabled={s === "catalog" && uniqueCatalogVariants.length === 0}
            className={`flex-1 text-[10px] uppercase tracking-wider font-semibold transition-colors disabled:opacity-30 ${
              source === s ? "bg-ink text-paper" : "bg-transparent text-ink/60"
            }`}
          >
            {s === "catalog" ? "Da listino" : "Personalizzato"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
        {source === "catalog" ? (
          <div className="md:col-span-6">
            <label className="label-cap block mb-1">Variante listino</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca qui…"
              className="input-bare w-full text-sm bg-paper mb-1"
            />
            <select
              value={selectedId}
              onChange={(e) => pickVariantById(e.target.value)}
              className="input-bare w-full text-sm bg-paper"
            >
              <option value="">— scegli —</option>
              {filteredVariants.map((v) => (
                <option key={v.id} value={v.id}>
                  {variantOptionLabel(v)}
                </option>
              ))}
            </select>
          </div>
        ) : isRotolo ? (
          <>
            <div className="md:col-span-3">
              <label className="label-cap block mb-1">Altezza (cm)</label>
              <input
                type="number"
                step="1"
                min={0}
                value={override ? Math.round((override.widthM ?? 0) * 100) : 0}
                onChange={(e) =>
                  onChange({
                    source: "custom",
                    widthM: (parseFloat(e.target.value) || 0) / 100,
                    heightM: override?.heightM || 30,
                    quantity: override?.quantity ?? 0,
                  })
                }
                className="input-bare w-full font-mono text-sm"
              />
            </div>
            <div className="md:col-span-3">
              <label className="label-cap block mb-1">Lunghezza max (cm)</label>
              <input
                type="number"
                step="1"
                min={0}
                value={override ? Math.round((override.heightM ?? 0) * 100) : 0}
                onChange={(e) =>
                  onChange({
                    source: "custom",
                    widthM: override?.widthM || 0,
                    heightM: (parseFloat(e.target.value) || 0) / 100,
                    quantity: override?.quantity ?? 0,
                  })
                }
                className="input-bare w-full font-mono text-sm"
              />
            </div>
          </>
        ) : (
          <>
            <div className="md:col-span-3">
              <label className="label-cap block mb-1">Base (cm)</label>
              <input
                type="number"
                step="1"
                min={0}
                value={override ? Math.round((override.widthM ?? 0) * 100) : 0}
                onChange={(e) =>
                  onChange({
                    source: "custom",
                    widthM: (parseFloat(e.target.value) || 0) / 100,
                    heightM: override?.heightM || 0,
                    quantity: override?.quantity ?? 0,
                  })
                }
                className="input-bare w-full font-mono text-sm"
              />
            </div>
            <div className="md:col-span-3">
              <label className="label-cap block mb-1">Altezza (cm)</label>
              <input
                type="number"
                step="1"
                min={0}
                value={override ? Math.round((override.heightM ?? 0) * 100) : 0}
                onChange={(e) =>
                  onChange({
                    source: "custom",
                    widthM: override?.widthM || 0,
                    heightM: (parseFloat(e.target.value) || 0) / 100,
                    quantity: override?.quantity ?? 0,
                  })
                }
                className="input-bare w-full font-mono text-sm"
              />
            </div>
          </>
        )}
        <div className="md:col-span-3">
          <label className="label-cap block mb-1">{isRotolo ? "N. rotoli disp." : "N. lastre disp."}</label>
          <input
            type="number"
            min={0}
            step={1}
            placeholder="∞ (auto)"
            value={override?.quantity ? override.quantity : ""}
            onChange={(e) =>
              onChange({
                source,
                widthM: override?.widthM || 0,
                heightM: override?.heightM || 0,
                quantity: Math.max(0, parseInt(e.target.value) || 0),
                label: override?.label,
              })
            }
            className="input-bare w-full font-mono text-sm"
          />
        </div>
        <div className="md:col-span-3 text-right">
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground hover:text-ink transition-colors"
          >
            Reset auto
          </button>
        </div>
      </div>
      {override && (
        <div className="font-mono text-[10px] text-muted-foreground">
          {isRotolo
            ? `Rotolo: h ${mToCm(override.widthM)} × L max ${mToCm(override.heightM)} cm`
            : `Lastra: ${mToCm(override.widthM)} × ${mToCm(override.heightM)} cm`}
          {" · disponibili: "}
          {override.quantity ? override.quantity : "∞"}
        </div>
      )}
    </div>
  );
};

const GroupSummary = ({
  group,
  groupPieces,
  expanded,
  onToggle,
  variants,
  override,
  onOverrideChange,
  onMixedBinsChange,
  onPickStock,
  pickedStockIds,
  pickedStockLabel,
  pickedStockConflict,
  diagnostic,
}: {
  group: NestingGroup;
  groupPieces: PieceLine[];
  expanded: boolean;
  onToggle: () => void;
  variants: CatalogMaterial[];
  override: NestingFormatOverride | null;
  onOverrideChange: (o: NestingFormatOverride | null) => void;
  onMixedBinsChange: (b: NestingMixedBin[] | null) => void;
  onPickStock?: (pick: { kind: "item" | "scrap" | "mixed"; id: string; label: string }) => boolean | void;
  pickedStockIds?: string[];
  pickedStockLabel?: string | null;
  pickedStockConflict?: boolean;
  diagnostic?: NestingDiagnostic;
}) => {
  const [debug, setDebug] = useState(false);
  const wastePct = group.wastePct * 100;
  const wasteColor =
    wastePct < 15 ? "text-primary" : wastePct < 30 ? "text-ink" : "text-destructive";
  return (
    <div className="border border-ink/20 rounded-sm overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between gap-4 bg-paper hover:bg-muted/40 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          {expanded ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
          <div className="min-w-0">
            <div className="font-display text-sm font-semibold truncate">{group.label}</div>
            <div className="font-mono text-[10px] text-muted-foreground">
              {group.material
                ? group.format === "lastra"
                  ? `Lastra ${fmtCm(group.sheetWidthM ?? group.rollWidthM)}×${fmtCm(group.sheetHeightM ?? 0)} cm${materialMetaLabel(group.material) ? ` · ${materialMetaLabel(group.material)}` : ""} · ${eur(group.unitPrice)}/m²`
                  : `Telo h ${fmtCm(group.rollWidthM)} cm${materialMetaLabel(group.material) ? ` · ${materialMetaLabel(group.material)}` : ""} · ${eur(group.unitPrice)}/m`
                : "Nessun materiale"}
              {group.items.length > 0 && ` · ${group.items.length} piazzati`}
              {group.unplaced.length > 0 && ` · ${group.unplaced.length} non piazzati`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-5 shrink-0 font-mono text-xs">
          {group.format === "lastra" && group.sheetsNeeded !== undefined && (
            <div className="text-right">
              <div className="label-cap mb-0.5">Lastre</div>
              <div className="font-semibold tabular-nums text-primary">
                {group.sheetsNeeded} ×
              </div>
            </div>
          )}
          <div className="text-right">
            <div className="label-cap mb-0.5">Lunghezza</div>
            <div className="font-semibold tabular-nums">{fmtCm(group.totalLengthM)} cm</div>
          </div>
          <div className="text-right">
            <div className="label-cap mb-0.5">Sfrido</div>
            <div className={`font-semibold tabular-nums ${wasteColor}`}>{fmt(wastePct, 1)}%</div>
          </div>
          <div className="text-right">
            <div className="label-cap mb-0.5">Costo nesting</div>
            <div className="font-semibold tabular-nums">{eur(group.materialCostOptimized)}</div>
          </div>
          <div className="text-right">
            <div className="label-cap mb-0.5">Costo interno</div>
            <div className="font-semibold tabular-nums text-muted-foreground">
              {eur(group.materialCostInternal)}
            </div>
          </div>
          {group.savings > 0.005 && (
            <div className="text-right">
              <div className="label-cap mb-0.5">Risparmio</div>
              <div className="font-semibold tabular-nums text-primary inline-flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                {eur(group.savings)}
              </div>
            </div>
          )}
        </div>
      </button>
      {expanded && (
        <div className="p-4 border-t border-ink/15 bg-muted/20 space-y-3">
          <StockHintForGroup
            group={group}
            currentOverride={override}
            onApplyOverride={onOverrideChange}
            onApplyMixedBins={onMixedBinsChange}
            onPickStock={onPickStock}
            pickedStockIds={pickedStockIds}
            pickedStockLabel={pickedStockLabel}
            pickedStockConflict={pickedStockConflict}
          />
          {(group.items.length > 0 || group.unplaced.length > 0) && (
            <div className="border border-primary/40 bg-primary/5 rounded-sm p-3">
              <div className="font-mono text-sm font-bold uppercase tracking-wider text-primary mb-2 inline-flex items-center gap-1.5 justify-between w-full">
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4" />
                  Copertura pezzi
                </span>
                <span className="text-[11px] text-ink/70 normal-case tracking-normal">
                  {group.items.length > 0 && <>{new Set(group.items.map((i) => `${i.pieceId}|${i.copy}`)).size} piazzati</>}
                  {group.unplaced.length > 0 && <span className="text-destructive"> · {group.unplaced.length} non piazzati</span>}
                </span>
              </div>
              <ul className="flex flex-col gap-1.5">
                {(() => {
                  const seen = new Set<string>();
                  type Row = { pieceId: string; label: string; sheetIdx: number | null; binLabel: string; kind: string; w: number; h: number; missing?: boolean; reason?: string };
                  const rows: Row[] = [];
                  const defaultBinLabel = group.format === "lastra"
                    ? `Lastra ${fmtCm(group.sheetWidthM ?? group.rollWidthM)}×${fmtCm(group.sheetHeightM ?? 0)} cm`
                    : `Telo h ${fmtCm(group.rollWidthM)} cm`;
                  for (const it of group.items) {
                    const k = `${it.pieceId}|${it.copy}`;
                    if (seen.has(k)) continue;
                    seen.add(k);
                    const si = it.sheetIndex ?? 0;
                    const ms = group.mixedSheets?.[si];
                    rows.push({
                      pieceId: it.pieceId,
                      label: it.label,
                      sheetIdx: si,
                      binLabel: ms?.bin.label ?? defaultBinLabel,
                      kind: ms?.bin.kind === "scrap" ? "Sfrido" : "Lastra",
                      w: it.w,
                      h: it.h,
                    });
                  }
                  for (const up of group.unplaced) {
                    // dedup: se già presente come piazzato non lo mostro come mancante
                    const alreadyPlaced = rows.some((r) => r.pieceId === up.pieceId && r.label === up.label);
                    if (alreadyPlaced) continue;
                    const src = groupPieces.find((p) => p.id === up.pieceId);
                    rows.push({
                      pieceId: up.pieceId,
                      label: up.label,
                      sheetIdx: null,
                      binLabel: up.reason || "Non piazzato",
                      kind: "Mancante",
                      w: (src?.width ?? 0) / 100,
                      h: (src?.height ?? 0) / 100,
                      missing: true,
                      reason: up.reason,
                    });
                  }
                  return rows.map((r, i) => {
                    const color = r.missing ? "hsl(var(--destructive))" : colorForPiece(r.pieceId);
                    const bg = r.missing ? "hsl(var(--destructive) / 0.1)" : pieceBackground(r.pieceId);
                    return (
                      <li
                        key={i}
                        className="rounded-sm px-3 py-2 grid items-center gap-x-3 shadow-sm"
                        style={{
                          background: bg,
                          border: `1px solid ${color}`,
                          gridTemplateColumns: "minmax(70px, auto) minmax(120px, auto) 1fr",
                        }}
                      >
                        <span className={`font-mono text-sm font-bold ${r.missing ? "text-destructive" : "text-ink"}`}>{r.label}</span>
                        <span className="font-mono text-sm font-bold text-ink tabular-nums bg-background/80 px-2 py-0.5 rounded justify-self-start">
                          {r.w > 0 && r.h > 0 ? `${fmtCm(r.w)}×${fmtCm(r.h)} cm` : "— cm"}
                        </span>
                        <span className={`font-mono text-xs tabular-nums justify-self-end ${r.missing ? "text-destructive font-bold" : "text-ink"}`}>
                          {r.missing
                            ? <>⚠ {r.binLabel}</>
                            : <>→ {r.kind}{r.sheetIdx !== null && group.mixedSheets ? <> <strong>{sheetLetter(r.sheetIdx)}</strong></> : null} · {r.binLabel}</>}
                        </span>
                      </li>
                    );
                  });
                })()}
              </ul>
            </div>
          )}
          {group.format === "lastra" && group.sheetsNeeded !== undefined && group.sheetHeightM !== undefined && (
            <div className="flex items-center gap-2 px-3 py-2 border border-primary/40 bg-primary/5 rounded-sm font-mono text-[11px]">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              <span>
                Servono <span className="font-bold text-primary">{group.sheetsNeeded} lastr{group.sheetsNeeded === 1 ? "a" : "e"}</span>
                {" "}da {fmtCm(group.sheetWidthM ?? group.rollWidthM)} × {fmtCm(group.sheetHeightM)} cm per realizzare i pezzi.
              </span>
            </div>
          )}
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => setDebug((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2 py-1 border rounded-sm font-mono text-[10px] uppercase tracking-wider transition-colors ${
                debug
                  ? "border-destructive/60 bg-destructive/10 text-destructive"
                  : "border-ink/30 bg-paper text-muted-foreground hover:text-ink"
              }`}
              title="Mostra bounding box, coordinate (x,y,w,h) e sheetIndex per ogni pezzo"
            >
              <Bug className="w-3 h-3" />
              Debug nesting
            </button>
          </div>
          <GroupCanvas group={group} debug={debug} />
          {debug && (
            <div className="border border-destructive/40 rounded-sm bg-destructive/5 overflow-x-auto">
              <div className="px-3 py-1.5 border-b border-destructive/30 bg-destructive/10 font-mono text-[10px] uppercase tracking-widest text-destructive flex items-center gap-2">
                <Bug className="w-3 h-3" />
                Debug · {group.items.length} item · sheet height {group.sheetHeightM ? `${fmtCm(group.sheetHeightM)} cm` : "—"} · roll/base width {fmtCm(group.rollWidthM)} cm · totLen {fmtCm(group.totalLengthM)} cm
              </div>
              <table className="w-full font-mono text-[10px]">
                <thead className="bg-destructive/5 text-destructive/80">
                  <tr>
                    <th className="text-left px-2 py-1">label</th>
                    <th className="text-right px-2 py-1">sheetIndex</th>
                    <th className="text-right px-2 py-1">x (cm)</th>
                    <th className="text-right px-2 py-1">y (cm)</th>
                    <th className="text-right px-2 py-1">w (cm)</th>
                    <th className="text-right px-2 py-1">h (cm)</th>
                    <th className="text-right px-2 py-1">x+w</th>
                    <th className="text-right px-2 py-1">y+h</th>
                    <th className="text-left px-2 py-1">shape</th>
                    <th className="text-left px-2 py-1">rot</th>
                    <th className="text-left px-2 py-1">pieceId</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((it, idx) => {
                    const overflowW = it.x + it.w > group.rollWidthM + 1e-3;
                    const overflowH = group.sheetHeightM ? it.y + it.h > group.sheetHeightM + 1e-3 : false;
                    return (
                      <tr
                        key={`${it.pieceId}-${it.copy}-${idx}`}
                        className={`border-t border-destructive/20 ${overflowW || overflowH ? "bg-destructive/15" : ""}`}
                      >
                        <td className="px-2 py-0.5 text-ink">{it.label}</td>
                        <td className="px-2 py-0.5 text-right tabular-nums">{it.sheetIndex ?? 0}</td>
                        <td className="px-2 py-0.5 text-right tabular-nums">{fmtCm(it.x)}</td>
                        <td className="px-2 py-0.5 text-right tabular-nums">{fmtCm(it.y)}</td>
                        <td className="px-2 py-0.5 text-right tabular-nums">{fmtCm(it.w)}</td>
                        <td className="px-2 py-0.5 text-right tabular-nums">{fmtCm(it.h)}</td>
                        <td className={`px-2 py-0.5 text-right tabular-nums ${overflowW ? "font-bold text-destructive" : ""}`}>{fmtCm(it.x + it.w)}</td>
                        <td className={`px-2 py-0.5 text-right tabular-nums ${overflowH ? "font-bold text-destructive" : ""}`}>{fmtCm(it.y + it.h)}</td>
                        <td className="px-2 py-0.5">{it.shape}</td>
                        <td className="px-2 py-0.5">{it.rotated ? "↻" : "—"}</td>
                        <td className="px-2 py-0.5 text-muted-foreground truncate max-w-[120px]">{it.pieceId.slice(0, 8)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {group.unplaced.length > 0 && (
                <div className="px-3 py-1.5 border-t border-destructive/30 text-[10px] font-mono text-destructive">
                  {group.unplaced.length} non piazzati: {group.unplaced.map((u) => `${u.label} (${u.reason})`).join(" · ")}
                </div>
              )}
            </div>
          )}
          {debug && diagnostic && (
            <div className="border border-primary/40 rounded-sm bg-primary/5 overflow-x-auto">
              <div className="px-3 py-1.5 border-b border-primary/30 bg-primary/10 font-mono text-[11px] uppercase tracking-widest text-primary flex items-center gap-2">
                <Bug className="w-3 h-3" />
                Criteri selezione materiale
              </div>
              <div className="px-3 py-2 font-mono text-[11px] text-ink space-y-1">
                <div>
                  <span className="text-muted-foreground">Filtri famiglia:</span>{" "}
                  <span className="font-semibold">nome=</span>{diagnostic.filters.productName || "—"}
                  {" · "}<span className="font-semibold">colore=</span>{diagnostic.filters.color || "—"}
                  {" · "}<span className="font-semibold">ignifugo=</span>{diagnostic.filters.fireproof || "—"}
                  {" · "}<span className="font-semibold">spessore=</span>{diagnostic.filters.thickness || "—"}
                  {" · "}<span className="font-semibold">finitura=</span>{diagnostic.filters.finish || "—"}
                </div>
                {diagnostic.filters.variantIdHint && (
                  <div className="text-muted-foreground">
                    Variante suggerita dalla card: <span className="text-ink">{diagnostic.filters.variantIdHint.slice(0, 8)}</span>
                    {" — "}usata solo come riferimento pricing, non vincola il layout.
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Motivo scelta:</span> {diagnostic.chosenReason}
                </div>
                {diagnostic.notes.map((n, i) => (
                  <div key={i} className="text-destructive">⚠ {n}</div>
                ))}
              </div>
              {diagnostic.variantsConsidered.length > 0 && (
                <table className="w-full font-mono text-[10px] border-t border-primary/30">
                  <thead className="bg-primary/10 text-primary/80">
                    <tr>
                      <th className="text-left px-2 py-1">variante</th>
                      <th className="text-left px-2 py-1">formato</th>
                      <th className="text-right px-2 py-1">W×H (cm)</th>
                      <th className="text-center px-2 py-1">fit</th>
                      <th className="text-right px-2 py-1">unplaced</th>
                      <th className="text-right px-2 py-1">seam (m)</th>
                      <th className="text-right px-2 py-1">sfrido %</th>
                      <th className="text-right px-2 py-1">costo €</th>
                      <th className="text-right px-2 py-1">fogli</th>
                      <th className="text-left px-2 py-1"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {diagnostic.variantsConsidered.map((v) => (
                      <tr
                        key={v.materialId}
                        className={`border-t border-primary/20 ${v.chosen ? "bg-primary/15 font-semibold text-ink" : ""}`}
                      >
                        <td className="px-2 py-0.5">{v.materialName} {v.thickness ? `· sp.${v.thickness}` : ""} {v.finish || ""}</td>
                        <td className="px-2 py-0.5">{v.format}</td>
                        <td className="px-2 py-0.5 text-right tabular-nums">
                          {fmtCm(v.sheetWidthM)} × {fmtCm(v.sheetHeightM)}
                        </td>
                        <td className="px-2 py-0.5 text-center">{v.feasible ? "✓" : "✗"}</td>
                        <td className="px-2 py-0.5 text-right tabular-nums">{v.unplacedCount}</td>
                        <td className="px-2 py-0.5 text-right tabular-nums">{v.seamLengthM.toFixed(2)}</td>
                        <td className="px-2 py-0.5 text-right tabular-nums">{(v.wastePct * 100).toFixed(1)}</td>
                        <td className="px-2 py-0.5 text-right tabular-nums">{v.materialCostOptimized.toFixed(2)}</td>
                        <td className="px-2 py-0.5 text-right tabular-nums">{v.sheetsNeeded ?? "—"}</td>
                        <td className="px-2 py-0.5">
                          {v.chosen ? <span className="text-primary">◀ SCELTA</span> : v.selectedByUser ? <span className="text-muted-foreground">(card)</span> : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="px-3 py-1.5 border-t border-primary/30 text-[10px] text-muted-foreground">
                Ordinamento: 1) nessuna cucitura da split, 2) costo minore, 3) sfrido minore, 4) area minore.
              </div>
            </div>
          )}
          {(() => {
            // Riepilogo pezzi spezzati: aggrega per pieceId+copy il numero di pannelli (strisce)
            const splitMap = new Map<string, { label: string; panels: number; seamsPerCopy: number; stripeH: number }>();
            for (const it of group.items) {
              const m = it.label.match(/^(.*)~(\d+)\/(\d+)$/);
              if (!m) continue;
              const baseLabel = m[1];
              const totalPanels = parseInt(m[3]);
              const key = `${it.pieceId}#${it.copy}`;
              if (!splitMap.has(key)) {
                splitMap.set(key, {
                  label: baseLabel,
                  panels: totalPanels,
                  seamsPerCopy: Math.max(0, totalPanels - 1),
                  stripeH: it.h,
                });
              }
            }
            if (splitMap.size === 0) return null;
            const rows = Array.from(splitMap.values());
            const totalSeams = rows.reduce((s, r) => s + r.seamsPerCopy, 0);
            return (
              <div className="border border-ink/20 rounded-sm bg-paper p-3">
                <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
                  <Layers3 className="w-3 h-3" />
                  Pezzi spezzati · {rows.length} {rows.length === 1 ? "pezzo" : "pezzi"} · {totalSeams} cuciture verticali totali
                </div>
                <ul className="font-mono text-[11px] space-y-1">
                  {rows.map((r, i) => (
                    <li key={i} className="flex items-center justify-between gap-3">
                      <span className="truncate">
                        <span className="font-semibold text-ink">{r.label}</span>
                        <span className="text-muted-foreground"> · {r.panels} teli affiancati</span>
                      </span>
                      <span className="tabular-nums text-muted-foreground shrink-0">
                        {r.seamsPerCopy} cucitur{r.seamsPerCopy === 1 ? "a" : "e"} × {fmtCm(r.stripeH)} cm
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}
          {group.unplaced.length > 0 && (
            <div className="flex items-start gap-2 p-2 border border-destructive/40 bg-destructive/5 rounded-sm">
              <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <div className="text-xs text-destructive">
                <div className="font-semibold mb-1">{group.unplaced.length} pezzi non piazzati</div>
                <ul className="font-mono text-[11px] space-y-0.5">
                  {group.unplaced.map((u, i) => (
                    <li key={i}>· {u.label}: {u.reason}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono text-[11px]">
            <div>
              <div className="label-cap mb-0.5">Area pezzi</div>
              <div className="tabular-nums">{fmt(group.usedAreaM2)} m²</div>
            </div>
            <div>
              <div className="label-cap mb-0.5">Area telo</div>
              <div className="tabular-nums">{fmt(group.totalAreaM2)} m²</div>
            </div>
            <div>
              <div className="label-cap mb-0.5">Costo "ingenuo"</div>
              <div className="tabular-nums line-through opacity-60">{eur(group.materialCostNaive)}</div>
            </div>
            <div>
              <div className="label-cap mb-0.5">Costo nesting</div>
              <div className="tabular-nums font-semibold text-primary">{eur(group.materialCostOptimized)}</div>
            </div>
          </div>
          {(group.widthUsagePct !== undefined || (group.lengthSavedM ?? 0) > 0.005) && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono text-[11px] border-t border-dashed border-ink/15 pt-2">
              {group.widthUsagePct !== undefined && (
                <>
                  <div>
                    <div className="label-cap mb-0.5">Sfrutt. larghezza</div>
                    <div className={`tabular-nums font-semibold ${group.widthUsagePct >= 0.85 ? "text-primary" : group.widthUsagePct >= 0.6 ? "text-ink" : "text-destructive"}`}>
                      {fmt((group.widthUsagePct ?? 0) * 100, 1)}%
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      su {fmtCm(group.rollWidthM)} cm di rullo
                    </div>
                  </div>
                  <div>
                    <div className="label-cap mb-0.5">Larghezza non usata</div>
                    <div className="tabular-nums">{fmtCm(group.widthUnusedM ?? 0)} cm</div>
                    <div className="text-[10px] text-muted-foreground">media per ml</div>
                  </div>
                </>
              )}
              {(group.lengthSavedM ?? 0) > 0.005 && (
                <>
                  <div>
                    <div className="label-cap mb-0.5">Lung. "ingenua"</div>
                    <div className="tabular-nums line-through opacity-60">{fmtCm(group.naiveLengthM ?? 0)} cm</div>
                  </div>
                  <div>
                    <div className="label-cap mb-0.5">Metri risparmiati</div>
                    <div className="tabular-nums font-semibold text-primary inline-flex items-center gap-1">
                      <Sparkles className="w-3 h-3" />
                      {fmtCm(group.lengthSavedM ?? 0)} cm
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
          {(group.scrapCost > 0.005 ||
            group.minBillingExtra > 0.005 ||
            (group.seamCost ?? 0) > 0.005) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-muted-foreground border-t border-dashed border-ink/15 pt-2">
              {group.scrapCost > 0.005 && (
                <span>
                  + sfrido iniziale rotolo (150 cm × {fmtCm(group.rollWidthM)} cm × €/mq × 1,3) ={" "}
                  <span className="text-ink font-semibold">{eur(group.scrapCost)}</span>
                </span>
              )}
              {group.minBillingExtra > 0.005 && (
                <span>
                  + minimo lastra (0,5 m²) ={" "}
                  <span className="text-ink font-semibold">{eur(group.minBillingExtra)}</span>
                </span>
              )}
              {(group.seamCost ?? 0) > 0.005 && (
                <span>
                  + cuciture verticali ({fmtCm(group.seamLengthM ?? 0)} cm){" "}
                  ={" "}
                  <span className="text-ink font-semibold">{eur(group.seamCost ?? 0)}</span>
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/** Genera e fa scaricare un file .dxf (AutoCAD R12 ASCII) con TUTTI i fogli di
 *  TUTTI i gruppi, affiancati orizzontalmente. Ogni pezzo è una LWPOLYLINE
 *  chiusa + un TEXT con etichetta. Coordinate in millimetri. Y invertita per
 *  avere l'origine in basso a sinistra come nei CAM. */
/** Parsifica un DXF R12 minimale e verifica: unità mm, dimensioni lastre,
 *  margine perimetrale, spaziatura fresa tra bounding-box dei pezzi.
 *  Ritorna una lista di avvisi (vuota se tutto ok). */
const verifyDxfOutput = (
  content: string,
  groups: NestingGroup[],
  cfg: { kerfMm: number; perimeterMm: number; skipPerimeter: boolean },
): string[] => {
  const issues: string[] = [];
  const src = content.split(/\r?\n/);

  // 1) Header unità
  const idxInsUnits = src.findIndex((l) => l.trim() === "$INSUNITS");
  if (idxInsUnits < 0 || (src[idxInsUnits + 2] ?? "").trim() !== "4") {
    issues.push("$INSUNITS non è 4 (mm)");
  }

  // 2) Parse LWPOLYLINE con layer -> lista di bbox
  type Poly = { layer: string; xs: number[]; ys: number[] };
  const polys: Poly[] = [];
  for (let i = 0; i < src.length - 1; i++) {
    if (src[i].trim() === "0" && src[i + 1].trim() === "LWPOLYLINE") {
      let layer = "";
      const xs: number[] = [];
      const ys: number[] = [];
      let j = i + 2;
      while (j < src.length - 1) {
        const code = src[j].trim();
        const val = src[j + 1];
        if (code === "0") break;
        if (code === "8") layer = val.trim();
        else if (code === "10") xs.push(parseFloat(val));
        else if (code === "20") ys.push(parseFloat(val));
        j += 2;
      }
      polys.push({ layer, xs, ys });
    }
  }
  const bboxOf = (p: Poly) => ({
    minX: Math.min(...p.xs), maxX: Math.max(...p.xs),
    minY: Math.min(...p.ys), maxY: Math.max(...p.ys),
  });

  const lastre = polys.filter((p) => p.layer === "LASTRA");
  const margini = polys.filter((p) => p.layer === "MARGINE");
  const pezzi = polys.filter((p) => p.layer === "PEZZI");

  // 3) Conta lastre attese
  const expectedSheets = groups.reduce((s, g) => {
    const idxs = new Set(g.items.map((it) => it.sheetIndex ?? 0));
    return s + idxs.size;
  }, 0);
  if (lastre.length !== expectedSheets) {
    issues.push(`lastre nel DXF ${lastre.length} ≠ attese ${expectedSheets}`);
  }

  // 4) Per ogni lastra: dimensione fisica, margine, kerf tra pezzi
  const EPS = 0.5; // mm
  const M2MM = 1000;
  let sheetPtr = 0;
  for (const g of groups) {
    const bySheet = new Map<number, NestingPieceItem[]>();
    for (const it of g.items) {
      const si = it.sheetIndex ?? 0;
      if (!bySheet.has(si)) bySheet.set(si, []);
      bySheet.get(si)!.push(it);
    }
    const sheetIndices = Array.from(bySheet.keys()).sort((a, b) => a - b);
    for (const si of sheetIndices) {
      const ms = g.mixedSheets?.[si];
      const expW = (ms ? ms.widthM : g.sheetWidthM ?? g.rollWidthM) * M2MM;
      const expH = (ms ? ms.heightM : g.sheetHeightM ?? g.totalLengthM) * M2MM;
      const lastra = lastre[sheetPtr];
      if (!lastra) { sheetPtr++; continue; }
      const b = bboxOf(lastra);
      const w = b.maxX - b.minX, h = b.maxY - b.minY;
      if (Math.abs(w - expW) > EPS || Math.abs(h - expH) > EPS) {
        issues.push(`Lastra ${sheetLetter(si)}: ${w.toFixed(1)}×${h.toFixed(1)}mm ≠ ${expW.toFixed(1)}×${expH.toFixed(1)}mm`);
      }

      // pezzi dentro questa lastra (bbox contenuto)
      const inside = pezzi.filter((p) => {
        const pb = bboxOf(p);
        return pb.minX >= b.minX - EPS && pb.maxX <= b.maxX + EPS &&
               pb.minY >= b.minY - EPS && pb.maxY <= b.maxY + EPS;
      });

      // Margine perimetrale
      if (!cfg.skipPerimeter && cfg.perimeterMm > 0) {
        for (const p of inside) {
          const pb = bboxOf(p);
          const dLeft = pb.minX - b.minX;
          const dRight = b.maxX - pb.maxX;
          const dBottom = pb.minY - b.minY;
          const dTop = b.maxY - pb.maxY;
          const minD = Math.min(dLeft, dRight, dBottom, dTop);
          if (minD < cfg.perimeterMm - EPS) {
            issues.push(`Lastra ${sheetLetter(si)}: pezzo a ${minD.toFixed(1)}mm dal bordo (< margine ${cfg.perimeterMm}mm)`);
            break;
          }
        }
      }

      // Spaziatura fresa (kerf) tra bbox di pezzi che si "affrontano"
      if (cfg.kerfMm > 0 && inside.length >= 2) {
        const bbs = inside.map(bboxOf);
        let violated = false;
        for (let i = 0; i < bbs.length && !violated; i++) {
          for (let j = i + 1; j < bbs.length && !violated; j++) {
            const A = bbs[i], B = bbs[j];
            const overlapY = !(A.maxY < B.minY || B.maxY < A.minY);
            const overlapX = !(A.maxX < B.minX || B.maxX < A.minX);
            if (overlapY) {
              const gap = A.maxX <= B.minX ? B.minX - A.maxX
                        : B.maxX <= A.minX ? A.minX - B.maxX : Infinity;
              if (gap < cfg.kerfMm - EPS) {
                issues.push(`Lastra ${sheetLetter(si)}: gap orizzontale ${gap.toFixed(1)}mm < fresa ${cfg.kerfMm}mm`);
                violated = true;
              }
            }
            if (!violated && overlapX) {
              const gap = A.maxY <= B.minY ? B.minY - A.maxY
                        : B.maxY <= A.minY ? A.minY - B.maxY : Infinity;
              if (gap < cfg.kerfMm - EPS) {
                issues.push(`Lastra ${sheetLetter(si)}: gap verticale ${gap.toFixed(1)}mm < fresa ${cfg.kerfMm}mm`);
                violated = true;
              }
            }
          }
        }
      }
      sheetPtr++;
    }
  }

  // 5) Se atteso margine, verifica presenza guida MARGINE
  if (!cfg.skipPerimeter && cfg.perimeterMm > 0 && margini.length === 0 && lastre.length > 0) {
    issues.push("guida margine perimetrale assente nel DXF");
  }
  return issues;
};

export const exportNestingDxf = (
  groups: NestingGroup[],
  cfg: { kerfMm: number; perimeterMm: number; skipPerimeter: boolean },
) => {

  if (groups.length === 0) return;
  const lines: string[] = [];
  const push = (code: number | string, val: string | number) => {
    lines.push(String(code));
    lines.push(String(val));
  };
  const M2MM = 1000;
  const GAP_MM = 100;
  // Kerf effettivo in mm (spazio di taglio tra pezzi). Il packer ha già
  // riservato kerf attorno ad ogni pezzo, quindi qui disegnamo l'outline
  // reale del pezzo finito rientrando di kerf/2 sul bbox.
  const kerfMm = Math.max(0, cfg.kerfMm);
  const halfKerf = kerfMm / 2;
  const entities = () => {
    const polyClosed = (pts: [number, number][], layer: string) => {
      push(0, "LWPOLYLINE"); push(8, layer); push(70, 1); push(90, pts.length);
      for (const [x, y] of pts) { push(10, x.toFixed(3)); push(20, y.toFixed(3)); }
    };
    const text = (x: number, y: number, h: number, str: string, layer: string) => {
      push(0, "TEXT"); push(8, layer);
      push(10, x.toFixed(3)); push(20, y.toFixed(3));
      push(40, h.toFixed(3)); push(1, str.replace(/[\r\n]+/g, " "));
    };
    let cursorX = 0;
    for (const g of groups) {
      const bySheet = new Map<number, NestingPieceItem[]>();
      for (const it of g.items) {
        const si = it.sheetIndex ?? 0;
        if (!bySheet.has(si)) bySheet.set(si, []);
        bySheet.get(si)!.push(it);
      }
      const sheetIndices = Array.from(bySheet.keys()).sort((a, b) => a - b);
      for (const si of sheetIndices) {
        const ms = g.mixedSheets?.[si];
        const sw = (ms ? ms.widthM : g.sheetWidthM ?? g.rollWidthM) * M2MM;
        const sh = (ms ? ms.heightM : g.sheetHeightM ?? g.totalLengthM) * M2MM;
        const ox = cursorX, oy = 0;
        polyClosed([[ox, oy],[ox+sw, oy],[ox+sw, oy+sh],[ox, oy+sh]], "LASTRA");
        if (!cfg.skipPerimeter && cfg.perimeterMm > 0) {
          const pm = cfg.perimeterMm;
          if (sw - 2*pm > 0 && sh - 2*pm > 0) {
            polyClosed([[ox+pm, oy+pm],[ox+sw-pm, oy+pm],[ox+sw-pm, oy+sh-pm],[ox+pm, oy+sh-pm]], "MARGINE");
          }
        }
        text(ox+5, oy+sh+20, 30, `${g.material?.name ?? ""} · Lastra ${sheetLetter(si)} · ${(sw/10).toFixed(1)}×${(sh/10).toFixed(1)} cm`, "LABEL");
        for (const it of bySheet.get(si)!) {
          const bx = ox + it.x * M2MM + halfKerf;
          const byTop = oy + sh - it.y * M2MM - halfKerf;
          const w = Math.max(0.1, it.w * M2MM - kerfMm);
          const h = Math.max(0.1, it.h * M2MM - kerfMm);
          let pts: [number, number][];
          if (it.shape === "triangle") {
            pts = it.pairRole === "secondary"
              ? [[bx, byTop],[bx+w, byTop],[bx+w/2, byTop-h]]
              : [[bx+w/2, byTop],[bx+w, byTop-h],[bx, byTop-h]];
          } else if (it.shape === "trapezoid") {
            const wbM = it.widthBottomM ?? it.w;
            const ratio = wbM > 0 && it.w > 0 ? wbM / it.w : 0.6;
            const wb = w * ratio;
            const off = (w - wb) / 2;
            pts = it.pairRole === "secondary"
              ? [[bx+off, byTop],[bx+w-off, byTop],[bx+w, byTop-h],[bx, byTop-h]]
              : [[bx, byTop],[bx+w, byTop],[bx+w-off, byTop-h],[bx+off, byTop-h]];
          } else {
            pts = [[bx, byTop-h],[bx+w, byTop-h],[bx+w, byTop],[bx, byTop]];
          }
          polyClosed(pts, "PEZZI");
          const fs = Math.max(20, Math.min(w, h) / 6);
          const realWcm = (it.w * M2MM - kerfMm) / 10;
          const realHcm = (it.h * M2MM - kerfMm) / 10;
          text(bx + Math.min(20, w*0.1), byTop - Math.min(fs+5, h*0.3), fs,
            `${it.label} ${realWcm.toFixed(1)}x${realHcm.toFixed(1)}${it.rotated ? " R" : ""}`, "LABEL");
        }
        cursorX += sw + GAP_MM;
      }
    }
  };
  push(0, "SECTION");
  push(2, "HEADER");
  push(9, "$ACADVER");
  push(1, "AC1009"); // AutoCAD R12
  push(9, "$INSUNITS");
  push(70, 4); // 4 = millimeters
  push(9, "$MEASUREMENT");
  push(70, 1); // 1 = metric
  push(9, "$LUNITS");
  push(70, 2); // decimal
  push(0, "ENDSEC");
  push(0, "SECTION");
  push(2, "ENTITIES");
  entities();
  push(0, "ENDSEC");
  push(0, "EOF");

  const content = lines.join("\n");

  // === Verifica automatica del DXF prodotto ===
  // Riparsifichiamo il file per garantire che unità, misure lastra, margine
  // perimetrale e spaziatura fresa tra pezzi corrispondano ai parametri.
  const issues = verifyDxfOutput(content, groups, {
    kerfMm,
    perimeterMm: cfg.perimeterMm,
    skipPerimeter: cfg.skipPerimeter,
  });
  if (issues.length === 0) {
    toast.success("DXF verificato: unità mm, lastre e margini corretti");
  } else {
    console.warn("[DXF verify]", issues);
    toast.warning(`DXF esportato con ${issues.length} avviso/i`, {
      description: issues.slice(0, 3).join(" · "),
    });
  }

  const blob = new Blob([content], { type: "application/dxf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  a.download = `nesting-${stamp}.dxf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};


/** Apre una finestra stampabile con la scheda taglio per l'operatore.
 *  Per ogni gruppo elenca i fogli/rotoli e, foglio per foglio, i pezzi con
 *  dimensioni (cm) e posizione (x,y in cm) — così l'operatore sa DOVE
 *  tagliare ciascun pezzo su quale pannello. */
/** Esporta un PDF (A4 landscape) con il layout di taglio di ogni lastra, disegnato
 *  in scala reale (unità mm di jsPDF). Ogni lastra su una pagina, con bordo lastra,
 *  margine perimetro tratteggiato, pezzi con riferimento e misure in cm. */
export const exportNestingPdf = (
  groups: NestingGroup[],
  cfg: { kerfMm: number; perimeterMm: number },
) => {
  if (groups.length === 0) return;
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const PAGE_W = 297, PAGE_H = 210;
  const MARGIN = 12;
  const HEADER_H = 22;
  const FOOTER_H = 8;
  const now = new Date().toLocaleString("it-IT");
  let firstPage = true;

  const cm = (m: number) => (m * 100).toFixed(1);

  for (const g of groups) {
    // raggruppa per foglio
    const bySheet = new Map<number, NestingPieceItem[]>();
    for (const it of g.items) {
      const si = it.sheetIndex ?? 0;
      if (!bySheet.has(si)) bySheet.set(si, []);
      bySheet.get(si)!.push(it);
    }
    const sheetIndices = Array.from(bySheet.keys()).sort((a, b) => a - b);
    const defaultSheetW = g.sheetWidthM ?? g.rollWidthM;
    const defaultSheetH = g.sheetHeightM ?? g.totalLengthM;

    for (const si of sheetIndices) {
      const ms = g.mixedSheets?.[si];
      const sheetWmm = (ms ? ms.widthM : defaultSheetW) * 1000;
      const sheetHmm = (ms ? ms.heightM : defaultSheetH) * 1000;
      const items = bySheet.get(si)!;
      const label = ms ? `Lastra ${sheetLetter(si)} · ${ms.bin.label}` : `Lastra ${sheetLetter(si)}`;

      if (!firstPage) doc.addPage("a4", "landscape");
      firstPage = false;

      // header
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(0);
      doc.text(g.label, MARGIN, MARGIN);
      doc.setFontSize(11);
      doc.text(`${label} · ${cm(sheetWmm / 1000)} × ${cm(sheetHmm / 1000)} cm`, MARGIN, MARGIN + 6);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(80);
      doc.text(`Generato ${now} · Fresa ${cfg.kerfMm} mm · Margine perimetro ${cfg.perimeterMm.toFixed(1)} mm`, MARGIN, MARGIN + 11);

      // area disegno
      const drawX = MARGIN;
      const drawY = MARGIN + HEADER_H;
      const drawW = PAGE_W - 2 * MARGIN;
      const drawH = PAGE_H - MARGIN - drawY - FOOTER_H;
      const scale = Math.min(drawW / sheetWmm, drawH / sheetHmm);
      const sw = sheetWmm * scale;
      const sh = sheetHmm * scale;
      const ox = drawX + (drawW - sw) / 2;
      const oy = drawY + (drawH - sh) / 2;

      // bordo lastra
      doc.setDrawColor(0);
      doc.setLineWidth(0.6);
      doc.setFillColor(250, 250, 250);
      doc.rect(ox, oy, sw, sh, "FD");

      // margine perimetro tratteggiato
      if (cfg.perimeterMm > 0) {
        const m = cfg.perimeterMm * scale;
        doc.setDrawColor(245, 158, 11);
        doc.setLineWidth(0.4);
        doc.setLineDashPattern([1.5, 1], 0);
        doc.rect(ox + m, oy + m, sw - 2 * m, sh - 2 * m);
        doc.setLineDashPattern([], 0);
      }

      // pezzi
      doc.setDrawColor(0);
      doc.setLineWidth(0.35);
      items.forEach((it, i) => {
        const x = ox + it.x * 1000 * scale;
        const y = oy + it.y * 1000 * scale;
        const w = it.w * 1000 * scale;
        const h = it.h * 1000 * scale;
        doc.setFillColor(229, 231, 235);
        doc.rect(x, y, w, h, "FD");
        const cx = x + w / 2;
        const cy = y + h / 2;
        const ref = `${sheetLetter(si)}-${i + 1}`;
        const dims = `${(it.w * 100).toFixed(1)}×${(it.h * 100).toFixed(1)}`;
        const refSize = Math.max(7, Math.min(18, Math.min(w, h) / 3));
        const dimSize = Math.max(5, refSize * 0.55);
        doc.setTextColor(0);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(refSize);
        doc.text(ref, cx, cy - refSize * 0.15, { align: "center", baseline: "middle" });
        doc.setFont("helvetica", "normal");
        doc.setFontSize(dimSize);
        doc.text(dims, cx, cy + refSize * 0.55, { align: "center", baseline: "middle" });
      });

      // legenda pezzi (max 6 per pagina, sotto)
      const legendY = PAGE_H - MARGIN - FOOTER_H + 2;
      doc.setFontSize(8);
      doc.setTextColor(60);
      const legend = items
        .slice(0, 8)
        .map((it, i) => `${sheetLetter(si)}-${i + 1} ${it.label} ${cm(it.w)}×${cm(it.h)}${it.rotated ? " ↻" : ""}`)
        .join("   ");
      doc.text(legend + (items.length > 8 ? `   +${items.length - 8} altri` : ""), MARGIN, legendY);
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  doc.save(`nesting-${stamp}.pdf`);
  toast.success("PDF esportato in scala reale");
};

export const openPrintCuttingSheet = (

  groups: NestingGroup[],
  cfg: { kerfMm: number; perimeterMm: number },
) => {
  if (groups.length === 0) return;
  const cm = (m: number) => (m * 100).toLocaleString("it-IT", { maximumFractionDigits: 1 });
  const esc = (s: string) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
  const now = new Date().toLocaleString("it-IT");

  const sections = groups
    .map((g) => {
      // dimensioni "foglio" (fallback per rotolo)
      const defaultSheetW = g.sheetWidthM ?? g.rollWidthM;
      const defaultSheetH = g.sheetHeightM ?? g.totalLengthM;
      const sheets: { idx: number; label: string; wM: number; hM: number; items: NestingPieceItem[] }[] = [];
      const bySheet = new Map<number, NestingPieceItem[]>();
      for (const it of g.items) {
        const si = it.sheetIndex ?? 0;
        if (!bySheet.has(si)) bySheet.set(si, []);
        bySheet.get(si)!.push(it);
      }
      const sheetIndices = Array.from(bySheet.keys()).sort((a, b) => a - b);
      for (const si of sheetIndices) {
        const ms = g.mixedSheets?.[si];
        sheets.push({
          idx: si,
          label: ms ? `Lastra ${sheetLetter(si)} · ${ms.bin.label}` : `Lastra ${sheetLetter(si)}`,
          wM: ms ? ms.widthM : defaultSheetW,
          hM: ms ? ms.heightM : defaultSheetH,
          items: bySheet.get(si)!,
        });
      }

      const sheetsHtml = sheets
        .map((s) => {
          // SVG del layout (scale-fit in ~700px larghezza max, mantiene aspect ratio)
          const SW = s.wM, SH = s.hM;
          const maxPx = 700;
          const scale = maxPx / Math.max(SW, SH);
          const vbW = SW * 1000, vbH = SH * 1000; // in mm
          const pxW = Math.round(SW * scale * 100); // px display
          const pxH = Math.round(SH * scale * 100);
          const marginMm = cfg.perimeterMm;
          const pieceRects = s.items
            .map((it, i) => {
              const x = it.x * 1000, y = it.y * 1000, w = it.w * 1000, h = it.h * 1000;
              const cx = x + w / 2, cy = y + h / 2;
              const fs = Math.max(60, Math.min(w, h) / 8);
              const num = i + 1;
              return `
                <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#e5e7eb" stroke="#111" stroke-width="4"/>
                <text x="${cx}" y="${cy - fs*0.2}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="#111">${sheetLetter(s.idx)}-${num}</text>
                <text x="${cx}" y="${cy + fs*0.9}" text-anchor="middle" font-size="${fs*0.7}" fill="#111">${(it.w*100).toFixed(1)}×${(it.h*100).toFixed(1)}</text>`;
            })
            .join("");
          const marginRect = marginMm > 0
            ? `<rect x="${marginMm}" y="${marginMm}" width="${vbW - 2*marginMm}" height="${vbH - 2*marginMm}" fill="none" stroke="#f59e0b" stroke-width="6" stroke-dasharray="30 20"/>`
            : "";
          const svg = `
            <svg viewBox="0 0 ${vbW} ${vbH}" width="${pxW}" height="${pxH}" xmlns="http://www.w3.org/2000/svg" style="border:2px solid #111;background:#fafafa;display:block;margin:0 auto 12px;">
              ${marginRect}
              ${pieceRects}
            </svg>`;

          const rows = s.items
            .map((it, i) => `
                <tr>
                  <td class="num lbl">${sheetLetter(s.idx)}-${i+1}</td>
                  <td class="lbl">${esc(it.label)}${it.rotated ? " <span class='rot'>↻</span>" : ""}</td>
                  <td class="num">${cm(it.w)} × ${cm(it.h)} cm</td>
                  <td class="num">x=${cm(it.x)} cm</td>
                  <td class="num">y=${cm(it.y)} cm</td>
                </tr>`)
            .join("");
          return `
            <div class="sheet">
              <h3>${esc(s.label)} · ${cm(s.wM)} × ${cm(s.hM)} cm</h3>
              ${svg}
              <table>
                <thead><tr><th>Rif.</th><th>Pezzo</th><th>Dimensioni</th><th>Posizione X</th><th>Posizione Y</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>`;
        })
        .join("");
      const unplacedHtml = g.unplaced.length
        ? `<div class="warn"><strong>Pezzi NON piazzati (${g.unplaced.length}):</strong> ${g.unplaced.map((u) => `${esc(u.label)} — ${esc(u.reason)}`).join(" · ")}</div>`
        : "";
      return `
        <section class="grp">
          <h2>${esc(g.label)}</h2>
          <div class="meta">
            ${sheets.length} foglio/i · Sfrido ${(g.wastePct * 100).toFixed(1)}%
          </div>
          ${sheetsHtml}
          ${unplacedHtml}
        </section>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8" />
<title>Scheda taglio operatore</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; margin: 24px; color: #111; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 18px; margin: 24px 0 6px; border-bottom: 2px solid #111; padding-bottom: 4px; }
  h3 { font-size: 15px; margin: 16px 0 6px; background: #eee; padding: 6px 10px; border-left: 4px solid #111; }
  .info { font-size: 13px; color: #555; margin-bottom: 16px; }
  .meta { font-size: 12px; color: #444; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 8px; }
  th, td { border: 1px solid #999; padding: 6px 8px; text-align: left; }
  th { background: #111; color: #fff; font-weight: 600; }
  td.num { font-family: ui-monospace, Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; }
  td.lbl { font-weight: 700; font-family: ui-monospace, Menlo, Consolas, monospace; }
  .rot { color: #b45309; }
  .warn { margin-top: 8px; padding: 8px 12px; background: #fee2e2; color: #991b1b; border: 1px solid #f87171; font-size: 13px; }
  .grp { page-break-inside: avoid; margin-bottom: 20px; }
  .sheet { page-break-inside: avoid; }
  @media print { body { margin: 12mm; } }
</style>
</head>
<body>
  <h1>Scheda taglio operatore</h1>
  <div class="info">
    Generata il ${esc(now)} · Fresa ${cfg.kerfMm} mm · Margine perimetro effettivo ${cfg.perimeterMm.toFixed(1)} mm
  </div>
  ${sections}
  <script>window.addEventListener("load", () => setTimeout(() => window.print(), 300));</script>
</body>
</html>`;

  const w = window.open("", "_blank");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
};

/** Genera un archivio ZIP contenente UN file .labelx (DYMO Label XML v8)
 *  per ogni pezzo del nesting. Formato tape 55×25 mm. L'operatore apre i file
 *  in DYMO Connect / DYMO Label e stampa. */
/** Helpers per etichette: dimensione reale del pezzo tagliato (senza margini/kerf)
 *  e descrizione completa del materiale (nome + colore + spessore + finitura). */
const cmFactorFromUnit = (u?: string): number => (u === "m" ? 100 : u === "mm" ? 0.1 : 1);
const buildPieceLookup = (pieces: PieceLine[]) => {
  const map = new Map<string, PieceLine>();
  for (const p of pieces) map.set(p.id, p);
  return map;
};
const realPieceCm = (p: PieceLine | undefined, it: NestingPieceItem): { w: number; h: number } => {
  if (p) {
    const f = cmFactorFromUnit(p.dimUnit);
    return { w: (p.width || 0) * f, h: (p.height || 0) * f };
  }
  // fallback: usa bbox nesting (in metri) meno margini standard 4cm
  return { w: Math.max(0, it.w * 100 - 4), h: Math.max(0, it.h * 100 - 4) };
};
const materialDescription = (
  mat: CatalogMaterial | null | undefined,
  piece: PieceLine | undefined,
  fallback: string,
): string => {
  const parts: string[] = [];
  const name = mat?.name || piece?.productName || fallback;
  if (name) parts.push(name);
  const color = mat?.color || piece?.color;
  if (color) parts.push(color);
  const thick =
    (mat?.thickness && String(mat.thickness).trim()) ||
    (mat?.height && String(mat.height).trim()) ||
    (piece?.thickness && String(piece.thickness).trim()) ||
    (piece?.height && String(piece.height).trim()) ||
    "";
  if (thick) parts.push(/mm|cm/i.test(thick) ? thick : `${thick} mm`);
  const finish = mat?.finish || piece?.finish;
  if (finish) parts.push(finish);
  const fire = mat?.fireproof || piece?.fireproof;
  if (fire) parts.push(fire);
  return parts.join(" ");
};

export const openPrintDymoLabels = async (groups: NestingGroup[], pieces: PieceLine[] = []) => {
  if (groups.length === 0) return;
  const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;",
  }[c]!));
  const fmt = (v: number) => v.toLocaleString("it-IT", { maximumFractionDigits: 1 });
  const pieceMap = buildPieceLookup(pieces);

  type Label = { materiale: string; spessore: string; colore: string; dims: string };
  const labels: Label[] = [];
  for (const g of groups) {
    for (const it of g.items) {
      const piece = pieceMap.get(it.pieceId);
      const mat = g.material;
      const { w, h } = realPieceCm(piece, it);
      const materiale = mat?.name || piece?.productName || g.label;
      const rawThick =
        (mat?.thickness && String(mat.thickness).trim()) ||
        (mat?.height && String(mat.height).trim()) ||
        (piece?.thickness && String(piece.thickness).trim()) ||
        (piece?.height && String(piece.height).trim()) ||
        "";
      const spessore = rawThick ? (/mm|cm/i.test(rawThick) ? rawThick : `${rawThick} mm`) : "";
      const colore = mat?.color || piece?.color || "";
      labels.push({
        materiale,
        spessore,
        colore,
        dims: `${fmt(w)} × ${fmt(h)} cm`,
      });
    }
  }
  if (labels.length === 0) return;

  // Formato DYMO DieCutLabel v8 (twips = 1/1440 inch). Estensione .label
  // Stock 30336 (Small Multi-Purpose, 1"×2-1/8" = 25×54mm) — il più vicino ai 55×25mm.
  const buildLabelXml = (l: Label) => {
    const line1 = l.materiale;
    const line2 = [l.spessore, l.colore].filter(Boolean).join(" · ");
    const line3 = l.dims;
    const mkElement = (str: string, size: number, bold: "True" | "False") => `
        <Element>
          <String>${esc(str + "\n")}</String>
          <Attributes>
            <Font Family="Arial" Size="${size}" Bold="${bold}" Italic="False" Underline="False" Strikeout="False"/>
            <ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>
          </Attributes>
        </Element>`;
    return `<?xml version="1.0" encoding="utf-8"?>
<DieCutLabel Version="8.0" Units="twips">
  <PaperOrientation>Landscape</PaperOrientation>
  <Id>SmallMultiPurpose</Id>
  <PaperName>30336 1 in x 2-1/8 in</PaperName>
  <DrawCommands>
    <RoundRectangle X="0" Y="0" Width="1440" Height="3060" Rx="180" Ry="180"/>
  </DrawCommands>
  <ObjectInfo>
    <TextObject>
      <Name>TEXT</Name>
      <ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>
      <BackColor Alpha="0" Red="255" Green="255" Blue="255"/>
      <LinkedObjectName></LinkedObjectName>
      <Rotation>Rotation0</Rotation>
      <IsMirrored>False</IsMirrored>
      <IsVariable>False</IsVariable>
      <HorizontalAlignment>Center</HorizontalAlignment>
      <VerticalAlignment>Middle</VerticalAlignment>
      <TextFitMode>ShrinkToFit</TextFitMode>
      <UseFullFontHeight>True</UseFullFontHeight>
      <Verticalized>False</Verticalized>
      <StyledText>${mkElement(line1, 13, "True")}${mkElement(line2, 11, "False")}${mkElement(line3, 14, "True")}
      </StyledText>
    </TextObject>
    <Bounds X="150" Y="100" Width="2900" Height="1250"/>
  </ObjectInfo>
</DieCutLabel>`;
  };

  const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60);
  const labelFileName = (l: Label, i: number) =>
    safeName([l.materiale, l.spessore, l.dims, String(i + 1)].filter(Boolean).join("_"));


  const stamp = new Date().toISOString().slice(0, 10);
  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (labels.length === 1) {
    const l = labels[0];
    triggerDownload(
      new Blob([buildLabelXml(l)], { type: "application/xml" }),
      `${labelFileName(l, 0)}.label`,
    );
    return;
  }

  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  labels.forEach((l, i) => {
    zip.file(`${labelFileName(l, i)}.label`, buildLabelXml(l));
  });

  const blob = await zip.generateAsync({ type: "blob" });
  triggerDownload(blob, `etichette-nesting-${stamp}.zip`);
};

/** Esporta le etichette come CSV (prima riga = intestazioni, una colonna per ogni dato variabile). */
export const exportNestingLabelsCsv = (groups: NestingGroup[], pieces: PieceLine[] = []) => {
  if (groups.length === 0) return;
  const fmt = (v: number) => v.toLocaleString("it-IT", { maximumFractionDigits: 2 });
  const cmSheet = (m: number) => (m * 100).toLocaleString("it-IT", { maximumFractionDigits: 2 });
  const pieceMap = buildPieceLookup(pieces);
  const headers = ["Materiale", "Spessore", "Colore", "Dimensioni pezzo"];
  const rows: string[][] = [];
  for (const g of groups) {
    const sheetMat = g.material;
    for (const it of g.items) {
      const piece = pieceMap.get(it.pieceId);
      const { w, h } = realPieceCm(piece, it);
      const materiale = sheetMat?.name || piece?.productName || g.label;
      const rawThick =
        (sheetMat?.thickness && String(sheetMat.thickness).trim()) ||
        (sheetMat?.height && String(sheetMat.height).trim()) ||
        (piece?.thickness && String(piece.thickness).trim()) ||
        (piece?.height && String(piece.height).trim()) ||
        "";
      const spessore = rawThick ? (/mm|cm/i.test(rawThick) ? rawThick : `${rawThick} mm`) : "";
      const colore = sheetMat?.color || piece?.color || "";
      rows.push([
        materiale,
        spessore,
        colore,
        `${fmt(w)} × ${fmt(h)} cm`,
      ]);
    }
  }

  if (rows.length === 0) return;
  const escCsv = (v: string) => {
    const s = String(v ?? "");
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv =
    "\uFEFF" +
    [headers, ...rows].map((r) => r.map(escCsv).join(";")).join("\r\n");
  const stamp = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `etichette-nesting-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};






export const NestingPanel = ({ pieces, catalog, customerType, onPiecesChange, initialNestingState, onNestingStateChange }: Props) => {
  /** Impostazioni fresa + margine perimetrale (persistite in localStorage). */
  const [nestSettings, setNestSettings] = useLocalStorageState("nesting.settings.v1", {
    kerfMm: 0,
    perimeterMm: 10,
    skipPerimeter: false,
  });
  /** Catalogo "effettivo" con i flag di nesting: viene usato per TUTTI i calcoli
   *  del pannello, così le impostazioni fresa/margine vengono applicate ovunque. */
  const effCatalog = useMemo<Catalog>(() => ({
    ...catalog,
    __kerfMm: nestSettings.kerfMm,
    __perimeterMarginMm: nestSettings.perimeterMm,
    __skipPerimeterMargin: nestSettings.skipPerimeter,
  }), [catalog, nestSettings.kerfMm, nestSettings.perimeterMm, nestSettings.skipPerimeter]);
  const perimeterM = useMemo(() => getNestingConfig(effCatalog).perimeterM, [effCatalog]);

  const baseGroups = useMemo(
    () => computeNesting(pieces, effCatalog, customerType),
    [pieces, effCatalog, customerType],
  );
  /** Override formato per gruppo (chiave = group.key). */
  const [overrides, setOverrides] = useState<Record<string, NestingFormatOverride | null>>(
    () => initialNestingState?.overrides ?? {},
  );
  /** Bin misti per gruppo: quando presenti, hanno PRIORITÀ sull'override singolo per la preview. */
  const [mixedBinsByGroup, setMixedBinsByGroup] = useState<Record<string, NestingMixedBin[] | null>>(
    () => initialNestingState?.mixedBins ?? {},
  );
  const indexMap = useMemo(() => buildPieceIndexMap(pieces), [pieces]);
  const diagnostics = useMemo(
    () => diagnoseNesting(pieces, effCatalog, customerType),
    [pieces, effCatalog, customerType],
  );
  const diagnosticByKey = useMemo(() => {
    const m = new Map<string, NestingDiagnostic>();
    for (const d of diagnostics) m.set(d.groupKey, d);
    return m;
  }, [diagnostics]);

  // Bubbla i cambi di stato verso il padre (per persistenza nello snapshot).
  const firstSync = useRef(true);
  useEffect(() => {
    if (firstSync.current) { firstSync.current = false; return; }
    onNestingStateChange?.({ overrides, mixedBins: mixedBinsByGroup });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrides, mixedBinsByGroup]);


  /** Applico l'override (se presente) a ciascun gruppo. */
  const groups = useMemo(
    () =>
      baseGroups.map((g) => {
        const mb = mixedBinsByGroup[g.key];
        if (mb && mb.length > 0) {
          const ps = piecesOfGroup(pieces, g.key);
          return recomputeGroupWithMixedBins(g, ps, mb, indexMap, perimeterM, effCatalog);
        }
        const ov = overrides[g.key];
        if (!ov || ov.widthM <= 0 || ov.heightM <= 0) return g;
        const ps = piecesOfGroup(pieces, g.key);
        const overridden = recomputeGroupWithOverride(g, ps, effCatalog, ov, indexMap, customerType);
        // Progetti vecchi: un override "da listino" salvato prima del fix può
        // bloccare il gruppo sulla 305×205 e lasciare pezzi non piazzati, mentre
        // il ricalcolo automatico corrente trova la 600×205. In quel caso uso il
        // nuovo automatico; gli override custom e i mix manuali restano rispettati.
        if (ov.source === "catalog" && overridden.unplaced.length > 0 && g.unplaced.length === 0) return g;
        return overridden;
      }),
    [baseGroups, overrides, mixedBinsByGroup, pieces, effCatalog, customerType, indexMap, perimeterM],
  );

  /** Varianti compatibili con il gruppo (per il selettore "da listino"). */
  const variantsForGroup = (g: NestingGroup) => {
    const norm = (s: string | undefined | null) => (s ?? "").trim().toLowerCase();
    const loose = (s: string | undefined | null) => norm(s).replace(/\s+/g, "");
    return catalog.materials.filter(
      (m) =>
        g.material &&
        norm(m.name) === norm(g.material.name) &&
        norm(m.color) === norm(g.material.color) &&
        (!g.material.fireproof || norm(m.fireproof) === norm(g.material.fireproof) || !m.fireproof) &&
        (!g.material.thickness || loose(m.thickness) === loose(g.material.thickness) || !m.thickness) &&
        (!g.material.finish || norm(m.finish) === norm(g.material.finish) || !m.finish),
    );
  };

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // di default espando il primo gruppo
  const initialExpanded = useMemo(() => {
    const e: Record<string, boolean> = {};
    if (groups[0]) e[groups[0].key] = true;
    return e;
  }, [groups]);
  const isExpanded = (k: string) => expanded[k] ?? initialExpanded[k] ?? false;

  const totalLength = groups.reduce((s, g) => s + g.totalLengthM, 0);
  const totalCost = groups.reduce((s, g) => s + g.materialCostOptimized, 0);
  const totalNaive = groups.reduce((s, g) => s + g.materialCostNaive, 0);
  const totalSavings = totalNaive - totalCost;
  const totalArea = groups.reduce((s, g) => s + g.totalAreaM2, 0);
  const totalUsed = groups.reduce((s, g) => s + g.usedAreaM2, 0);
  const avgWaste = totalArea > 0 ? (1 - totalUsed / totalArea) * 100 : 0;
  const workBreak = useMemo(
    () => aggregateWorkBreakdown(pieces, catalog, customerType),
    [pieces, catalog, customerType],
  );
  const totalCutting = workBreak.taglio;
  const totalPrint = workBreak.stampa + workBreak.print;
  const totalPieces = pieces.reduce((s, p) => s + (p.quantity || 0), 0);

  return (
    <section className="panel p-6">
      <header className="flex items-start justify-between gap-6 mb-5">
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-xs text-primary font-bold tracking-widest">§03</span>
          <div>
            <h3 className="font-display text-2xl font-semibold leading-none mb-1 inline-flex items-center gap-2">
              <Layers3 className="w-5 h-5" />
              Nesting
            </h3>
            <p className="text-xs text-muted-foreground">
              Ottimizzazione del piazzamento dei pezzi sui teli (shelf packing + appaiamento triangoli/trapezi).
              Pezzi raggruppati per materiale, colore e ignifugo.
            </p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="label-cap mb-1">Costo materiale ottimizzato</div>
          <div className="font-mono text-xl font-semibold tabular-nums">{eur(totalCost)}</div>
          {totalSavings > 0.005 && (
            <div className="font-mono text-[10px] text-primary mt-0.5 inline-flex items-center gap-1 justify-end">
              <Sparkles className="w-3 h-3" />
              −{eur(totalSavings)} vs ingenuo
            </div>
          )}
        </div>
      </header>
      <div className="rule-line mb-4" />

      {/* Impostazioni operative: fresa (kerf) + margine perimetrale + stampa scheda taglio */}
      <div className="mb-5 border-2 border-ink/15 rounded-md bg-muted/20 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Settings2 className="w-4 h-4 text-primary" />
          <span className="font-display text-base font-semibold">Impostazioni taglio</span>
        </div>
        <div className="flex flex-wrap items-end gap-6">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-ink">Spazio fresa (mm)</span>
            <input
              type="number"
              min={0}
              step={0.1}
              value={nestSettings.kerfMm}
              onChange={(e) => setNestSettings((s) => ({ ...s, kerfMm: Math.max(0, Number(e.target.value) || 0) }))}
              className="w-32 h-10 px-3 border-2 border-input rounded-md bg-background text-base font-mono tabular-nums"
              title="Larghezza della fresa: lo spazio lasciato tra due pezzi adiacenti"
            />
            <span className="text-xs text-muted-foreground">Distanza fra i pezzi</span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-ink">Margine perimetro (mm)</span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={nestSettings.perimeterMm}
              disabled={nestSettings.skipPerimeter}
              onChange={(e) => setNestSettings((s) => ({ ...s, perimeterMm: Math.max(0, Number(e.target.value) || 0) }))}
              className="w-32 h-10 px-3 border-2 border-input rounded-md bg-background text-base font-mono tabular-nums disabled:opacity-40"
              title="Margine minimo sul bordo del foglio (default 10 mm). La fresa viene sempre sommata."
            />
            <span className="text-xs text-muted-foreground">
              Effettivo: {nestSettings.skipPerimeter ? "0 mm (bypass)" : `${(nestSettings.perimeterMm + nestSettings.kerfMm).toFixed(1)} mm`}
            </span>
          </label>

          <label className="flex items-center gap-2 h-10 px-3 border-2 border-input rounded-md bg-background cursor-pointer">
            <input
              type="checkbox"
              checked={nestSettings.skipPerimeter}
              onChange={(e) => setNestSettings((s) => ({ ...s, skipPerimeter: e.target.checked }))}
              className="w-5 h-5 accent-primary"
            />
            <span className="text-sm font-semibold">Bypassa margine perimetro</span>
          </label>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => exportNestingDxf(groups, { kerfMm: nestSettings.kerfMm, perimeterMm: nestSettings.perimeterMm, skipPerimeter: nestSettings.skipPerimeter })}
              disabled={groups.length === 0}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-md border-2 border-primary text-primary font-semibold text-base hover:bg-primary/10 disabled:opacity-40"
              title="Scarica un file DXF (mm, scala reale) importabile in Aspire / VCarve / AutoCAD"
            >
              <Download className="w-4 h-4" />
              Esporta DXF (Aspire/CAM)
            </button>

            <button
              type="button"
              onClick={() => openPrintCuttingSheet(groups, { kerfMm: nestSettings.kerfMm, perimeterMm: nestSettings.skipPerimeter ? 0 : nestSettings.perimeterMm + nestSettings.kerfMm })}
              disabled={groups.length === 0}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-primary text-primary-foreground font-semibold text-base hover:bg-primary/90 disabled:opacity-40"
              title="Apre una scheda stampabile con la posizione di taglio di ogni pezzo su ogni foglio"
            >
              <Printer className="w-4 h-4" />
              Stampa scheda taglio operatore
            </button>
            <button
              type="button"
              onClick={() => openPrintDymoLabels(groups, pieces)}
              disabled={groups.length === 0}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-md border-2 border-primary text-primary font-semibold text-base hover:bg-primary/10 disabled:opacity-40"
              title="Scarica un file .label (DYMO) per ogni pezzo — stock 30336 (25×54 mm)"

            >
              <Download className="w-4 h-4" />
              Scarica etichette .label

            </button>
            <button
              type="button"
              onClick={() => exportNestingLabelsCsv(groups, pieces)}
              disabled={groups.length === 0}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-md border-2 border-primary text-primary font-semibold text-base hover:bg-primary/10 disabled:opacity-40"
              title="Esporta CSV con una riga per etichetta (intestazioni in prima riga)"
            >
              <Download className="w-4 h-4" />
              Esporta etichette CSV
            </button>
          </div>
        </div>
      </div>

      <WarehousePlanner
        groups={groups}
        catalog={catalog}
        onApplyAllMixedBins={(byGroup) => setMixedBinsByGroup((prev) => ({ ...prev, ...byGroup }))}
      />

      {groups.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Aggiungi pezzi con dimensioni e tipo prodotto per visualizzare il nesting.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 font-mono text-xs">
            <div>
              <div className="label-cap mb-0.5">Materiale</div>
              <div className="font-semibold tabular-nums text-base">{eur(totalCost)}</div>
            </div>
            <div>
              <div className="label-cap mb-0.5">Stampa</div>
              <div className={`font-semibold tabular-nums text-base ${totalPrint > 0 ? "text-ink" : "text-muted-foreground"}`}>
                {eur(totalPrint)}
              </div>
            </div>
            <div>
              <div className="label-cap mb-0.5">Taglio</div>
              <div className={`font-semibold tabular-nums text-base ${totalCutting > 0 ? "text-ink" : "text-muted-foreground"}`}>
                {eur(totalCutting)}
              </div>
            </div>
            <div>
              <div className="label-cap mb-0.5">Nr. pezzi</div>
              <div className="font-semibold tabular-nums text-base">{totalPieces}</div>
            </div>
          </div>
          <div className="space-y-3">
            {groups.map((g) => {
              const groupPieces = piecesOfGroup(pieces, g.key);
              const pickedRows = groupPieces.filter((p) => !!p.pickedStockId);
              const pickedIds = Array.from(new Set(pickedRows.map((p) => `${p.pickedStockKind ?? ""}:${p.pickedStockId ?? ""}`)));
              const pickedLabels = Array.from(new Set(pickedRows.map((p) => p.pickedStockLabel).filter(Boolean))) as string[];
              return (
                <GroupSummary
                  key={g.key}
                  group={g}
                  groupPieces={groupPieces}
                  expanded={isExpanded(g.key)}
                  onToggle={() => setExpanded((prev) => ({ ...prev, [g.key]: !isExpanded(g.key) }))}
                  variants={variantsForGroup(g)}
                  override={overrides[g.key] ?? null}
                  onOverrideChange={(o) =>
                    setOverrides((prev) => ({ ...prev, [g.key]: o }))
                  }
                  onMixedBinsChange={(b) =>
                    setMixedBinsByGroup((prev) => ({ ...prev, [g.key]: b }))
                  }
                  onPickStock={onPiecesChange ? (pick) => {
                    const groupRows = piecesOfGroup(pieces, g.key);
                    const existingDifferent = groupRows.filter(
                      (p) => p.pickedStockId && (p.pickedStockKind !== pick.kind || p.pickedStockId !== pick.id),
                    );
                    if (existingDifferent.length > 0) {
                      const ok = window.confirm(
                        `Questo gruppo ha già ${existingDifferent.length} pezzo/i agganciati a una scelta diversa. Vuoi sovrascrivere l'aggancio per tutto il gruppo?`,
                      );
                      if (!ok) {
                        toast.warning("Aggancio annullato: scelta diversa già presente nel gruppo");
                        return false;
                      }
                    }
                    const ids = new Set(groupRows.map((p) => p.id));
                    const next = pieces.map((p) =>
                      ids.has(p.id)
                        ? {
                            ...p,
                            pickedStockKind: pick.kind,
                            pickedStockId: pick.id,
                            pickedStockLabel: pick.label,
                          }
                        : p,
                    );
                    onPiecesChange(next);
                    return true;
                  } : undefined}
                  pickedStockIds={pickedIds}
                  pickedStockLabel={pickedLabels.join(" + ") || null}
                  pickedStockConflict={pickedIds.length > 1}
                  diagnostic={diagnosticByKey.get(g.key)}
                />
              );
            })}
          </div>
          <div className="mt-4 pt-3 border-t border-dashed border-ink/15 font-mono text-[10px] text-muted-foreground">
            Algoritmo: Shelf / First-Fit Decreasing su bounding-box con margini di lavorazione (+{10} cm × +{20} cm).
            Triangoli e trapezi identici vengono appaiati per dimezzare lo sfrido. La rotazione 90° viene
            applicata solo ai pezzi con "Ruota tessuto" attivo.
          </div>
        </>
      )}
    </section>
  );
};