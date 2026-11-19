import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuickDateInput } from "./QuickDateInput";

afterEach(cleanup);

describe("movement date entry", () => {
  it.each(["15.01.27", "15/01/27", "15-01-2027", "150127", "15012027"])("keeps 2027 when entering %s", (input) => {
    const onCommit = vi.fn();
    render(<QuickDateInput value="2026-01-15" monthIndex={0} ariaLabel="Data" onCommit={onCommit} />);
    const field = screen.getByRole("textbox", { name: "Data" });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: input } });
    fireEvent.blur(field);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("2027-01-15");
  });

  it("does not replace a date being entered with a refreshed old value", () => {
    const onCommit = vi.fn();
    const { rerender } = render(<QuickDateInput value="2026-01-15" monthIndex={0} ariaLabel="Data" onCommit={onCommit} />);
    const field = screen.getByRole("textbox", { name: "Data" });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "15.01.27" } });
    rerender(<QuickDateInput value="2026-01-16" monthIndex={0} ariaLabel="Data" onCommit={onCommit} />);
    fireEvent.blur(field);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("2027-01-15");
  });

  it("rejects impossible dates without changing the movement", () => {
    const onCommit = vi.fn();
    render(<QuickDateInput value="2026-01-15" monthIndex={0} ariaLabel="Data" onCommit={onCommit} />);
    const field = screen.getByRole("textbox", { name: "Data" });
    fireEvent.change(field, { target: { value: "31.02.27" } });
    fireEvent.blur(field);
    expect(onCommit).not.toHaveBeenCalled();
  });
});