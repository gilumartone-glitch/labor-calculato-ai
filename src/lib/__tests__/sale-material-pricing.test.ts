import { describe, expect, it } from "vitest";
import type { CatalogMaterial } from "@/components/calculator/types";
import { saleMaterialPrice } from "../sale-material-pricing";

const seta: CatalogMaterial = {
  id: "seta", name: "Seta Tempesta", color: "Bianco", height: "140",
  heightUnit: "cm", weight: "", composition: "", fireproof: "", unit: "Mt",
  costPrice: 24.5, pricePiece: 0, priceCut: 30, priceUnit: "ml",
};

describe("fabric sales catalog prices", () => {
  it("uses Seta Tempesta's 30 €/m cut price: 5 m cost 150 €, not 245 €", () => {
    expect(saleMaterialPrice(seta, "final", "cut", "m", "m") * 5).toBe(150);
  });
  it("does not multiply a manual catalog price for dealers", () => {
    expect(saleMaterialPrice(seta, "dealer", "cut", "m", "m")).toBe(30);
  });
  it("uses each product's whole-roll price, independently of its purchase price", () => {
    expect(saleMaterialPrice({ ...seta, pricePiece: 20.8 }, "final", "piece", "m", "m")).toBe(20.8);
  });
  it("preserves zero catalog prices rather than inventing a purchase markup", () => {
    expect(saleMaterialPrice(seta, "final", "piece", "m", "m")).toBe(0);
  });
  it("converts the catalog selling price from square to linear metres", () => {
    expect(saleMaterialPrice({ ...seta, priceCut: 30 }, "final", "cut", "m²", "m")).toBe(42);
  });
  it("keeps laboratory customer/mode multipliers unchanged", () => {
    const laboratory = { ...seta, costPrice: undefined, pricePiece: 24.5, priceCut: 24.5 };
    expect(saleMaterialPrice(laboratory, "final", "cut", "m", "m")).toBe(49);
    expect(saleMaterialPrice(laboratory, "dealer", "piece", "m", "m")).toBe(31.85);
  });
});