import { getDayBoundsInTimezone } from "@/lib/utils";

/**
 * Which day's entries the dashboard's Activity Log calls "Today".
 *
 * A shift that crosses midnight keeps its entries filed under the day it started
 * until getCorrectSessionDate's own overnight cutoff in the dashboard corrects new
 * inserts back to today — but that correction only applies going forward. Entries
 * already written during the overnight window (12:12 AM-ish through the cutoff)
 * keep yesterday's session_date permanently; they never get relabeled. The log
 * used to show only entries filed under today's calendar date, so those entries
 * vanished from "Today" the moment anyone checked past the early morning, even
 * though by the clock they happened today and Time Log (which buckets by actual
 * start_time, not session_date) showed them fine all day.
 *
 * So the bridge below isn't time-of-day gated — a yesterday-filed entry that
 * genuinely overlaps or follows today's midnight (by its own start/end, not by
 * when someone happens to be looking) counts as "Today" all day long. It can
 * only ever reach back one calendar day (the `yesterdayStr` check), so it can't
 * leak further back as later days roll by.
 */
export interface ActivityDayLog {
  user_id: string;
  session_date?: string | null;
  start_time: string;
  end_time?: string | null;
}

export interface ActivityDayContext {
  todayStr: string;
  yesterdayStr: string;
  /** People still on an overnight shift: their yesterday-filed entries count as today. */
  continuing: Set<string>;
}

/** The org-timezone date ("YYYY-MM-DD") the log is filed under. */
export function logDateOf(log: ActivityDayLog, timezone: string): string {
  return log.session_date || new Date(log.start_time).toLocaleDateString("en-CA", { timeZone: timezone });
}

export function activityDayContext(logs: ActivityDayLog[], now: Date, timezone: string): ActivityDayContext {
  const todayStr = now.toLocaleDateString("en-CA", { timeZone: timezone });
  const yesterdayStr = new Date(now.getTime() - 24 * 60 * 60 * 1000).toLocaleDateString("en-CA", { timeZone: timezone });
  const continuing = new Set<string>();

  const midnightMs = new Date(getDayBoundsInTimezone(now, timezone).start).getTime();
  for (const log of logs) {
    if (logDateOf(log, timezone) !== yesterdayStr) continue;
    const stillOpen = !log.end_time;
    const crossedMidnight = log.end_time ? new Date(log.end_time).getTime() >= midnightMs : false;
    const startedAfterMidnight = new Date(log.start_time).getTime() >= midnightMs;
    if (stillOpen || crossedMidnight || startedAfterMidnight) continuing.add(log.user_id);
  }
  return { todayStr, yesterdayStr, continuing };
}

/** Whether a log belongs in the Activity Log's "Today". */
export function belongsToToday(log: ActivityDayLog, timezone: string, ctx: ActivityDayContext): boolean {
  const logDate = logDateOf(log, timezone);
  if (logDate === ctx.todayStr) return true;
  return logDate === ctx.yesterdayStr && ctx.continuing.has(log.user_id);
}
