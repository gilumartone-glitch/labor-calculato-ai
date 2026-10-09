import { describe, it, expect } from "vitest";
import { withFullness } from "@/lib/piece";

describe("ricchezza sulle lavorazioni perimetrali", () => {
  it("ricchezza 100% raddoppia la larghezza usata per misurare", () => {
    const p = withFullness({ width: 200, height: 300, fullnessPct: 100 } as any);
    expect(p.width).toBe(400);
    expect(p.height).toBe(300);
  });
});
