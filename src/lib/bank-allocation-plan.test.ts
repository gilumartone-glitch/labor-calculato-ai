import { describe, expect, it } from "vitest";
import { allocationBalance, buildAllocationPlan } from "./bank-allocation-plan";
import type { BankTransaction, CompetenceMovement } from "./bank-reconciliation";
const bank = (id: string, amount: number, booking_date = "2026-10-28"): BankTransaction => ({ id, amount, booking_date, bank: "Credem", account_ref: "TEST", external_id: id, currency: "EUR", description: "SPANDEX", source: "csv", created_at: "", status: "BOOK" });
const competence = (id: string, amount: number, acconto = 0): CompetenceMovement => ({ id, amount, acconto, date: "2026-11-15", description: "SPANDEX", category: "TESSUTI", type: "uscita", status: "previsto" });
describe("bank allocation plans", () => {
  it("splits a 4500 euro outgoing movement across four Spandex entries", () => {
    const selections = [1000, 1500, 1200, 800].map((amount, i) => ({ movement: competence(String(i), amount), amount }));
    const plan = buildAllocationPlan([bank("bank", -4500)], [], selections);
    expect(plan.map(p => p.amount)).toEqual([1000, 1500, 1200, 800]);
    expect(allocationBalance([bank("bank", -4500)], [], selections)).toEqual({ bank: 4500, competence: 4500, allocated: 4500, difference: 0 });
  });
  it("shows a positive difference when the bank movement exceeds selected competence", () => {
    expect(allocationBalance([bank("b", -4500)], [], [{ movement: competence("c", 4000), amount: 4000 }]).difference).toBe(500);
  });
  it("shows a negative difference and rejects over-allocation", () => {
    const selections = [{ movement: competence("c", 5000), amount: 5000 }];
    expect(allocationBalance([bank("b", -4500)], [], selections).difference).toBe(-500);
    expect(() => buildAllocationPlan([bank("b", -4500)], [], selections)).toThrow("superano");
  });
  it("associates multiple payments to one competence preserving advances and sequential optimistic balances", () => {
    const plan = buildAllocationPlan([bank("b1", -1000), bank("b2", -3500)], [], [{ movement: competence("c", 5000, 500), amount: 4500 }]);
    expect(plan.map(p => [p.transaction_id, p.competence_id, p.amount, p.expected_amount, p.expected_acconto])).toEqual([["b1", "c", 1000, 5000, 500], ["b2", "c", 3500, 4000, 500]]);
  });
  it("registers every selected bank movement directly in cash with a shared causale", () => {
    const plan = buildAllocationPlan([bank("b1", -1000), bank("b2", 3500)], [], [], { description: "SPANDEX", category: "TESSUTI" });
    expect(plan.map(p => [p.competence_id, p.amount, p.description])).toEqual([[null, 1000, "SPANDEX"], [null, 3500, "SPANDEX"]]);
  });
  it("retains each movement's automatic causale when no common causale is entered", () => {
    const plan = buildAllocationPlan([bank("b1", -1000), { ...bank("b2", -3500), description: "PAGAMENTO CARTA DI DEBITO INTERNAZIONALE 123" }], [], [], { description: "", category: "" });
    expect(plan.map(p => p.description)).toEqual(["SPANDEX", "CARTA DI DEBITO"]);
  });
  it("does not permit pending movements to be registered in cash", () => {
    expect(() => buildAllocationPlan([{ ...bank("b", -4500), status: "PDNG" }], [], [], { description: "X", category: "" })).toThrow("sospeso");
  });
  it("rejects opposite directions for competence associations", () => {
    expect(() => buildAllocationPlan([bank("b1", -1000), bank("b2", 3500)], [], [{ movement: competence("c", 4500), amount: 4500 }])).toThrow("solo entrate");
  });
});