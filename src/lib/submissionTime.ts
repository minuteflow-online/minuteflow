/**
 * How a task's logged time is split across its submissions, and across days.
 *
 * VAs submit every day while a task is in progress, so each submission is a
 * round of work. A round owns every log on the task that started after the
 * previous submission and before (or at) its own — the work it reports on. Its
 * time is then split by the day it was actually worked, so a day's total counts
 * the work done that day, whenever it was handed in (Toni's call, 2026-11-09).
 * A log that runs past midnight is split at midnight, org time (2026-11-11).
 * Logs started after the latest submission aren't in any round yet: that time
 * is "not yet submitted" — it counts toward a day's Potential, never its
 * Submitted figure.
 */
import { localDay } from "@/lib/onTime";

export type SubmissionMark = { id: number; created_at: string };
export type TaskLogTime = { start_time: string | null; duration_ms: number | null };

export type RoundTime = {
  totalMs: number;
  /** YYYY-MM-DD (org time) -> ms of this round's work done that day. */
  byDay: Record<string, number>;
  /** Each logged stretch of this round, earliest first (epoch ms). */
  sessions: Array<{ startMs: number; endMs: number }>;
};

export type TaskTime = {
  /** submission id -> its round's time. Every submission gets an entry. */
  bySubmission: Record<number, RoundTime>;
  /** Logged after the latest submission — not part of any round yet. */
  unsubmittedMs: number;
  /** The same not-yet-submitted time, by the day it was worked. */
  unsubmittedByDay: Record<string, number>;
  /** Everything logged on the task, submitted or not. */
  totalMs: number;
};

/** The org-time offset from UTC at `ms`, in ms (positive east of UTC). */
function tzOffsetMs(ms: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Epoch ms of the midnight that ends org-time day `day` (YYYY-MM-DD). */
function endOfDayMs(day: string, timezone: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const nextUtcMidnight = Date.UTC(y, m - 1, d + 1);
  // Two passes settle the offset even across a DST change.
  let guess = nextUtcMidnight - tzOffsetMs(nextUtcMidnight, timezone);
  guess = nextUtcMidnight - tzOffsetMs(guess, timezone);
  return guess;
}

/**
 * A stretch of work split at each org-time midnight it crosses:
 * 11 PM–1 AM is one hour on each day.
 */
export function splitAcrossDays(startMs: number, durationMs: number, timezone: string): Record<string, number> {
  const out: Record<string, number> = {};
  const endMs = startMs + Math.max(0, durationMs);
  let cursor = startMs;
  // Bounded: a single log never spans more than a few days, and a runaway one
  // (a timer left on for a month) still terminates.
  for (let guard = 0; cursor < endMs && guard < 400; guard++) {
    const day = localDay(new Date(cursor).toISOString(), timezone);
    const boundary = Math.min(endOfDayMs(day, timezone), endMs);
    if (boundary <= cursor) break;
    out[day] = (out[day] ?? 0) + (boundary - cursor);
    cursor = boundary;
  }
  return out;
}

/** Index of the submission that reports on work started at `startMs`, or -1. */
export function roundIndexFor(marksMs: number[], startMs: number): number {
  return marksMs.findIndex((m) => m >= startMs);
}

export function allocateTaskTime(
  submissions: SubmissionMark[],
  logs: TaskLogTime[],
  timezone: string
): TaskTime {
  const ordered = [...submissions].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const marks = ordered.map((s) => new Date(s.created_at).getTime());

  const bySubmission: Record<number, RoundTime> = {};
  for (const s of ordered) bySubmission[s.id] = { totalMs: 0, byDay: {}, sessions: [] };

  let unsubmittedMs = 0;
  const unsubmittedByDay: Record<string, number> = {};
  let totalMs = 0;

  for (const log of logs) {
    const ms = Math.max(0, Number(log.duration_ms ?? 0));
    if (!log.start_time || ms === 0) continue;
    const start = new Date(log.start_time).getTime();
    if (!Number.isFinite(start)) continue;
    totalMs += ms;
    const days = splitAcrossDays(start, ms, timezone);

    // The first submission made at or after the log started is the one that
    // reports on it. Linear scan: a task has a handful of submissions.
    const idx = roundIndexFor(marks, start);
    if (idx === -1) {
      unsubmittedMs += ms;
      for (const [day, dayMs] of Object.entries(days)) unsubmittedByDay[day] = (unsubmittedByDay[day] ?? 0) + dayMs;
      continue;
    }
    const round = bySubmission[ordered[idx].id];
    round.totalMs += ms;
    for (const [day, dayMs] of Object.entries(days)) round.byDay[day] = (round.byDay[day] ?? 0) + dayMs;
    round.sessions.push({ startMs: start, endMs: start + ms });
  }

  for (const r of Object.values(bySubmission)) r.sessions.sort((a, b) => a.startMs - b.startMs);

  return { bySubmission, unsubmittedMs, unsubmittedByDay, totalMs };
}

/**
 * Screenshots follow the work, not the submission that happened to pick them
 * up (Toni's call, 2026-11-11). Each capture is taken while a timer runs, so
 * it carries that time log; the log's start decides its round by the same rule
 * as the time. A capture whose log isn't known keeps the submission it's
 * linked to. Returns submission id -> its captures.
 */
export function placeShotsByWork<T extends { submission_id: number | null; log_id: number | null }>(
  shots: T[],
  submissions: SubmissionMark[],
  logStartById: Record<number, string | null | undefined>
): Map<number, T[]> {
  const ordered = [...submissions].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const marks = ordered.map((s) => new Date(s.created_at).getTime());
  const out = new Map<number, T[]>();
  for (const shot of shots) {
    const logStart = shot.log_id != null ? logStartById[shot.log_id] : null;
    let target = shot.submission_id;
    if (logStart) {
      const idx = roundIndexFor(marks, new Date(logStart).getTime());
      if (idx !== -1) target = ordered[idx].id;
    }
    if (target == null) continue;
    const list = out.get(target) ?? [];
    list.push(shot);
    out.set(target, list);
  }
  return out;
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

/** "Nov 8, 11:20 PM" (or just "11:20 PM") in org time. */
export function formatStamp(ms: number, timezone: string, withDate: boolean): string {
  return new Date(ms).toLocaleString("en-US", {
    timeZone: timezone,
    ...(withDate ? { month: "short", day: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * When a round's work happened: first log start to last log end, in org time.
 * The end carries its own date only when it falls on a later day than the start.
 * Null when nothing was logged.
 */
export function workedSpanLabel(
  sessions: Array<{ startMs: number; endMs: number }>,
  timezone: string
): string | null {
  if (sessions.length === 0) return null;
  const startMs = Math.min(...sessions.map((s) => s.startMs));
  const endMs = Math.max(...sessions.map((s) => s.endMs));
  const sameDay =
    localDay(new Date(startMs).toISOString(), timezone) === localDay(new Date(endMs).toISOString(), timezone);
  return `${formatStamp(startMs, timezone, true)} – ${formatStamp(endMs, timezone, !sameDay)}`;
}
