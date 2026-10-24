import type { Catalog, DepartmentState, PieceLine } from "@/components/calculator/types";
import type { CustomerType } from "./pricing";
import { pieceTotal, pieceWorkBreakdown } from "./piece";
import { withoutInitialScrap } from "./piece-catalog";
import {
  buildPieceIndexMap, computeNesting, getNestingConfig, piecesOfGroup,
  recomputeGroupWithMixedBins, recomputeGroupWithOverride,
} from "./nesting";

/** Same saved layout, margins and fabric allocation as the upholstery cards. */
export const upholsteryPiecesTotal = (
  state: DepartmentState,
  catalog: Catalog,
  customer?: CustomerType,
): number => {
  const pieces = state.pieces ?? [];
  const settings = state.nestingState?.settings;
  const effectiveCatalog: Catalog = {
    ...withoutInitialScrap(catalog),
    __kerfMm: settings?.kerfMm ?? 0,
    __perimeterMarginMm: settings?.perimeterMm ?? 10,
    __skipPerimeterMargin: !!settings?.skipPerimeter,
    __forceSinglePiece: !!settings?.forceSinglePiece,
  };
  if (state.nestingState?.bypassRedistribution) {
    return pieces.reduce((sum, piece) => sum + pieceTotal(piece, effectiveCatalog, customer), 0);
  }
  const indexMap = buildPieceIndexMap(pieces);
  const distributed = new Map<string, number>();
  const groups = computeNesting(pieces, effectiveCatalog, customer).map((base) => {
    const groupPieces = piecesOfGroup(pieces, base.key);
    const bins = state.nestingState?.mixedBins?.[base.key];
    if (bins?.length) return recomputeGroupWithMixedBins(
      base, groupPieces, bins, indexMap, getNestingConfig(effectiveCatalog).perimeterM, effectiveCatalog,
    );
    const override = state.nestingState?.overrides?.[base.key];
    if (!override || !(override.widthM > 0) || !(override.heightM > 0)) return base;
    const result = recomputeGroupWithOverride(base, groupPieces, effectiveCatalog, override, indexMap, customer);
    return override.source === "catalog" && result.unplaced.length > 0 && base.unplaced.length === 0
      ? base : result;
  });
  let scrapExtra = 0;
  for (const group of groups) {
    const fabricCost = group.materialCostOptimized - (group.seamCost ?? 0) - group.scrapCost;
    if (fabricCost > 0 && group.usedAreaM2 > 0) {
      for (const item of group.items) {
        distributed.set(item.pieceId, (distributed.get(item.pieceId) ?? 0)
          + fabricCost * item.w * item.h / group.usedAreaM2);
      }
    }
    if (state.nestingState?.chargeNestingScrap?.[group.key] && group.totalAreaM2 > 0) {
      scrapExtra += Math.max(0, group.totalAreaM2 - group.usedAreaM2)
        * group.materialCostOptimized / group.totalAreaM2;
    }
  }
  return scrapExtra + pieces.reduce((sum, piece: PieceLine) => {
    const material = distributed.get(piece.id);
    return sum + (material === undefined
      ? pieceTotal(piece, effectiveCatalog, customer)
      : material + pieceWorkBreakdown(piece, effectiveCatalog, customer).total);
  }, 0);
};