// Server-side enforcement of the weekly scheduling budget.
//
// The calendar greys out its Add button once the week is full, but that is a
// courtesy, not a limit: the same task can be given hours from the Assignment
// panel, the admin Task Assignments tab, or by lengthening a block that already
// exists. This runs on every write that sets start_time/end_time, so the rule
// holds wherever the hours come from.
//
// Only the WEEKLY budget stops a write. Filling a day is deliberately allowed —
// the overflow is understood to come out of the week, which is what the
// calendar's daily notice says. The week is the point where there is nothing
// left to draw on.

import { addDaysToDateStr, orgDateOf } from "@/lib/taskSchedule";

export const WEEKLY_LIMIT_ERROR =
  "Weekly limit reached — request more time to continue.";

type MinimalClient = {
  from: (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (columns: string) => any;
  };
};

/** Sunday-anchored week containing an org-time date, as [start, endExclusive). */
export function orgWeekBounds(orgDate: string): { start: string; endExclusive: string } {
  const weekday = new Date(`${orgDate}T00:00:00Z`).getUTCDay();
  const start = addDaysToDateStr(orgDate, -weekday);
  return { start, endExclusive: addDaysToDateStr(start, 7) };
}

function minutesBetween(startIso: string, endIso: string): number {
  return (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000;
}

/**
 * Whether giving `vaId` a block of start..end would put their week over budget.
 * Returns an error message to reject with, or null to allow.
 *
 * `excludeTaskId` drops the task being edited out of the existing total, so
 * shortening or moving a block is never rejected by its own old length.
 */
export async function weeklyBudgetRejection(
  adminSupabase: MinimalClient,
  vaId: string,
  startIso: string,
  endIso: string,
  excludeTaskId?: string | number | null
): Promise<string | null> {
  const addedMinutes = minutesBetween(startIso, endIso);
  if (!Number.isFinite(addedMinutes) || addedMinutes <= 0) return null;

  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("weekly_budget_limit")
    .eq("id", vaId)
    .maybeSingle();

  const limitHours = profile?.weekly_budget_limit ?? null;
  if (limitHours == null || limitHours <= 0) return null; // no cap configured

  const { start, endExclusive } = orgWeekBounds(orgDateOf(startIso));

  // Bounds are org-time dates; compare against the stored instants generously
  // (a day either side) and filter precisely by org date below, so a block near
  // midnight isn't counted into the wrong week.
  const { data: rows } = await adminSupabase
    .from("assigned_tasks")
    .select("id, start_time, end_time, assigned_task_assignees!inner(va_id)")
    .eq("assigned_task_assignees.va_id", vaId)
    .is("deleted_at", null)
    .is("archived_at", null)
    .not("start_time", "is", null)
    .not("end_time", "is", null)
    .gte("start_time", `${addDaysToDateStr(start, -1)}T00:00:00Z`)
    .lt("start_time", `${addDaysToDateStr(endExclusive, 1)}T00:00:00Z`);

  const existingMinutes = (rows ?? [])
    .filter((r: { id: string | number }) => String(r.id) !== String(excludeTaskId ?? ""))
    .filter((r: { start_time: string }) => {
      const day = orgDateOf(r.start_time);
      return day >= start && day < endExclusive;
    })
    .reduce(
      (sum: number, r: { start_time: string; end_time: string }) =>
        sum + Math.max(0, minutesBetween(r.start_time, r.end_time)),
      0
    );

  const budgetMinutes = Math.round(limitHours * 60);
  return existingMinutes + addedMinutes > budgetMinutes ? WEEKLY_LIMIT_ERROR : null;
}

/**
 * Same check across every assignee a task is being scheduled for. A task with
 * several assignees is rejected if it would put ANY of them over — the block
 * lands on each of their calendars, so each of their weeks has to have room.
 */
export async function weeklyBudgetRejectionForAssignees(
  adminSupabase: MinimalClient,
  vaIds: string[],
  startIso: string,
  endIso: string,
  excludeTaskId?: string | number | null
): Promise<string | null> {
  for (const vaId of vaIds) {
    const rejection = await weeklyBudgetRejection(adminSupabase, vaId, startIso, endIso, excludeTaskId);
    if (rejection) return rejection;
  }
  return null;
}
