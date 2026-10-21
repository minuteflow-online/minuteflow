/**
 * Categories that can't be chosen on the dashboard's "Log an Activity" form.
 *
 * Toni asked for "Task" to be disabled there while Communication, Planning,
 * Collaboration, Personal and Break stay usable. Tasks are started from Assigned
 * Tasks, so a task is not logged by hand as an activity.
 *
 * Only this form is affected: the category itself, and every other path that
 * records one (Assigned Tasks, the calendar, reports), is unchanged.
 */
export const LOG_ACTIVITY_DISABLED_CATEGORIES: readonly string[] = ["Task"];

export function isLogActivityCategoryDisabled(category: string): boolean {
  return LOG_ACTIVITY_DISABLED_CATEGORIES.includes(category);
}

/**
 * The category to apply when something other than a click suggests one (a Quick
 * Pick prefill, or the auto-category a project/task implies). A suggestion for a
 * disabled category is dropped, so the form never lands on a chip the VA can't
 * pick; it keeps whatever is already selected.
 */
export function usableCategory(suggested: string | null | undefined, current: string): string {
  if (!suggested || isLogActivityCategoryDisabled(suggested)) return current;
  return suggested;
}

/**
 * Fixed-rate (Output Based) tasks are also logged from this form and have always
 * been recorded under Task, so Task is only blocked for ordinary hourly entries.
 */
export function isCategoryBlocked(category: string, isFixedRate: boolean): boolean {
  return isLogActivityCategoryDisabled(category) && !isFixedRate;
}

/** The category after the VA picks a task from the Task dropdown. */
export function categoryAfterTaskPick(prev: string, auto: string | null, isFixedRate: boolean): string {
  // Fixed-rate: exactly what it was before Task was disabled. The auto-category
  // wins, else keep what was chosen, else the old default of Task.
  if (isFixedRate) return auto ?? (prev || "Task");
  // Hourly: a suggestion for Task is dropped, and a Task left over from an earlier
  // fixed-rate pick is cleared so it cannot ride along into an hourly entry.
  const next = usableCategory(auto, prev);
  return isLogActivityCategoryDisabled(next) ? "" : next;
}

/** The category after the VA picks a project (the task has not changed). */
export function categoryAfterProjectPick(prev: string, auto: string | null, isFixedRate: boolean): string {
  if (isFixedRate) return auto ?? prev;
  return usableCategory(auto, prev);
}
