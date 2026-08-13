// Shared budget/shift helpers. A VA's daily budget is driven by their shift:
// either an explicit shift_hours value, or the span between shift_start and
// shift_end. A null result means the VA has no shift set → no budget limit.

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

export type BudgetStatus = {
  /** The daily limit, in the display unit (hours or dollars). */
  limit: number;
  /** Amount used so far today, in the display unit. */
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
 * Compute a VA's remaining daily budget from their shift and the hours they've
 * already worked today. `unit` picks whether the numbers are expressed in hours
 * or dollars (dollars = hours × payRate). Returns null when the VA has no shift
 * configured (no limit applies).
 */
export function computeBudgetStatus(
  shiftHours: number | null,
  workedHoursToday: number,
  unit: "hours" | "dollars",
  payRate: number | null
): BudgetStatus | null {
  if (shiftHours == null || shiftHours <= 0) return null;
  const toUnit = (hours: number) => (unit === "dollars" ? hours * (payRate ?? 0) : hours);
  const limit = toUnit(shiftHours);
  const used = toUnit(workedHoursToday);
  const remaining = Math.max(0, limit - used);
  const fraction = limit > 0 ? used / limit : 0;
  return {
    limit,
    used,
    remaining,
    unit,
    fraction,
    warn: fraction >= BUDGET_WARN_THRESHOLD,
    over: used >= limit,
  };
}
