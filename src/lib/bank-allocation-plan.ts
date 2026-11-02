import { bankRemaining, competenceRemaining, money, validateAllocation, type BankAllocation, type BankTransaction, type CompetenceMovement } from "./bank-reconciliation";
import { bankCausale } from "./bank-causale";

export type CompetenceSelection = { movement: CompetenceMovement; amount: number };
export type ReconciliationEntry = { transaction_id: string; request_id: string; competence_id: string | null; amount: number; description: string; category: string; expected_amount: number | null; expected_acconto: number | null };

export function allocationBalance(transactions: BankTransaction[], allocations: BankAllocation[], selections: CompetenceSelection[]) {
  const bank = money(transactions.reduce((sum, t) => sum + bankRemaining(t, allocations), 0));
  const competence = money(selections.reduce((sum, s) => sum + competenceRemaining(s.movement), 0));
  const allocated = money(selections.reduce((sum, s) => sum + s.amount, 0));
  return { bank, competence, allocated, difference: money(bank - competence) };
}

export function buildAllocationPlan(transactions: BankTransaction[], allocations: BankAllocation[], selections: CompetenceSelection[], direct?: { description: string; category: string; amount?: number }): ReconciliationEntry[] {
  if (!transactions.length || transactions.length > 500) throw new Error("Seleziona da 1 a 500 movimenti.");
  if (new Set(transactions.map(t => t.id)).size !== transactions.length) throw new Error("Movimento selezionato più volte.");
  for (const t of transactions) validateAllocation(t, allocations, bankRemaining(t, allocations));
  const entry = (t: BankTransaction, amount: number, competence?: CompetenceMovement): ReconciliationEntry => ({ transaction_id: t.id, request_id: crypto.randomUUID(), competence_id: competence?.id ?? null, amount, description: direct?.description.trim() || bankCausale(t), category: direct?.category ?? "", expected_amount: competence?.amount ?? null, expected_acconto: competence ? Math.min(competence.amount, Math.max(0, competence.acconto ?? 0)) : null });
  if (direct) return transactions.map(t => entry(t, validateAllocation(t, allocations, transactions.length === 1 && direct.amount !== undefined ? direct.amount : bankRemaining(t, allocations))));
  if (!selections.length) throw new Error("Scegli almeno una voce di competenza.");
  if (new Set(selections.map(s => s.movement.id)).size !== selections.length) throw new Error("Competenza selezionata più volte.");
  if (transactions.some(t => Math.sign(t.amount) !== Math.sign(transactions[0].amount))) throw new Error("Per associare a competenza seleziona solo entrate oppure solo uscite.");
  const balance = allocationBalance(transactions, allocations, selections);
  if (balance.allocated > balance.bank) throw new Error("Gli importi da associare superano il residuo bancario.");
  const remaining = transactions.map(t => bankRemaining(t, allocations));
  const result: ReconciliationEntry[] = [];
  let index = 0;
  for (const selection of selections) {
    let left = validateAllocation({ ...transactions[0], amount: Math.sign(transactions[0].amount) * balance.bank }, [], selection.amount, selection.movement);
    let current = { ...selection.movement };
    while (left > 0) {
      const t = transactions[index];
      if (!t) throw new Error("Importo superiore al residuo bancario.");
      const value = money(Math.min(left, remaining[index]));
      if (value > 0) {
        result.push(entry(t, value, current));
        current = { ...current, amount: money(current.amount - value) };
        remaining[index] = money(remaining[index] - value);
        left = money(left - value);
      }
      if (remaining[index] === 0) index++;
    }
  }
  return result;
}