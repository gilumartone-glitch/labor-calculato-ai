import { Catalog, PieceLine } from "@/components/calculator/types";

/**
 * Catalogo effettivo da usare per il calcolo del pezzo:
 * - lavorazioni/perimetrali restano quelle del reparto corrente
 * - se il materiale è prelevato dal Laboratorio, le varianti materiale arrivano dal listino Lab
 */
export const materialAwareCatalog = (
  piece: PieceLine,
  catalog: Catalog,
  labCatalog?: Catalog,
): Catalog => {
  if (!piece.materialFromLab || !labCatalog) return catalog;
  return { ...catalog, materials: labCatalog.materials };
};

/** Marca un catalogo come "no sfrido iniziale" (Tappezzeria). Il flag è
 *  runtime-only e viene letto da computePieceMaterial. */
export const withoutInitialScrap = (catalog: Catalog): Catalog =>
  ({ ...catalog, __skipInitialScrap: true } as Catalog);