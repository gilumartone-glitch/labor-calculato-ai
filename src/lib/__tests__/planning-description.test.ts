import { describe, expect, it } from "vitest";
import { readPlanningDescription, writePlanningDescription } from "../planning-description";

describe("manual planning descriptions", () => {
  it("saves multiline descriptions independently of customer, location and notes", () => {
    const notes = "Cliente: TEATRO\nLuogo: ROMA\nPortare trapano";
    const description = "Montaggio fondale\nVelluto 550 × 379 cm, 2 pezzi";
    expect(readPlanningDescription(writePlanningDescription(notes, description))).toEqual({ description, notes });
  });
  it("preserves legacy notes when no description is present", () => {
    expect(readPlanningDescription("Portare trapano")).toEqual({ description: "", notes: "Portare trapano" });
  });
  it("replaces or removes a description without duplicates or losing notes", () => {
    const saved = writePlanningDescription("Attrezzi", "Vecchia descrizione");
    expect(readPlanningDescription(writePlanningDescription(saved, "Nuova descrizione"))).toEqual({ description: "Nuova descrizione", notes: "Attrezzi" });
    expect(writePlanningDescription(saved, "")).toBe("Attrezzi");
  });
});