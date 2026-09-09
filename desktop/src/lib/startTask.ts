// Starting an assigned task from the Tasks panel — mirrors the web
// dashboard's handlePlayAssignedTask + startTask() for the standard
// (non-fixed-pay) case: src/app/(app)/dashboard/page.tsx.
//
// Scoped down from the web version on purpose:
//  - No task-switch wizard. The web app can open a wizard to collect a memo
//    + status for whatever was running before, when leaving it for this task.
//    This just closes it via the same safety net clock.ts's closeOpenLogs
//    already uses for clock-in/out — same as switching tasks mid-shift with
//    no wizard open on the web.
//  - Fixed-pay tasks aren't supported — see AssignedTaskDetail.fixed_pay_task_id.
//    Their web flow is a different, instant one-shot log with no timer; the
//    caller should disable Start for those rather than call this.
//  - autoUpdateAssignmentStatus() (a separate, name-matched "task library"
//    sync in the web dashboard, unrelated to assigned_tasks) isn't ported —
//    it's a secondary system this app doesn't otherwise touch.
import { query } from "./db";
import { closeOpenLogs, getCorrectSessionDate, isDuplicateActiveLogError, type ActiveTask, type Profile, type SessionRow } from "./clock";
import { fetchAccountClientMap } from "./accounts";
import { setAssignedTaskStatus } from "./tasks";
import type { VAAssignedTask } from "./tasks";

export interface StartTaskResult {
  ok: boolean;
  error?: string;
  session?: SessionRow;
}

/** Starts a standard assigned task: closes whatever log is currently open,
 *  inserts a new time_log for this task, flips its assignee status to
 *  in_progress, and (auto-clocking in if idle) marks it the active task. */
export async function startAssignedTask(
  task: VAAssignedTask,
  userId: string,
  profile: Profile,
  currentSession: SessionRow | null,
  orgTimezone: string
): Promise<StartTaskResult> {
  const detail = task.assigned_tasks;
  if (detail.fixed_pay_task_id != null) {
    return { ok: false, error: "Fixed-pay tasks aren't supported here yet — start this one from the web app." };
  }

  const now = new Date().toISOString();

  // Same "close everything open" safety net clock-in/out use — whatever was
  // running (including a break) ends here, no exceptions. See clock.ts.
  await closeOpenLogs(userId, now);

  const accountClientMap = await fetchAccountClientMap().catch(() => ({}) as Record<string, string>);
  const clientName = (detail.account && accountClientMap[detail.account]) || null;
  const sessionDate = getCorrectSessionDate(currentSession, orgTimezone);

  let log: { id: number };
  try {
    const rows = await query<{ id: number }[]>("time_logs", {
      method: "POST",
      body: {
        user_id: userId,
        username: profile.username,
        full_name: profile.full_name,
        department: profile.department,
        position: profile.position,
        task_name: detail.task_name,
        category: "Task",
        project: detail.project || null,
        account: detail.account || null,
        client_name: clientName,
        start_time: now,
        // Category is always "Task" on this path, which is never in the
        // unpaid set (Personal, Break) — see src/lib/billable.ts.
        billable: true,
        client_memo: detail.task_detail || null,
        internal_memo: null,
        form_fill_ms: 0,
        billing_type: "hourly",
        session_date: sessionDate,
      },
    });
    log = rows[0];
  } catch (err) {
    return {
      ok: false,
      error: isDuplicateActiveLogError(err)
        ? "You're already tracking something else somewhere (another device or the extension?). Refresh to see your current status."
        : `Couldn't start the task: ${err instanceof Error ? err.message : "unknown error"}.`,
    };
  }

  // Best-effort — a failure here shouldn't undo the time_log that's already
  // tracking real time; the task just won't show as in_progress until retried.
  void setAssignedTaskStatus({
    assignedTaskId: detail.id,
    status: "in_progress",
    vaId: userId,
    logId: log.id,
  });

  const activeTask: ActiveTask = {
    task_name: detail.task_name,
    category: "Task",
    project: detail.project || "",
    account: detail.account || "",
    client_name: clientName || "",
    client_memo: detail.task_detail || "",
    internal_memo: "",
    start_time: now,
    end_time: null,
    duration_ms: 0,
    logId: String(log.id),
    _startMs: Date.now(),
    assignedTaskId: detail.id,
    todoLabel: null,
  };

  const clockInTime = currentSession?.clocked_in ? currentSession.clock_in_time || now : now;

  const rows = await query<SessionRow[]>("sessions", {
    method: "POST",
    filters: "on_conflict=user_id",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: {
      user_id: userId,
      clocked_in: true,
      clock_in_time: clockInTime,
      active_task: activeTask,
      session_date: sessionDate,
      updated_at: now,
    },
  });

  return { ok: true, session: rows[0] };
}
