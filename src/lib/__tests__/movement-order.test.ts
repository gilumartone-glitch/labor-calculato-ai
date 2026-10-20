import { describe, expect, it } from "vitest";
import { orderMovementRows } from "../movement-order";

describe("movement entry order", () => {
  const existing = { id: "existing", date: "2026-10-20", description: "Mario", amount: 50 };
  const entry = { id: "new", date: "2026-10-20", description: "", amount: 0 };

  it("keeps a new causale in place while its letters and other data are entered", () => {
    for (const description of ["A", "Al", "Alberto"]) {
      expect(orderMovementRows([existing, { ...entry, description, amount: 100 }], "name", ["existing", "new"]).map(row => row.id)).toEqual(["existing", "new"]);
    }
  });

  it("alphabetizes the completed entry after confirmation releases the frozen order", () => {
    expect(orderMovementRows([existing, { ...entry, description: "Alberto", amount: 100 }], "name").map(row => row.id)).toEqual(["new", "existing"]);
  });
});