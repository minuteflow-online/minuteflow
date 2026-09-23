"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  computeRevisionByLogId,
  type RevisionLogInput,
  type AssigneeRow,
} from "@/lib/revisionByLogId";

export type { RevisionLogInput };

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
 *
 * It bit: Neil logs essentially everything as "MinuteFlow Work" /
 * "Virtual Concierge" — 100+ separate tasks sharing that one name+account — so
 * a single revision on any one of them was leaking the badge onto every other
 * one, including brand new submissions that had never been touched. Fixed
 * with a second pass: wherever `assigned_task_assignees.log_id` names the
 * exact log currently doing a task's work, that exact match overrides the
 * name+account guess for that one log — including clearing a false positive
 * the guess left behind. It's still only the CURRENT log per task, per the
 * limitation above; older logs of a same-named task still rely on the guess.
 *
 * The matching itself lives in @/lib/revisionByLogId, as a plain function —
 * this hook is just the data fetching around it.
 */
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

      const [{ data: tasks }, { data: revisedTaskAssignees }, { data: exactAssignees }] =
        await Promise.all([
          supabase.from("assigned_tasks").select("id, task_name, account, created_at").in("id", taskIds),
          supabase.from("assigned_task_assignees").select("assigned_task_id, va_id").in("assigned_task_id", taskIds),
          supabase
            .from("assigned_task_assignees")
            .select("assigned_task_id, va_id, log_id")
            .in("log_id", logs.map((l) => l.id)),
        ]);

      if (cancelled || !tasks || !revisedTaskAssignees) return;

      const map = computeRevisionByLogId(
        logs,
        revisions as { assigned_task_id: number; created_at: string }[],
        tasks as { id: number; task_name: string | null; account: string | null; created_at: string | null }[],
        revisedTaskAssignees as AssigneeRow[],
        (exactAssignees ?? []) as AssigneeRow[]
      );

      if (!cancelled) setRevisionByLogId(map);
    })();

    return () => {
      cancelled = true;
    };
  }, [logs]);

  return revisionByLogId;
}
