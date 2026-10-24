import { describe, expect, it } from "vitest";
import type { Catalog, CatalogMaterial, DepartmentState, PieceLine } from "@/components/calculator/types";
import { computeNesting } from "@/lib/nesting";
import { withoutInitialScrap } from "@/lib/piece-catalog";
import { upholsteryPiecesTotal } from "@/lib/upholstery-totals";

const material = (height: number, price: number): CatalogMaterial => ({
  id: `tulle-${height}`, name: "Tulle Gobelin", color: "Nero", height: String(height),
  heightUnit: "cm", weight: "", composition: "", fireproof: "", unit: "m",
  pricePiece: price, priceCut: price, costPrice: price / 2, priceUnit: "ml",
  format: "rotolo", verticalHeight: true,
});
const catalog = (materials = [material(360, 10), material(610, 15)]): Catalog => ({
  materials, operations: [], perimeterOps: [], perimeterPresets: [], importedAt: null, fileName: null,
});
const piece = (id: string, width: number, height: number, variant = "tulle-610"): PieceLine => ({
  id, productName: "Tulle Gobelin", color: "Nero", fireproof: "", width, height,
  dimUnit: "cm", matchedHeight: "", matchedHeightUnit: "cm", catalogMaterialId: variant,
  variantId: variant, priceMode: "cut", materialQty: 0, perimeters: [], quantity: 1,
  noMargins: true, manualMargins: true, marginExtraWCm: 0, marginExtraHCm: 0,
  allowRotation: false, allowSplit: false,
});
const state = (pieces: PieceLine[]): DepartmentState => ({
  pieces, materials: [], operations: [], perimeters: [], transports: [],
  nestingState: { settings: { skipPerimeter: true } },
});
const effective = (c: Catalog) => ({ ...withoutInitialScrap(c), __skipPerimeterMargin: true });

describe("upholstery shared fabric consumption", () => {
  it("fits 300×400 and 200×100 in the same 300 cm cut of h 610", () => {
    const pieces = [piece("large", 300, 400), piece("small", 200, 100, "tulle-360")];
    const groups = computeNesting(pieces, effective(catalog()));
    expect(groups).toHaveLength(1);
    expect(groups[0].rollWidthM).toBeCloseTo(6.1);
    expect(groups[0].totalLengthM).toBeCloseTo(3);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[0].unplaced).toEqual([]);
    expect(groups[0].materialCostOptimized).toBeCloseTo(45);
    expect(upholsteryPiecesTotal(state(pieces), catalog())).toBeCloseTo(45);
  });

  it("chooses a taller roll when its overall cost is lower", () => {
    const c = catalog([material(610, 15), material(800, 12)]);
    const pieces = [piece("large", 300, 400), piece("small", 200, 100)];
    const groups = computeNesting(pieces, effective(c));
    expect(groups).toHaveLength(1);
    expect(groups[0].rollWidthM).toBeCloseTo(8);
    expect(groups[0].materialCostOptimized).toBeCloseTo(36);
    expect(upholsteryPiecesTotal(state(pieces), c)).toBeCloseTo(36);
  });

  it("keeps separate heights if they really cost less than a shared cut", () => {
    const c = catalog([material(360, 1), material(610, 15)]);
    const pieces = [piece("large", 300, 400), piece("small", 200, 100, "tulle-360")];
    const groups = computeNesting(pieces, effective(c));
    expect(groups).toHaveLength(2);
    expect(groups.reduce((sum, g) => sum + g.materialCostOptimized, 0)).toBeCloseTo(47);
  });
});