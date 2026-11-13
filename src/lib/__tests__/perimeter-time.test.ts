import { it, expect } from "vitest";
import type { Catalog, DepartmentState, PieceLine } from "@/components/calculator/types";
import { aggregateWorkBreakdown, perimeterTimeCostPerPiece, pieceTotal, pieceWorkBreakdown } from "@/lib/piece";
import { upholsteryPiecesTotal } from "@/lib/upholstery-totals";

const catalog: Catalog = {
  materials: [{
    id: "fabric", name: "Tessuto", weight: "", color: "Bianco", height: "300",
    heightUnit: "cm", composition: "", fireproof: "", unit: "m", format: "rotolo",
    pricePiece: 10, priceCut: 10, costPrice: 5,
  }],
  operations: [], perimeterPresets: [], importedAt: null, fileName: null,
  perimeterOps: [{ id: "plotter", name: "Taglio plotter", category: "taglio", priceUnit: "mq", pricePerMeter: 3 }],
  __skipInitialScrap: true,
};
const piece: PieceLine = {
  id: "piece", productName: "Tessuto", color: "Bianco", fireproof: "",
  matchedHeight: "300", matchedHeightUnit: "cm", catalogMaterialId: "fabric",
  priceMode: "cut", materialQty: 0, width: 4, height: 2, dimUnit: "cm", quantity: 4000,
  perimeters: [{ id: "cut", opId: "plotter", sides: [], timeMode: true, timeMinutes: 120, timeRate: 60 }],
};

it("taglio a tempo: 120 min a 60 €/h su 4000 pezzi = 120 € totali", () => {
  expect(perimeterTimeCostPerPiece({ timeMinutes: 120, timeRate: 60 }, 4000) * 4000).toBeCloseTo(120);
});

it("includes the 120 € time cost in piece and department breakdowns exactly once", () => {
  const withoutCut = { ...piece, perimeters: [] };
  expect(pieceWorkBreakdown(piece, catalog).taglio).toBeCloseTo(120);
  expect(pieceWorkBreakdown(piece, catalog).total - pieceWorkBreakdown(withoutCut, catalog).total).toBeCloseTo(120);
  expect(aggregateWorkBreakdown([piece], catalog).taglio).toBeCloseTo(120);
  expect(pieceTotal(piece, catalog) - pieceTotal(withoutCut, catalog)).toBeCloseTo(120);
});

it("includes 120 € in the upholstery quote with nesting redistribution", () => {
  const state: DepartmentState = { materials: [], operations: [], perimeters: [], transports: [], pieces: [piece] };
  const withoutCut = { ...state, pieces: [{ ...piece, perimeters: [] }] };
  expect(upholsteryPiecesTotal(state, catalog) - upholsteryPiecesTotal(withoutCut, catalog)).toBeCloseTo(120);
});

it("retains area pricing when time mode is disabled", () => {
  const areaPiece = { ...piece, perimeters: piece.perimeters.map(pp => ({ ...pp, timeMode: false })) };
  expect(pieceWorkBreakdown(areaPiece, catalog).taglio).toBeCloseTo(9.6);
});
