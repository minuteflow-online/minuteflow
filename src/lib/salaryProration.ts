/* Attendance-based proration for a salaried VA.
 *
 * The old rule paid a fraction of the monthly salary based on how much of the
 * month the pay period covered — $300 × 11/21 weekdays = $157.14 for Aug 16-31
 * — so whether the VA actually showed up never entered it. Two days with no
 * clock-in at all cost nothing.
 *
 * Here a cycle has a fixed amount (half the monthly salary for a half-month
 * period) and every expected work day in it is worth an equal share. A day
 * with no clock-in is not paid; a day can be excused, which takes it out of
 * both sides so it neither pays nor deducts.
 *
 * Nothing here decides anything on its own: it produces a suggested figure
 * and the day-by-day reasoning behind it, and the person running payroll
 * accepts that or overrides it.
 */

import { weekdayOfOrgDate } from "./budget";

/** What payroll has decided about a single day. */
export type DayDecision =
  /** Untouched: paid if there is a clock-in, unpaid if there isn't. */
  | "auto"
  /** Excused — holiday, approved leave, a day off you asked for. Neither pays nor deducts. */
  | "excused"
  /** Deducted regardless of whether time was logged. */
  | "unpaid";

export interface AttendanceDay {
  date: string;
  /** 0-6, Sunday first. */
  weekday: number;
  /** Milliseconds clocked on this date. */
  ms: number;
  /** Any clock-in at all. */
  worked: boolean;
  decision: DayDecision;
  /** Counts toward the days this cycle expected. */
  counted: boolean;
  /** Counts toward the days being paid for. */
  paid: boolean;
}

export interface AttendancePay {
  /** The cycle's full amount before any proration. */
  base: number;
  /** How the base was derived, for display. */
  baseLabel: string;
  days: AttendanceDay[];
  expectedDays: number;
  paidDays: number;
  missedDays: number;
  excusedDays: number;
  /** base × paidDays / expectedDays, rounded to cents. */
  suggestedGross: number;
}

export interface AttendancePayInput {
  monthlySalary: number;
  /** Inclusive YYYY-MM-DD bounds of the pay period. */
  periodStart: string;
  periodEnd: string;
  /** Weekday indices (0-6) the VA is expected to work. */
  workDays: number[];
  /** Clocked milliseconds keyed by YYYY-MM-DD. */
  byDateMs: Record<string, number>;
  /** Per-day overrides keyed by YYYY-MM-DD; anything absent is "auto". */
  decisions?: Record<string, DayDecision>;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Every YYYY-MM-DD from start to end inclusive. */
export function datesInRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const last = new Date(`${end}T00:00:00Z`).getTime();
  for (let t = new Date(`${start}T00:00:00Z`).getTime(); t <= last; t += 86_400_000) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * What this pay period is worth before attendance.
 *
 * A half-month period is half the salary flat — that is the point of paying
 * per cycle, and it is why this doesn't reuse the weekday ratio: Aug 16-31
 * holds 11 of the month's 21 weekdays, which would pay $157.14 rather than
 * the $150 the cycle is actually worth. Anything that is neither a half nor
 * a whole month falls back to its share of the month's calendar days.
 */
export function cycleBase(
  monthlySalary: number,
  periodStart: string,
  periodEnd: string
): { base: number; label: string } {
  const [yearStr, monthStr, startDay] = periodStart.split("-");
  const [endYear, endMonth, endDay] = periodEnd.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const sameMonth = yearStr === endYear && monthStr === endMonth;
  const monthEnd = daysInMonth(year, month);

  if (sameMonth) {
    if (startDay === "01" && Number(endDay) === monthEnd) {
      return { base: round2(monthlySalary), label: "Full month" };
    }
    if (startDay === "01" && Number(endDay) === 15) {
      return { base: round2(monthlySalary / 2), label: "1st half of the month" };
    }
    if (Number(startDay) === 16 && Number(endDay) === monthEnd) {
      return { base: round2(monthlySalary / 2), label: "2nd half of the month" };
    }
  }

  const span = datesInRange(periodStart, periodEnd).length;
  return {
    base: round2(monthlySalary * (span / monthEnd)),
    label: `${span} of ${monthEnd} days`,
  };
}

/**
 * Suggested pay for a salaried VA over one pay period, with the day-by-day
 * reasoning behind it. Callers are expected to show this and let a human
 * accept or override it.
 */
export function computeAttendancePay(input: AttendancePayInput): AttendancePay {
  const { monthlySalary, periodStart, periodEnd, workDays, byDateMs, decisions = {} } = input;
  const { base, label } = cycleBase(monthlySalary, periodStart, periodEnd);

  const days: AttendanceDay[] = datesInRange(periodStart, periodEnd)
    .map((date) => ({ date, weekday: weekdayOfOrgDate(date) }))
    .filter(({ weekday }) => workDays.includes(weekday))
    .map(({ date, weekday }) => {
      const ms = Number(byDateMs[date]) || 0;
      const worked = ms > 0;
      const decision = decisions[date] ?? "auto";
      // Excused days leave the cycle entirely; an unpaid day still counts as
      // expected, which is what makes it a deduction.
      const counted = decision !== "excused";
      const paid = decision === "auto" ? worked : false;
      return { date, weekday, ms, worked, decision, counted, paid };
    });

  const expectedDays = days.filter((d) => d.counted).length;
  const paidDays = days.filter((d) => d.paid).length;
  const excusedDays = days.filter((d) => d.decision === "excused").length;
  const missedDays = expectedDays - paidDays;

  // Every day excused means nothing was expected of this cycle, so there is
  // nothing to dock — not a division by zero, and not a zero payout.
  const suggestedGross = expectedDays === 0 ? round2(base) : round2(base * (paidDays / expectedDays));

  return { base, baseLabel: label, days, expectedDays, paidDays, missedDays, excusedDays, suggestedGross };
}
