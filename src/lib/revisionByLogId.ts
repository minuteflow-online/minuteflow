/**
 * Pure matching logic behind useRevisionByLogId — see that hook for what it's
 * for and why matching a log to its task is done this way at all. Split out
 * so the matching itself is unit-testable without mocking Supabase or React.
 */

export interface RevisionLogInput {
  id: number;
  user_id: string;
  task_name: string | null;
  account: string | null;
  start_time: string | null;
}

export interface RevisionSubmissionRow {
  assigned_task_id: number;
  created_at: string;
}

export interface AssignedTaskRow {
  id: number;
  task_name: string | null;
  account: string | null;
  created_at: string | null;
}

export interface AssigneeRow {
  assigned_task_id: number;
  va_id: string;
  log_id?: number | null;
}

/** person + task + account, the best identity a time log carries today. */
function matchKey(userId: string, taskName: string | null, account: string | null) {
  return `${userId}|${(taskName ?? "").trim().toLowerCase()}|${(account ?? "").trim().toLowerCase()}`;
}

/**
 * @param revisions Every revision ever issued (message_type = 'revision'),
 *   with when it happened.
 * @param revisedTasks assigned_tasks rows for the task ids in `revisions` —
 *   only those need fetching for the name+account guess.
 * @param revisedTaskAssignees assigned_task_assignees rows for those same
 *   task ids (va_id only needed here; log_id isn't fetched for this query).
 * @param exactAssignees assigned_task_assignees rows for whichever tasks
 *   currently have one of `logs` as their designated log (queried by
 *   `log_id IN (logs' ids)`, so it can include tasks with zero revisions —
 *   that's what lets a false positive get cleared, not just a true one set).
 */
export function computeRevisionByLogId(
  logs: RevisionLogInput[],
  revisions: RevisionSubmissionRow[],
  revisedTasks: AssignedTaskRow[],
  revisedTaskAssignees: AssigneeRow[],
  exactAssignees: AssigneeRow[]
): Map<number, number> {
  const revisionTimesByTask = new Map<number, string[]>();
  for (const row of revisions) {
    const list = revisionTimesByTask.get(row.assigned_task_id) ?? [];
    list.push(row.created_at);
    revisionTimesByTask.set(row.assigned_task_id, list);
  }

  // A task can have several assignees; each one's logs match on their own id.
  // createdAt rides along so logs predating the task can be excluded — older
  // work often reuses a task name under the same account.
  const byKey = new Map<string, { times: string[]; createdAt: string | null }>();
  for (const task of revisedTasks) {
    const times = revisionTimesByTask.get(task.id);
    if (!times) continue;
    for (const a of revisedTaskAssignees) {
      if (a.assigned_task_id !== task.id) continue;
      const key = matchKey(a.va_id, task.task_name, task.account);
      const existing = byKey.get(key);
      byKey.set(key, {
        times: (existing?.times ?? []).concat(times),
        createdAt: existing?.createdAt ?? task.created_at,
      });
    }
  }

  const map = new Map<number, number>();
  for (const log of logs) {
    if (!log.start_time) continue;
    const entry = byKey.get(matchKey(log.user_id, log.task_name, log.account));
    if (!entry) continue;
    if (entry.createdAt && log.start_time < entry.createdAt) continue;
    // How many revisions had already been issued when this log started.
    const round = entry.times.filter((t) => t < log.start_time!).length;
    if (round > 0) map.set(log.id, round);
  }

  // Override for whichever logs we can identify exactly, rather than by
  // name+account guesswork: assigned_task_assignees.log_id names the one log
  // currently doing a task's work. Someone who logs everything under the
  // same generic name+account (e.g. Neil, 100+ "MinuteFlow Work" /
  // "Virtual Concierge" entries) has every one of those entries collapsed
  // into a single key above — so the moment any ONE of them is revised,
  // every other one, past and future, inherits the badge forever. Where we
  // can name the exact task a log belongs to, trust that over the guess,
  // including clearing a false positive the guess left behind.
  const logById = new Map(logs.map((l) => [l.id, l]));
  for (const row of exactAssignees) {
    const log = row.log_id != null ? logById.get(row.log_id) : undefined;
    if (!log || !log.start_time) continue;
    const times = revisionTimesByTask.get(row.assigned_task_id) ?? [];
    const round = times.filter((t) => t < log.start_time!).length;
    if (round > 0) map.set(log.id, round);
    else map.delete(log.id);
  }

  return map;
}
