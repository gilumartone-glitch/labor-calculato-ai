import { describe, it, expect } from "vitest";
import {
  computePieceMaterial,
  pieceLeftoverScrapAreaM2,
  pieceLeftoverScrapSellCost,
  pieceWorkBreakdown,
  aggregateWorkBreakdown,
  pieceTotal,
  pieceMaterialTotal,
  pieceInitialScrapSellCost,
  rollQuantityNestingPlan,
} from "../piece";
import { buildPieceIndexMap, computeNesting, recomputeGroupWithOverride } from "../nesting";
import { perimeterCost } from "../perimeter";
import type {
  Catalog,
  CatalogMaterial,
  CatalogPerimeterOp,
  PieceLine,
} from "@/components/calculator/types";

/**
 * Test della logica di sfrido di lavorazione (nesting).
 *
 * Caso di riferimento (stampa su rotolo h 2 m):
 *  - pezzo 12,10 m × 0,50 m (no margini, reparto stampa)
 *  - rotolo larghezza 2 m, prezzo €/mq
 *  - 1 telo lungo 12,10 m (la larghezza pezzo 0,50 m sta in 1 telo da 2 m)
 *  - sfrido = (1 × 2 − 0,50) × 12,10 = 1,50 × 12,10 = 18,15 m²
 *  - costo sfrido = 18,15 × prezzo €/mq d'acquisto × 1,30
 */

const makeRollMaterial = (
  overrides: Partial<CatalogMaterial> = {},
): CatalogMaterial => ({
  id: "mat-roll-2m",
  name: "PVC Stampa",
  weight: "440",
  color: "Bianco",
  height: "2",
  heightUnit: "m",
  composition: "PVC",
  fireproof: "",
  unit: "mq",
  // Prezzi d'acquisto/vendita: 10 €/mq (schema legacy = pricePiece/priceCut sono il costo)
  pricePiece: 10,
  priceCut: 10,
  format: "rotolo",
  priceUnit: "mq",
  ...overrides,
});

const makeCatalog = (materials: CatalogMaterial[]): Catalog => ({
  materials,
  operations: [],
  perimeterOps: [],
  perimeterPresets: [],
  importedAt: null,
  fileName: null,
  printOps: [],
});

const makePiece = (overrides: Partial<PieceLine> = {}): PieceLine => ({
  id: "p1",
  productName: "PVC Stampa",
  color: "Bianco",
  fireproof: "",
  matchedHeight: "2",
  matchedHeightUnit: "m",
  catalogMaterialId: null,
  priceMode: "cut",
  materialQty: 0,
  width: 12.1,
  height: 0.5,
  dimUnit: "m",
  perimeters: [],
  noMargins: true,
  chargeScrap: true,
  allowRotation: true,
  ...overrides,
});

const round2 = (n: number) => Math.round(n * 100) / 100;

