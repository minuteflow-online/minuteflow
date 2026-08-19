// Shared budget/shift/limit helpers.
//
// A VA's budget type follows their pay setup, not a manual toggle:
// Output Based (per-task) VAs are tracked in dollars (daily_budget_limit /
// monthly_budget_limit, both admin-set caps); everyone else is tracked in
// hours (shift_hours or the shift_start/shift_end span for daily, plus
// monthly_budget_limit in hours for monthly). A null limit means no cap is
// set for that VA/period.

import { normalizePosition } from "@/types/database";

export type ShiftProfile = {
  shift_hours: number | null;
  shift_start: string | null;
  shift_end: string | null;
};

/** Resolve a VA's daily shift length in hours, or null if none is configured. */
export function shiftHoursFromProfile(p: ShiftProfile): number | null {
  if (p.shift_hours != null && p.shift_hours > 0) return p.shift_hours;
  if (p.shift_start && p.shift_end) {
    const [sh, sm] = p.shift_start.split(":").map(Number);
    const [eh, em] = p.shift_end.split(":").map(Number);
    if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
    let mins = eh * 60 + em - (sh * 60 + sm);
    if (mins < 0) mins += 24 * 60; // shift crosses midnight
    return mins > 0 ? mins / 60 : null;
  }
  return null;
}

export type VaBudgetType = "time_based" | "output_based";

/** Same per-task derivation used elsewhere (FixedPayTasksPanel, Calendar's taskModesForMember). */
export function vaBudgetType(profile: { position?: string | null; pay_rate_type?: string | null }): VaBudgetType {
  if (normalizePosition(profile.position) === "Output Based" || profile.pay_rate_type === "per_task") return "output_based";
  return "time_based";
}

/**
 * Convert a VA's pay rate to a $/hour equivalent, for showing a dollar
 * estimate alongside an hours-based budget. Same daily/monthly-to-hourly
 * conversion used by FinancialSummaryTab and team/page.tsx's computePayable
 * (daily assumes an 8h day, monthly assumes a 160h month). Null when there's
 * no rate to convert (per_task VAs are dollar-tracked directly, not via this).
 */
export function hourlyRateFromProfile(profile: { pay_rate: number | null; pay_rate_type: string | null }): number | null {
  if (!profile.pay_rate || profile.pay_rate <= 0) return null;
  if (profile.pay_rate_type === "daily") return profile.pay_rate / 8;
  if (profile.pay_rate_type === "monthly") return profile.pay_rate / 160;
  if (profile.pay_rate_type === "hourly" || !profile.pay_rate_type) return profile.pay_rate;
  return null;
}

export type BudgetStatus = {
  /** The limit for this period, in `unit`. */
  limit: number;
  /** Amount used so far this period, in `unit`. */
  used: number;
  /** limit - used, clamped at 0. */
  remaining: number;
  unit: "hours" | "dollars";
  /** used / limit as a 0..1+ fraction. */
  fraction: number;
  /** True once used ≥ 90% of the limit — the soft "wrap up soon" threshold. */
  warn: boolean;
  /** True once used ≥ limit. */
  over: boolean;
};

export const BUDGET_WARN_THRESHOLD = 0.9;

/**
 * Compute remaining budget for one period (day or month) from a limit and
 * amount already used, both expressed in `unit`. Returns null when no limit
 * is configured for that period (no cap applies).
 *
 * `extraApproved` is any additional budget approved for today — from an
 * approved over-budget request or a direct admin grant, already in `unit` —
 * added straight onto the limit. Only meaningful for the daily period; leave
 * at 0 for monthly (requests/grants are day-scoped, see BudgetWidget).
 */
export function computeBudgetStatus(
  limit: number | null,
  used: number,
  unit: "hours" | "dollars",
  extraApproved: number = 0
): BudgetStatus | null {
  if (limit == null || limit <= 0) return null;
  const effectiveLimit = limit + Math.max(0, extraApproved);
  const remaining = Math.max(0, effectiveLimit - used);
  const fraction = effectiveLimit > 0 ? used / effectiveLimit : 0;
  return {
    limit: effectiveLimit,
    used,
    remaining,
    unit,
    fraction,
    warn: fraction >= BUDGET_WARN_THRESHOLD,
    over: used >= effectiveLimit,
  };
}

// ── Work days ──────────────────────────────────────────────────────────
//
// Which weekdays a member is scheduled for, set per member in Team
// Management. 0 = Sunday .. 6 = Saturday, matching Date#getUTCDay() and
// orgWeekBounds() in lib/scheduleBudget so a date string maps to the same
// weekday everywhere.
//
// A day off carries NO daily budget, but it is not blocked: hours booked
// there come out of the weekly limit instead, which stays the only hard
// stop (see weeklyBudgetRejection). Null/empty means no schedule has been
// set for that member — every day counts, i.e. the behaviour before work
// days existed.

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5]; // Mon–Fri
export const ALL_WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6];

export type WorkDayProfile = { work_days?: number[] | null };

/** A member's scheduled weekdays, or all seven when none is configured. */
export function workDaysFromProfile(profile: WorkDayProfile | null | undefined): number[] {
  const days = profile?.work_days;
  if (!days || days.length === 0) return ALL_WEEK_DAYS;
  return days;
}

/** Weekday index (0-6) of an org-time "YYYY-MM-DD" date string. */
export function weekdayOfOrgDate(orgDate: string): number {
  return new Date(`${orgDate}T00:00:00Z`).getUTCDay();
}

/** Whether an org-time "YYYY-MM-DD" date falls on a day this member works. */
export function isWorkDay(profile: WorkDayProfile | null | undefined, orgDate: string): boolean {
  return workDaysFromProfile(profile).includes(weekdayOfOrgDate(orgDate));
}

/**
 * "Mon–Fri" when the days form one unbroken run, otherwise a plain list
 * ("Mon, Wed, Fri"). A run that wraps the week end falls through to the list
 * form rather than reading backwards.
 */
export function formatWorkDays(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 0) return "None";
  if (sorted.length === 7) return "Every day";
  if (sorted.length === 1) return WEEKDAY_SHORT[sorted[0]];
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  return contiguous
    ? `${WEEKDAY_SHORT[sorted[0]]}–${WEEKDAY_SHORT[sorted[sorted.length - 1]]}`
    : sorted.map((d) => WEEKDAY_SHORT[d]).join(", ");
}
