type Movement = {
  description?: string;
  amount?: number;
  counterparty_name?: string | null;
  manual_updated_at?: string | null;
};

const clean = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleUpperCase("it-IT");
const endOfName = /\s*(?:[;|]|\b(?:CAUSALE|MOTIVO|IBAN|B\.\s*ORD|DES\s*\/\s*BEN|RIFERIMENTO|CRO|TRN)\s*[:/])/i;

/** Presentation only: never change the bank description or its deduplication identity. */
export function bankCausale(movement: Movement): string {
  if (movement.manual_updated_at) return movement.description ?? "";
  const structured = movement.counterparty_name?.trim();
  if (structured) return clean(structured);

  const original = movement.description ?? "";
  // BNL incoming transfers carry the payer between the YYY date and B.ORD.
  if ((movement.amount ?? 0) > 0) {
    const bnl = original.match(/^\s*YYY\d{8}\s+(.+?)\s+B\.\s*ORD\s*:/i);
    if (bnl?.[1]?.trim()) return clean(bnl[1]);
  }
  const marker = (movement.amount ?? 0) > 0
    ? /\b(?:ORDINANTE|DEBITORE|MITTENTE)\s*:\s*(.+)/i
    : /\b(?:BENEFICIARIO|CREDITORE|DESTINATARIO)\s*:\s*(.+)/i;
  const explicit = original.match(marker)?.[1]?.split(endOfName)[0]?.trim();
  if (explicit && /\p{L}/u.test(explicit)) return clean(explicit);
  // Do not guess a person's name from an unstructured card/payment narrative.
  return original;
}