// Mappa macro → microreparti. Allineata ai valori usati in profiles.settori.
export type MacroReparto = "laboratorio" | "tappezzeria" | "montaggi" | "uffici" | "magazzino";

export const MACRO_REPARTI: { k: MacroReparto; label: string }[] = [
  { k: "laboratorio", label: "Laboratorio" },
  { k: "tappezzeria", label: "Tappezzeria" },
  { k: "montaggi", label: "Montaggi" },
  { k: "uffici", label: "Uffici" },
  { k: "magazzino", label: "Magazzino" },
];

export const MICRO_BY_MACRO: Record<MacroReparto, { k: string; label: string }[]> = {
  laboratorio: [
    { k: "grafica", label: "Grafica" },
    { k: "stampa", label: "Stampa" },
    { k: "taglio", label: "Taglio" },
    { k: "confezione", label: "Confezione" },
  ],
  tappezzeria: [
    { k: "taglio_tessuti", label: "Taglio tessuti" },
    { k: "cucito", label: "Cucito" },
    { k: "montaggio_tende", label: "Montaggio tende" },
  ],
  montaggi: [
    { k: "trasporto", label: "Trasporto" },
    { k: "installazione", label: "Installazione" },
  ],
  uffici: [
    { k: "amministrazione", label: "Amministrazione" },
    { k: "commerciale", label: "Commerciale" },
    { k: "marketing", label: "Marketing" },
    { k: "progettazione", label: "Progettazione" },
  ],
  magazzino: [
    { k: "ricezione_merci", label: "Ricezione merci" },
    { k: "stoccaggio", label: "Stoccaggio" },
    { k: "spedizioni", label: "Spedizioni" },
    { k: "inventario", label: "Inventario" },
  ],
};



export const microsOf = (m: MacroReparto) => MICRO_BY_MACRO[m].map((x) => x.k);

export const microLabel = (k: string): string => {
  for (const m of Object.values(MICRO_BY_MACRO)) {
    const f = m.find((x) => x.k === k);
    if (f) return f.label;
  }
  return k;
};

export type UserLite = { id: string; display_name: string | null; settori?: string[] | null };

/** Utenti che hanno almeno un micro del macro indicato. */
export const filterUsersByMacro = (users: UserLite[], macro: MacroReparto): UserLite[] => {
  const micros = new Set(microsOf(macro));
  return users.filter((u) => (u.settori ?? []).some((s) => micros.has(s)));
};

/** Utenti che hanno quel micro specifico. */
export const filterUsersByMicro = (users: UserLite[], micro: string): UserLite[] =>
  users.filter((u) => (u.settori ?? []).includes(micro));
