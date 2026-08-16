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

/** Just enough of a screenshot row to count and attribute it. */
export type ScreenshotOwnerRow = Pick<TaskScreenshot, "id" | "user_id" | "created_at">;

/**
 * Owner rows for every screenshot captured in a date range, paged past the 1000-row
 * cap. Used where only counts matter — a week of team captures runs well past 1000,
 * so a single request would under-report.
 */
export async function fetchScreenshotOwnersInRange(
  supabase: SupabaseBrowserClient,
  startIso: string,
  endIso: string
): Promise<ScreenshotOwnerRow[]> {
  const rows: ScreenshotOwnerRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("task_screenshots")
      .select("id, user_id, created_at")
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error || !data || data.length === 0) break;
    rows.push(...(data as ScreenshotOwnerRow[]));
    if (data.length < PAGE_SIZE) break;
  }

  return rows;
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
