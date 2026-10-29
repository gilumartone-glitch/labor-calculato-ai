import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { bankRemaining, competenceRemaining, parseBankAmount, validateAllocation, type BankTransaction, type BankAllocation, type CompetenceMovement } from "../bank-reconciliation";

const bank: BankTransaction = { id: "bank-1", bank: "Credem", account_ref: "AZIENDA", external_id: "1", booking_date: "2026-10-29", description: "FATTURA", amount: -100, currency: "EUR", source: "csv", created_at: "" };
const competence: CompetenceMovement = { id: "c1", date: "2026-09-10", description: "FATTURA", category: "FORNITORE", type: "uscita", status: "previsto", amount: 150 };
describe("bank reconciliation rules", () => {
  it("partial bank payment leaves the unpaid competence outstanding", () => {
    const paid = validateAllocation(bank, [], 100, competence);
    expect(competenceRemaining({ ...competence, amount: competence.amount - paid })).toBe(50);
  });
  it("full payment clears the competence residual", () => {
    expect(competenceRemaining({ ...competence, amount: 100 - validateAllocation(bank, [], 100, { ...competence, amount: 100 }) })).toBe(0);
  });
  it("a bank movement can be registered directly in cash", () => { expect(validateAllocation(bank, [], 100)).toBe(100); });
  it("already associated money cannot be counted twice", () => {
    const a: BankAllocation = { id: "a", transaction_id: bank.id, accounting_key: "main", competence_id: "c1", cash_movement_id: "cash", amount: 100, created_at: "" };
    expect(bankRemaining(bank, [a])).toBe(0);
    expect(() => validateAllocation(bank, [a], 100)).toThrow();
  });
  it("incoming transactions cannot pay outgoing competence", () => { expect(() => validateAllocation({ ...bank, amount: 100 }, [], 100, competence)).toThrow(); });
  it("previous manual advances are not paid a second time", () => { expect(() => validateAllocation(bank, [], 100, { ...competence, amount: 150, acconto: 60 })).toThrow(); });
  it("Italian statement amounts retain their sign and cents", () => { expect(parseBankAmount("-1.234,56 €")).toBe(-1234.56); });
  it("CSV loading preserves decimal commas before amount conversion", () => {
    const wb = XLSX.read("Data;Importo\n29/10/2026;-1,00\n29/10/2026;0,50\n", { type: "string", raw: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<{ Importo: string }>(sheet);
    expect(parseBankAmount(rows[0].Importo)).toBe(-1);
    expect(parseBankAmount(rows[1].Importo)).toBe(0.5);
  });
});