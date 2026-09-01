import { Catalog, CatalogMaterial, PieceLine } from "@/components/calculator/types";

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
/** Orientamento dell'altezza del pezzo — deciso nel LISTINO, per prodotto.
 *  Default "horizontal": l'altezza del pezzo si sviluppa lungo il rotolo.
 *  "vertical" solo se il prodotto è flaggato con `verticalHeight`. */
export const resolveHeightOrientation = (
  piece: PieceLine,
  catalog: Catalog,
): "vertical" | "horizontal" => {
  const mats: CatalogMaterial[] = catalog?.materials ?? [];
  const exact =
    (piece.variantId ? mats.find((m) => m.id === piece.variantId) : null) ??
    (piece.catalogMaterialId ? mats.find((m) => m.id === piece.catalogMaterialId) : null);
  if (exact) return exact.verticalHeight ? "vertical" : "horizontal";
  const name = (piece.productName || "").trim().toLowerCase();
  const family = mats.filter((m) => (m.name || "").trim().toLowerCase() === name);
  return family.some((m) => m.verticalHeight) ? "vertical" : "horizontal";
};

/** Normalizza una lista di pezzi applicando l'orientamento del listino. */
export const withCatalogOrientation = (
  pieces: PieceLine[],
  catalog?: Catalog | null,
): PieceLine[] => {
  if (!catalog) return pieces;
  return pieces.map((p) => ({ ...p, heightOrientation: resolveHeightOrientation(p, catalog) }));
};
