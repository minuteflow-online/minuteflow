import { describe, it, expect } from "vitest";
import { isPayrollEligible, sumPayrollMs, PAYROLL_BREAK_EXCLUSION_DATE } from "@/lib/payrollHours";

const HOUR = 3_600_000;
const AFTER = "2026-10-27";
const BEFORE = "2026-06-01";

function log(category: string | null, over: Partial<{ duration_ms: number | null; session_date: string; start_time: string }> = {}) {
  const session_date = over.session_date ?? AFTER;
  return {
    category,
    duration_ms: over.duration_ms === undefined ? HOUR : over.duration_ms,
    session_date,
    start_time: over.start_time ?? `${session_date}T14:00:00.000Z`,
  };
}

describe("isPayrollEligible", () => {
  it("pays ordinary work", () => {
    for (const c of ["Task", "Message", "Meeting", "Sorting Tasks", "Collaboration", "Clock In", "Planning"]) {
      expect(isPayrollEligible(log(c)), c).toBe(true);
    }
  });

  it("does not pay Pause", () => {
    expect(isPayrollEligible(log("Pause"))).toBe(false);
    expect(isPayrollEligible(log("pause"))).toBe(false);
    expect(isPayrollEligible(log("  Pause  "))).toBe(false);
  });

  it("does not pay Pause on any date", () => {
    for (const day of [BEFORE, PAYROLL_BREAK_EXCLUSION_DATE, AFTER]) {
      expect(isPayrollEligible(log("Pause", { session_date: day })), day).toBe(false);
    }
  });

  it("still leaves Personal and Clock Out unpaid", () => {
    expect(isPayrollEligible(log("Personal"))).toBe(false);
    expect(isPayrollEligible(log("Clock Out"))).toBe(false);
  });

  it("still leaves Break unpaid from the cutoff date, and paid before it", () => {
    expect(isPayrollEligible(log("Break", { session_date: AFTER }))).toBe(false);
    expect(isPayrollEligible(log("Break", { session_date: PAYROLL_BREAK_EXCLUSION_DATE }))).toBe(false);
    expect(isPayrollEligible(log("Break", { session_date: BEFORE }))).toBe(true);
  });

  it("pays nothing for a log with no duration", () => {
    expect(isPayrollEligible(log("Task", { duration_ms: null }))).toBe(false);
    expect(isPayrollEligible(log("Task", { duration_ms: 0 }))).toBe(false);
  });
});

describe("sumPayrollMs", () => {
  it("adds paid time and leaves Pause out of the total", () => {
    const logs = [
      log("Task", { duration_ms: 3 * HOUR }),
      log("Pause", { duration_ms: 2 * HOUR }),
      log("Break", { duration_ms: HOUR }),
      log("Message", { duration_ms: HOUR }),
    ];
    expect(sumPayrollMs(logs, "Full Time")).toBe(4 * HOUR);
    expect(sumPayrollMs(logs, "Part Time")).toBe(4 * HOUR);
  });

  it("is unchanged for a day with no Pause", () => {
    const logs = [log("Task", { duration_ms: 5 * HOUR }), log("Personal", { duration_ms: HOUR })];
    expect(sumPayrollMs(logs, null)).toBe(5 * HOUR);
  });
});
