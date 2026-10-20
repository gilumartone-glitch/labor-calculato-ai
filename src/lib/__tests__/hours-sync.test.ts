import { describe, expect, it } from "vitest";
import { mergeHoursLog } from "@/lib/hours-sync";
import type { HoursLog } from "@/components/contabilita/HoursLogView";

const hours = (id: string, h: number, time: number): HoursLog => ({
  "2026-9": { rows: [{ id, name: id, days: { 1: { segments: h ? [{ t: "lavoro", h }] : [] } }, dayUpdatedAt: { 1: time } }] },
});

describe("salvataggio ore nomi liberi", () => {
  it("conserva entrambi i nomi liberi salvati da finestre diverse", () => {
    const rows = mergeHoursLog(hours("libero-a", 8, 10), hours("libero-b", 6, 20))["2026-9"].rows;
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.id === "libero-a")?.days[1]).toEqual({ segments: [{ t: "lavoro", h: 8 }] });
    expect(rows.find(r => r.id === "libero-b")?.days[1]).toEqual({ segments: [{ t: "lavoro", h: 6 }] });
  });
  it("non sovrascrive le ore nuove con una copia vecchia", () => {
    expect(mergeHoursLog(hours("libero", 8, 20), hours("libero", 4, 10))["2026-9"].rows[0].days[1]).toEqual({ segments: [{ t: "lavoro", h: 8 }] });
  });
  it("mantiene una giornata svuotata anche ricevendo le vecchie ore", () => {
    expect(mergeHoursLog(hours("libero", 0, 30), hours("libero", 8, 20))["2026-9"].rows[0].days[1]).toEqual({ segments: [] });
  });
  it("non ripristina un nome libero eliminato", () => {
    expect(mergeHoursLog({ "2026-9": { rows: [], deletedRowIds: ["libero"] } }, hours("libero", 8, 20))["2026-9"].rows).toEqual([]);
  });
});