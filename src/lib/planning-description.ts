export function readPlanningDescription(notes: string | null) {
  const lines = (notes ?? "").split("\n");
  const encoded = lines.find(line => line.startsWith("Descrizione progetto: "));
  let description = "";
  if (encoded) {
    try { const value: unknown = JSON.parse(encoded.slice("Descrizione progetto: ".length)); if (typeof value === "string") description = value; } catch { description = encoded.slice("Descrizione progetto: ".length); }
  }
  return { description, notes: lines.filter(line => !line.startsWith("Descrizione progetto: ")).join("\n") };
}

export function writePlanningDescription(notes: string | null, description: string) {
  const rest = readPlanningDescription(notes).notes;
  return [description.trim() ? `Descrizione progetto: ${JSON.stringify(description.trim())}` : "", rest].filter(Boolean).join("\n") || null;
}