/**
 * How a task's logged time is split across its submissions, and across days.
 *
 * VAs submit every day while a task is in progress, so each submission is a
 * round of work. A round owns every log on the task that started after the
 * previous submission and before (or at) its own — the work it reports on. Its
 * time is then split by the day each log started, so a day's total counts the
 * work actually done that day, whenever it was handed in (Toni's call,
 * 2026-11-09). Logs started after the latest submission aren't in any round yet:
 * that time is "not yet submitted".
 */
import { localDay } from "@/lib/onTime";

export type SubmissionMark = { id: number; created_at: string };
export type TaskLogTime = { start_time: string | null; duration_ms: number | null };

export type RoundTime = {
  totalMs: number;
  /** YYYY-MM-DD (org time) -> ms of this round's work logged that day. */
  byDay: Record<string, number>;
};

export type TaskTime = {
  /** submission id -> its round's time. Every submission gets an entry. */
  bySubmission: Record<number, RoundTime>;
  /** Logged after the latest submission — not part of any round yet. */
  unsubmittedMs: number;
  /** Everything logged on the task, submitted or not. */
  totalMs: number;
};

export function allocateTaskTime(
  submissions: SubmissionMark[],
  logs: TaskLogTime[],
  timezone: string
): TaskTime {
  const ordered = [...submissions].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const marks = ordered.map((s) => new Date(s.created_at).getTime());

  const bySubmission: Record<number, RoundTime> = {};
  for (const s of ordered) bySubmission[s.id] = { totalMs: 0, byDay: {} };

  let unsubmittedMs = 0;
  let totalMs = 0;

  for (const log of logs) {
    const ms = Math.max(0, Number(log.duration_ms ?? 0));
    if (!log.start_time || ms === 0) continue;
    const start = new Date(log.start_time).getTime();
    if (!Number.isFinite(start)) continue;
    totalMs += ms;

    // The first submission made at or after the log started is the one that
    // reports on it. Linear scan: a task has a handful of submissions.
    const idx = marks.findIndex((m) => m >= start);
    if (idx === -1) {
      unsubmittedMs += ms;
      continue;
    }
    const round = bySubmission[ordered[idx].id];
    const day = localDay(log.start_time, timezone);
    round.totalMs += ms;
    round.byDay[day] = (round.byDay[day] ?? 0) + ms;
  }

  return { bySubmission, unsubmittedMs, totalMs };
}

/**
 * The days a round belongs to: the days its work was logged on. A round with no
 * logged time (nothing tracked, or a quick re-send) belongs to the day it was
 * submitted, so it still shows up somewhere.
 */
export function roundDays(
  submission: SubmissionMark,
  round: RoundTime | undefined,
  timezone: string
): string[] {
  const worked = Object.keys(round?.byDay ?? {}).filter((d) => (round?.byDay[d] ?? 0) > 0);
  if (worked.length > 0) return worked.sort();
  return [localDay(submission.created_at, timezone)];
}
