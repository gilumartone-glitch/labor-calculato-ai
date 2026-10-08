import { describe, it, expect } from "vitest";
import { applyRateChange, rateAt } from "@/lib/dipendenti";

describe("cambio stipendio da una data", () => {
  it("i mesi precedenti al cambio restano con la vecchia paga", () => {
    const h = applyRateChange(8, [], "2026-10-01", 10);
    const d = { hourly_rate: 10, rate_history: h };
    expect(rateAt(d, "2026-09-30")).toBe(8);
    expect(rateAt(d, "2026-10-01")).toBe(10);
  });
  it("senza storico usa la paga attuale", () => {
    expect(rateAt({ hourly_rate: 9, rate_history: [] }, "2026-01-05")).toBe(9);
  });
});
