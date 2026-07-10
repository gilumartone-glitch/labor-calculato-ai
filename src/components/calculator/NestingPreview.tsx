import { useMemo } from "react";
import { Layers3, Download, Printer, Tag } from "lucide-react";
import { Catalog, PieceLine } from "./types";
import {
  computeNesting,
  NestingGroup,
  NestingPieceItem,
  NESTING_SAFETY_BORDER_CM,
  NestingMixedBin,
  NestingFormatOverride,
  recomputeGroupWithMixedBins,
  recomputeGroupWithOverride,
  buildPieceIndexMap,
  piecesOfGroup,
} from "@/lib/nesting";
import { useProdStore } from "@/lib/produzione/store";
import { mmToCm, mToCm } from "@/lib/fmt";
import { exportNestingDxf, openPrintCuttingSheet, openPrintDymoLabels } from "./NestingPanel";
import { useLocalStorageState } from "@/hooks/useLocalStorageState";

/**
 * Componente READ-ONLY che mostra il nesting di una lista di pezzi:
 *  - SVG di ogni lastra/sfrido usato (mixed o uniforme)
 *  - Elenco testuale "Lastre & sfridi usati"
 *  - "Copertura pezzi": per ogni pezzo, in quale bin è stato collocato.
 *
 * Usato nel modulo Produzione (Flow Board → dialog dettaglio / completamento).
 */

const fmt = (n: number, d = 2) =>
  n.toLocaleString("it-IT", { maximumFractionDigits: d, minimumFractionDigits: d });

const fmtCm = (m: number) => mToCm(m);

const materialMetaLabel = (group: NestingGroup) =>
  [
    group.material?.thickness ? `sp. ${group.material.thickness}` : null,
    group.material?.finish || null,
  ].filter(Boolean).join(" · ");

