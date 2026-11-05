type Movement = {
  description?: string;
  amount?: number;
  counterparty_name?: string | null;
  manual_updated_at?: string | null;
};

const clean = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleUpperCase("it-IT");
const endOfName = /\s*(?:[;|]|\b(?:CAUSALE|MOTIVO|IBAN|B\.\s*ORD|DES\s*\/\s*BEN|RIFERIMENTO|CRO|TRN)\s*[:/])/i;

const ADDRESS = /\s+(?:C\/O|VIA|V\.LE|VIALE|PIAZZA|P\.ZZA|P\.LE|PIAZZALE|CORSO|C\.SO|LOC\.|LOCALITA'?|CONTRADA|STRADA|LARGO|VICOLO)\s/;
const LEGAL = /\s+(?:S\.?\s?R\.?\s?L\.?S?|S\.?R\.?$|S\.?\s?P\.?\s?A\.?|S\.?N\.?C\.?|S\.?A\.?S\.?|GMBH|B\.V\.|SOCIETA'\s+(?:A\s+RESP|P\b|PER\s+AZ|COOP)|SOC\.\s*COOP)(?=[\s,.;]|$)/;
const TAIL = /^(?:IRELAND|ITALIA|ITALY|EUROPE|EU|LIMITED|LTD|AG|KG|INC|SARL|SA|TEXTILWERKE|MILAN|BRANCH)$/;

/** Reduce a counterparty to its name: no address, legal form, country or branch words. */
export function counterpartyName(value: string): string {
  const full = clean(value);
  const words = full.split(ADDRESS)[0].split(LEGAL)[0].replace(/[,;.\s-]+$/, "").split(" ");
  while (words.length > 1 && TAIL.test(words[words.length - 1])) words.pop();
  return words.join(" ") || full;
}

/**
 * Presentation only: never change the bank description or its deduplication identity.
 * Goal: show who paid (incoming) or who was paid (outgoing), never the payment reason.
 */
export function bankCausale(movement: Movement): string {
  if (movement.manual_updated_at) return movement.description ?? "";
  const original = movement.description ?? "";
  const amount = movement.amount ?? 0;

  // PayPal: "name · subject · note".
  if (original.includes(" · ")) return counterpartyName(original.split(" · ")[0]);

  const structured = movement.counterparty_name?.trim();
  if (structured) return counterpartyName(structured);

  // Credem incoming: "Ordinante: NAME ADDRESS; ..." / outgoing "Beneficiario: ...".
  const party = original.match(/^\s*(?:ORDINANTE|BENEFICIARIO)\s*:\s*([^;]+)/i)?.[1];
  if (party?.trim()) return counterpartyName(party);

  // Credem coded rows: "TYPE   CODE rest;causale interna: XX" (optionally after "rif. banca ...; ulteriori descrizioni:").
  const body = original.replace(/^\s*rif\.\s*banca:[^;]*;\s*ulteriori descrizioni:\s*/i, "").replace(/;\s*causale interna.*$/i, "");
  const coded = body.match(/^(.+?)\s{2,}([A-Z][A-Z0-9]{2,4})\b\s*(.*)$/);
  if (coded) {
    const [, type, code, rest] = coded;
    if (/^VIACARD/i.test(type)) return "VIACARD";
    if (/CARTA\s+(?:DI\s+)?DEBITO/i.test(body) || code === "PDINT") return "CARTA DI DEBITO";
    if (/^CO/.test(code)) return "BANCA"; // commissioni, spese, canoni bancari
    let name = "";
    if (code === "PDDDC") name = rest.match(/\bDA\s+(.+?)(?:\s+MANDATO\b|$)/i)?.[1] ?? "";
    else if (code === "ERRIB") name = rest.split(/\s{2,}/).pop() ?? ""; // ricevuta bancaria: creditore in fondo
    else name = rest.split(/\s+MANDATO\b|\s+RIF\.?\s|\s{2,}/i)[0] ?? "";
    if (/\p{L}{2}/u.test(name)) return counterpartyName(name);
    return clean(type).replace(/^PAGAMENTO\s+/, "") || clean(type);
  }

  const transfer = original.match(/^\s*BONIFICO\s+(?:A\s+CREDITO|A\s+DEBITO|IN\s+ENTRATA|IN\s+USCITA)\s+(.+)/i)?.[1];
  if (transfer) {
    const name = transfer.split(/\s+\b(?:SALDO|ACCONTO|PAGAMENTO|CAUSALE|RIF\.|RIFERIMENTO|CRO\s*:|TRN\s*:|IBAN\s*:)\b|\s+RIF\./i)[0]?.trim();
    if (name && /\p{L}/u.test(name)) return counterpartyName(name);
  }
  // BNL incoming transfers carry the payer between the YYY date and B.ORD.
  if (amount > 0) {
    const bnl = original.match(/^\s*YYY\d{8}\s+(.+?)\s+B\.\s*ORD\s*:/i);
    if (bnl?.[1]?.trim()) return counterpartyName(bnl[1]);
  }
  const marker = amount > 0
    ? /\b(?:ORDINANTE|DEBITORE|MITTENTE)\s*:\s*(.+)/i
    : /\b(?:BENEFICIARIO|CREDITORE|DESTINATARIO|BEN)\s*:\s*(.+)/i;
  const explicit = original.match(marker)?.[1]?.split(endOfName)[0]?.trim();
  if (explicit && /\p{L}/u.test(explicit)) return counterpartyName(explicit);
  // Plain names (e.g. "GIADA DE LUCA", "DASIC SRLS") or unknown text: strip legal form/address only.
  return counterpartyName(original);
}
