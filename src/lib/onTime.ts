/**
 * The single "was this on time?" formula for a submission.
 *
 * Originally lived only in the Submissions page (as the "On time" / "Ln"
 * badge on each round). The On-Time report reuses these exact functions
 * rather than re-deriving the rule, so a VA's report number can never
 * disagree with what their own submission badge already told them.
 */

/** The fields a deadline can be read off of. Matches assigned_tasks. */
export interface DeadlineTask {
  due_date: string | null;
  due_time: string | null;
  end_date: string | null;
  end_time: string | null;
}

/** Local YYYY-MM-DD for a timestamp, in the org's timezone. */
export function localDay(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: timezone });
}

/**
 * The moment the work was due, as a local "YYYY-MM-DD HH:MM:SS" string.
 *
 * Prefers due_date/due_time; without a due time the whole due day counts as on
 * time. Falls back to the scheduled block's end when no due date was set, and
 * returns null when the task carries no schedule at all — an unscheduled task
 * can't be late, so it gets no verdict rather than a wrong one.
 *
 * Comparing local wall-clock strings rather than instants keeps a due_time
 * like "17:27" — which carries no timezone — anchored to the org's day, so
 * the verdict doesn't shift with the viewer's location.
 */
export function deadlineFor(task: DeadlineTask | null | undefined, timezone: string): string | null {
  if (!task) return null;
  if (task.due_date) {
    return `${task.due_date} ${(task.due_time ?? "23:59:59").padEnd(8, ":00").slice(0, 8)}`;
  }
  if (task.end_time) {
    return `${localDay(task.end_time, timezone)} ${new Date(task.end_time).toLocaleTimeString("en-GB", { hour12: false, timeZone: timezone })}`;
  }
  if (task.end_date) return `${task.end_date} 23:59:00`;
  return null;
}

/**
 * Whether a submission landed on time.
 *
 * A revision can set a new due date for the rework — pass the most recent
 * revision's `due_at` (issued before this submission) as `priorRevisionDueAt`
 * so a moved deadline doesn't rewrite an earlier verdict. Judging every
 * submission against whatever the task says today would let work that was on
 * time become "late" months later, the moment a fresh revision moves the due
 * date. Omit it (or pass null) to judge against the task's own due date only.
 */
export function isLate(
  createdAt: string,
  task: DeadlineTask | null | undefined,
  timezone: string,
  priorRevisionDueAt?: string | null
): boolean | null {
  const deadline = priorRevisionDueAt
    ? `${localDay(priorRevisionDueAt, timezone)} ${new Date(priorRevisionDueAt).toLocaleTimeString("en-GB", { hour12: false, timeZone: timezone })}`
    : deadlineFor(task, timezone);
  if (!deadline) return null;
  const submitted = `${localDay(createdAt, timezone)} ${new Date(createdAt).toLocaleTimeString("en-GB", { hour12: false, timeZone: timezone })}`;
  return submitted > deadline;
}

/**
 * How a submission landed against its deadline (the task's own due date
 * only — not revision-aware, unlike `isLate`).
 *
 * "same day" is separated from "another day" because they are different
 * failures: an hour past the time is a slip, a day past it is a miss, and
 * one colour for both hides which happened.
 */
export type Timeliness = "on_time" | "late_same_day" | "late_other_day" | "no_deadline";

export function timelinessOf(
  createdAt: string,
  task: DeadlineTask | null | undefined,
  timezone: string
): Timeliness {
  const deadline = deadlineFor(task, timezone);
  if (!deadline) return "no_deadline";
  const submitted = `${localDay(createdAt, timezone)} ${new Date(createdAt).toLocaleTimeString("en-GB", { hour12: false, timeZone: timezone })}`;
  if (submitted <= deadline) return "on_time";
  return localDay(createdAt, timezone) === deadline.slice(0, 10) ? "late_same_day" : "late_other_day";
}
