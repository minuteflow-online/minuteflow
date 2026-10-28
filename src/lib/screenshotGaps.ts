/**
 * Stretches of a task with neither a screenshot nor a marker.
 *
 * While someone is clocked in the capture runs every 5 minutes and each slot
 * leaves a row: a screenshot, or a marker that says why there is none ("Computer
 * idle", "Chrome was minimised"). So a long stretch with no row at all is not a
 * skipped slot, it is capture not running or not able to report — Chrome closed,
 * the computer asleep, a lost sign-in. This finds those stretches so the
 * Screenshots page can name them instead of leaving a silent hole.
 *
 * Display only. It reads rows that already exist and changes nothing about how
 * or when screenshots are taken.
 */

/** Two missed 5-minute slots plus a little slack. One missed slot can be timing. */
export const CAPTURE_GAP_MS = 12 * 60 * 1000;

export interface CaptureGap {
  start: string;
  end: string;
  minutes: number;
}

/**
 * @param shotTimes  when each screenshot or marker of the task was recorded
 * @param log        the task's own start and end. An open task has no end, so
 *                   nothing is claimed about time after its last record.
 * @param loaded     the span (ms) the page actually has records for. The task's
 *                   start/end are ignored outside it, so a task cut off by the
 *                   date filter is not reported as having a gap at the cut.
 */
export function findCaptureGaps(
  shotTimes: string[],
  log: { start_time: string | null; end_time: string | null; category?: string | null } | null,
  thresholdMs: number = CAPTURE_GAP_MS,
  loaded?: { start: number; end: number } | null
): CaptureGap[] {
  // A break is deliberately not captured, so a quiet break is not a gap. Pause
  // (desktop app) is the same: no screenshots are taken while paused.
  if (log?.category === "Break" || log?.category === "Pause") return [];

  const points = shotTimes.map((t) => new Date(t).getTime()).filter((t) => Number.isFinite(t));
  // The task's own start and end only count when the page actually loaded records
  // that far. A date filter (or the 500-row limit) can cut a task in the middle:
  // its earlier shots exist but are not on screen, and reading the task's start
  // as "nothing was recorded since then" would invent a gap. Anything before the
  // oldest loaded record, or after the newest, is outside what the page can judge.
  const logStart = log?.start_time ? new Date(log.start_time).getTime() : NaN;
  const logEnd = log?.end_time ? new Date(log.end_time).getTime() : NaN;
  if (Number.isFinite(logStart) && (!loaded || logStart >= loaded.start)) points.push(logStart);
  if (Number.isFinite(logEnd) && (!loaded || logEnd <= loaded.end)) points.push(logEnd);
  const sorted = points.filter((t) => Number.isFinite(t)).sort((a, b) => a - b);

  const gaps: CaptureGap[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const span = sorted[i] - sorted[i - 1];
    if (span > thresholdMs) {
      gaps.push({
        start: new Date(sorted[i - 1]).toISOString(),
        end: new Date(sorted[i]).toISOString(),
        minutes: Math.round(span / 60000),
      });
    }
  }
  return gaps;
}

/** "1h 54m", "47m" — same shape the rest of the page uses for spans. */
export function formatGapMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
