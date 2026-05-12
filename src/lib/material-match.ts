import { CatalogMaterial } from "@/components/calculator/types";
import { convertLength, DimUnit } from "./perimeter";
import { CustomerType, sellPrice } from "./pricing";

/** Converte un'altezza espressa in heightUnit in metri (per confronto). */
const toMeters = (value: string, unit: string): number => {
  const v = parseFloat(String(value).replace(",", "."));
  if (!isFinite(v) || v <= 0) return 0;
  const u: DimUnit = (["mm", "cm", "m"] as const).includes(unit as DimUnit) ? (unit as DimUnit) : "cm";
  return convertLength(v, u, "m");
};

export type MaterialMatch = {
  material: CatalogMaterial;
  /** altezza variante in metri */
  heightM: number;
};

/**
 * Sceglie automaticamente la variante del materiale con altezza minima sufficiente
 * a coprire `requiredHeight` (espressa in `requiredUnit`), filtrando per nome/colore/ignifugo.
 *
 * Ritorna `null` se nessuna variante è grande abbastanza (oppure se mancano dati).
 */
export const autoMatchMaterial = (
  materials: CatalogMaterial[],
  productName: string,
  color: string,
  fireproof: string,
  requiredHeight: number,
  requiredUnit: DimUnit,
): MaterialMatch | null => {
  if (!productName || !requiredHeight) return null;
  const requiredM = convertLength(requiredHeight, requiredUnit, "m");
  if (requiredM <= 0) return null;

  const candidates = materials
    .filter((m) => m.name === productName)
    .filter((m) => (color ? m.color === color : true))
    .filter((m) => (fireproof !== undefined ? (m.fireproof || "") === (fireproof || "") : true))
    .map((m) => ({ material: m, heightM: toMeters(m.height, m.heightUnit) }))
    .filter((x) => x.heightM > 0);

  if (candidates.length === 0) return null;

  const compatible = candidates
    .filter((c) => c.heightM >= requiredM)
    .sort((a, b) => a.heightM - b.heightM);

  return compatible[0] ?? null;
};

/**
 * Prezzo unitario (€/m) della variante.
 * - prezzo d'acquisto in base al priceMode (pezza/taglio)
 * - se viene passato `customer`, applica il moltiplicatore di vendita
 *   (rivenditore vs cliente finale × intero vs al taglio).
 */
export const materialUnitCost = (
  material: CatalogMaterial,
  priceMode: "piece" | "cut",
  customer?: CustomerType,
): number => {
  const value = priceMode === "piece" ? material.pricePiece : material.priceCut;
  // Se il materiale usa il nuovo schema "prezzi di vendita manuali" (Tappezzeria),
  // `costPrice` è definito e `pricePiece`/`priceCut` sono già prezzi finali al cliente:
  // NON applichiamo i moltiplicatori Riv/Fin.
  if (typeof material.costPrice === "number") return value;
  if (!customer) return value;
  return sellPrice(value, customer, priceMode);
};

/** Costo materiale di una piece: priceUnit × quantità (m). */
export const pieceMaterialCost = (
  material: CatalogMaterial | null,
  priceMode: "piece" | "cut",
  qty: number,
  customer?: CustomerType,
): number => {
  if (!material) return 0;
  return materialUnitCost(material, priceMode, customer) * (qty || 0);
};
