/**
 * Sistema di pricing rivenditore vs cliente finale.
 *
 * Tabella moltiplicatori (fissa, da specifica):
 *   - Rivenditore  · intero (lastra/rotolo intero)  → ×1,3
 *   - Rivenditore  · al taglio                      → ×1,5
 *   - Cliente fin. · intero                         → ×1,5
 *   - Cliente fin. · al taglio                      → ×2,0
 *
 * "Intero" corrisponde a `priceMode = "piece"` (lastra/rotolo intero acquistato).
 * "Al taglio" corrisponde a `priceMode = "cut"`.
 */

export type CustomerType = "dealer" | "final";
export type PriceMode = "piece" | "cut";

export const CUSTOMER_LABEL: Record<CustomerType, string> = {
  dealer: "Rivenditore",
  final: "Cliente finale",
};

/** Restituisce il moltiplicatore di vendita applicato al prezzo d'acquisto. */
export const priceMultiplier = (
  customer: CustomerType,
  mode: PriceMode,
): number => {
  if (customer === "dealer") return mode === "piece" ? 1.3 : 1.5;
  // final
  return mode === "piece" ? 1.5 : 2.0;
};

/** Prezzo di vendita = prezzo d'acquisto × moltiplicatore. */
export const sellPrice = (
  purchasePrice: number,
  customer: CustomerType,
  mode: PriceMode,
): number => (purchasePrice || 0) * priceMultiplier(customer, mode);

/** Sigla breve per badge UI. */
export const customerBadge = (c: CustomerType): string =>
  c === "dealer" ? "RIV" : "FIN";