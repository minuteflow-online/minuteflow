// Shared budget/shift/limit helpers.
//
// A VA's budget type follows their pay setup, not a manual toggle:
// Output Based (per-task) VAs are tracked in dollars (daily_budget_limit /
// monthly_budget_limit, both admin-set caps); everyone else is tracked in
// hours (shift_hours or the shift_start/shift_end span for daily, plus
// monthly_budget_limit in hours for monthly). A null limit means no cap is
// set for that VA/period.

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
  if (profile.position === "Per Task VA" || profile.pay_rate_type === "per_task") return "output_based";
  return "time_based";
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
