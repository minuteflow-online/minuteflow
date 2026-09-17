import { orgDateOf, orgWallClockToUtc } from "@/lib/taskSchedule";

/**
 * A stale open log (Clock In left running overnight, a task nobody switched
 * off) closes at 23:59:59.999 of the day it STARTED, not at `now`. Without
 * this, closing an overnight "Clock In" the next time a real task starts
 * bills the entire dead-of-night gap as worked time: this is what turned one
 * placeholder log into a 15.6-hour billable entry in the August Time Review
 * (Charinade, log 5659).
 *
 * "Day" and "end of day" are both org-timezone concepts (orgDateOf /
 * orgWallClockToUtc), never the browser's local system clock. That
 * distinction is the actual cause of Charinade's 2026-09-09 and 2026-09-16
 * timelog gaps: her computer's local day rolls over at Manila midnight,
 * which lands mid-shift in the org's own Eastern-time day. A version of
 * this that read `.toDateString()`/`.setHours()` — the browser's local
 * zone — misread a still-actively-running, hours-old task as "started on a
 * previous day" the moment her local clock crossed midnight, and capped it
 * at *her* local end-of-day (23:59:59.999 Manila time, only early afternoon
 * in the org's own timezone) — silently truncating hours of real,
 * screenshot-proven work. orgDateOf already carries this exact lesson for
 * the calendar grid (see its own comment); this is the same fix applied
 * here.
 */
export function cappedCloseTime(
  startTime: string | null,
  now: string,
  orgTimezone: string
): { endTime: string; durationMs: number } {
  const startMs = startTime ? new Date(startTime).getTime() : new Date(now).getTime();
  const sameDay = startTime && orgDateOf(startTime, orgTimezone) === orgDateOf(now, orgTimezone);
  let endTime: string;
  if (!sameDay && startTime) {
    const endOfDayStart = orgWallClockToUtc(orgDateOf(startTime, orgTimezone), "23:59", orgTimezone);
    endTime = new Date(new Date(endOfDayStart).getTime() + 59999).toISOString(); // 23:59:59.999
  } else {
    endTime = now;
  }
  return { endTime, durationMs: Math.max(0, new Date(endTime).getTime() - startMs) };
}
