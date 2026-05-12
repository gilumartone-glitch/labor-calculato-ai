import { DepartmentKey, DepartmentState, PieceLine } from "@/components/calculator/types";

const same = (a?: string | null, b?: string | null) => (a ?? "") === (b ?? "");

export const labPieceMatches = (piece: PieceLine, labPiece: PieceLine): boolean => {
  if (!piece.productName || !labPiece.productName) return false;
  if (piece.variantId && labPiece.variantId) return piece.variantId === labPiece.variantId;
  return (
    piece.productName === labPiece.productName &&
    same(piece.color, labPiece.color) &&
    same(piece.thickness, labPiece.thickness) &&
    same(piece.finish, labPiece.finish)
  );
};

export const findLabDimensionSource = (
  piece: PieceLine,
  labPieces: PieceLine[] = [],
  index?: number,
): PieceLine | undefined =>
  (piece.linkedLabPieceId
    ? labPieces.find((lp) => lp.id === piece.linkedLabPieceId)
    : undefined) ??
  labPieces.find((labPiece) => labPieceMatches(piece, labPiece)) ??
  (typeof index === "number" ? labPieces[index] : undefined);

export const copyLabDimensions = (piece: PieceLine, labPiece: PieceLine): PieceLine => ({
  ...piece,
  productName: labPiece.productName,
  color: labPiece.color,
  fireproof: labPiece.fireproof,
  matchedHeight: labPiece.matchedHeight,
  matchedHeightUnit: labPiece.matchedHeightUnit,
  catalogMaterialId: labPiece.catalogMaterialId,
  thickness: labPiece.thickness,
  finish: labPiece.finish,
  variantId: labPiece.variantId,
  priceMode: labPiece.priceMode,
  width: labPiece.width,
  height: labPiece.height,
  dimUnit: labPiece.dimUnit,
  shape: labPiece.shape,
  widthBottom: labPiece.widthBottom,
});

export const syncMaterialFromLabDimensions = (
  departments: Record<DepartmentKey, DepartmentState>,
): Record<DepartmentKey, DepartmentState> => {
  const labPieces = departments.stampa.pieces ?? [];
  const syncDept = (key: DepartmentKey): DepartmentState => {
    if (key === "stampa") return departments[key];
    return {
      ...departments[key],
      pieces: (departments[key].pieces ?? []).map((piece, index) => {
        if (!piece.materialFromLab) return piece;
        const source = findLabDimensionSource(piece, labPieces, index);
        return source ? copyLabDimensions(piece, source) : piece;
      }),
    };
  };

  return {
    tappezzeria: syncDept("tappezzeria"),
    stampa: departments.stampa,
    falegnameria: syncDept("falegnameria"),
  };
};