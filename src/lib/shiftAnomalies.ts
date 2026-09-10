import { createClient as createServiceClient } from "@supabase/supabase-js";
import { ORG_TIMEZONE } from "@/lib/taskSchedule";
import { entryDurationMs } from "@/lib/shiftSummary";

// The three checks from the manual August time review — a Break entry that
// somehow ended up billable, a "Clock In" placeholder that never got handed
// off to a real task, and two billable entries that substantially overlap
// (double-counted time) — plus a gap check added after Charinade's
// 2026-09-09 shift: a task closed after 21 seconds while her screenshots kept
// arriving against it for another 1h50m, so nothing in time_logs showed the
// work ever happened. Small task-switch jitter (a couple of seconds at a
// boundary) is normal and intentionally not flagged.
//
// How the message reads is in shiftAnomalyFormat.ts; this file only decides
// what is wrong.

/** A "Clock In" placeholder idle/open this long is worth a human look. */
const ORPHAN_CLOCK_IN_MINUTES = 20;

/** Overlap below this is task-switch timestamp jitter, not a real double-count. */
const OVERLAP_MINUTES = 2;

/**
 * A gap below this is normal: a real task switch closes the old log and opens
 * the new one off the same "now", so back-to-back entries in this data are
 * exactly contiguous. Anything longer means nothing was logged for that
 * stretch at all — either a real unlogged break/absence, or a log closed too
 * early while work actually continued (see silent_gap below).
 */
const GAP_MINUTES = 5;

export interface ShiftAnomalyFinding {
  type: "billed_break" | "orphaned_clock_in" | "overlap" | "break_overlap" | "silent_gap" | "unlogged_gap";
  logId: number;
  /** Every log the finding implicates — two of them for an overlap. */
  logIds: number[];
  taskName: string;
  startTime: string;
  endTime: string | null;
  /** The slice of the day that is actually wrong, not the whole entry. */
  windowStart: string;
  windowEnd: string | null;
  minutes: number;
  detail: string;
}

export interface ShiftLogRow {
  id: number;
  task_name: string;
  category: string;
  billable: boolean;
  start_time: string;
  end_time: string | null;
  duration_ms: number | null;
}

export interface ShiftAnomalyResult {
  clean: boolean;
  findings: ShiftAnomalyFinding[];
  /** The whole day, in order — what the context lines in the alert come from. */
  logs: ShiftLogRow[];
}

/**
 * Checks one VA's just-completed shift for the billing anomalies flagged in
 * the August review: billed breaks, orphaned "Clock In" placeholders, and
 * overlapping billable entries.
 *
 * Scoped by time_logs.session_date rather than sessions.clock_in_time —
 * clock_in_time is cleared back to null the moment a session clocks out, so
 * it can't be used to bound the query after the fact. session_date is the
 * org-timezone calendar day and is what the rest of the app already keys on.
 *
 * Durations come from entryDurationMs, not duration_ms directly. Plenty of
 * rows store 0 there while start and end sit half an hour apart — the first
 * live alert called a 26-minute billed break "0 min", which made the thing
 * being flagged look like nothing.
 */
