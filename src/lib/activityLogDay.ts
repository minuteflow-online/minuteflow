import { getDayBoundsInTimezone } from "@/lib/utils";

/**
 * Which day's entries the dashboard's Activity Log calls "Today".
 *
 * A shift that crosses midnight keeps its entries filed under the day it started
 * until OVERNIGHT_CUTOFF_HOUR (see getCorrectSessionDate in the dashboard), so at
 * 12:08 AM on Oct 21 a person's entries still say Oct 20. The log used to show only
 * entries filed under today's calendar date, so at midnight an ongoing shift fell
 * out of "Today" and into "previous days" until the cutoff, which looked like the
 * whole log had vanished while the person was still working.
 *
 * Between midnight and the cutoff, a person who is still on that shift keeps
 * their yesterday-filed entries in "Today". Everyone else's yesterday stays in
 * "previous days".
 */
export const OVERNIGHT_CUTOFF_HOUR = 6;

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

function hourIn(date: Date, timezone: string): number {
  return Number(date.toLocaleString("en-US", { timeZone: timezone, hour: "numeric", hour12: false })) % 24;
}

export function activityDayContext(logs: ActivityDayLog[], now: Date, timezone: string): ActivityDayContext {
  const todayStr = now.toLocaleDateString("en-CA", { timeZone: timezone });
  const yesterdayStr = new Date(now.getTime() - 24 * 60 * 60 * 1000).toLocaleDateString("en-CA", { timeZone: timezone });
  const continuing = new Set<string>();

  // After the cutoff, new entries are filed under today again, so there is no
  // overnight continuation to bridge.
  if (hourIn(now, timezone) >= OVERNIGHT_CUTOFF_HOUR) return { todayStr, yesterdayStr, continuing };

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
