/**
 * Whether an Output Based task belongs on a given person's Calendar.
 *
 * A task is claimed_by someone once they grab it from the pool, or at once when
 * a VA creates it for themselves. A task an admin creates and assigns is
 * different: it carries assigned_to but stays unclaimed until the assignee
 * accepts it. Filtering on claimed_by alone hid every such task from the
 * Calendar, so an output task created for someone never showed up there.
 */
export function fixedTaskBelongsTo(
  task: { claimed_by: string | null; assigned_to?: string | null },
  vaId: string
): boolean {
  if (task.claimed_by) return task.claimed_by === vaId;
  return task.assigned_to === vaId;
}

/** What the Month view's hover card needs from an Output Based due item. */
export interface OutputDayItem {
  taskId: number;
  source: "assigned" | "fixed";
  title: string;
  date: string;
  dateType: "due" | "start";
  startDate?: string | null;
}

export type OutputDayEntry<T extends OutputDayItem> = { item: T; label: "Starts" | "Due" };

/**
 * The Output Based tasks to list on one day of the Month view: the ones that
 * start or are due that day. A multi-day task also puts an item on every day in
 * between (drawn as a bar); those are left out so the card doesn't repeat the
 * task on each day of its span. A task that starts and is due the same day is
 * listed once, as Due.
 */
export function outputTasksForDay<T extends OutputDayItem>(items: T[]): OutputDayEntry<T>[] {
  const byTask = new Map<number, OutputDayEntry<T>>();
  for (const item of items) {
    if (item.source !== "fixed") continue;
    const label = item.dateType === "due" ? "Due" : item.startDate === item.date ? "Starts" : null;
    if (!label) continue;
    const seen = byTask.get(item.taskId);
    if (!seen || label === "Due") byTask.set(item.taskId, { item, label });
  }
  return [...byTask.values()];
}
