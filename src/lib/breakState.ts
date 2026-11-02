/**
 * Whether an active task means the person is on a break.
 *
 * There are two ways to start one and they leave different traces. The session
 * banner's Break button sets active_task.isBreak; picking Break from the task
 * list creates an ordinary task whose category is "Break" and sets no flag.
 *
 * Checking only the flag is why Flordeliz showed as "Working" through a
 * 90-minute break on 2026-08-25 — she takes the second route, and every screen
 * that reads the flag alone reported her as at her desk. The same gap silenced
 * her break notification.
 *
 * One definition, because four screens drifting apart on what counts as a
 * break is how that happened in the first place.
 */
export function isOnBreak(activeTask: { isBreak?: boolean; category?: string } | null | undefined): boolean {
  return Boolean(activeTask?.isBreak) || activeTask?.category === "Break";
}

/** Personal time is a category only — there is no button that flags it. */
export function isOnPersonal(
  activeTask: { category?: string } | null | undefined
): boolean {
  return activeTask?.category === "Personal";
}
