import { it, expect } from "vitest";
import { perimeterTimeCostPerPiece } from "@/lib/piece";
it("taglio a tempo: 120 min a 60 €/h su 4000 pezzi = 120 € totali", () => {
  expect(perimeterTimeCostPerPiece({ timeMinutes: 120, timeRate: 60 }, 4000) * 4000).toBeCloseTo(120);
});
