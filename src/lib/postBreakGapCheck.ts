/**
 * Whether the dashboard's "left in a gap after a break" safety net should run.
 *
 * The net exists for one case: the page is loaded while the person is clocked in
 * with no running task (a break ended and the page was reloaded before anything
 * resolved it). It is meant to look ONCE per page load, at the first session it
 * sees.
 *
 * It used to mark itself done only after passing its "clocked in, no active task"
 * test. A person who loads the page with a task running therefore never marked
 * it, and the net kept running on every later session change. Switching tasks
 * briefly leaves no active task, so it fired then: it opened the "Welcome Back!"
 * window (which has no close button, so the tab had to be reloaded) or, when the
 * last task was not completed, resumed that task behind the new one.
 *
 * The first look now counts whatever it finds.
 */
export function postBreakGapDecision(
  alreadyChecked: boolean,
  session: { clocked_in?: boolean | null; active_task?: unknown } | null | undefined
): { markChecked: boolean; run: boolean } {
  if (!session || alreadyChecked) return { markChecked: false, run: false };
  return { markChecked: true, run: Boolean(session.clocked_in) && !session.active_task };
}
