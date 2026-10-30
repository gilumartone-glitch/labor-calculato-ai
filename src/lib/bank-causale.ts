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
  const original = movement.description ?? "";
  if (/\bPAGAMENTO\s+CARTA\s+DI\s+DEBITO\s+INTERNAZIONALE\b/i.test(original)) return "CARTA DI DEBITO";
  const structured = movement.counterparty_name?.trim();
  if (structured) return clean(structured);

  const transfer = original.match(/^\s*BONIFICO\s+(?:A\s+CREDITO|A\s+DEBITO|IN\s+ENTRATA|IN\s+USCITA)\s+(.+)/i)?.[1];
  if (transfer) {
    const name = transfer.split(/\s+\b(?:SALDO|ACCONTO|PAGAMENTO|CAUSALE|RIF\.|RIFERIMENTO|CRO\s*:|TRN\s*:|IBAN\s*:)\b|\s+RIF\./i)[0]?.trim();
    if (name && /\p{L}/u.test(name)) return clean(name);
  }
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