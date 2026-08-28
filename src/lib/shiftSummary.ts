import { createClient as createServiceClient } from "@supabase/supabase-js";

/**
 * The day's totals, appended to a clock-out alert in Toni's private chat.
 *
 * Without it the clock-out line said only when someone stopped, so answering
 * "how long did she actually work?" meant opening the admin panel — every
 * time, for every person. The three numbers she reads first belong on the line
 * she already gets.
 *
 * Not sent to the VA and not to the team chat. Hours are between the two of
 * them, and a running tally of everyone's day posted publicly is a scoreboard.
 */

export interface ShiftSummary {
  /** Everything tracked that day, including breaks. */
  totalMs: number;
  /** The part marked billable — breaks included if they were wrongly flagged. */
  billableMs: number;
  /** Break and Personal together; she reads them as one number, not two. */
  awayMs: number;
  entries: number;
}

interface SummaryRow {
  category: string | null;
  billable: boolean | null;
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
function durationOf(row: SummaryRow, now: number): number {
  if (row.duration_ms != null && row.duration_ms > 0) return row.duration_ms;
  const start = new Date(row.start_time).getTime();
  const end = row.end_time ? new Date(row.end_time).getTime() : now;
  return Math.max(0, end - start);
}

const AWAY_CATEGORIES = new Set(["Break", "Personal"]);

export function summarize(rows: SummaryRow[], now: number = Date.now()): ShiftSummary {
  let totalMs = 0;
  let billableMs = 0;
  let awayMs = 0;

  for (const row of rows) {
    const ms = durationOf(row, now);
    totalMs += ms;
    if (row.billable) billableMs += ms;
    if (row.category && AWAY_CATEGORIES.has(row.category)) awayMs += ms;
  }

  return { totalMs, billableMs, awayMs, entries: rows.length };
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

/**
 * One line for the alert, or null when there is nothing to summarise.
 *
 * A shift with no entries prints nothing rather than "Total 0m" — a row of
 * zeroes looks like a bug in the tracker and invites a question every time.
 */
export function formatSummaryLine(summary: ShiftSummary): string | null {
  if (summary.entries === 0 || summary.totalMs === 0) return null;
  return [
    `⏱ Total <b>${humanDuration(summary.totalMs)}</b>`,
    `Billable <b>${humanDuration(summary.billableMs)}</b>`,
    `Break/personal <b>${humanDuration(summary.awayMs)}</b>`,
  ].join(" · ");
}

/** Reads the day's logs and returns the alert line, or null. */
export async function shiftSummaryLine(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: ReturnType<typeof createServiceClient<any>>,
  userId: string,
  sessionDate: string
): Promise<string | null> {
  const { data } = await supabase
    .from("time_logs")
    .select("category, billable, start_time, end_time, duration_ms")
    .eq("user_id", userId)
    .eq("session_date", sessionDate)
    .is("deleted_at", null);

  return formatSummaryLine(summarize((data ?? []) as unknown as SummaryRow[]));
}
