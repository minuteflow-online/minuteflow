import { esc } from "@/lib/telegram";
import { ORG_TIMEZONE } from "@/lib/taskSchedule";
import { entryDurationMs } from "@/lib/shiftSummary";
import type { ShiftAnomalyFinding, ShiftAnomalyResult, ShiftLogRow } from "@/lib/shiftAnomalies";

/**
 * How a shift review reads in the chat.
 *
 * The first version printed the whole day as an aligned table. On a phone
 * every row wrapped onto two lines, the columns collapsed, and sixteen entries
 * buried the one line that mattered — Toni's verdict was that it was hard to
 * understand, and she was right.
 *
 * So: the finding leads, in plain language, and only the entries either side
 * of it come with it. Seeing what is wrong against what is fine was the point
 * of the full day, and three lines do that better than sixteen. Alignment is
 * gone deliberately; nothing here is padded, so it reflows at any width
 * instead of shattering below some threshold.
 */

/** Plain-language names. "billed_break" means nothing to someone reading a chat. */
const FINDING_TITLES: Record<ShiftAnomalyFinding["type"], string> = {
  billed_break: "Break billed as work",
  orphaned_clock_in: "Clock In left running",
  overlap: "Two tasks counted at once",
};

/** Entries shown either side of a flagged one. */
const CONTEXT_SPAN = 1;

function parts(iso: string): { time: string; meridiem: string } {
  const text = new Date(iso).toLocaleTimeString("en-US", {
    timeZone: ORG_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  });
  const [time, meridiem] = text.split(" ");
  return { time, meridiem: meridiem.toLowerCase().startsWith("p") ? "p" : "a" };
}

/** "4:01–4:27p", or "11:50a–12:10p" when they straddle noon. */
export function compactSpan(start: string, end: string | null): string {
  const from = parts(start);
  if (!end) return `${from.time}${from.meridiem}–open`;
  const to = parts(end);
  return from.meridiem === to.meridiem
    ? `${from.time}–${to.time}${to.meridiem}`
    : `${from.time}${from.meridiem}–${to.time}${to.meridiem}`;
}

/** "1h42m", "26m" — tighter than the spaced form, and these sit mid-line. */
export function compactDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h${minutes}m`;
}

function entryLine(row: ShiftLogRow, flagged: boolean): string {
  const marker = flagged ? "▸ " : "  ";
  const duration = compactDuration(entryDurationMs(row));
  const name = esc(row.task_name);
  const billable = row.billable ? "" : " (unbilled)";
  return `${marker}${compactSpan(row.start_time, row.end_time)} · ${name} · ${duration}${billable}`;
}

/** The flagged entries plus their neighbours, in day order, no duplicates. */
function contextFor(finding: ShiftAnomalyFinding, logs: ShiftLogRow[]): ShiftLogRow[] {
  const wanted = new Set<number>();
  for (const logId of finding.logIds) {
    const index = logs.findIndex((row) => row.id === logId);
    if (index === -1) continue;
    for (let i = index - CONTEXT_SPAN; i <= index + CONTEXT_SPAN; i++) {
      if (i >= 0 && i < logs.length) wanted.add(i);
    }
  }
  return [...wanted].sort((a, b) => a - b).map((i) => logs[i]);
}

/** Telegram HTML for one shift's result. Run vaName through esc() first. */
export function formatShiftMessage(
  vaName: string,
  sessionDate: string,
  result: ShiftAnomalyResult
): string {
  // duration_ms is 0 on a good number of rows even where start and end are
  // half an hour apart, so the totals are computed rather than summed. The
  // first live alert reported a 26-minute billed break as "0 min" — the number
  // that made it look like nothing was the number being flagged.
  const billableMs = result.logs
    .filter((row) => row.billable)
    .reduce((sum, row) => sum + entryDurationMs(row), 0);
  const footer = `Day: <b>${compactDuration(billableMs)}</b> billable · ${result.logs.length} entries`;

  if (result.clean) {
    return [`✅ <b>${vaName}</b> — ${sessionDate}`, "", "Shift looks clean.", "", footer].join("\n");
  }

  const many = result.findings.length > 1;
  const lines = [`⚠️ <b>${vaName}</b> — ${sessionDate}`];

  result.findings.forEach((finding, index) => {
    const label = many ? `[${index + 1}] ` : "";
    const minutes = Math.round(finding.minutes);
    lines.push(
      "",
      `${label}<b>${FINDING_TITLES[finding.type]}</b> — ${minutes} min`,
      `${compactSpan(finding.windowStart, finding.windowEnd)} · log ${finding.logIds.join(", ")}`,
      ""
    );
    for (const row of contextFor(finding, result.logs)) {
      lines.push(entryLine(row, finding.logIds.includes(row.id)));
    }
  });

  lines.push(
    "",
    footer,
    "",
    many
      ? "<i>Reply with the item number and the fix — “1 not billable”, “2 delete”, “1 set end time 3:40pm”. Nothing is written until you confirm.</i>"
      : "<i>Reply “not billable”, “delete”, or “set end time 3:40pm”. Nothing is written until you confirm.</i>"
  );

  return lines.join("\n");
}
