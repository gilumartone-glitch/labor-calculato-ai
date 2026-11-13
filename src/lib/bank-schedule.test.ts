import { describe, expect, it } from "vitest";
import { bankScheduleSlot, BANK_SYNC_TIMES, BANK_REFRESH_TIMES } from "../../supabase/functions/_shared/bank-schedule";
describe("Italian bank sync schedule", () => {
  it("reads all providers only at 08:30", () => expect(BANK_SYNC_TIMES).toEqual(["08:30"]));
  it("refreshes Credem and BNL only at 08:30", () => expect(BANK_REFRESH_TIMES).toEqual(["08:30"]));
  it("refreshes banks at 08:30 in winter and summer", () => {
    expect(bankScheduleSlot(new Date("2026-11-13T07:30:00Z"), true)).toBe(true);
    expect(bankScheduleSlot(new Date("2027-07-01T06:30:00Z"), true)).toBe(true);
  });
  it.each(["09:00", "11:00", "14:00"])("blocks former winter slot %s UTC for every provider", time => {
    const now = new Date(`2026-11-13T${time}:00Z`);
    expect(bankScheduleSlot(now)).toBe(false);
    expect(bankScheduleSlot(now, true)).toBe(false);
  });
  it("runs PayPal at 08:30 in winter and summer", () => {
    expect(bankScheduleSlot(new Date("2026-10-30T07:30:00Z"))).toBe(true);
    expect(bankScheduleSlot(new Date("2027-07-01T06:30:00Z"))).toBe(true);
  });
  it("does not use the wrong DST slot", () => {
    expect(bankScheduleSlot(new Date("2027-07-01T07:30:00Z"), true)).toBe(false);
    expect(bankScheduleSlot(new Date("2026-11-13T06:30:00Z"), true)).toBe(false);
  });
});
