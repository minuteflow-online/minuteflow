import { describe, it, expect } from "vitest";
import { cycleBase, computeAttendancePay, datesInRange } from "./salaryProration";

const MON_TO_FRI = [1, 2, 3, 4, 5];

/** Neil's real August 2026 second half: $300/mo, clock-ins on 9 of 11 weekdays. */
const NEIL_AUG = {
  monthlySalary: 300,
  periodStart: "2026-08-16",
  periodEnd: "2026-08-31",
  workDays: MON_TO_FRI,
  byDateMs: {
    "2026-08-17": 2.08 * 3_600_000,
    "2026-08-18": 3.07 * 3_600_000,
    "2026-08-19": 3.2 * 3_600_000,
    "2026-08-20": 4.92 * 3_600_000,
    "2026-08-21": 1.15 * 3_600_000,
    "2026-08-24": 3.03 * 3_600_000,
    "2026-08-25": 1.32 * 3_600_000,
    "2026-08-27": 4.54 * 3_600_000,
    "2026-08-28": 1.4 * 3_600_000,
    // Aug 26 and Aug 31: no clock-in at all.
    "2026-08-29": 0.68 * 3_600_000, // Saturday — not a work day
    "2026-08-30": 1.79 * 3_600_000, // Sunday — not a work day
  },
};

describe("datesInRange", () => {
  it("is inclusive of both ends", () => {
    expect(datesInRange("2026-08-16", "2026-08-18")).toEqual(["2026-08-16", "2026-08-17", "2026-08-18"]);
  });

  it("crosses a month boundary", () => {
    expect(datesInRange("2026-08-30", "2026-09-01")).toEqual(["2026-08-30", "2026-08-31", "2026-09-01"]);
  });
});

describe("cycleBase", () => {
  it("pays half the salary for the second half of a month, not the weekday share", () => {
    // The old rule gave 11/21 of $300 = $157.14 for this same period.
    expect(cycleBase(300, "2026-08-16", "2026-08-31")).toEqual({ base: 150, label: "2nd half of the month" });
  });

  it("pays half for the first half", () => {
    expect(cycleBase(300, "2026-08-01", "2026-08-15")).toEqual({ base: 150, label: "1st half of the month" });
  });

  it("pays the whole salary for a whole month", () => {
    expect(cycleBase(300, "2026-08-01", "2026-08-31")).toEqual({ base: 300, label: "Full month" });
  });

  it("handles a short February and a leap February", () => {
    expect(cycleBase(300, "2026-02-16", "2026-02-28").base).toBe(150);
    expect(cycleBase(300, "2024-02-16", "2024-02-29").base).toBe(150);
  });

  it("falls back to a calendar-day share for an odd period", () => {
    const { base, label } = cycleBase(310, "2026-08-10", "2026-08-14");
    expect(base).toBe(50); // 5 of 31 days
    expect(label).toBe("5 of 31 days");
  });
});

describe("computeAttendancePay", () => {
  it("docks the two days with no clock-in", () => {
    const result = computeAttendancePay(NEIL_AUG);
    expect(result.base).toBe(150);
    expect(result.expectedDays).toBe(11);
    expect(result.paidDays).toBe(9);
    expect(result.missedDays).toBe(2);
    expect(result.suggestedGross).toBe(122.73); // 150 × 9/11
  });

  it("ignores time logged on a day that isn't a work day", () => {
    const result = computeAttendancePay(NEIL_AUG);
    expect(result.days.some((d) => d.date === "2026-08-29")).toBe(false);
    expect(result.days.some((d) => d.date === "2026-08-30")).toBe(false);
  });

  it("counts any clock-in as present, however short", () => {
    const result = computeAttendancePay({
      ...NEIL_AUG,
      byDateMs: { ...NEIL_AUG.byDateMs, "2026-08-26": 60_000, "2026-08-31": 60_000 },
    });
    expect(result.paidDays).toBe(11);
    expect(result.suggestedGross).toBe(150);
  });

  it("excusing a missed day removes it from both sides, so pay rises", () => {
    const result = computeAttendancePay({
      ...NEIL_AUG,
      decisions: { "2026-08-26": "excused" },
    });
    expect(result.expectedDays).toBe(10);
    expect(result.paidDays).toBe(9);
    expect(result.excusedDays).toBe(1);
    expect(result.suggestedGross).toBe(135); // 150 × 9/10
  });

  it("excusing every missed day pays the cycle in full", () => {
    const result = computeAttendancePay({
      ...NEIL_AUG,
      decisions: { "2026-08-26": "excused", "2026-08-31": "excused" },
    });
    expect(result.suggestedGross).toBe(150);
  });

  it("marking a worked day unpaid deducts it", () => {
    const result = computeAttendancePay({
      ...NEIL_AUG,
      decisions: { "2026-08-17": "unpaid" },
    });
    expect(result.expectedDays).toBe(11);
    expect(result.paidDays).toBe(8);
    expect(result.suggestedGross).toBe(109.09); // 150 × 8/11
  });

  it("pays the full cycle when every day is excused rather than dividing by zero", () => {
    const decisions = Object.fromEntries(
      datesInRange("2026-08-16", "2026-08-31").map((d) => [d, "excused" as const])
    );
    const result = computeAttendancePay({ ...NEIL_AUG, decisions });
    expect(result.expectedDays).toBe(0);
    expect(result.suggestedGross).toBe(150);
  });

  it("pays nothing when nothing was logged and nothing excused", () => {
    const result = computeAttendancePay({ ...NEIL_AUG, byDateMs: {} });
    expect(result.paidDays).toBe(0);
    expect(result.suggestedGross).toBe(0);
  });

  it("respects a VA who doesn't work Mondays", () => {
    const result = computeAttendancePay({ ...NEIL_AUG, workDays: [2, 3, 4, 5] });
    // Aug 17, 24 and 31 are Mondays — 11 weekdays less those three.
    expect(result.expectedDays).toBe(8);
  });
});
