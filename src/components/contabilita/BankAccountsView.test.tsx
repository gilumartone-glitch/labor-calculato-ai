import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { BankAccountsView } from "./BankAccountsView";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ can: () => true, isAmministrazione: true }) }));
vi.mock("./BankBalances", () => ({ BankBalances: () => null }));
vi.mock("./BankLiveConnection", () => ({ BankLiveConnection: () => null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke },
    rpc: vi.fn(async () => ({ data: [{ bank: "Credem", status: "authorized", account_count: 1, consent_expires_at: "2027-01-27" }] })),
    from: () => {
      const query: Record<string, unknown> = {};
      for (const method of ["select", "gte", "lte", "order", "eq", "range", "limit"]) query[method] = () => query;
      query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
      return query;
    },
  },
}));

describe("live provider accounts", () => {
  afterEach(cleanup);
  it("reads open-banking.io instead of counting obsolete Enable consents", async () => {
    invoke.mockResolvedValue({ data: { status: "ready", accounts: [{ id: "view-1", bank: "Credem", account_ref: "view-1", display_name: "AZIENDA", iban_last4: "1234", currency: "EUR", balance: "10.00", balance_date: null, last_sync_at: null, is_active: true, needs_reconnect: false, valid_until: "2027-01-27" }] }, error: null });
    render(<BankAccountsView year={2026} accountingKey="2026" saving={false} onReconciled={vi.fn()} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("obio-accounts", { body: {} }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Aggiorna conti open-banking.io" })).toBeEnabled());
    expect(invoke).not.toHaveBeenCalledWith("bank-sync", expect.anything());
  });
});
