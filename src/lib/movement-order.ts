type MovementOrderRow = { id: string; date: string; description: string; amount: number };

/** Keep the entry's position stable until the user confirms the complete form. */
export function orderMovementRows<T extends MovementOrderRow>(rows: T[], sortBy: "date" | "name" | "amount", frozenIds?: string[]): T[] {
  const sorted = [...rows];
  if (frozenIds) {
    const positions = new Map(frozenIds.map((id, index) => [id, index]));
    return sorted.sort((a, b) => (positions.get(a.id) ?? frozenIds.length) - (positions.get(b.id) ?? frozenIds.length));
  }
  if (sortBy === "date") return sorted.sort((a, b) => a.date.localeCompare(b.date));
  if (sortBy === "name") return sorted.sort((a, b) => a.description.localeCompare(b.description, "it", { sensitivity: "base" }));
  return sorted.sort((a, b) => b.amount - a.amount);
}