export type ContactType = "cliente" | "fornitore" | "entrambi";

export type Contact = {
  id: string;
  type: ContactType;
  name: string;
  vat?: string;        // P.IVA / CF
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  /** Fido manuale impostato dall'utente; se assente si usa il suggerito */
  fidoManual?: number;
  /** Movimenti collegati manualmente (oltre al match automatico per nome) */
  linkedIds?: string[];
  /** Movimenti esplicitamente esclusi dal match automatico */
  excludedIds?: string[];
  createdAt: string;
};

export const normalizeText = (s: string) =>
  (s ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Termini generici da ignorare quando si confrontano i nomi. */
const GENERIC_TOKENS = new Set([
  "srl", "srls", "spa", "snc", "sas", "sa", "sl", "scarl", "soc", "societa",
  "ditta", "di", "the", "and", "e", "&", "co", "company", "group",
  "lab", "studio", "service", "services", "italia", "italy",
]);

/** Estrae i token significativi (>=3 char, no termini generici) da una stringa. */
const significantTokens = (s: string): string[] => {
  return normalizeText(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !GENERIC_TOKENS.has(t));
};

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const containsAsWord = (text: string, word: string): boolean => {
  if (!word) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRegex(word)}([^a-z0-9]|$)`).test(text);
};

/**
 * Match tra causale movimento e nome anagrafica.
 * - Se il nome (normalizzato) compare come parola nella causale → match.
 * - Altrimenti match se condividono almeno un token significativo (>=3 char,
 *   escludendo "srl", "spa", articoli, ecc.). Così "APA" combacia con "APA SRL".
 */
export const movementMatchesContact = (movementDescription: string, contactName: string): boolean => {
  const text = normalizeText(movementDescription);
  const name = normalizeText(contactName);
  if (!text || name.length < 3) return false;
  if (containsAsWord(text, name)) return true;
  const nameTokens = significantTokens(contactName);
  if (nameTokens.length === 0) return false;
  return nameTokens.some((t) => containsAsWord(text, t));
};

export type MovementLite = {
  id: string;
  date: string;
  description: string;
  type: "entrata" | "uscita";
  status: "cassa" | "previsto";
  amount: number;
};

/** Restituisce i movimenti collegati a un contatto: match per nome + linkedIds − excludedIds. */
export const getContactMovements = <M extends MovementLite>(contact: Contact, movements: M[]): M[] => {
  const linked = new Set(contact.linkedIds ?? []);
  const excluded = new Set(contact.excludedIds ?? []);
  return movements.filter((m) => {
    if (excluded.has(m.id)) return false;
    if (linked.has(m.id)) return true;
    return movementMatchesContact(m.description, contact.name);
  });
};

export type ContactStats = {
  count: number;
  cassaIn: number;        // entrate incassate (da cliente)
  cassaOut: number;       // pagate (a fornitore)
  previstoIn: number;     // entrate ancora da incassare
  previstoOut: number;    // uscite ancora da pagare
  saldo: number;          // (cassaIn − cassaOut) per il contatto
  esposizione: number;    // previstoIn − previstoOut (positivo = ti devono ancora pagare)
  monthsActive: number;
  monthlyAvgIn: number;   // media mensile incassi (su mesi con almeno un incasso)
  fidoSuggerito: number;  // = monthlyAvgIn × 2 (per clienti); per fornitori 0
  firstDate?: string;
  lastDate?: string;
};

export const computeContactStats = (contact: Contact, movements: MovementLite[]): ContactStats => {
  const ms = getContactMovements(contact, movements);
  let cassaIn = 0, cassaOut = 0, previstoIn = 0, previstoOut = 0;
  const monthsWithIncome = new Set<string>();
  let firstDate: string | undefined, lastDate: string | undefined;
  for (const m of ms) {
    if (m.status === "cassa") {
      if (m.type === "entrata") {
        cassaIn += m.amount;
        monthsWithIncome.add(m.date.slice(0, 7));
      } else cassaOut += m.amount;
    } else {
      if (m.type === "entrata") previstoIn += m.amount;
      else previstoOut += m.amount;
    }
    if (!firstDate || m.date < firstDate) firstDate = m.date;
    if (!lastDate || m.date > lastDate) lastDate = m.date;
  }
  const monthsActive = monthsWithIncome.size;
  const monthlyAvgIn = monthsActive > 0 ? cassaIn / monthsActive : 0;
  const isCliente = contact.type === "cliente" || contact.type === "entrambi";
  const fidoSuggerito = isCliente ? Math.round(monthlyAvgIn * 2 * 100) / 100 : 0;
  return {
    count: ms.length,
    cassaIn, cassaOut, previstoIn, previstoOut,
    saldo: cassaIn - cassaOut,
    esposizione: previstoIn - previstoOut,
    monthsActive,
    monthlyAvgIn,
    fidoSuggerito,
    firstDate, lastDate,
  };
};

/** Suggerisce contatti dato un testo digitato (>=3 lettere) e un tipo movimento. */
export const suggestContacts = (
  query: string,
  contacts: Contact[],
  movementType?: "entrata" | "uscita",
  limit = 6,
): Contact[] => {
  const q = normalizeText(query);
  if (q.length < 3) return [];
  const wanted: ContactType | null = movementType === "entrata" ? "cliente" : movementType === "uscita" ? "fornitore" : null;
  return contacts
    .filter((c) => {
      if (wanted && c.type !== wanted && c.type !== "entrambi") return false;
      return normalizeText(c.name).includes(q);
    })
    .slice(0, limit);
};