export async function checkShiftAnomalies(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: ReturnType<typeof createServiceClient<any>>,
  userId: string,
  sessionDate: string
): Promise<ShiftAnomalyResult> {
  const { data: logs } = await supabase
    .from("time_logs")
    .select("id, task_name, category, billable, start_time, end_time, duration_ms")
    .eq("user_id", userId)
    .eq("session_date", sessionDate)
    .is("deleted_at", null)
    .order("start_time", { ascending: true });

  const rows = (logs ?? []) as unknown as ShiftLogRow[];
  const findings: ShiftAnomalyFinding[] = [];

  for (const row of rows) {
    const minutes = entryDurationMs(row) / 60000;

    if (row.category === "Break" && row.billable) {
      findings.push({
        type: "billed_break",
        logId: row.id,
        logIds: [row.id],
        taskName: row.task_name,
        startTime: row.start_time,
        endTime: row.end_time,
        windowStart: row.start_time,
        windowEnd: row.end_time,
        minutes,
        detail: `Break marked billable (${minutes.toFixed(0)} min)`,
      });
    }

    if (row.task_name === "Clock In" && minutes > ORPHAN_CLOCK_IN_MINUTES) {
      findings.push({
        type: "orphaned_clock_in",
        logId: row.id,
        logIds: [row.id],
        taskName: row.task_name,
        startTime: row.start_time,
        endTime: row.end_time,
        windowStart: row.start_time,
        windowEnd: row.end_time,
        minutes,
        detail: `"Clock In" placeholder ran ${minutes.toFixed(0)} min without handing off to a task`,
      });
    }
  }

  const isOwnTime = (row: ShiftLogRow) => row.category === "Break" || row.category === "Personal";

  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      if (!a.end_time || !b.end_time) continue;

      // The August-review check only looked at two billable entries
      // double-counting paid hours. A Break is never billable, so it was
      // structurally invisible here — Break overlapping a real task never
      // tripped this at all, which is exactly the shape of the 2026-09-04
      // incident (Flordeliz): a break log stayed open for over an hour
      // alongside the task resumed after it, and nothing caught it. One side
      // being Break or Personal ("own time," which must never run alongside
      // anything else) is now enough to flag on its own — it doesn't also
      // need both sides billable the way a pure double-count does.
      const bothBillable = a.billable && b.billable;
      const ownTimeInvolved = isOwnTime(a) || isOwnTime(b);
      if (!bothBillable && !ownTimeInvolved) continue;

      const aStart = new Date(a.start_time).getTime();
      const aEnd = new Date(a.end_time).getTime();
      const bStart = new Date(b.start_time).getTime();
      const bEnd = new Date(b.end_time).getTime();
      const overlapStart = Math.max(aStart, bStart);
      const overlapEnd = Math.min(aEnd, bEnd);
      const overlapMinutes = (overlapEnd - overlapStart) / 60000;

      if (overlapMinutes > OVERLAP_MINUTES) {
        const type = bothBillable ? "overlap" : "break_overlap";
        findings.push({
          type,
          logId: b.id,
          logIds: [a.id, b.id],
          taskName: b.task_name,
          startTime: b.start_time,
          endTime: b.end_time,
          // Only the overlapping slice, not either entry in full — the point is
          // to see the double-counted minutes on their own.
          windowStart: new Date(overlapStart).toISOString(),
          windowEnd: new Date(overlapEnd).toISOString(),
          minutes: overlapMinutes,
          detail:
            type === "overlap"
              ? `"${b.task_name}" (log ${b.id}) overlaps "${a.task_name}" (log ${a.id}) by ${overlapMinutes.toFixed(0)} min — possible double count`
              : `"${a.category === "Break" || a.category === "Personal" ? a.task_name : b.task_name}" (own time) overlaps "${a.category === "Break" || a.category === "Personal" ? b.task_name : a.task_name}" by ${overlapMinutes.toFixed(0)} min — one of them didn't actually close`,
        });
      }
    }
  }

  // Gaps: a stretch between two logs where nothing at all was recorded.
  // Skip pairs that straddle an actual clock-out/back-in — that time is
  // legitimately off the clock, not lost — by excluding any pair where the
  // earlier log is the "Clocked Out" marker or the later one is "Clock In".
  for (let i = 0; i < rows.length - 1; i++) {
    const cur = rows[i];
    const next = rows[i + 1];
    const curEnd = cur.end_time;
    if (!curEnd) continue;
    if (cur.category === "Clock Out" || next.task_name === "Clock In") continue;
    // Break and Personal are already non-billable by design — a gap after one
    // of these ends isn't missing billable time, whatever screenshots turn up
    // during it. That question (did she come back late?) belongs to a
    // different check, not this one.
    if (isOwnTime(cur)) continue;

    const gapMinutes = (new Date(next.start_time).getTime() - new Date(curEnd).getTime()) / 60000;
    if (gapMinutes <= GAP_MINUTES) continue;

    // Was work still actually happening? Real (non-"failed") screenshots
    // filed against the log that just "ended" prove the task kept running
    // even though nothing was recording it — the exact shape of Charinade's
    // CRM task on 2026-09-09, closed after 21 seconds while captures kept
    // arriving for another 1h50m. That distinction is the difference between
    // "billable time is missing from the record" and "she was away without
    // logging it" — very different things to tell Toni.
    const { count: strandedShots } = await supabase
      .from("task_screenshots")
      .select("id", { count: "exact", head: true })
      .eq("log_id", cur.id)
      .is("failure_reason", null)
      .gt("created_at", curEnd)
      .lt("created_at", next.start_time);

    const hasEvidence = (strandedShots ?? 0) > 0;

    findings.push({
      type: hasEvidence ? "silent_gap" : "unlogged_gap",
      logId: cur.id,
      logIds: [cur.id, next.id],
      taskName: cur.task_name,
      startTime: curEnd,
      endTime: next.start_time,
      windowStart: curEnd,
      windowEnd: next.start_time,
      minutes: gapMinutes,
      detail: hasEvidence
        ? `Nothing logged for ${gapMinutes.toFixed(0)} min after "${cur.task_name}" (log ${cur.id}) ended, but ${strandedShots} screenshot(s) kept arriving for it — the work itself didn't stop, only the record of it did`
        : `Nothing logged for ${gapMinutes.toFixed(0)} min between "${cur.task_name}" (log ${cur.id}) ending and "${next.task_name}" (log ${next.id}) starting, with no screenshots either`,
    });
  }

  return { clean: findings.length === 0, findings, logs: rows };
}

/** "9:04 AM" in org time. Used where a full, unambiguous time reads better. */
export function clockTime(iso: string | null): string {
  if (!iso) return "open";
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: ORG_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  });
}

export { formatShiftMessage } from "@/lib/shiftAnomalyFormat";
