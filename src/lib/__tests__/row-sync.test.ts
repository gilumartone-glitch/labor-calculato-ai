import { describe, expect, it } from "vitest";
import { mergeRowsById, stampChangedRows } from "../row-sync";

type Mov = { id: string; date: string; status: string; _u?: number };

describe("accounting row sync", () => {
  it("a movement moved to next month stays moved when an older copy arrives", () => {
    const local: Mov[] = [{ id: "pongs", date: "2026-11-15", status: "previsto", _u: 2000 }];
    const remote: Mov[] = [{ id: "pongs", date: "2026-10-15", status: "previsto", _u: 1000 }];
    expect(mergeRowsById(local, remote)[0].date).toBe("2026-11-15");
  });

  it("an F24 marked paid stays paid against a copy without edit time", () => {
    const local: Mov[] = [{ id: "f24", date: "2026-10-16", status: "cassa", _u: 5 }];
    const remote: Mov[] = [{ id: "f24", date: "2026-10-16", status: "previsto" }];
    expect(mergeRowsById(local, remote)[0].status).toBe("cassa");
  });

  it("a newer edit from another device replaces the local copy", () => {
    const local: Mov[] = [{ id: "a", date: "2026-10-01", status: "previsto", _u: 1 }];
    const remote: Mov[] = [{ id: "a", date: "2026-10-01", status: "cassa", _u: 9 }];
    expect(mergeRowsById(local, remote)[0].status).toBe("cassa");
  });

  it("only changed rows get a new edit time", () => {
    const before: Mov[] = [{ id: "a", date: "x", status: "previsto", _u: 1 }, { id: "b", date: "y", status: "previsto", _u: 1 }];
    const after: Mov[] = [before[0], { ...before[1], status: "cassa" }];
    const out = stampChangedRows(before, after, 100);
    expect(out[0]._u).toBe(1);
    expect(out[1]._u).toBe(100);
  });

  it("an undo gets a newer edit time than the edit it undoes", () => {
    const edited: Mov[] = [{ id: "a", date: "nov", status: "previsto", _u: 500 }];
    const undone: Mov[] = [{ id: "a", date: "oct", status: "previsto", _u: 100 }];
    expect(stampChangedRows(edited, undone, 50)[0]._u).toBeGreaterThan(500);
  });
});
