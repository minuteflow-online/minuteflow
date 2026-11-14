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
 *
 * An entry whose own start_time already falls on/after today's midnight is
 * today no matter what — that's exactly how Time Log buckets it too, so it
 * always shows. The "pull in the earlier, non-crossing part of the shift
 * too" grouping (so a Clock In or a task that both start AND end before
 * midnight still reads as part of the same visible shift) is the part that's
 * only for show-while-live: it exists so a late-night task doesn't look like
 * it vanished while someone's still actively working, not to keep
 * yesterday's hours mixed into today's total for the rest of the day once
 * they're done. Once a Clock Out shows up anywhere at or after that shift's
 * start (it's usually filed under today itself, once the cutoff has
 * passed), that grouping stops and those pre-midnight entries settle back
 * under yesterday — same as Time Log already files them.
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

  // All of this user's logs (today's included) — needed to tell whether a
  // yesterday-filed shift has since clocked out, since that Clock Out is
  // usually filed under today once the cutoff has passed.
  const allByUser = new Map<string, ActivityDayLog[]>();
  const yesterdayByUser = new Map<string, ActivityDayLog[]>();
  for (const log of logs) {
    const all = allByUser.get(log.user_id);
    if (all) all.push(log);
    else allByUser.set(log.user_id, [log]);

    if (logDateOf(log, timezone) !== yesterdayStr) continue;
    const bucket = yesterdayByUser.get(log.user_id);
    if (bucket) bucket.push(log);
    else yesterdayByUser.set(log.user_id, [log]);
  }

  for (const [userId, userLogs] of yesterdayByUser) {
    userLogs.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    const lastClockOut = userLogs.map((l) => l.category).lastIndexOf("Clock Out");
    const lastShift = userLogs.slice(lastClockOut + 1);
    if (lastShift.length === 0) continue;

    const shiftStartMs = new Date(lastShift[0].start_time).getTime();
    const alreadyClockedOut = (allByUser.get(userId) ?? []).some(
      (log) => log.category === "Clock Out" && new Date(log.start_time).getTime() >= shiftStartMs
    );

    const ownQualifies = (log: ActivityDayLog) => {
      const stillOpen = !log.end_time;
      const crossedMidnight = log.end_time ? new Date(log.end_time).getTime() >= midnightMs : false;
      const startedAfterMidnight = new Date(log.start_time).getTime() >= midnightMs;
      return stillOpen || crossedMidnight || startedAfterMidnight;
    };
    if (!lastShift.some(ownQualifies)) continue;

    for (const log of lastShift) {
      const startedAfterMidnight = new Date(log.start_time).getTime() >= midnightMs;
      if (startedAfterMidnight || !alreadyClockedOut) continuing.add(log.id);
    }
  }

  return { todayStr, yesterdayStr, continuing };
}

/** Whether a log belongs in the Activity Log's "Today". */
export function belongsToToday(log: ActivityDayLog, timezone: string, ctx: ActivityDayContext): boolean {
  const logDate = logDateOf(log, timezone);
  if (logDate === ctx.todayStr) return true;
  return logDate === ctx.yesterdayStr && ctx.continuing.has(log.id);
}
