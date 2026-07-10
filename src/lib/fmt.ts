// Formattatori numerici condivisi per nesting/magazzino.
// Mostrano decimali senza mai arrotondare all'intero.

/** Millimetri → centimetri con 1 decimale (elimina .0 quando intero). */
export const mmToCm = (mm: number): string => {
  const v = (Number(mm) || 0) / 10;
  const s = v.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
};

/** Metri → centimetri con 1 decimale (elimina .0 quando intero). */
export const mToCm = (m: number): string => {
  const v = (Number(m) || 0) * 100;
  const s = v.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
};
