import { describe, expect, it } from "vitest";
import { bankScheduleSlot, BANK_SYNC_TIMES, BANK_REFRESH_TIMES } from "../../supabase/functions/_shared/bank-schedule";
describe("Italian bank sync schedule", () => {
  it("has PayPal slots plus bank 10:00 and 12:00 recovery", () => expect(BANK_SYNC_TIMES).toEqual(["08:30", "10:00", "12:00", "15:00"]));
  it("refreshes Credem and BNL at 10:00 with 12:00 recovery", () => expect(BANK_REFRESH_TIMES).toEqual(["10:00", "12:00"]));
  it("refreshes banks at 10:00 in winter and summer", () => {
    expect(bankScheduleSlot(new Date("2026-11-13T09:00:00Z"), true)).toBe(true);
    expect(bankScheduleSlot(new Date("2027-07-01T08:00:00Z"), true)).toBe(true);
  });
  it("no longer refreshes banks at 08:30", () => expect(bankScheduleSlot(new Date("2026-11-05T07:30:00Z"), true)).toBe(false));
  it("blocks afternoon bank refresh", () => expect(bankScheduleSlot(new Date("2026-11-05T14:00:00Z"), true)).toBe(false));
  it("runs PayPal at 08:30 and 15:00", () => {
    expect(bankScheduleSlot(new Date("2026-10-30T07:30:00Z"))).toBe(true);
    expect(bankScheduleSlot(new Date("2026-10-30T14:00:00Z"))).toBe(true);
  });
  it("does not use the wrong DST slot", () => expect(bankScheduleSlot(new Date("2027-07-01T09:00:00Z"), true)).toBe(false));
});
