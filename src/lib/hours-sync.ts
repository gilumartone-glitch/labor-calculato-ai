import type { DayCell, HoursLog, HoursRow } from "@/components/contabilita/HoursLogView";

/** Merge by stable row identity and per-day edit time, including cleared cells. */
export const mergeHoursLog = (local: HoursLog = {}, remote: HoursLog = {}, localActive = false): HoursLog => {
  const result: HoursLog = {};
  for (const month of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const left = local[month] ?? { rows: [] };
    const right = remote[month] ?? { rows: [] };
    const deletedRowIds = [...new Set([...(left.deletedRowIds ?? []), ...(right.deletedRowIds ?? [])])];
    const dead = new Set(deletedRowIds);
    const rows = new Map<string, HoursRow>();
    const identity = (row: HoursRow) => row.dipendenteId ? `employee:${row.dipendenteId}` : `free:${row.id}`;
    for (const row of right.rows) if (!dead.has(row.id)) rows.set(identity(row), row);
    for (const row of left.rows) {
      if (dead.has(row.id)) continue;
      const other = rows.get(identity(row));
      if (!other) { rows.set(identity(row), row); continue; }
      const days: Record<number, DayCell> = {};
      const dayUpdatedAt: Record<number, number> = {};
      for (const key of new Set([...Object.keys(row.days), ...Object.keys(other.days)])) {
        const day = Number(key);
        const lt = row.dayUpdatedAt?.[day] ?? 0;
        const rt = other.dayUpdatedAt?.[day] ?? 0;
        const leftWins = lt > rt || (lt === rt && localActive);
        const cell = leftWins ? (row.days[day] ?? other.days[day]) : (other.days[day] ?? row.days[day]);
        if (cell) days[day] = cell;
        dayUpdatedAt[day] = Math.max(lt, rt);
      }
      rows.set(identity(row), { ...other, ...row, days, dayUpdatedAt });
    }
    // Keep the order rows were shown in: local order first, then rows only seen remotely.
    const order = new Map<string, number>();
    for (const row of [...left.rows, ...right.rows]) if (!order.has(identity(row))) order.set(identity(row), order.size);
    const sorted = [...rows.entries()].sort((a, b) => (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0)).map(([, r]) => r);
    result[month] = { rows: sorted, deletedRowIds };
  }
  return result;
};