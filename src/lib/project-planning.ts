export type PlanningDay = {
  id: string; commessa_id: string | null; cantiere_label: string; operator_id: string;
  date: string; hours: number; notes: string | null; reparto: string | null;
  created_by: string; completed_at?: string | null;
};
export type DepartmentDates = { dept: string; start: string; end: string; due: string; operators: string[] };

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86400000;
const dateKey = (day: number) => new Date(day * 86400000).toISOString().slice(0, 10);

/** Preserve each day's crew, hours, notes and identity when shifting an existing plan. */
export function buildProjectPlanning(existing: PlanningDay[], dates: DepartmentDates[], project: {
  id: string; label: string; userId: string;
}, newId: () => string): { rows: PlanningDay[]; removedIds: string[] } {
  const rows: PlanningDay[] = [];
  for (const department of dates) {
    const start = dayNumber(department.start), end = dayNumber(department.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 730) {
      throw new Error(`Controlla le date di ${department.dept} (massimo due anni).`);
    }
    const previous = existing.filter(row => (row.reparto ?? "montaggi") === department.dept);
    if (previous.length) {
      const oldStart = Math.min(...previous.map(row => dayNumber(row.date)));
      const oldEnd = Math.max(...previous.map(row => dayNumber(row.date)));
      for (const row of previous) {
        const nextDay = start + dayNumber(row.date) - oldStart;
        if (nextDay <= end) rows.push({ ...row, date: dateKey(nextDay) });
      }
      // Extension keeps the crew and work details of the last scheduled day.
      const lastCrew = previous.filter(row => dayNumber(row.date) === oldEnd);
      for (let day = start + oldEnd - oldStart + 1; day <= end; day++) {
        for (const row of lastCrew) rows.push({ ...row, id: newId(), date: dateKey(day), completed_at: null, created_by: project.userId });
      }
    } else {
      if (!department.operators.length) throw new Error(`Scegli almeno un operaio per ${department.dept}.`);
      for (let day = start; day <= end; day++) {
        for (const operator of department.operators) rows.push({
          id: newId(), commessa_id: project.id, cantiere_label: project.label,
          operator_id: operator, date: dateKey(day), hours: 8, notes: null,
          reparto: department.dept, created_by: project.userId,
        });
      }
    }
  }
  const kept = new Set(rows.map(row => row.id));
  const edited = new Set(dates.map(row => row.dept));
  return { rows, removedIds: existing.filter(row => edited.has(row.reparto ?? "montaggi") && !kept.has(row.id)).map(row => row.id) };
}