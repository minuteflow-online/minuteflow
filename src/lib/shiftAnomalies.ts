import { createClient as createServiceClient } from "@supabase/supabase-js";
import { ORG_TIMEZONE } from "@/lib/taskSchedule";
import { entryDurationMs } from "@/lib/shiftSummary";

// Same three checks used in the manual August time review: a Break entry that
// somehow ended up billable, a "Clock In" placeholder that never got handed
// off to a real task, and two billable entries that substantially overlap
// (double-counted time). Small task-switch jitter (a couple of seconds at a
// boundary) is normal and intentionally not flagged.
//
// How the message reads is in shiftAnomalyFormat.ts; this file only decides
// what is wrong.

/** A "Clock In" placeholder idle/open this long is worth a human look. */
const ORPHAN_CLOCK_IN_MINUTES = 20;

/** Overlap below this is task-switch timestamp jitter, not a real double-count. */
const OVERLAP_MINUTES = 2;

export interface ShiftAnomalyFinding {
  type: "billed_break" | "orphaned_clock_in" | "overlap";
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

  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      if (!a.billable || !b.billable || !a.end_time || !b.end_time) continue;

      const aStart = new Date(a.start_time).getTime();
      const aEnd = new Date(a.end_time).getTime();
      const bStart = new Date(b.start_time).getTime();
      const bEnd = new Date(b.end_time).getTime();
      const overlapStart = Math.max(aStart, bStart);
      const overlapEnd = Math.min(aEnd, bEnd);
      const overlapMinutes = (overlapEnd - overlapStart) / 60000;

      if (overlapMinutes > OVERLAP_MINUTES) {
        findings.push({
          type: "overlap",
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
          detail: `"${b.task_name}" (log ${b.id}) overlaps "${a.task_name}" (log ${a.id}) by ${overlapMinutes.toFixed(0)} min — possible double count`,
        });
      }
    }
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
