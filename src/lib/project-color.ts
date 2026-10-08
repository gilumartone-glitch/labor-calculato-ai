/** Colore stabile per progetto/cantiere: stesso nome → stesso colore in ogni calendario. */
export const colorForProject = (label: string) => {
  const key = (label || "").trim().toUpperCase().replace(/\s+/g, " ");
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  // distribuisce le tinte con il rapporto aureo per tenerle ben distinte
  const hue = Math.round(((h % 1000) * 0.618033988749895 * 360) % 360);
  const saturation = 62 + ((h >>> 10) % 20);
  const lightness = 30 + ((h >>> 20) % 12);
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
};
