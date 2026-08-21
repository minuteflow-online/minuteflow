/**
 * The span of days a task's work can legitimately fall in.
 *
 * Screenshots are matched to a task by name when no time-log link exists, and a
 * name alone matches months of recurring work — the same task name comes back
 * daily. Bounding that match is what keeps one day's task from listing another
 * day's screenshots.
 *
 * The lower bound is the real fix: work logged before the task existed can never
 * belong to it. The upper bound stays OPEN while the task is unfinished, because
 * a task put on hold and picked up days later is still the same task and its
 * later screenshots do belong. Once it's finished, the end is pinned so a closed
 * task can't absorb work that came after it.
 */
const FINISHED_STATUSES = new Set([
  "submitted",
  "completed",
  "approved",
  "paid",
  "cancelled",
]);

type TaskWindowRow = {
  status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  due_date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  archived_at?: string | null;
};

const day = (value: string | null | undefined): string | null =>
  value ? String(value).slice(0, 10) : null;

export function assignedTaskWindow(task: TaskWindowRow | null | undefined): {
  from: string | null;
  to: string | null;
} {
  if (!task) return { from: null, to: null };

  // due_date is deliberately not a lower bound: it says when the work is owed,
  // not when it started, and work often begins before it.
  const from = day(task.start_date) ?? day(task.created_at);

  const finished = FINISHED_STATUSES.has(String(task.status ?? ""));
  const to =
    day(task.end_date) ??
    day(task.archived_at) ??
    (finished ? day(task.updated_at) : null);

  return { from, to };
}
