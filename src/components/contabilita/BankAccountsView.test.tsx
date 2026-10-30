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

describe("blocked bank import", () => {
  afterEach(cleanup);
  it("handles a normal blocked response without presenting zero imports as a successful sync", async () => {
    invoke.mockResolvedValueOnce({ data: { status: "blocked", code: "commercial_terms_unverified", message: "Condizioni economiche non verificate.", imported: 0 }, error: null });
    render(<BankAccountsView year={2026} accountingKey="2026" saving={false} onReconciled={vi.fn()} />);
    const button = await screen.findByRole("button", { name: "Sincronizza ora Credem" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Nessun movimento importato"));
    expect(button).toBeEnabled();
    expect(screen.getByRole("button", { name: "Importa estratto conto" })).toBeEnabled();
  });
  it("handles a 409 without losing the accounts view and releases the sync button", async () => {
    invoke.mockResolvedValueOnce({
      data: null,
      error: { context: new Response(JSON.stringify({ error: "Importazione bloccata: condizioni economiche del servizio non ancora verificate." }), { status: 409 }) },
    });
    render(<BankAccountsView year={2026} accountingKey="2026" saving={false} onReconciled={vi.fn()} />);
    const button = await screen.findByRole("button", { name: "Sincronizza ora Credem" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Nessun movimento importato"));
    expect(button).toBeEnabled();
    expect(screen.getByRole("button", { name: "Importa estratto conto" })).toBeEnabled();
    expect(invoke).toHaveBeenCalledWith("bank-sync", { body: { bank: "Credem" } });
  });
});