import { orgDateOf, orgWallClockToUtc } from "@/lib/taskSchedule";

/**
 * How long a log must have been open before crossing midnight makes it look
 * abandoned rather than worked. Real single tasks in this data top out around
 * 5.8 hours; the only entries past 9 hours are logs someone walked away from
 * (a 12.7-hour Sorting entry, a 15.6-hour "Clock In" placeholder). Eight hours
 * sits between the two.
 */
export const STALE_OPEN_MS = 8 * 60 * 60 * 1000;

/**
 * What a sweep should use as the end of a still-open log: `now`, unless the
 * log looks abandoned overnight, in which case the end of the org day it
 * started on (23:59:59.999, org time).
 *
 * The cap exists for one case: a log someone left running and walked away
 * from ("Clock In" left overnight billed as a 15.6-hour entry — Charinade,
 * log 5659). Closing that at `now` bills the whole dead-of-night gap.
 *
 * Crossing midnight is NOT enough to call a log abandoned, and treating it
 * that way has now cost people real hours twice over:
 *
 *  - Charinade, 2026-09-09 and 2026-09-16. "Did this start on a previous
 *    day" was read off the browser's local clock (`.toDateString()` /
 *    `.setHours()`). Her computer runs on Manila time, whose midnight lands
 *    at noon in the org's Eastern day, so a task that had been running for
 *    45 minutes mid-shift was capped at *Manila* end-of-day and cut short.
 *    Fixed by reading "day" in the org timezone (orgDateOf).
 *
 *  - Shem, 2026-09-17 and 2026-09-18. That fix moved the boundary to
 *    Eastern midnight, which is the middle of *his* working day (his shift
 *    is Manila daytime). A task started at 11:41 PM and switched at 1:45 AM
 *    was capped at 11:59:59.999 PM — 1h45m of proven, screenshot-backed work
 *    gone; a "Clock In" from 11:59 PM to 12:35 AM lost 35 minutes. Whatever
 *    timezone midnight is read in, it lands mid-shift for somebody.
 *
 * So the boundary alone can't decide it. A log is treated as abandoned only
 * when it crossed org midnight AND has been open longer than STALE_OPEN_MS.
 * A log that crossed midnight but is only minutes or hours old is somebody
 * working through it, and closes at `now`.
 *
 * A more exact answer would end an abandoned log at its last real screenshot
 * rather than at midnight; the midnight cap is kept because it's the existing
 * behavior for that case and changing what abandoned logs bill is a separate
 * decision.
 */
export function cappedCloseTime(
  startTime: string | null,
  now: string,
  orgTimezone: string
): { endTime: string; durationMs: number } {
  const startMs = startTime ? new Date(startTime).getTime() : new Date(now).getTime();
  const nowMs = new Date(now).getTime();
  const crossedOrgMidnight =
    Boolean(startTime) && orgDateOf(startTime as string, orgTimezone) !== orgDateOf(now, orgTimezone);
  const looksAbandoned = crossedOrgMidnight && nowMs - startMs > STALE_OPEN_MS;

  let endTime: string;
  if (looksAbandoned && startTime) {
    const endOfDayStart = orgWallClockToUtc(orgDateOf(startTime, orgTimezone), "23:59", orgTimezone);
    endTime = new Date(new Date(endOfDayStart).getTime() + 59999).toISOString(); // 23:59:59.999
  } else {
    endTime = now;
  }
  return { endTime, durationMs: Math.max(0, new Date(endTime).getTime() - startMs) };
}
