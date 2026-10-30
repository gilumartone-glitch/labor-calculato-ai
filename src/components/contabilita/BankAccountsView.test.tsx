import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { BankAccountsView } from "./BankAccountsView";

const { invoke, rpc, bankRows } = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(async () => ({ data: [], error: null })), bankRows: [] as Record<string, unknown>[] }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ can: () => true, isAmministrazione: true }) }));
vi.mock("./BankBalances", () => ({ BankBalances: () => null }));
vi.mock("./BankLiveConnection", () => ({ BankLiveConnection: () => null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke },
    rpc,
    from: (table: string) => {
      const query: Record<string, unknown> = {};
      for (const method of ["select", "gte", "lte", "order", "eq", "range", "limit"]) query[method] = () => query;
      query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "bank_transactions" ? bankRows : [], error: null }).then(resolve);
      return query;
    },
  },
}));

describe("live provider accounts", () => {
  afterEach(() => { cleanup(); bankRows.length = 0; rpc.mockClear(); });
  it.each([
    ["PAGAMENTO DEBINT PDINT PAGAMENTO CARTA DI DEBITO INTERNAZIONALE 537599******0775 -28/10/26-04:53 BONOMO;causale interna", "CARTA DI DEBITO", -36.87],
    ["BONIFICO A CREDITO SOCIETA' COSTRUZIONE SEGNALETICA SOCI SALDO ORDINE 356/2026 DEL 01.10.2026 RIF. 263026062979340-486784068*.", "SOCIETA' COSTRUZIONE SEGNALETICA SOCI", 100],
  ])("registers the automatic direct-cash causale for %s", async (original, expected, amount) => {
    bankRows.push({ id: "test-movement", bank: "Credem", account_ref: "TEST", external_id: "test", booking_date: "2026-10-28", description: original, amount, currency: "EUR", status: "BOOK" });
    invoke.mockResolvedValue({ data: { status: "ready", accounts: [] }, error: null });
    render(<BankAccountsView year={2026} accountingKey="2026" saving={false} onReconciled={vi.fn(async () => {})} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Associa$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Inserisci direttamente in cassa" }));
    expect(screen.getByLabelText("Causale")).toHaveValue(expected);
    await waitFor(() => expect(screen.getByRole("button", { name: "Conferma associazione" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Conferma associazione" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("reconcile_bank_transaction", expect.objectContaining({ _description: expected, _competence_id: null, _amount: Math.abs(amount) })));
  });
  it("reads open-banking.io instead of counting obsolete Enable consents", async () => {
    invoke.mockResolvedValue({ data: { status: "ready", accounts: [{ id: "view-1", bank: "Credem", account_ref: "view-1", display_name: "AZIENDA", iban_last4: "1234", currency: "EUR", balance: "10.00", balance_date: null, last_sync_at: null, is_active: true, needs_reconnect: false, valid_until: "2027-01-27" }] }, error: null });
    render(<BankAccountsView year={2026} accountingKey="2026" saving={false} onReconciled={vi.fn()} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("obio-accounts", { body: {} }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Aggiorna conti open-banking.io" })).toBeEnabled());
    expect(invoke).not.toHaveBeenCalledWith("bank-sync", expect.anything());
  });
});
