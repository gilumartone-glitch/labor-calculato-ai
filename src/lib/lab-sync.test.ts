import { describe, expect, it } from "vitest";
import { syncMaterialFromLabDimensions } from "./lab-sync";
import { DepartmentState, PieceLine } from "@/components/calculator/types";

const emptyDept = (): DepartmentState => ({
  materials: [],
  operations: [],
  perimeters: [],
  pieces: [],
  transports: [],
});

const piece = (patch: Partial<PieceLine>): PieceLine => ({
  id: "piece",
  productName: "Banner",
  color: "Bianco",
  fireproof: "",
  matchedHeight: "",
  matchedHeightUnit: "cm",
  catalogMaterialId: null,
  priceMode: "cut",
  materialQty: 0,
  width: 100,
  height: 50,
  dimUnit: "cm",
  perimeters: [],
  ...patch,
});

describe("syncMaterialFromLabDimensions", () => {
  it("copia dimUnit, shape e widthBottom dal pezzo corrispondente del Laboratorio", () => {
    const synced = syncMaterialFromLabDimensions({
      tappezzeria: {
        ...emptyDept(),
        pieces: [
          piece({
            id: "tap-1",
            materialFromLab: true,
            width: 200,
            height: 120,
            dimUnit: "cm",
            shape: "rect",
          }),
        ],
      },
      stampa: {
        ...emptyDept(),
        pieces: [
          piece({
            id: "lab-1",
            width: 900,
            height: 550,
            dimUnit: "mm",
            shape: "trapezoid",
            widthBottom: 720,
          }),
        ],
      },
      falegnameria: emptyDept(),
    });

    expect(synced.tappezzeria.pieces[0]).toMatchObject({
      productName: "Banner",
      color: "Bianco",
      width: 900,
      height: 550,
      dimUnit: "mm",
      shape: "trapezoid",
      widthBottom: 720,
    });
  });

  it("usa la stessa posizione del pezzo come fallback quando prodotto e variante non sono selezionati", () => {
    const synced = syncMaterialFromLabDimensions({
      tappezzeria: {
        ...emptyDept(),
        pieces: [
          piece({ id: "tap-1", productName: "", color: "", materialFromLab: true }),
        ],
      },
      stampa: {
        ...emptyDept(),
        pieces: [piece({ id: "lab-1", productName: "Tessuto Lab", color: "Rosso", width: 900, height: 550, dimUnit: "cm" })],
      },
      falegnameria: emptyDept(),
    });

    expect(synced.tappezzeria.pieces[0]).toMatchObject({
      productName: "Tessuto Lab",
      color: "Rosso",
      width: 900,
      height: 550,
      dimUnit: "cm",
    });
  });

  it("copia variante e altezza materiale per permettere il calcolo delle cuciture", () => {
    const synced = syncMaterialFromLabDimensions({
      tappezzeria: {
        ...emptyDept(),
        pieces: [piece({ id: "tap-1", materialFromLab: true, matchedHeight: "", catalogMaterialId: null })],
      },
      stampa: {
        ...emptyDept(),
        pieces: [piece({ id: "lab-1", matchedHeight: "320", matchedHeightUnit: "cm", catalogMaterialId: "mat-lab", variantId: "mat-lab" })],
      },
      falegnameria: emptyDept(),
    });

    expect(synced.tappezzeria.pieces[0]).toMatchObject({
      matchedHeight: "320",
      matchedHeightUnit: "cm",
      catalogMaterialId: "mat-lab",
      variantId: "mat-lab",
    });
  });
});