/**
 * The Screenshot Report's own rules, shared by every page that shows screenshots.
 *
 * Admin's Screenshots tab is the source of truth for how a capture is labelled,
 * timed and judged (unchanged / away / no browser view / no capture record). This
 * module holds those rules so the submissions page's SC Data pill, the shared
 * screenshot viewer and Admin itself all read from one place — change a rule
 * here and every surface follows (Toni's call, 2026-11-09).
 *
 * Display only. Nothing here changes how or when screenshots are taken, and
 * screenshots themselves stay in Google Drive.
 */
import { findCaptureBatches, findCaptureGaps, type CaptureBatch, type CaptureGap } from "@/lib/screenshotGaps";
import { screenshotCaptureTime } from "@/lib/utils";

/** The fields of a task_screenshots row the report reads. */
export type ReportShot = {
  id: number;
  log_id: number | null;
  filename: string | null;
  screenshot_type: string | null;
  failure_reason: string | null;
  created_at: string;
  drive_file_id: string | null;
  captured_at?: string | null;
  image_hash?: string | null;
};

/** The fields of a time_logs row the report reads — enough to find capture gaps. */
export type ReportLog = {
  start_time: string | null;
  end_time: string | null;
  category?: string | null;
};

/**
 * A screenshot carrying the moment it was taken, and whether the screen had moved
 * since the previous shot of the same task.
 *
 * `captureTime` prefers `captured_at` (stamped by the client at the moment of
 * capture), falls back to the Drive filename, and only then to `created_at` — the
 * row's insert time, which for a queued upload can be hours late.
 */
export type CapturedShot<T extends ReportShot = ReportShot> = T & {
  captureTime: string;
  captureIsExact: boolean;
  /** Screen is pixel-for-pixel the layout of the previous capture in this task. */
  unchanged: boolean;
};

export function screenshotTypeLabel(type: string | null): string {
  if (!type) return "Manual";
  const labels: Record<string, string> = {
    start: "Start",
    progress: "Progress",
    end: "End",
    remote: "Remote",
    manual: "Manual",
    failed: "No capture",
  };
  return labels[type] || type;
}

export function screenshotTypeBadge(type: string | null): { bg: string; text: string } {
  if (!type) return { bg: "bg-parchment", text: "text-bark" };
  const styles: Record<string, { bg: string; text: string }> = {
    start: { bg: "bg-sage-soft", text: "text-sage" },
    progress: { bg: "bg-slate-blue-soft", text: "text-slate-blue" },
    end: { bg: "bg-terracotta-soft", text: "text-terracotta" },
    remote: { bg: "bg-amber-soft", text: "text-amber" },
    manual: { bg: "bg-parchment", text: "text-bark" },
    failed: { bg: "bg-stone/10", text: "text-stone" },
  };
  return styles[type] || { bg: "bg-parchment", text: "text-bark" };
}

/** Time-of-day with seconds — screenshots land seconds apart, so minutes alone blur them together. */
export function formatCaptureTime(iso: string, timezone?: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    ...(timezone ? { timeZone: timezone } : {}),
  });
}

/** "Nov 9" style date for the viewer header. */
export function formatCaptureDate(iso: string, timezone?: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(timezone ? { timeZone: timezone } : {}),
  });
}

/** The exact capture moment when known — null when only the upload time is. */
export function exactCaptureTime(shot: Pick<ReportShot, "captured_at" | "filename">): string | null {
  return shot.captured_at ?? screenshotCaptureTime(shot.filename);
}

/** Stamps each shot with its capture time. `unchanged` is resolved by orderTaskShots. */
export function withCaptureTimes<T extends ReportShot>(shots: T[]): CapturedShot<T>[] {
  return shots.map((ss) => ({
    ...ss,
    captureTime: ss.captured_at ?? screenshotCaptureTime(ss.filename) ?? ss.created_at,
    // Boolean(), not a null check: before the captured_at column exists the
    // field is absent from the row entirely, and `undefined !== null` would
    // label every old screenshot as exactly timed.
    captureIsExact: Boolean(ss.captured_at),
    unchanged: false,
  }));
}

