import { createClient as createServiceClient } from "@supabase/supabase-js";
import { ORG_TIMEZONE } from "@/lib/taskSchedule";
import { esc } from "@/lib/telegram";

// Same three checks used in the manual August time review: a Break entry that
// somehow ended up billable, a "Clock In" placeholder that never got handed
// off to a real task, and two billable entries that substantially overlap
// (double-counted time). Small task-switch jitter (a couple of seconds at a
// boundary) is normal and intentionally not flagged.

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
  /** The whole day, in order — what the itemized log in the alert is built from. */
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
    const minutes = (row.duration_ms ?? 0) / 60000;

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

/** "9:04 AM" in org time. */
export function clockTime(iso: string | null): string {
  if (!iso) return "open";
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: ORG_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "1h 22m" / "22m" — durations read faster than a raw minute count. */
export function humanDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value + " ".repeat(width - value.length);
}

/**
 * The itemized day, inside a <pre> block so the columns line up.
 *
 * The whole day is here rather than only the flagged entries, because deciding
 * whether an overlap is a real double-count usually means looking at what sat
 * either side of it.
 */
function formatDayLog(rows: ShiftLogRow[]): string[] {
  if (rows.length === 0) return [];

  const lines = rows.map((row) => {
    const span = `${clockTime(row.start_time)}–${clockTime(row.end_time)}`;
    const duration = humanDuration(row.duration_ms ?? 0);
    const flag = row.billable ? " " : "·";
    return `${pad(span, 18)}${flag} ${pad(row.task_name, 22)} ${pad(row.category, 15)} ${duration}`;
  });

  const billableMs = rows
    .filter((row) => row.billable)
    .reduce((sum, row) => sum + (row.duration_ms ?? 0), 0);

  return [
    "",
    "<b>Full day</b>  <i>(· = non-billable)</i>",
    `<pre>${esc(lines.join("\n"))}</pre>`,
    `Billable total: <b>${humanDuration(billableMs)}</b>`,
  ];
}

/** Telegram HTML message for one shift's result. Run vaName through esc() first. */
export function formatShiftMessage(
  vaName: string,
  sessionDate: string,
  result: ShiftAnomalyResult
): string {
  if (result.clean) {
    return [
      `✅ <b>${vaName}</b> — ${sessionDate}`,
      "",
      "Shift looks clean, no anomalies found.",
      ...formatDayLog(result.logs),
    ].join("\n");
  }

  const lines = [
    `⚠️ <b>${vaName}</b> — ${sessionDate}`,
    "",
    `${result.findings.length} item(s) flagged:`,
    "",
  ];

  result.findings.forEach((finding, index) => {
    // Numbered so a reply can name which one without quoting it back.
    lines.push(`<b>[${index + 1}]</b> ${esc(finding.detail)}`);
    lines.push(
      `      ⏱ ${clockTime(finding.windowStart)}–${clockTime(finding.windowEnd)}  ·  log ${finding.logIds.join(", ")}`
    );
  });

  lines.push(...formatDayLog(result.logs));
  lines.push(
    "",
    "<i>Reply to this message with the fix — e.g. “1 delete” or “2 set end time 3:40pm”. Nothing is written until you confirm.</i>"
  );

  return lines.join("\n");
}
