/**
 * Break and Pause are both unpaid time away from work (Pause is the desktop
 * app's, Toni's 2026-10-26 "Lean and Focused Work" policy). Screens that leave
 * Break out of task counts, progress and task time use this so a Pause is left
 * out the same way. Exact-match on purpose: it is the same comparison those
 * screens already made against "Break".
 */
export function isBreakLike(category: string | null | undefined): boolean {
  return category === "Break" || category === "Pause";
}
