import { describe, it, expect } from "vitest";
import { computePieceMaterial } from "../piece";
import type { Catalog, PieceLine } from "@/components/calculator/types";

const catalog: Catalog = {
  materials: [{
    id: "m1", name: "Tessuto", color: "", fireproof: "", thickness: "", finish: "",
    height: "300", heightUnit: "cm", dimUnit: "cm", format: "rotolo",
    pricePiece: 10, priceCut: 10, unit: "ml", priceUnit: "ml",
  } as any],
  perimeterOps: [],
} as any;

const piece: PieceLine = {
  id: "p1", productName: "Tessuto", color: "", fireproof: "", thickness: "", finish: "",
  width: 450, height: 320, dimUnit: "cm", quantity: 2, allowRotation: true, allowSplit: true,
  shape: "rect",
} as any;

describe("trace", () => {
  it("logs breakdown", () => {
    const b = computePieceMaterial(piece, catalog);
    console.log(JSON.stringify(b, null, 2));
    expect(true).toBe(true);
  });
});
