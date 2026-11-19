import { describe, expect, it } from "vitest";
import { buildProjectPlanning, type PlanningDay } from "../project-planning";

const project = { id: "project-1", label: "UMBRIA", userId: "owner" };
const row = (id: string, date: string, operator: string): PlanningDay => ({ id, date, operator_id: operator,
  commessa_id: project.id, cantiere_label: project.label, hours: 4, notes: "ATTREZZI", reparto: "tappezzeria", created_by: "owner" });
describe("project planning dates", () => {
  it("shifts every project day to 2027 preserving daily crews and work details", () => {
    const result = buildProjectPlanning([row("a", "2026-11-19", "guido"), row("b", "2026-11-20", "salvatore")],
      [{ dept: "tappezzeria", start: "2027-01-15", end: "2027-01-16", due: "2027-01-16", operators: [] }], project, () => "new");
    expect(result.rows.map(r => [r.id, r.date, r.operator_id, r.hours, r.notes])).toEqual([
      ["a", "2027-01-15", "guido", 4, "ATTREZZI"], ["b", "2027-01-16", "salvatore", 4, "ATTREZZI"],
    ]);
    expect(result.removedIds).toEqual([]);
  });
  it("restores deleted planning under the same project identity for every department", () => {
    let id = 0;
    const result = buildProjectPlanning([], [
      { dept: "tappezzeria", start: "2026-11-30", end: "2026-11-30", due: "", operators: ["guido"] },
      { dept: "montaggi", start: "2026-12-02", end: "2026-12-03", due: "", operators: ["guido", "salvatore"] },
    ], project, () => String(++id));
    expect(result.rows).toHaveLength(5);
    expect(result.rows.map(r => r.commessa_id)).toEqual(Array(5).fill("project-1"));
    expect(result.rows.filter(r => r.reparto === "montaggi").map(r => r.date)).toEqual(["2026-12-02", "2026-12-02", "2026-12-03", "2026-12-03"]);
  });
  it("trims only days beyond the edited end and leaves other departments untouched", () => {
    const result = buildProjectPlanning([row("a", "2026-11-19", "guido"), row("b", "2026-11-20", "guido"),
      { ...row("c", "2026-11-20", "guido"), reparto: "montaggi" }],
      [{ dept: "tappezzeria", start: "2026-11-19", end: "2026-11-19", due: "", operators: [] }], project, () => "new");
    expect(result.removedIds).toEqual(["b"]);
  });
  it("extends the plan with the last day's crew without marking new days completed", () => {
    const result = buildProjectPlanning([{ ...row("a", "2026-11-19", "guido"), completed_at: "2026-11-19T10:00:00Z" }],
      [{ dept: "tappezzeria", start: "2026-11-19", end: "2026-11-20", due: "", operators: [] }], project, () => "new");
    expect(result.rows[1]).toMatchObject({ id: "new", date: "2026-11-20", operator_id: "guido", hours: 4, notes: "ATTREZZI", completed_at: null });
  });
  it("rejects reversed dates and ranges longer than 730 days before writing", () => {
    for (const end of ["2026-11-18", "2028-11-20"]) {
      expect(() => buildProjectPlanning([], [{ dept: "montaggi", start: "2026-11-19", end, due: "", operators: ["guido"] }], project, () => "new")).toThrow();
    }
  });
});