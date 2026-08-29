import { createClient as createServiceClient } from "@supabase/supabase-js";

/**
 * The day's totals, appended to a clock-out alert in Toni's private chat.
 *
 * Without it the clock-out line said only when someone stopped, so answering
 * "how long did she actually work?" meant opening the admin panel — every
 * time, for every person. The three numbers she reads first belong on the line
 * she already gets.
 *
 * Hours are only half the picture. Output-based work is logged with
 * billing_type "fixed": it carries a task_rate and no duration at all, so a
 * day spent on it totals zero minutes. Rhealin's 2026-08-27 shift was nine
 * fixed tasks worth $125.85 and would have reported nothing whatsoever. Money
 * earned is the unit for that work, the way minutes are the unit for hourly.
 *
 * Not sent to the VA and not to the team chat. Hours are between the two of
 * them, and a running tally of everyone's day posted publicly is a scoreboard.
 */

export interface ShiftSummary {
  /** Everything tracked that day, including breaks. Hourly work only. */
  totalMs: number;
  /** The part marked billable — breaks included if they were wrongly flagged. */
  billableMs: number;
  /** Break and Personal together; she reads them as one number, not two. */
  awayMs: number;
  /** Output-based entries: paid per task, so counted rather than timed. */
  fixedCount: number;
  /** What that output-based work is worth, summed from task_rate. */
  fixedValue: number;
  entries: number;
}

interface SummaryRow {
  category: string | null;
  billable: boolean | null;
  billing_type: string | null;
  task_rate: number | string | null;
  start_time: string;
  end_time: string | null;
  duration_ms: number | null;
}

/**
 * How long one entry ran.
 *
 * duration_ms is trusted when it is there, but the last entry of a shift is
 * often still open at the moment the webhook fires — the clock-out writes the
 * session row and the closing of the final log separately, and this can arrive
 * between the two. Falling back to the elapsed time keeps that last stretch
 * from silently counting as zero.
 */
export function entryDurationMs(
  row: { start_time: string; end_time: string | null; duration_ms: number | null },
  now?: number
): number {
  if (row.duration_ms != null && row.duration_ms > 0) return row.duration_ms;
  const start = new Date(row.start_time).getTime();
  if (row.end_time) return Math.max(0, new Date(row.end_time).getTime() - start);
  // Only extrapolate to "now" when the caller says the shift is live. A review
  // of a past day must not report an entry someone forgot to close as having
  // run for three weeks.
  return now == null ? 0 : Math.max(0, now - start);
}

function durationOf(row: SummaryRow, now: number): number {
  return entryDurationMs(row, now);
}

const AWAY_CATEGORIES = new Set(["Break", "Personal"]);

/** Output-based. Anything else — including a null on older rows — is hourly. */
function isFixed(row: SummaryRow): boolean {
  return row.billing_type === "fixed";
}

export function summarize(rows: SummaryRow[], now: number = Date.now()): ShiftSummary {
  let totalMs = 0;
  let billableMs = 0;
  let awayMs = 0;
  let fixedCount = 0;
  let fixedValue = 0;

  for (const row of rows) {
    if (isFixed(row)) {
      // Never timed. A fixed entry's duration is zero by design, and letting
      // one into the hourly totals would put per-task work into a number that
      // is meant to answer "how many hours do I owe?".
      fixedCount++;
      fixedValue += Number(row.task_rate ?? 0) || 0;
      continue;
    }

    const ms = durationOf(row, now);
    totalMs += ms;
    if (row.billable) billableMs += ms;
    if (row.category && AWAY_CATEGORIES.has(row.category)) awayMs += ms;
  }

  return { totalMs, billableMs, awayMs, fixedCount, fixedValue, entries: rows.length };
}

/** "8h 12m", "8h", "47m", "0m" — no empty halves, since these sit in a
 *  sentence rather than a column and "8h 0m" reads like a stutter. */
export function humanDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** "$125.85" — two places always, so a column of these lines up by eye. */
export function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * The summary for the alert, or null when there is nothing to say.
 *
 * Up to two lines, and each appears only if it has something in it: a day of
 * pure output-based work has no hours worth printing, and an ordinary hourly
 * day has no task rates. A shift with neither prints nothing rather than a row
 * of zeroes, which looks like a bug in the tracker and invites a question.
 */
export function formatSummaryLine(summary: ShiftSummary): string | null {
  const lines: string[] = [];

  if (summary.totalMs > 0) {
    lines.push(
      [
        `⏱ Total <b>${humanDuration(summary.totalMs)}</b>`,
        `Billable <b>${humanDuration(summary.billableMs)}</b>`,
        `Break/personal <b>${humanDuration(summary.awayMs)}</b>`,
      ].join(" · ")
    );
  }

  if (summary.fixedCount > 0) {
    const noun = summary.fixedCount === 1 ? "task" : "tasks";
    lines.push(
      `📦 Output-based: <b>${summary.fixedCount}</b> ${noun} · <b>${money(summary.fixedValue)}</b>`
    );
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

/** Reads the day's logs and returns the alert lines, or null. */
export async function shiftSummaryLine(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: ReturnType<typeof createServiceClient<any>>,
  userId: string,
  sessionDate: string
): Promise<string | null> {
  const { data } = await supabase
    .from("time_logs")
    .select("category, billable, billing_type, task_rate, start_time, end_time, duration_ms")
    .eq("user_id", userId)
    .eq("session_date", sessionDate)
    .is("deleted_at", null);

  return formatSummaryLine(summarize((data ?? []) as unknown as SummaryRow[]));
}