/**
 * Sorts one task's shots oldest first and flags each one whose screen is
 * identical to the one before it. Compared only against the immediately
 * preceding shot of the same task, so a run of untouched screens reads as a run
 * of flags rather than one isolated mark. Mutates and returns the array.
 */
export function orderTaskShots<T extends ReportShot>(shots: CapturedShot<T>[]): CapturedShot<T>[] {
  shots.sort((a, b) => new Date(a.captureTime).getTime() - new Date(b.captureTime).getTime());
  shots.forEach((shot, i) => {
    const prev = i > 0 ? shots[i - 1] : null;
    shot.unchanged = !!(shot.image_hash && prev?.image_hash && shot.image_hash === prev.image_hash);
  });
  return shots;
}

/**
 * "Idle" is a claim about the person; everything else is a claim about the
 * browser. Counting them together reads as an accusation the data does not
 * support — a VA in a Zoom meeting produces "could not capture" all hour.
 */
export const AWAY_REASONS = ["Computer idle", "Screen locked"];

export const isAwayShot = (s: ReportShot) =>
  s.screenshot_type === "failed" && AWAY_REASONS.includes(s.failure_reason ?? "");

export const isNotCapturedShot = (s: ReportShot) =>
  s.screenshot_type === "failed" && !AWAY_REASONS.includes(s.failure_reason ?? "");

/** A slot that carries no image — a marker saying why there isn't one. */
export const isMarkerShot = (s: ReportShot) => s.screenshot_type === "failed" || !s.drive_file_id;

/** What the report says about one task's captures. */
export type TaskShotSummary = {
  total: number;
  unchangedBatches: CaptureBatch[];
  awayBatches: CaptureBatch[];
  notCapturedBatches: CaptureBatch[];
  /** Stretches with neither a screenshot nor a marker. */
  gaps: CaptureGap[];
};

/**
 * One task's report, from its shots already in order (see orderTaskShots).
 * `loaded` is the span the page actually has records for — see findCaptureGaps.
 */
export function summarizeTaskShots(
  shots: CapturedShot[],
  log: ReportLog | null,
  loaded?: { start: number; end: number } | null
): TaskShotSummary {
  return {
    total: shots.length,
    unchangedBatches: findCaptureBatches(shots, (s) => s.unchanged, "previous"),
    awayBatches: findCaptureBatches(shots, isAwayShot, "first"),
    notCapturedBatches: findCaptureBatches(shots, isNotCapturedShot, "first"),
    gaps: findCaptureGaps(shots.map((s) => s.captureTime), log, undefined, loaded),
  };
}

/** One task session's shots and the report on them. */
export type ShotSession = {
  logId: number | null;
  log: ReportLog | null;
  shots: CapturedShot[];
  summary: TaskShotSummary;
};

/**
 * Splits a mixed set of shots into one session per time log — the same unit
 * Admin's report groups by — oldest session first, each with its own summary.
 * The span of the shots given is treated as everything loaded, so a session cut
 * short at either end is not reported as having a gap at the cut.
 */
export function buildShotSessions(
  rows: ReportShot[],
  logsById: Record<number, ReportLog | undefined>
): ShotSession[] {
  const captured = withCaptureTimes(rows);
  const times = captured.map((s) => new Date(s.captureTime).getTime()).filter(Number.isFinite);
  const loaded = times.length ? { start: Math.min(...times), end: Math.max(...times) } : null;

  const byLog = new Map<string, CapturedShot[]>();
  for (const s of captured) {
    const key = s.log_id != null ? String(s.log_id) : "none";
    byLog.set(key, (byLog.get(key) ?? []).concat(s));
  }

  const sessions: ShotSession[] = Array.from(byLog.entries()).map(([key, shots]) => {
    const logId = key === "none" ? null : Number(key);
    const log = logId != null ? logsById[logId] ?? null : null;
    orderTaskShots(shots);
    return { logId, log, shots, summary: summarizeTaskShots(shots, log, loaded) };
  });
  sessions.sort(
    (a, b) => new Date(a.shots[0].captureTime).getTime() - new Date(b.shots[0].captureTime).getTime()
  );
  return sessions;
}
