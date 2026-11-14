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
 *
 * It's scoped per shift, not just per person: two yesterday-filed shifts can
 * share the same session_date (an already-closed-out overnight shift, then a
 * brand new Clock In later that same evening that's the one actually reaching
 * into today) — bridging by user_id alone pulled the whole closed-out shift
 * back into "Today" too. A "Clock Out" row ends a shift, so only the run of
 * entries after the LAST one (or everything, if there's no Clock Out at all)
 * is a candidate to bridge.
 */
export interface ActivityDayLog {
  id: number;
  user_id: string;
  category: string;
  session_date?: string | null;
  start_time: string;
  end_time?: string | null;
}

export interface ActivityDayContext {
  todayStr: string;
  yesterdayStr: string;
  /** Specific yesterday-filed log ids whose shift reaches into today. */
  continuing: Set<number>;
}

/** The org-timezone date ("YYYY-MM-DD") the log is filed under. */
export function logDateOf(log: ActivityDayLog, timezone: string): string {
  return log.session_date || new Date(log.start_time).toLocaleDateString("en-CA", { timeZone: timezone });
}

export function activityDayContext(logs: ActivityDayLog[], now: Date, timezone: string): ActivityDayContext {
  const todayStr = now.toLocaleDateString("en-CA", { timeZone: timezone });
  const yesterdayStr = new Date(now.getTime() - 24 * 60 * 60 * 1000).toLocaleDateString("en-CA", { timeZone: timezone });
  const continuing = new Set<number>();

  const midnightMs = new Date(getDayBoundsInTimezone(now, timezone).start).getTime();

  const byUser = new Map<string, ActivityDayLog[]>();
  for (const log of logs) {
    if (logDateOf(log, timezone) !== yesterdayStr) continue;
    const bucket = byUser.get(log.user_id);
    if (bucket) bucket.push(log);
    else byUser.set(log.user_id, [log]);
  }

  for (const userLogs of byUser.values()) {
    userLogs.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    const lastClockOut = userLogs.map((l) => l.category).lastIndexOf("Clock Out");
    const lastShift = userLogs.slice(lastClockOut + 1);
    const qualifies = lastShift.some((log) => {
      const stillOpen = !log.end_time;
      const crossedMidnight = log.end_time ? new Date(log.end_time).getTime() >= midnightMs : false;
      const startedAfterMidnight = new Date(log.start_time).getTime() >= midnightMs;
      return stillOpen || crossedMidnight || startedAfterMidnight;
    });
    if (qualifies) lastShift.forEach((log) => continuing.add(log.id));
  }

  return { todayStr, yesterdayStr, continuing };
}

/** Whether a log belongs in the Activity Log's "Today". */
export function belongsToToday(log: ActivityDayLog, timezone: string, ctx: ActivityDayContext): boolean {
  const logDate = logDateOf(log, timezone);
  if (logDate === ctx.todayStr) return true;
  return logDate === ctx.yesterdayStr && ctx.continuing.has(log.id);
}
