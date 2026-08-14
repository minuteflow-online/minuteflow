/**
 * Ported verbatim from `getCorrectSessionDate` in
 * src/app/(app)/dashboard/page.tsx (web app). Per the desktop spec (section 1b),
 * any task-start/task-end logic here must use the same shared, timezone-aware
 * date logic as the web app instead of a new inline `new Date()` calculation —
 * that's what caused the session_date drift bug in capture-alerts/route.ts.
 *
 * If the web app's version of this function changes, port the change here too
 * rather than letting the two drift apart.
 */

// Single source of truth for "what session_date should this new time_log get."
// A stored session.session_date can go stale if Clock Out ever fails to
// register (network blip, closed tab, etc.) — without this check, every
// later insert would keep blindly copying that old date forward, sometimes
// for days. Rule: a shift that's still going in the early morning hours is
// treated as a real overnight continuation (kept on the Clock In day, per
// policy). Anything older than that is stale and gets today's real date
// instead, so a missed Clock Out can only ever corrupt one day, not several.
const OVERNIGHT_CUTOFF_HOUR = 6;

function getCorrectSessionDate(session, orgTimezone) {
  const now = new Date();
  const todayStr = now.toLocaleDateString("en-CA", { timeZone: orgTimezone });
  const storedDate = session?.session_date;

  if (!storedDate || storedDate === todayStr) {
    return storedDate || todayStr;
  }

  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayStr = yesterday.toLocaleDateString("en-CA", { timeZone: orgTimezone });
  const currentHour = Number(
    now.toLocaleString("en-US", { timeZone: orgTimezone, hour: "numeric", hour12: false })
  );

  if (storedDate === yesterdayStr && currentHour < OVERNIGHT_CUTOFF_HOUR) {
    return storedDate; // genuine overnight shift — keep it on the Clock In day
  }

  return todayStr; // stale (missed Clock Out) — start fresh
}

module.exports = { getCorrectSessionDate, OVERNIGHT_CUTOFF_HOUR };
