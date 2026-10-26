/**
 * Whether time in a category is paid.
 *
 * One rule, in one place, because it was previously written out by hand at
 * nine call sites and four of them had drifted — they excluded Personal but
 * not Break. Any of those four could set a break billable: resuming a task
 * after a break, closing a stale active task, or approving a correction that
 * moved an entry into the Break category.
 *
 * That drift is how roughly 4,300 minutes of break time each for two VAs ended
 * up billed as work. The clock-out path was repaired separately; this stops the
 * others from putting it back.
 */

/** Never paid. Break was the one that kept getting left out. Pause (added
 *  2026-10-26, Toni's "Lean and Focused Work" policy) is deliberately in
 *  this same set — unpaid is the one non-negotiable part of what Pause means,
 *  same as Break. */
const UNPAID_CATEGORIES = new Set(["Personal", "Break", "Pause"]);

export function isBillableCategory(category: string | null | undefined): boolean {
  return !UNPAID_CATEGORIES.has((category ?? "").trim());
}
