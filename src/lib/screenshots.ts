import type { createClient } from "@/lib/supabase/client";
import type { TaskScreenshot } from "@/types/database";

type SupabaseBrowserClient = ReturnType<typeof createClient>;

// Supabase caps a single response at 1000 rows. task_screenshots is the biggest
// table in the app (tens of thousands of rows, thousands per VA), so an unbounded
// `select("*")` silently returns the oldest 1000 rows a caller is allowed to see
// and nothing recent — which is why a VA's own screenshots stopped showing up in
// the Activity Log and Time Log. Always scope to the logs on screen and page
// through the result rather than trusting a single request to be complete.
const PAGE_SIZE = 1000;

// Log IDs go into the query string, so they're chunked to keep the URL sane.
const LOG_ID_CHUNK = 100;

/**
 * Every screenshot attached to the given time logs, paged past the 1000-row cap.
 * Returns an empty array for an empty log list (no request is made).
 */
export async function fetchScreenshotsForLogs(
  supabase: SupabaseBrowserClient,
  logIds: number[]
): Promise<TaskScreenshot[]> {
  const ids = Array.from(new Set(logIds));
  if (ids.length === 0) return [];

  const rows: TaskScreenshot[] = [];

  for (let i = 0; i < ids.length; i += LOG_ID_CHUNK) {
    const chunk = ids.slice(i, i + LOG_ID_CHUNK);

    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from("task_screenshots")
        .select("*")
        .in("log_id", chunk)
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error || !data || data.length === 0) break;
      rows.push(...(data as TaskScreenshot[]));
      if (data.length < PAGE_SIZE) break;
    }
  }

  return rows;
}

export type ScreenshotCountsByUser = {
  total: number;
  byUser: Record<string, number>;
};

/**
 * Screenshot counts (overall + per user) for a date range, without paging through
 * every row. A wide range (a quarter, a year) can cover tens of thousands of rows —
 * fetching and paginating the rows themselves to then just count them client-side
 * turned "This Year" into dozens of sequential round trips. `count: "exact", head:
 * true` gets Postgres to do the counting and only the number crosses the wire.
 */
export async function fetchScreenshotCountsInRange(
  supabase: SupabaseBrowserClient,
  startIso: string,
  endIso: string,
  userIds: string[]
): Promise<ScreenshotCountsByUser> {
  const ids = Array.from(new Set(userIds));

  const [totalRes, ...userResults] = await Promise.all([
    supabase
      .from("task_screenshots")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startIso)
      .lte("created_at", endIso),
    ...ids.map((uid) =>
      supabase
        .from("task_screenshots")
        .select("id", { count: "exact", head: true })
        .eq("user_id", uid)
        .gte("created_at", startIso)
        .lte("created_at", endIso)
    ),
  ]);

  const byUser: Record<string, number> = {};
  ids.forEach((uid, i) => {
    byUser[uid] = userResults[i].count ?? 0;
  });

  return { total: totalRes.count ?? 0, byUser };
}

/**
 * Tooltip text for one screenshot tile. A marker (screenshot_type "failed") has
 * no image, ever, by design — it exists to record *why* a slot is blank (idle,
 * screen locked, on a MinuteFlow tab), so its tooltip should say that reason,
 * not "Screenshot failed", which reads as a bug rather than the explanation it is.
 */
export function screenshotTileTitle(ss: TaskScreenshot): string {
  if (ss.screenshot_type === "failed") {
    return ss.failure_reason || "No screenshot for this slot";
  }
  return `Screenshot ${ss.screenshot_type || "manual"}`;
}

/**
 * The exhaustive set of failure_reason strings the extension actually
 * produces (extension/background.js — queueMarker() call sites). A raw
 * reason like "On MinuteFlow — not captured" is true but assumes the reader
 * already knows why that happens; this is the plain-language version for
 * surfaces where someone is actively trying to understand a blank slot, not
 * just glancing at a tooltip. Requested by Toni after a review meeting,
 * specifically about that one reason reading as unexplained.
 */
const SCREENSHOT_REASON_EXPLANATIONS: Record<string, string> = {
  "On MinuteFlow — not captured":
    "You were on a MinuteFlow page at that moment — the extension doesn't screenshot MinuteFlow itself, only your work elsewhere.",
  "Screen locked": "Your screen was locked, so there was nothing to capture.",
  "Computer idle": "No activity was detected on your computer at that moment.",
  "Chrome was not open": "Chrome wasn't open at that moment.",
  "No tab open in Chrome": "No browser tab was open at that moment.",
  "On a browser settings page":
    "You were on a browser settings page, which Chrome doesn't allow any extension to capture.",
  "Chrome was minimised or another app was in front":
    "Chrome was minimized, or a non-browser app was in front, at that moment.",
  "Screen could not be captured": "The capture failed and the extension couldn't tell why.",
  "Clocked in — no active task": "You were clocked in but hadn't started a task yet.",
};

/**
 * Full explanation for a marker's reason, for a surface with room for one
 * (a detail modal or lightbox) — not the short tile tooltip, which stays as
 * screenshotTileTitle's raw reason. Falls back to the raw reason itself for
 * anything not in the table above, so a new reason string added later still
 * shows something instead of nothing.
 */
export function explainScreenshotReason(reason: string | null | undefined): string {
  if (!reason) return "No reason was recorded for this slot.";
  return SCREENSHOT_REASON_EXPLANATIONS[reason] ?? reason;
}

/** Group a flat screenshot list by log_id, the shape the log tables render from. */
export function groupScreenshotsByLog(
  screenshots: TaskScreenshot[]
): Record<number, TaskScreenshot[]> {
  const grouped: Record<number, TaskScreenshot[]> = {};
  screenshots.forEach((ss) => {
    if (ss.log_id === null) return;
    if (!grouped[ss.log_id]) grouped[ss.log_id] = [];
    grouped[ss.log_id].push(ss);
  });
  return grouped;
}