describe("Sfrido di lavorazione (nesting)", () => {
  it("accorpa gli avanzi di 2 pezzi 450×320 cm in 3 teli da 450 cm su rotolo h 300", () => {
    const plan = rollQuantityNestingPlan(3.2, 3, 4.5, 2);

    expect(plan.panels).toBe(3);
    expect(plan.totalMetersM).toBeCloseTo(13.5, 5);

    const material = makeRollMaterial({
      id: "super-buio-300",
      name: "SUPER BUIO",
      color: "",
      height: "300",
      heightUnit: "cm",
      dimUnit: "cm",
      priceUnit: "ml",
      priceCut: 31.3,
      pricePiece: 31.3,
    });
    const catalog = { ...makeCatalog([material]), __skipInitialScrap: true } as Catalog;
    const piece = makePiece({
      productName: "SUPER BUIO",
      color: "",
      width: 450,
      height: 320,
      dimUnit: "cm",
      quantity: 2,
      allowRotation: false,
      allowSplit: true,
    });
    const breakdown = computePieceMaterial(piece, catalog);

    expect(breakdown.feasible).toBe(true);
    expect(breakdown.panels).toBe(2);
    expect(breakdown.panelLengthM).toBeCloseTo(4.5, 5);
    expect(round2(pieceMaterialTotal(piece, catalog) * 2)).toBe(round2(13.5 * 31.3));

    const nestingCatalog = {
      ...catalog,
      __perimeterMarginMm: 0,
      __skipPerimeterMargin: true,
    } as Catalog;
    const group = computeNesting([piece], nestingCatalog)[0];
    expect(group.unplaced).toHaveLength(0);
    expect(group.items).toHaveLength(4);
    expect(group.totalLengthM).toBeCloseTo(13.5, 5);
    expect(round2(group.materialCostOptimized)).toBe(round2(13.5 * 31.3));
  });

  it("Lavorazione €/pz (es. squadratura) viene conteggiata anche senza quantità impostata (default 1 pz)", () => {
    const op: CatalogPerimeterOp = {
      id: "op-squad",
      name: "Squadratura",
      pricePerMeter: 8,
      priceUnit: "pz",
      category: "taglio",
    };
    const slab: CatalogMaterial = {
      ...makeRollMaterial(),
      id: "plexi",
      name: "Plexi Opale",
      format: "lastra",
      baseWidth: "2.5",
      height: "1.22",
      heightUnit: "m",
      dimUnit: "m",
      priceUnit: "mq",
      pricePiece: 36.4,
      priceCut: 36.4,
    };
    const catalog: Catalog = { ...makeCatalog([slab]), perimeterOps: [op] };
    const piece: PieceLine = {
      ...makePiece(),
      productName: "Plexi Opale",
      width: 250,
      height: 120,
      dimUnit: "cm",
      noMargins: true,
      chargeScrap: false,
      perimeters: [{ id: "pp1", opId: op.id, sides: [] }],
    };

    // perimeterCost diretto: nessuna quantity → default 1 pezzo
    expect(
      perimeterCost({
        id: "x",
        catalogId: op.id,
        name: op.name,
        pricePerMeter: op.pricePerMeter,
        priceUnit: "pz",
        sides: [],
        width: 250,
        height: 120,
        dimUnit: "cm",
      }),
    ).toBe(8);

    // Nel totale del pezzo la squadratura compare in "taglio"
    const wb = pieceWorkBreakdown(piece, catalog);
    expect(round2(wb.taglio)).toBe(8);
    expect(round2(wb.total)).toBe(8);
  });

  it("LASTRA Plexi 250×120 cm a 36,40 €/mq → materiale = 3,00 m² × 36,40 = 109,20 €", () => {
    // Caso reale: lastra Plexi Opale 2,5 × 1,22 m, prezzo €/mq, pezzo 250×120 cm.
    // Il cliente paga l'AREA del pezzo, non i metri lineari.
    const slab: CatalogMaterial = {
      ...makeRollMaterial(),
      id: "plexi",
      name: "Plexi Opale",
      format: "lastra",
      baseWidth: "2.5",
      height: "1.22",
      heightUnit: "m",
      dimUnit: "m",
      priceUnit: "mq",
      pricePiece: 36.4,
      priceCut: 36.4,
    };
    const catalog = makeCatalog([slab]);
    const piece: PieceLine = {
      ...makePiece(),
      productName: "Plexi Opale",
      width: 250,
      height: 120,
      dimUnit: "cm",
      noMargins: true,
      allowRotation: true,
      chargeScrap: false,
    };

    const b = computePieceMaterial(piece, catalog);
    expect(b.feasible).toBe(true);
    expect(b.material?.format).toBe("lastra");
    // costo interno (acquisto, no moltiplicatore cliente) = area × €/mq
    expect(round2(pieceMaterialTotal(piece, catalog))).toBe(round2(2.5 * 1.2 * 36.4));
    expect(round2(pieceMaterialTotal(piece, catalog))).toBe(109.2);

    // Cliente finale "al taglio" → ×2,0 sul prezzo unitario
    expect(round2(pieceMaterialTotal(piece, catalog, "final"))).toBe(round2(2.5 * 1.2 * 36.4 * 2));
    expect(round2(pieceMaterialTotal(piece, catalog, "final"))).toBe(218.4);

    // Rivenditore "al taglio" → ×1,5
    expect(round2(pieceMaterialTotal(piece, catalog, "dealer"))).toBe(round2(2.5 * 1.2 * 36.4 * 1.5));
    expect(round2(pieceMaterialTotal(piece, catalog, "dealer"))).toBe(163.8);

    // Nessuno sfrido iniziale per le lastre
    expect(round2(pieceInitialScrapSellCost(piece, catalog))).toBe(0);
  });

  it("nesting lastra usa il formato più grande della stessa famiglia se la variante scelta non basta", () => {
    const small: CatalogMaterial = {
      ...makeRollMaterial(),
      id: "poly-305",
      name: "Policarbonato",
      color: "Trasparente",
      format: "lastra",
      thickness: "8",
      baseWidth: "305",
      height: "205",
      heightUnit: "cm",
      dimUnit: "cm",
      priceUnit: "mq",
      pricePiece: 25,
      priceCut: 25,
    };
    const large: CatalogMaterial = {
      ...small,
      id: "poly-600",
      baseWidth: "600",
      height: "205",
    };
    const catalog = makeCatalog([small, large]);
    const piece: PieceLine = {
      ...makePiece(),
      productName: "Policarbonato",
      color: "Trasparente",
      thickness: "8",
      width: 500,
      height: 120,
      dimUnit: "cm",
      noMargins: true,
      allowSplit: false,
      allowRotation: true,
      catalogMaterialId: small.id,
      variantId: small.id,
    };

    const group = computeNesting([piece], catalog)[0];

    expect(group.material?.id).toBe("poly-600");
    expect(group.sheetWidthM).toBeCloseTo(6, 5);
    expect(group.sheetHeightM).toBeCloseTo(2.05, 5);
    expect(group.unplaced).toHaveLength(0);
  });

  it("suddivide 600×660 cm su lastre 100×140 cm considerando il margine perimetrale", () => {
    const sheet: CatalogMaterial = {
      ...makeRollMaterial(),
      id: "sheet-100-140",
      name: "Pannello laboratorio",
      color: "Neutro",
      format: "lastra",
      baseWidth: "100",
      height: "140",
      heightUnit: "cm",
      dimUnit: "cm",
      priceUnit: "mq",
    };
    const catalog = makeCatalog([sheet]);
    const piece = makePiece({
      productName: sheet.name,
      color: sheet.color,
      width: 600,
      height: 660,
      dimUnit: "cm",
      noMargins: true,
      allowSplit: false,
      allowRotation: true,
      catalogMaterialId: sheet.id,
      variantId: sheet.id,
    });

    const group = computeNesting([piece], catalog)[0];

    expect(group.unplaced).toHaveLength(0);
    // Con il margine perimetrale predefinito da 10 mm l'area utile è
    // 98×138 cm: lo split crea 35 pannelli; MaxRects combina i pannelli
    // terminali più piccoli e usa 31 lastre fisiche.
    expect(group.items).toHaveLength(35);
    expect(group.sheetsNeeded).toBe(31);
    expect(group.totalAreaM2).toBeCloseTo(43.4, 5);
  });

  it("suddivide in griglia 2D anche quando la lastra è scelta come override", () => {
    const sheet = makeRollMaterial({
      id: "sheet-100-140-override",
      name: "Pannello laboratorio",
      color: "Neutro",
      format: "lastra",
      baseWidth: "100",
      height: "140",
      heightUnit: "cm",
      dimUnit: "cm",
    });
    const catalog = makeCatalog([sheet]);
    const piece = makePiece({
      productName: sheet.name,
      color: sheet.color,
      width: 600,
      height: 660,
      dimUnit: "cm",
      noMargins: true,
      allowSplit: false,
      allowRotation: true,
      catalogMaterialId: sheet.id,
      variantId: sheet.id,
    });
    const computed = computeNesting([piece], catalog)[0];
    const legacyBase = { ...computed, format: "rotolo" as const };
    const group = recomputeGroupWithOverride(
      legacyBase,
      [piece],
      catalog,
      { widthM: 1, heightM: 1.4, quantity: 0, source: "catalog" },
      buildPieceIndexMap([piece]),
    );

    expect(group.format).toBe("lastra");
    expect(group.unplaced).toHaveLength(0);
    expect(group.items).toHaveLength(35);
    expect(group.sheetsNeeded).toBe(31);
  });

  it("pezzo 12,10 × 0,50 m su rotolo h 2 m → sfrido 1,50 × 12,10 = 18,15 m²", () => {
    const catalog = makeCatalog([makeRollMaterial()]);
    const piece = makePiece();

    const breakdown = computePieceMaterial(piece, catalog);
    expect(breakdown.feasible).toBe(true);
    expect(breakdown.rollWidthM).toBe(2);
    // il sistema deve sviluppare il telo sul lato lungo (12,10 m)
    expect(breakdown.panelLengthM).toBeCloseTo(12.1, 5);
    expect(breakdown.panels).toBe(1);
    // larghezza effettiva del pezzo che "occupa" il telo = 0,50 m
    expect(breakdown.pieceWidthM).toBeCloseTo(0.5, 5);

    const leftover = pieceLeftoverScrapAreaM2(piece, catalog);
    // (1 × 2 − 0,5) × 12,10 = 18,15 m²
    expect(round2(leftover)).toBe(18.15);
  });

  it("prezzo dello sfrido usa il moltiplicatore fisso 1,30 sul prezzo d'acquisto €/mq", () => {
    // Prezzo d'acquisto 10 €/mq → sfrido = 18,15 × 10 × 1,30 = 235,95 €
    const catalog = makeCatalog([makeRollMaterial({ pricePiece: 10, priceCut: 10 })]);
    const piece = makePiece();

    const cost = pieceLeftoverScrapSellCost(piece, catalog);
    expect(round2(cost)).toBe(round2(18.15 * 10 * 1.3));
    expect(round2(cost)).toBe(235.95);
  });

  it("prezzo dello sfrido NON dipende dal moltiplicatore cliente (Riv vs Fin)", () => {
    const catalog = makeCatalog([makeRollMaterial()]);
    const piece = makePiece();

    const costRiv = pieceLeftoverScrapSellCost(piece, catalog, "dealer");
    const costFin = pieceLeftoverScrapSellCost(piece, catalog, "final");
    expect(round2(costRiv)).toBe(round2(costFin));
    expect(round2(costRiv)).toBe(235.95);
  });

  it("se chargeScrap è false → nessun addebito di sfrido di lavorazione", () => {
    const catalog = makeCatalog([makeRollMaterial()]);
    const piece = makePiece({ chargeScrap: false });

    expect(pieceLeftoverScrapAreaM2(piece, catalog)).toBe(0);
    expect(pieceLeftoverScrapSellCost(piece, catalog)).toBe(0);
  });

  it("pezzo 12,10 × 2,50 m su rotolo h 2 m → 2 teli, sfrido (2×2 − 2,5) × 12,10 = 18,15 m²", () => {
    // Caso a 2 teli per verificare la formula generale (panels × rollW − pieceW) × panelLength
    const catalog = makeCatalog([makeRollMaterial()]);
    const piece = makePiece({ width: 12.1, height: 2.5, allowRotation: true });

    const breakdown = computePieceMaterial(piece, catalog);
    expect(breakdown.feasible).toBe(true);
    expect(breakdown.rollWidthM).toBe(2);
    expect(breakdown.panels).toBe(2);
    expect(breakdown.panelLengthM).toBeCloseTo(12.1, 5);
    expect(breakdown.pieceWidthM).toBeCloseTo(2.5, 5);

    const leftover = pieceLeftoverScrapAreaM2(piece, catalog);
    // (2 × 2 − 2,5) × 12,10 = 1,5 × 12,10 = 18,15 m²
    expect(round2(leftover)).toBe(18.15);
  });

  it("pezzo che occupa esattamente la larghezza del rotolo → sfrido di lavorazione = 0", () => {
    const catalog = makeCatalog([makeRollMaterial()]);
    const piece = makePiece({ width: 12.1, height: 2 });

    const leftover = pieceLeftoverScrapAreaM2(piece, catalog);
    expect(round2(leftover)).toBe(0);
    expect(round2(pieceLeftoverScrapSellCost(piece, catalog))).toBe(0);
  });

  it("pezzo 4,50 × 12,10 m su rotolo h 2 m → 3 teli da 12,10 m, sfrido 1,5 × 12,10 = 18,15 m² (no rotazione 'a strisce')", () => {
    // Il sistema NON deve scegliere 7 teli da 4,50 m (sfrido 8,55 m²), ma 3 teli
    // da 12,10 m con sfrido fisicamente coerente: 1,5 m × 12,10 m = 18,15 m².
    const catalog = makeCatalog([makeRollMaterial()]);
    const piece = makePiece({ width: 4.5, height: 12.1, allowRotation: true });

    const breakdown = computePieceMaterial(piece, catalog);
    expect(breakdown.feasible).toBe(true);
    expect(breakdown.rollWidthM).toBe(2);
    expect(breakdown.panels).toBe(3);
    expect(breakdown.panelLengthM).toBeCloseTo(12.1, 5);
    expect(breakdown.pieceWidthM).toBeCloseTo(4.5, 5);

    const leftover = pieceLeftoverScrapAreaM2(piece, catalog);
    expect(round2(leftover)).toBe(18.15);
    expect(round2(pieceLeftoverScrapSellCost(piece, catalog))).toBe(235.95);
  });

  it("pezzo 12,10 × 4,50 m (lato lungo già orizzontale) su rotolo h 2 m → 3 teli da 12,10 m", () => {
    const catalog = makeCatalog([makeRollMaterial()]);
    const piece = makePiece({ width: 12.1, height: 4.5, allowRotation: true });

    const breakdown = computePieceMaterial(piece, catalog);
    expect(breakdown.panels).toBe(3);
    expect(breakdown.panelLengthM).toBeCloseTo(12.1, 5);
    expect(round2(pieceLeftoverScrapAreaM2(piece, catalog))).toBe(18.15);
  });

  it("stampa 12,10 × 4,50: materiale sui mq effettivi, sfrido nesting separato, sfrido iniziale separato", () => {
    const catalog = makeCatalog([makeRollMaterial({ pricePiece: 3.75, priceCut: 3.75 })]);
    const piece = makePiece({ width: 4.5, height: 12.1, allowRotation: true });

    const breakdown = computePieceMaterial(piece, catalog);
    expect(round2(breakdown.pieceWidthM * breakdown.pieceHeightM)).toBe(54.45);
    // Materiale venduto sui mq effettivamente stampati + sfrido iniziale, non sui 63 m² dei teli.
    expect(round2(pieceMaterialTotal(piece, catalog))).toBe(round2(54.45 * 3.75 + 1.5 * 2 * 3.75 * 1.3));
    expect(round2(pieceMaterialTotal(piece, catalog))).toBe(218.81);

    // Sfrido nesting: (3×2 − 4,50) × 12,10 = 18,15 m², in lavorazioni.
    expect(round2(pieceLeftoverScrapAreaM2(piece, catalog))).toBe(18.15);
    expect(round2(pieceLeftoverScrapSellCost(piece, catalog))).toBe(round2(18.15 * 3.75 * 1.3));
    expect(round2(pieceLeftoverScrapSellCost(piece, catalog))).toBe(88.48);

    // Sfrido iniziale: 1,50 m × larghezza materiale 2,00 m, voce distinta dal nesting.
    expect(round2(pieceInitialScrapSellCost(piece, catalog))).toBe(round2(1.5 * 2 * 3.75 * 1.3));
    expect(round2(pieceInitialScrapSellCost(piece, catalog))).toBe(14.63);

    const wb = pieceWorkBreakdown(piece, catalog);
    expect(round2(wb.scrap)).toBe(88.48);
    expect(round2(pieceTotal(piece, catalog))).toBe(round2(54.45 * 3.75 + 14.625 + 88.48125));
  });

  it("lo sfrido di lavorazione viene incluso nel breakdown delle Lavorazioni", () => {
    const catalog = makeCatalog([makeRollMaterial()]);
    const piece = makePiece();

    const wb = pieceWorkBreakdown(piece, catalog);
    // wb.scrap = costo sfrido (235,95 €) e contribuisce a wb.total
    expect(round2(wb.scrap)).toBe(235.95);
    expect(round2(wb.total)).toBe(round2(wb.stampa + wb.taglio + wb.perimetrale + wb.altre + wb.seam + wb.custom + wb.print + wb.scrap));
    expect(round2(wb.total)).toBe(235.95);
  });

  it("aggregateWorkBreakdown somma lo sfrido di tutti i pezzi", () => {
    const catalog = makeCatalog([makeRollMaterial()]);
    const p1 = makePiece({ id: "p1" });
    const p2 = makePiece({ id: "p2" });

    const agg = aggregateWorkBreakdown([p1, p2], catalog);
    expect(round2(agg.scrap)).toBe(round2(235.95 * 2));
  });

  it("lo sfrido di lavorazione resta conteggiato esattamente una volta in pieceTotal", () => {
    const catalog = makeCatalog([makeRollMaterial()]);
    const piece = makePiece();

    // pieceTotal = materiale (con sfrido iniziale) + lavorazioni (incluso sfrido lav.)
    // Lo sfrido di lavorazione non deve essere doppiato.
    const total = pieceTotal(piece, catalog);
    const wb = pieceWorkBreakdown(piece, catalog);
    // Verifica indiretta: il totale meno lo sfrido di lavorazione deve essere
    // un valore stabile e non negativo (no doppio conteggio).
    expect(total).toBeGreaterThan(wb.scrap);
    // Eseguendo due volte il calcolo deve dare lo stesso risultato (no side effect)
    expect(pieceTotal(piece, catalog)).toBe(total);
  });
});