const colorForPiece = (id: string): string => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${h} 70% 55%)`;
};

const SheetSvg = ({
  group,
  sheetWidthM,
  sheetHeightM,
  sheetItems,
  label,
  maxW,
  maxH,
  fixedScale,
}: {
  group: NestingGroup;
  sheetWidthM: number;
  sheetHeightM: number;
  sheetItems: NestingPieceItem[];
  label: string;
  maxW: number;
  maxH: number;
  fixedScale?: number;
}) => {
  const PAD = 12;
  const scaleW = (maxW - PAD * 2) / sheetWidthM;
  const scaleH = (maxH - PAD * 2) / sheetHeightM;
  const scale = fixedScale ?? Math.min(scaleW, scaleH);
  const innerW = sheetWidthM * scale;
  const innerH = sheetHeightM * scale;
  const W = innerW + PAD * 2;
  const H = innerH + PAD * 2;
  // Bordo di sicurezza in pixel (2 cm per lato → riduce la forma reale interna).
  const safetyPx = (NESTING_SAFETY_BORDER_CM / 100) * scale;

  return (
    <div className="flex flex-col items-center gap-1 shrink-0">
      <div className="font-mono text-[10px] font-semibold text-primary uppercase tracking-widest text-center max-w-[500px]">
        {label}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: W, height: H }} className="block">
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
        <text x={PAD + innerW / 2} y={PAD - 3} textAnchor="middle" className="fill-muted-foreground" fontFamily="ui-monospace, monospace" fontSize={8}>
          {fmtCm(sheetWidthM)} cm
        </text>
        <text
          x={PAD - 6}
          y={PAD + innerH / 2}
          textAnchor="middle"
          className="fill-muted-foreground"
          fontFamily="ui-monospace, monospace"
          fontSize={8}
          transform={`rotate(-90 ${PAD - 6} ${PAD + innerH / 2})`}
        >
          {fmtCm(sheetHeightM)} cm
        </text>
        {sheetItems.map((it, idx) => {
          const x = PAD + it.x * scale;
          const y = PAD + it.y * scale;
          const w = it.w * scale;
          const h = it.h * scale;
          const color = colorForPiece(it.pieceId);
          // Forma reale (senza il bordo di sicurezza): rettangolo interno di
          // safetyPx px su tutti i lati. Per triangle/trapezoid disegniamo la
          // forma piena come prima (la geometria già conteggia margini), ma
          // sovrapponiamo il rettangolo tratteggiato di sicurezza attorno.
          const ix = x + safetyPx;
          const iy = y + safetyPx;
          const iw = Math.max(0, w - safetyPx * 2);
          const ih = Math.max(0, h - safetyPx * 2);
          let shape: JSX.Element;
          if (it.shape === "triangle") {
            const points =
              it.pairRole === "secondary"
                ? `${ix},${iy} ${ix + iw},${iy} ${ix + iw / 2},${iy + ih}`
                : `${ix + iw / 2},${iy} ${ix + iw},${iy + ih} ${ix},${iy + ih}`;
            shape = <polygon points={points} fill={color} fillOpacity={0.45} stroke={color} strokeWidth={1} />;
          } else if (it.shape === "trapezoid") {
            const wbM = it.widthBottomM ?? it.w;
            const ratio = wbM > 0 && it.w > 0 ? wbM / it.w : 0.6;
            const wb = iw * ratio;
            const off = (iw - wb) / 2;
            const points =
              it.pairRole === "secondary"
                ? `${ix + off},${iy} ${ix + iw - off},${iy} ${ix + iw},${iy + ih} ${ix},${iy + ih}`
                : `${ix},${iy} ${ix + iw},${iy} ${ix + iw - off},${iy + ih} ${ix + off},${iy + ih}`;
            shape = <polygon points={points} fill={color} fillOpacity={0.45} stroke={color} strokeWidth={1} />;
          } else {
            shape = <rect x={ix} y={iy} width={iw} height={ih} fill={color} fillOpacity={0.5} stroke={color} strokeWidth={1} />;
          }
          return (
            <g key={`${it.pieceId}-${it.copy}-${idx}`}>
              {shape}
              {/* Bordo di sicurezza 2 cm per lato (tratteggiato) */}
              {safetyPx > 0.5 && (
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  fill="none"
                  stroke={color}
                  strokeWidth={0.6}
                  strokeDasharray="2 2"
                  strokeOpacity={0.7}
                  pointerEvents="none"
                />
              )}
              {w > 24 && h > 12 && (
                <text
                  x={ix + iw / 2}
                  y={iy + ih / 2 + 3}
                  textAnchor="middle"
                  fontFamily="ui-monospace, monospace"
                  fontSize={Math.min(9, Math.max(7, ih / 4))}
                  fontWeight={700}
                  className="fill-ink"
                  pointerEvents="none"
                >
                  {it.label}{it.rotated ? "↻" : ""}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
};

const GroupCanvas = ({ group }: { group: NestingGroup }) => {
  const { rollWidthM, totalLengthM, items } = group;
  if (rollWidthM <= 0 || totalLengthM <= 0) return null;
  const isLastra = group.format === "lastra";

  // Bin eterogenei
  if (isLastra && group.mixedSheets && group.mixedSheets.length > 0) {
    const allMixed = group.mixedSheets;
    const allBySheet: NestingPieceItem[][] = Array.from({ length: allMixed.length }, () => []);
    for (const it of items) {
      const si = Math.min(allMixed.length - 1, Math.max(0, it.sheetIndex ?? 0));
      allBySheet[si].push(it);
    }
    const visibleIdx = allMixed.map((_, i) => i).filter((i) => allBySheet[i] && allBySheet[i].length > 0);
    const mixed = visibleIdx.map((i) => allMixed[i]);
    const bySheet = visibleIdx.map((i) => allBySheet[i]);
    if (mixed.length === 0) return null;
    // Scala adattiva: ogni bin viene mostrato grande abbastanza per essere leggibile.
    // Lastre intere ~280 px/m; sfridi piccoli scalati per riempire un'altezza minima.
    const PAD = 14;
    const GAP = 20;
    const baseScale = 280; // px per metro
    const minSidePx = 220; // dimensione minima del lato corto di ogni bin
    const maxScale = 1400; // px/m massimo per evitare bin enormi su sfridi micro
    return (
      <div>
        <div className="flex flex-wrap items-start justify-center" style={{ gap: GAP }}>
          {bySheet.map((sheetItems, idx) => {
            const ms = mixed[idx];
            const kindLabel = ms.bin.kind === "scrap" ? "Sfrido" : "Lastra";
            const minSide = Math.max(0.001, Math.min(ms.widthM, ms.heightM));
            const scale = Math.min(maxScale, Math.max(baseScale, minSidePx / minSide));
            return (
              <SheetSvg
                key={`mix-${idx}`}
                group={group}
                sheetWidthM={ms.widthM}
                sheetHeightM={ms.heightM}
                sheetItems={sheetItems}
                label={`${kindLabel} ${idx + 1}/${mixed.length} · ${ms.bin.label}`}
                maxW={ms.widthM * scale + PAD * 2}
                maxH={ms.heightM * scale + PAD * 2}
                fixedScale={scale}
              />
            );
          })}
        </div>
      </div>
    );
  }

  // Lastre uniformi
  if (isLastra) {
    const sheetW = group.sheetWidthM ?? rollWidthM;
    const sheetH = group.sheetHeightM ?? 0;
    const sheetsCount = Math.max(1, group.sheetsNeeded ?? 1);
    if (sheetH <= 0) return null;
    const bySheet: NestingPieceItem[][] = Array.from({ length: sheetsCount }, () => []);
    for (const it of items) {
      const si = Math.min(sheetsCount - 1, Math.max(0, it.sheetIndex ?? 0));
      bySheet[si].push(it);
    }
    // Scala fissa: lastre disegnate grandi e leggibili. Se non entrano in una riga,
    // il flex-wrap le manda automaticamente a capo (anche su più righe verticali).
    const PAD = 14;
    const sharedScale = 160; // px/m
    const GAP = 16;
    return (
      <div>
        <div className="flex flex-wrap items-start justify-center" style={{ gap: GAP }}>
          {bySheet.map((sheetItems, idx) => (
            <SheetSvg
              key={`sh-${idx}`}
              group={group}
              sheetWidthM={sheetW}
              sheetHeightM={sheetH}
              sheetItems={sheetItems}
              label={`Lastra ${idx + 1} / ${sheetsCount}`}
              maxW={sheetW * sharedScale + PAD * 2}
              maxH={sheetH * sharedScale + PAD * 2}
              fixedScale={sharedScale}
            />
          ))}
        </div>
      </div>
    );
  }

  // Rotolo: lunghezza in orizzontale, altezza tessuto in verticale.
  const PAD = 18;
  const MAX_W = 480;
  const MAX_H = 260;
  const scaleW = (MAX_W - PAD * 2) / totalLengthM;
  const scaleH = (MAX_H - PAD * 2) / rollWidthM;
  const scale = Math.min(scaleW, scaleH);
  const innerW = totalLengthM * scale;
  const innerH = rollWidthM * scale;
  const W = innerW + PAD * 2;
  const H = innerH + PAD * 2;
  return (
    <div className="border border-ink/15 rounded-sm bg-paper overflow-hidden">
      <div className="px-3 py-1.5 border-b border-ink/15 bg-muted/30 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Telo · {fmtCm(totalLengthM)} × h {fmtCm(rollWidthM)} cm
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-auto max-h-[280px] mx-auto" preserveAspectRatio="xMidYMid meet" style={{ aspectRatio: `${W} / ${H}` }}>
        <rect x={PAD} y={PAD} width={innerW} height={innerH} fill="hsl(var(--background))" stroke="currentColor" strokeWidth={1.2} className="text-ink/40" />
        {items.map((it, idx) => {
          const x = PAD + it.y * scale;
          const y = PAD + it.x * scale;
          const w = it.h * scale;
          const h = it.w * scale;
          const color = colorForPiece(it.pieceId);
          return (
            <g key={`${it.pieceId}-${it.copy}-${idx}`}>
              <rect x={x} y={y} width={w} height={h} fill={color} fillOpacity={0.4} stroke={color} strokeWidth={1} />
              {w > 28 && h > 14 && (
                <text x={x + w / 2} y={y + h / 2 + 3} textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize={Math.min(10, Math.max(7, h / 4))} fontWeight={700} className="fill-ink">
                  {it.label}{it.rotated ? "↻" : ""}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
};

/** Riepilogo testuale: lastre/sfridi usati + copertura per pezzo. */
const GroupTextSummary = ({ group }: { group: NestingGroup }) => {
  const isLastra = group.format === "lastra";

  // Bin usati (etichetta + dimensioni cm)
  const binsUsed: { label: string; kind: string; widthM: number; heightM: number; pieces: NestingPieceItem[] }[] = useMemo(() => {
    if (isLastra && group.mixedSheets && group.mixedSheets.length > 0) {
      const bySheet: NestingPieceItem[][] = Array.from({ length: group.mixedSheets.length }, () => []);
      for (const it of group.items) {
        const si = Math.min(group.mixedSheets.length - 1, Math.max(0, it.sheetIndex ?? 0));
        bySheet[si].push(it);
      }
      return group.mixedSheets
        .map((ms, i) => ({
          label: ms.bin.label,
          kind: ms.bin.kind === "scrap" ? "Sfrido" : "Lastra",
          widthM: ms.widthM,
          heightM: ms.heightM,
          pieces: bySheet[i] ?? [],
        }))
        .filter((b) => b.pieces.length > 0);
    }
    if (isLastra) {
      const sheetW = group.sheetWidthM ?? group.rollWidthM;
      const sheetH = group.sheetHeightM ?? 0;
      const n = Math.max(1, group.sheetsNeeded ?? 1);
      const bySheet: NestingPieceItem[][] = Array.from({ length: n }, () => []);
      for (const it of group.items) {
        const si = Math.min(n - 1, Math.max(0, it.sheetIndex ?? 0));
        bySheet[si].push(it);
      }
      return bySheet.map((pieces, i) => ({
        label: `Lastra intera #${i + 1}`,
        kind: "Lastra",
        widthM: sheetW,
        heightM: sheetH,
        pieces,
      }));
    }
    // rotolo
    return [{
      label: `Rotolo h ${fmtCm(group.rollWidthM)} cm`,
      kind: "Rotolo",
      widthM: group.rollWidthM,
      heightM: group.totalLengthM,
      pieces: group.items,
    }];
  }, [group, isLastra]);

  // Copertura pezzi: con dimensioni base × altezza in cm (bbox usato dal nesting)
  const coverage: { label: string; binLabel: string; binKind: string; dimLabel: string }[] = useMemo(() => {
    const out: { label: string; binLabel: string; binKind: string; dimLabel: string }[] = [];
    for (const bin of binsUsed) {
      for (const it of bin.pieces) {
        // it.w/it.h sono in metri (bbox con margini, eventualmente ruotato).
        // Per la "vera" misura del pezzo mostriamo le dimensioni non ruotate.
        const baseM = it.rotated ? it.h : it.w;
        const altM = it.rotated ? it.w : it.h;
        const dimLabel = `${fmtCm(baseM)}×${fmtCm(altM)} cm`;
        out.push({ label: it.label, binLabel: bin.label, binKind: bin.kind, dimLabel });
      }
    }
    return out.sort((a, b) => a.label.localeCompare(b.label, "it", { numeric: true }));
  }, [binsUsed]);

  return (
    <div className="space-y-2">
      {/* Lastre/sfridi usati */}
      <div>
        <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground mb-1">
          Lastre & sfridi usati ({binsUsed.length})
        </div>
        <ul className="space-y-0.5">
          {binsUsed.map((b, i) => (
            <li key={i} className="text-[11px] flex items-center justify-between gap-2 py-1 px-2 bg-muted/30 rounded-sm">
              <span className="font-mono">
                <span className={`inline-block px-1.5 py-0.5 rounded-sm text-[9px] uppercase mr-1.5 font-bold ${b.kind === "Sfrido" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                  {b.kind}
                </span>
                {b.label}
              </span>
              <span className="font-mono text-muted-foreground">
                {fmtCm(b.widthM)}×{fmtCm(b.heightM)} cm · {b.pieces.length} pz
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Copertura pezzi */}
      {coverage.length > 0 && (
        <div>
          <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground mb-1">
            Copertura pezzi ({coverage.length})
          </div>
          <ul className="space-y-0.5">
            {coverage.map((c, i) => (
              <li key={i} className="text-[11px] flex items-center justify-between gap-2 py-0.5 px-2">
                <span className="font-mono">
                  <span className="font-bold">{c.label}</span>
                  <span className="text-muted-foreground ml-2">{c.dimLabel}</span>
                </span>
                <span className="text-muted-foreground">
                  → <span className={`text-[9px] uppercase font-bold mr-1 ${c.binKind === "Sfrido" ? "text-amber-700" : "text-emerald-700"}`}>{c.binKind}</span>
                  <span className="font-mono">{c.binLabel}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

type Props = {
  pieces: PieceLine[];
  catalog: Catalog | null | undefined;
  /** Titolo opzionale (default "Nesting"). */
  title?: string;
  /** Mostra solo grafico (no riepilogo). */
  graphicOnly?: boolean;
  /** Mostra solo riepilogo testuale (no grafico). */
  textOnly?: boolean;
  /** Stato di nesting salvato nel preventivo (override formato + bin misti per gruppo).
   *  Quando presente ha PRIORITÀ sulla logica pickedStockId, così la produzione
   *  vede ESATTAMENTE il nesting deciso dal progettista nel calcolatore. */
  nestingState?: {
    overrides?: Record<string, NestingFormatOverride | null>;
    mixedBins?: Record<string, NestingMixedBin[] | null>;
  };
  customerType?: any;
};

/**
 * Calcola e mostra il nesting per i pezzi passati.
 * Da usare nel modulo Produzione (read-only).
 */
export const NestingPreview = ({ pieces, catalog, title = "Nesting", graphicOnly, textOnly, nestingState, customerType }: Props) => {
  const { inventory, scraps } = useProdStore();
  const [nestSettings] = useLocalStorageState("nesting.settings.v1", {
    kerfMm: 0,
    perimeterMm: 10,
    skipPerimeter: false,
  });
  const exportCfg = {
    kerfMm: nestSettings.kerfMm,
    perimeterMm: nestSettings.skipPerimeter ? 0 : nestSettings.perimeterMm + nestSettings.kerfMm,
  };
  const dxfCfg = {
    kerfMm: nestSettings.kerfMm,
    perimeterMm: nestSettings.perimeterMm,
    skipPerimeter: nestSettings.skipPerimeter,
  };

  const groups = useMemo(() => {
    if (!catalog || !pieces.length) return [] as NestingGroup[];
    try {
      const base = computeNesting(pieces, catalog, customerType);
      const indexMap = buildPieceIndexMap(pieces);
      return base.map((g) => {
        const groupPieces = piecesOfGroup(pieces, g.key);

        // 1) PRIORITÀ MASSIMA: stato salvato nel preventivo (mixedBins → poi override formato).
        const savedMixed = nestingState?.mixedBins?.[g.key];
        if (savedMixed && savedMixed.length > 0) {
          return recomputeGroupWithMixedBins(g, groupPieces, savedMixed, indexMap);
        }
        const savedOv = nestingState?.overrides?.[g.key];
        if (savedOv && savedOv.widthM > 0 && savedOv.heightM > 0) {
          const overridden = recomputeGroupWithOverride(g, groupPieces, catalog, savedOv, indexMap, customerType);
          if (savedOv.source === "catalog" && overridden.unplaced.length > 0 && g.unplaced.length === 0) return g;
          return overridden;
        }

        // 2) Fallback storico: ricostruisci dai pickedStockId dei pezzi (vecchi ordini senza nestingState).
        const tokens: { kind: "item" | "scrap"; id: string }[] = [];
        for (const p of groupPieces) {
          if (!p.pickedStockId) continue;
          const ids = String(p.pickedStockId).split(",").map((s) => s.trim()).filter(Boolean);
          for (const raw of ids) {
            const m = raw.match(/^(item|scrap):(.+)$/);
            if (m) {
              tokens.push({ kind: m[1] as "item" | "scrap", id: m[2] });
            } else if (p.pickedStockKind === "item" || p.pickedStockKind === "scrap") {
              tokens.push({ kind: p.pickedStockKind, id: raw });
            }
          }
        }
        if (tokens.length === 0) return g;
        const seen = new Set<string>();
        const bins: NestingMixedBin[] = [];
        for (const t of tokens) {
          const key = `${t.kind}:${t.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (t.kind === "scrap") {
            const s = scraps.find((x) => x.id === t.id);
            if (!s) continue;
            bins.push({
              kind: "scrap",
              id: s.id,
              widthM: s.w_mm / 1000,
              heightM: s.h_mm / 1000,
              label: `Sfrido ${s.code} ${mmToCm(s.w_mm)}×${mmToCm(s.h_mm)} cm`,
            });
          } else {
            const i = inventory.find((x) => x.id === t.id);
            if (!i) continue;
            const a = (i.material_attrs ?? {}) as any;
            let w = Number(a.base_mm ?? a.width_mm ?? a.w_mm ?? 0);
            let h = Number(a.height_mm ?? a.h_mm ?? 0);
            if (!(w > 0 && h > 0)) {
              const u = String(a.dimUnit ?? a.heightUnit ?? "cm").toLowerCase();
              const mul = u === "m" ? 1000 : u === "mm" ? 1 : 10;
              const bRaw = parseFloat(String(a.baseWidth ?? "").replace(",", "."));
              const hRaw = parseFloat(String(i.material_height ?? a.height ?? "").replace(",", "."));
              if (bRaw > 0 && hRaw > 0) { w = bRaw * mul; h = hRaw * mul; }
            }
            if (!(w > 0 && h > 0)) continue;
            bins.push({
              kind: "sheet",
              id: i.id,
              widthM: w / 1000,
              heightM: h / 1000,
              label: `Lastra ${i.code} ${mmToCm(w)}×${mmToCm(h)} cm`,
            });
          }
        }
        if (bins.length === 0) return g;
        return recomputeGroupWithMixedBins(g, groupPieces, bins, indexMap);
      });
    } catch {
      return [];
    }
  }, [pieces, catalog, inventory, scraps, nestingState, customerType]);

  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="border-2 border-primary/40 rounded-sm bg-primary/[0.02] p-3 space-y-4">
      <div className="font-mono text-[10px] uppercase tracking-widest text-primary flex items-center gap-1.5 pb-2 border-b-2 border-primary/30">
        <Layers3 className="w-3.5 h-3.5" /> {title}
        <span className="ml-auto text-muted-foreground normal-case tracking-normal text-[11px]">
          {groups.length} {groups.length === 1 ? "materiale" : "materiali"}
        </span>
      </div>

      {/* Toolbar operatore: PDF nesting, scheda taglio stampabile, etichette Dymo */}
      <div className="flex flex-wrap items-center gap-2 -mt-2">
        <button
          type="button"
          onClick={() => exportNestingDxf(groups, dxfCfg)}
          disabled={groups.length === 0}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-md border-2 border-primary text-primary font-semibold text-sm hover:bg-primary/10 disabled:opacity-40"
          title="Scarica il file DXF (mm) importabile in Aspire / VCarve / AutoCAD"
        >
          <Download className="w-4 h-4" /> Scarica DXF (Aspire/CAM)
        </button>

        <button
          type="button"
          onClick={() => openPrintCuttingSheet(groups, exportCfg)}
          disabled={groups.length === 0}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-40"
          title="Apre la scheda taglio con disegno e lista pezzi per ogni foglio"
        >
          <Printer className="w-4 h-4" /> Stampa lista di taglio
        </button>
        <button
          type="button"
          onClick={() => openPrintDymoLabels(groups)}
          disabled={groups.length === 0}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-md border-2 border-primary text-primary font-semibold text-sm hover:bg-primary/10 disabled:opacity-40"
          title="Scarica un file .labelx (DYMO Connect) per ogni pezzo — 55×25 mm"
        >
          <Tag className="w-4 h-4" /> Scarica etichette .labelx

        </button>
      </div>
      {groups.map((g, idx) => (
        <section
          key={g.key + idx}
          className="rounded-sm border border-ink/20 bg-background overflow-hidden"
        >
          <header className="flex items-center justify-between flex-wrap gap-2 px-3 py-2 bg-ink/5 border-b border-ink/15">
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-sm bg-primary text-primary-foreground font-mono text-[11px] font-bold shrink-0">
                {idx + 1}
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold leading-tight truncate">
                  {g.material?.name ?? g.label}
                  {g.material?.color ? (
                    <span className="text-muted-foreground font-normal"> · {g.material.color}</span>
                  ) : null}
                </div>
                {materialMetaLabel(g) && (
                  <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
                    {materialMetaLabel(g)}
                  </div>
                )}
              </div>
            </div>
            <div className="font-mono text-[10px] text-muted-foreground flex items-center gap-2">
              <span>area pezzi: <strong className="text-ink">{fmt(g.usedAreaM2)} m²</strong></span>
              <span className="text-ink/30">·</span>
              <span>sfrido: <strong className="text-ink">{fmt(g.wastePct * 100, 1)}%</strong></span>
            </div>
          </header>
          <div className="p-3 space-y-2">
            {!textOnly && <GroupCanvas group={g} />}
            {!graphicOnly && <GroupTextSummary group={g} />}
          </div>
        </section>
      ))}
    </div>
  );
};