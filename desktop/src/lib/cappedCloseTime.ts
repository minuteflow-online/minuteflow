// Ported from src/lib/cappedCloseTime.ts (+ the orgDateOf/orgWallClockToUtc
// helpers it depends on, from src/lib/taskSchedule.ts) — this project can't
// import across into ../src, so the logic is duplicated here rather than
// shared. Keep this in sync with the web file if the rule ever changes again;
// see that file's doc comment for the full incident history.

// Wall-clock parts of an instant as seen in `tz`.
function partsInTz(iso: string, tz: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(iso));
  const out: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") out[p.type] = p.value;
  // Intl renders midnight as "24" in some zones; normalize back to 00.
  if (out.hour === "24") out.hour = "00";
  return out;
}

// Which calendar day a stored instant falls on IN ORG TIME.
function orgDateOf(iso: string, tz: string): string {
  const p = partsInTz(iso, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

// "YYYY-MM-DD" + "HH:MM" as typed on an org-time calendar -> the UTC instant.
function orgWallClockToUtc(dateStr: string, timeStr: string, tz: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);
  // Start from the wall clock read as if it were UTC, then subtract however far
  // that guess lands from the target zone. One correction is enough: zone
  // offsets shift by at most an hour or two and the guess is already within
  // a day, so re-reading the corrected instant cannot cross another boundary.
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const p = partsInTz(new Date(guess).toISOString(), tz);
  const asSeenInTz = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour), Number(p.minute), Number(p.second), 0
  );
  return new Date(guess - (asSeenInTz - guess)).toISOString();
}

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
 * Crossing midnight is NOT enough to call a log abandoned — this was wrong
 * twice over on the web app before landing here (see src/lib/cappedCloseTime.ts's
 * doc comment for the full Charinade/Shem history): first the "which day"
 * check read the browser's local clock instead of the org timezone, then even
 * after fixing that, crossing org midnight alone still cut short a log that
 * was only minutes or hours old — someone working through midnight, not
 * someone who walked away. A log is treated as abandoned only when it crossed
 * org midnight AND has been open longer than STALE_OPEN_MS.
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
