import { describe, it, expect } from "vitest";
import { computeNesting } from "@/lib/nesting";
import type { Catalog, CatalogMaterial, PieceLine } from "@/components/calculator/types";

/**
 * Verifica guidata sul caso reale: rotolo h 975 cm con 2 pezzi 260×250 + 1 pezzo 340×314,
 * tutti con rotazione DISATTIVATA e split disabilitato.
 * Layout atteso: pezzi affiancati sulla larghezza (h del pezzo attraverso il tessuto),
 * lunghezza usata = 340 cm (= larghezza max di P02).
 */

const mkMaterial = (): CatalogMaterial => ({
  id: "mat-975",
  name: "Velluto",
  weight: "",
  color: "Blu",
  height: "975",
  heightUnit: "cm",
  composition: "",
  fireproof: "",
  unit: "mq",
  pricePiece: 30,
  priceCut: 30,
  format: "rotolo",
  priceUnit: "mq",
  dimUnit: "cm",
});

const mkCatalog = (): Catalog => ({
  materials: [mkMaterial()],
  operations: [],
  perimeterOps: [],
  perimeterPresets: [],
  importedAt: null,
  fileName: null,
  printOps: [],
});

const mkPiece = (id: string, w: number, h: number, qty = 1): PieceLine => ({
  id,
  productName: "Velluto",
  color: "Blu",
  fireproof: "",
  matchedHeight: "975",
  matchedHeightUnit: "cm",
  catalogMaterialId: "mat-975",
  variantId: "mat-975",
  priceMode: "cut",
  materialQty: 0,
  width: w,
  height: h,
  dimUnit: "cm",
  shape: "rect",
  quantity: qty,
  perimeters: [],
  allowRotation: false,
  allowSplit: false,
});

describe("nesting rotolo h 975 · pezzi verticali", () => {
  it("dispone i 3 pezzi su un'unica shelf lunga 340 cm con h attraverso il tessuto", () => {
    const pieces: PieceLine[] = [
      mkPiece("p1", 260, 250, 2), // P01 × 2 copie
      mkPiece("p2", 340, 314, 1), // P02
    ];
    const groups = computeNesting(pieces, mkCatalog());
    expect(groups).toHaveLength(1);
    const g = groups[0];

    // Materiale scelto correttamente
    expect(g.rollWidthM).toBeCloseTo(9.75, 4);
    expect(g.unplaced).toEqual([]);
    expect(g.items).toHaveLength(3); // 2 copie di P01 + 1 di P02

    // Lunghezza usata = max(w) = 3.40 m (nessun margine attivo)
    expect(g.totalLengthM).toBeCloseTo(3.4, 4);

    // Nessun pezzo marcato come ruotato (rotazione OFF)
    g.items.forEach((it) => expect(it.rotated).toBe(false));

    // Ogni pezzo è disegnato con w=h_pezzo (cross) e h=w_pezzo (along)
    const p02 = g.items.find((i) => i.pieceId === "p2")!;
    expect(p02.w).toBeCloseTo(3.14, 4); // cross = h pezzo
    expect(p02.h).toBeCloseTo(3.4, 4);  // along = w pezzo

    const p01copies = g.items.filter((i) => i.pieceId === "p1");
    expect(p01copies).toHaveLength(2);
    p01copies.forEach((it) => {
      expect(it.w).toBeCloseTo(2.5, 4);
      expect(it.h).toBeCloseTo(2.6, 4);
    });

    // Somma trasversale: 314 + 250 + 250 = 814 cm ≤ 975 ✓
    const crossSum = p02.w + p01copies[0].w + p01copies[1].w;
    expect(crossSum).toBeCloseTo(8.14, 4);
    expect(crossSum).toBeLessThanOrEqual(g.rollWidthM + 1e-6);

    // Tutti sulla stessa shelf → stessa y (=0)
    g.items.forEach((it) => expect(it.y).toBeCloseTo(0, 4));

    // Le x devono essere consecutive, senza sovrapposizioni
    const byX = [...g.items].sort((a, b) => a.x - b.x);
    for (let i = 1; i < byX.length; i++) {
      const prev = byX[i - 1];
      expect(byX[i].x).toBeGreaterThanOrEqual(prev.x + prev.w - 1e-6);
    }

    // Area utile telo = 9.75 × 3.40 = 33.15 m²
    expect(g.totalAreaM2).toBeCloseTo(9.75 * 3.4, 3);
    // Area realmente coperta = 2×(2.6×2.5) + (3.4×3.14) = 13.0 + 10.676 = 23.676 m²
    expect(g.usedAreaM2).toBeCloseTo(2 * 2.6 * 2.5 + 3.4 * 3.14, 3);
  });

  it("se attivo la rotazione su un solo pezzo, quello NON basta a girare il layout", () => {
    // Guardrail: la rotazione è per-pezzo. Rotazione off sul pezzo grande
    // deve continuare a produrre la stessa lunghezza (3.40 m).
    const pieces: PieceLine[] = [
      { ...mkPiece("p1", 260, 250, 2), allowRotation: true },
      mkPiece("p2", 340, 314, 1),
    ];
    const g = computeNesting(pieces, mkCatalog())[0];
    expect(g.totalLengthM).toBeCloseTo(3.4, 4);
    const p02 = g.items.find((i) => i.pieceId === "p2")!;
    expect(p02.rotated).toBe(false);
  });
});
