/** Row-level sync for accounting lists: every edited row carries `_u` (edit time, ms). */
export type SyncRow = { id: string; _u?: number };

export const rowEditedAt = (row: SyncRow | undefined) => (row && typeof row._u === "number" ? row._u : 0);

/**
 * Merge two copies of a list by id. The most recently edited copy of a row wins,
 * so a stale copy (older save, other device) can never bring back an old value.
 * On equal edit time the remote copy wins unless the id is in `keepLocalIds`.
 */
export const mergeRowsById = <T extends SyncRow>(
  local: T[],
  remote: T[],
  tombstones: Set<string> = new Set(),
  keepLocalIds: Set<string> = new Set(),
): T[] => {
  const map = new Map<string, T>();
  for (const item of local) if (!tombstones.has(item.id)) map.set(item.id, item);
  for (const item of remote) {
    if (tombstones.has(item.id)) continue;
    const mine = map.get(item.id);
    if (!mine) { map.set(item.id, item); continue; }
    const lt = rowEditedAt(mine);
    const rt = rowEditedAt(item);
    if (lt > rt) continue;
    if (lt === rt && keepLocalIds.has(item.id)) continue;
    map.set(item.id, item);
  }
  return Array.from(map.values());
};

/** Stamp `_u = now` on rows of `after` that differ from their copy in `before`. */
export const stampChangedRows = <T extends SyncRow>(before: T[] = [], after: T[] = [], now = Date.now()): T[] => {
  const strip = (row: T) => { const { _u, ...rest } = row; void _u; return JSON.stringify(rest, Object.keys(rest).sort()); };
  const prev = new Map(before.map((row) => [row.id, row]));
  return after.map((row) => {
    const old = prev.get(row.id);
    if (old === row) return row;
    if (old && strip(old) === strip(row)) return row;
    return { ...row, _u: Math.max(now, rowEditedAt(old) + 1, rowEditedAt(row)) };
  });
};
