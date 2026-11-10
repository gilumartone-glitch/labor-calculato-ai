import type { CatalogMaterial } from "@/components/calculator/types";
import { materialUnitCost } from "./material-match";
import type { CustomerType, PriceMode } from "./pricing";

/** Use the department's catalog prices before converting the selling unit. */
export function saleMaterialPrice(
  material: CatalogMaterial,
  customer: CustomerType,
  mode: PriceMode,
  baseUnit: string,
  saleUnit: string,
): number {
  const price = materialUnitCost(material, mode, customer);
  const height = Number(material.height);
  if (!Number.isFinite(height) || height <= 0 || baseUnit === saleUnit) return price;
  const heightM = material.heightUnit === "m" ? height
    : material.heightUnit === "mm" ? height / 1000 : height / 100;
  if (baseUnit === "m²" && saleUnit === "m") return price * heightM;
  if (baseUnit === "m" && saleUnit === "m²") return price / heightM;
  return price;
}