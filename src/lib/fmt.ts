// Formattatori numerici condivisi per nesting/magazzino.
// Mostrano i cm con precisione al millimetro, senza arrotondare all'intero.

const formatCmAtMillimeter = (cm: number): string => {
  const s = cm.toFixed(1).replace(".", ",");
  return s.endsWith(",0") ? s.slice(0, -2) : s;
};

/** Millimetri → centimetri con 1 decimale (elimina ,0 quando intero). */
export const mmToCm = (mm: number): string => {
  const v = (Number(mm) || 0) / 10;
  return formatCmAtMillimeter(v);
};

/** Metri → centimetri con 1 decimale (elimina ,0 quando intero). */
export const mToCm = (m: number): string => {
  const v = (Number(m) || 0) * 100;
  return formatCmAtMillimeter(v);
};
