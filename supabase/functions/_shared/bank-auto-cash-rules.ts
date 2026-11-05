import { bankCausale } from "./bank-causale.ts";

export function automaticCashCausale(movement: Parameters<typeof bankCausale>[0]): string | null {
  const label = bankCausale(movement).trim().toLocaleUpperCase("it-IT");
  return ["CARTA DI DEBITO", "BANCA", "GOOGLE"].includes(label) ? label : null;
}