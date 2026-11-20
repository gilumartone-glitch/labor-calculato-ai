/** Modalità di pagamento della Contabilità: una lettera per ciascuna. */
export const DEFAULT_PAYMENT_METHODS: { code: string; label: string }[] = [
  { code: "B", label: "B - Bonifico" },
  { code: "C", label: "C - Contanti" },
  { code: "F", label: "F - Fisso" },
  { code: "N", label: "N - Note" },
  { code: "R", label: "R - Ricevuta" },
  { code: "A", label: "A - Assegno" },
  { code: "P", label: "P - PayPal" },
];

export const PAYMENT_CODES = DEFAULT_PAYMENT_METHODS.map((m) => m.code);

/** Riporta alla lettera anche le diciture per esteso arrivate da vecchi dati o da import. */
export const paymentCode = (method?: string) => {
  const value = (method ?? "").trim().toUpperCase();
  if (value === "CC") return "C";
  if (PAYMENT_CODES.includes(value)) return value;
  if (value === "BONIFICO") return "B";
  if (value === "CONTANTI") return "C";
  if (value === "SPESA FISSA") return "F";
  if (value === "NELLA") return "N";
  if (value === "RIBA") return "R";
  if (value === "ASSEGNO") return "A";
  if (value === "PAYPAL") return "P";
  return value;
};
