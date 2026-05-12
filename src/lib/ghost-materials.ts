import { Catalog, DepartmentKey, MaterialLine, PieceLine } from "@/components/calculator/types";
import { CustomerType, priceMultiplier } from "@/lib/pricing";
import { convertLength } from "@/lib/perimeter";
import { computePieceMaterial } from "@/lib/piece";
import { uid } from "@/lib/format";

/** Margini extra (cm) richiesti quando un pezzo prende il materiale dal Laboratorio.
 *  Sono additivi al pezzo stesso (non ai margini di lavorazione standard). */
export const LAB_EXTRA_HEIGHT_CM = 20;
export const LAB_EXTRA_WIDTH_CM = 10;

/** Ritorna le righe materiale "ghost" da iniettare nel reparto Laboratorio
 *  in base ai pezzi degli altri reparti che hanno il flag `materialFromLab`.
 *  Le righe sono in sola lettura: mostrano la quantità di materiale (in m²
 *  oppure metri lineari, a seconda di `priceUnit` della variante) necessaria. */
export const buildGhostMaterialsForLab = (
  departments: Record<DepartmentKey, { pieces: PieceLine[] }>,
  labCatalog: Catalog,
  labCustomer: CustomerType,
): MaterialLine[] => {
  const out: MaterialLine[] = [];
  (Object.keys(departments) as DepartmentKey[]).forEach((deptKey) => {
    if (deptKey === "stampa") return; // niente self-ghost
    const deptLabel = deptKey === "tappezzeria" ? "Tappezzeria" : "Falegnameria";
    const pieces = departments[deptKey].pieces ?? [];
    pieces.forEach((piece, idx) => {
      if (!piece.materialFromLab || !piece.productName) return;

      // Cerca la variante: prima per id esplicito, poi per nome/colore/spessore/finitura
      const variant =
        (piece.variantId
          ? labCatalog.materials.find((m) => m.id === piece.variantId)
          : null) ??
        labCatalog.materials.find(
          (m) =>
            m.name === piece.productName &&
            (piece.color ? m.color === piece.color : true) &&
            (piece.thickness ? (m.thickness ?? "") === piece.thickness : true) &&
            (piece.finish ? (m.finish ?? "") === piece.finish : true),
        );
      if (!variant) return;

      // Dimensioni del pezzo + margini extra Lab (totali, NON per lato)
      const baseW = convertLength(piece.width || 0, piece.dimUnit, "m");
      const baseH = convertLength(piece.height || 0, piece.dimUnit, "m");
      if (baseW <= 0 || baseH <= 0) return;
      const wM = baseW + LAB_EXTRA_WIDTH_CM / 100;
      const hM = baseH + LAB_EXTRA_HEIGHT_CM / 100;
      const qtyPieces = Math.max(1, Math.floor(Number(piece.quantity) || 1));

      // Quantità totale materiale: usa il motore di calcolo del pezzo per tenere
      // conto anche di pannellatura/altezza rotolo. Qui NON aggiungiamo i margini
      // standard del pezzo: applichiamo solo i +20cm/+10cm del Laboratorio.
      const priceUnit = variant.priceUnit ?? "ml";
      const isMq = priceUnit === "mq";
      const labPiece: PieceLine = {
        ...piece,
        width: wM,
        height: hM,
        dimUnit: "m",
        quantity: 1,
        noMargins: true,
      };
      const breakdown = computePieceMaterial(labPiece, labCatalog, labCustomer);
      const quantity = breakdown.feasible
        ? (isMq ? breakdown.totalMetersM * breakdown.rollWidthM : breakdown.totalMetersM) * qtyPieces
        : (isMq ? wM * hM * qtyPieces : hM * qtyPieces);

      // Prezzo unitario d'acquisto, applicando il moltiplicatore del cliente Lab
      const purchase =
        piece.priceMode === "piece" ? variant.pricePiece : variant.priceCut;
      const mult = priceMultiplier(labCustomer, piece.priceMode);
      const unitCost = purchase * mult;

      const sourceLabel = `${deptLabel} · P${String(idx + 1).padStart(2, "0")}`;

      out.push({
        id: `ghost-${piece.id}`,
        catalogId: variant.id,
        name: variant.name,
        weight: variant.weight,
        color: variant.color,
        height: variant.height,
        heightUnit: variant.heightUnit,
        composition: variant.composition,
        fireproof: variant.fireproof,
        unit: isMq ? "mq" : "m",
        priceMode: piece.priceMode,
        quantity,
        unitCost,
        ghostFromPieceId: piece.id,
        ghostSourceLabel: sourceLabel,
      });
    });
  });
  return out;
};

// Riferimento per evitare warning su uid non usato in alcuni branch.
void uid;