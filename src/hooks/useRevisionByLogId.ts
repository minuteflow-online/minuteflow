"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Maps a `time_logs.id` to the revision round that log's work belongs to, for
 * the R badge in the Activity Log, Time Log, and Team views.
 *
 * The number is HISTORICAL, not live: it's how many revisions had been issued
 * at the moment that log started. Work done during the R2 round keeps reading
 * R2 forever, even after a third revision lands — a time entry is a record of
 * what happened, so relabelling it later would rewrite history. (The badge on
 * the task itself is the opposite: that one tracks the task's current state and
 * should move to R3.)
 *
 * Logs that ran before any revision get no entry here, so callers treat a miss
 * as zero and render nothing.
 *
 * Matching a log to its task is done on person + task name + account, because
 * `time_logs` carries no task reference. `assigned_task_assignees.log_id` only
 * ever points at the most recently worked log, so it can't mark a task's older
 * entries. The tradeoff: one person holding two same-named tasks under the same
 * account would have both treated as one. A dedicated `assigned_task_id` column
 * on `time_logs` is the exact fix if that ever bites.
 */
export interface RevisionLogInput {
  id: number;
  user_id: string;
  task_name: string | null;
  account: string | null;
  start_time: string | null;
}

/** person + task + account, the best identity a time log carries today. */
function matchKey(userId: string, taskName: string | null, account: string | null) {
  return `${userId}|${(taskName ?? "").trim().toLowerCase()}|${(account ?? "").trim().toLowerCase()}`;
}

export function useRevisionByLogId(logs: RevisionLogInput[]): Map<number, number> {
  const [revisionByLogId, setRevisionByLogId] = useState<Map<number, number>>(new Map());

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (logs.length === 0) {
        setRevisionByLogId(new Map());
        return;
      }

      const supabase = createClient();

      // Every revision ever issued, with when it happened. This is the
      // append-only submission thread, so it's an exact history.
      const { data: revisions } = await supabase
        .from("task_submissions")
        .select("assigned_task_id, created_at")
        .eq("message_type", "revision")
        .not("assigned_task_id", "is", null);

      if (cancelled || !revisions || revisions.length === 0) {
        if (!cancelled) setRevisionByLogId(new Map());
        return;
      }

      const taskIds = Array.from(
        new Set(revisions.map((r) => r.assigned_task_id as number))
      );

      const [{ data: tasks }, { data: assignees }] = await Promise.all([
        supabase.from("assigned_tasks").select("id, task_name, account, created_at").in("id", taskIds),
        supabase.from("assigned_task_assignees").select("assigned_task_id, va_id").in("assigned_task_id", taskIds),
      ]);

      if (cancelled || !tasks || !assignees) return;

      const revisionTimesByTask = new Map<number, string[]>();
      for (const row of revisions) {
        const id = row.assigned_task_id as number;
        const list = revisionTimesByTask.get(id) ?? [];
        list.push(row.created_at as string);
        revisionTimesByTask.set(id, list);
      }

      // A task can have several assignees; each one's logs match on their own id.
      // createdAt rides along so logs predating the task can be excluded — older
      // work often reuses a task name under the same account.
      const byKey = new Map<string, { times: string[]; createdAt: string | null }>();
      for (const task of tasks) {
        const times = revisionTimesByTask.get(task.id as number);
        if (!times) continue;
        for (const a of assignees) {
          if ((a.assigned_task_id as number) !== (task.id as number)) continue;
          const key = matchKey(
            a.va_id as string,
            task.task_name as string | null,
            task.account as string | null
          );
          const existing = byKey.get(key);
          byKey.set(key, {
            times: (existing?.times ?? []).concat(times),
            createdAt: existing?.createdAt ?? (task.created_at as string | null),
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

      setRevisionByLogId(map);
    })();

    return () => {
      cancelled = true;
    };
  }, [logs]);

  return revisionByLogId;
}
