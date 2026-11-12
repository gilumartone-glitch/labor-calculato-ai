import { describe, expect, it } from "vitest";
import { bankScheduleSlot, BANK_SYNC_TIMES, BANK_REFRESH_TIMES } from "../../supabase/functions/_shared/bank-schedule";
describe("Italian bank sync schedule", () => {
  it("has the two slots plus the 10:30 recovery", () => expect(BANK_SYNC_TIMES).toEqual(["08:30", "10:30", "15:00"]));
  it("refreshes Credem and BNL only in the morning", () => expect(BANK_REFRESH_TIMES).toEqual(["08:30", "10:30"]));
  it("allows the 10:30 recovery in winter", () => expect(bankScheduleSlot(new Date("2026-11-12T09:30:00Z"), true)).toBe(true));
  it("blocks afternoon bank refresh in winter", () => expect(bankScheduleSlot(new Date("2026-11-05T14:00:00Z"), true)).toBe(false));
  it("blocks afternoon bank refresh in summer", () => expect(bankScheduleSlot(new Date("2027-07-01T13:00:00Z"), true)).toBe(false));
  it("refreshes banks at 08:30 in winter and summer", () => {
    expect(bankScheduleSlot(new Date("2026-11-05T07:30:00Z"), true)).toBe(true);
    expect(bankScheduleSlot(new Date("2027-07-01T06:30:00Z"), true)).toBe(true);
  });
  it("runs at 08:30 in winter", () => expect(bankScheduleSlot(new Date("2026-10-30T07:30:00Z"))).toBe(true));
  it("runs at 15:00 in winter", () => expect(bankScheduleSlot(new Date("2026-10-30T14:00:00Z"))).toBe(true));
  it("runs at 08:30 in summer", () => expect(bankScheduleSlot(new Date("2027-07-01T06:30:00Z"))).toBe(true));
  it("runs at 15:00 in summer", () => expect(bankScheduleSlot(new Date("2027-07-01T13:00:00Z"))).toBe(true));
  it("does not use the old 07:00 slot", () => expect(bankScheduleSlot(new Date("2026-10-30T06:00:00Z"))).toBe(false));
  it("does not use the wrong DST slot", () => expect(bankScheduleSlot(new Date("2027-07-01T07:30:00Z"))).toBe(false));
});