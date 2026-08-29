import { orgWallClockToUtc } from "@/lib/taskSchedule";
import { clockTime, type ShiftAnomalyFinding, type ShiftLogRow } from "@/lib/shiftAnomalies";

/**
 * Turning a free-text Telegram reply into a proposed time-log correction.
 *
 * Deliberately narrow. It understands four fixes — delete an entry, flip it
 * non-billable, move its start, move its end — and refuses anything it cannot
 * read with certainty. A parser that guesses would be worse than one that asks
 * again, because what it guesses at is billable hours.
 *
 * Nothing here writes. It returns a proposal that the webhook echoes back for
 * confirmation; only a second reply applies it.
 */

export interface ProposedFix {
  findingIndex: number;
  logId: number;
  changes: Record<string, string>;
  /** Plain-language echo of the change, shown back for confirmation. */
  summary: string;
}

export type ParseResult = { ok: true; fix: ProposedFix } | { ok: false; error: string };

/** Words that pick a finding when the reply names the problem instead of its number. */
const KEYWORD_TYPES: { pattern: RegExp; type: ShiftAnomalyFinding["type"] }[] = [
  { pattern: /\bbreaks?\b/i, type: "billed_break" },
  { pattern: /\boverlap(ping|s)?\b/i, type: "overlap" },
  { pattern: /\bclock[\s-]?in\b/i, type: "orphaned_clock_in" },
];

/**
 * "3:40pm", "3:40 PM", "15:40", "3pm" → "15:40" on a 24-hour clock.
 * Returns null for anything else, including a bare "340".
 */
export function parseClockInput(raw: string): string | null {
  const match = raw.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const meridiem = match[3]?.toLowerCase();

  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  } else {
    // No am/pm: only a 24-hour reading is unambiguous. "set end time to 3"
    // could mean either, and picking one silently is how an eight-hour day
    // becomes a twenty-hour one.
    if (hour > 23) return null;
    if (!match[2]) return null;
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function findingLabel(finding: ShiftAnomalyFinding, logs: ShiftLogRow[]): string {
  const log = logs.find((row) => row.id === finding.logId);
  const name = log?.task_name ?? finding.taskName;
  return `“${name}” (log ${finding.logId}, ${clockTime(finding.windowStart)}–${clockTime(finding.windowEnd)})`;
}

/** Which flagged item is this reply about? */
function selectFinding(text: string, findings: ShiftAnomalyFinding[]): number | null {
  const numbered = text.match(/(?:^|\bitem\s*|#)\s*(\d{1,2})\b/i);
  if (numbered) {
    const index = parseInt(numbered[1], 10) - 1;
    if (index >= 0 && index < findings.length) return index;
    return null;
  }

  for (const { pattern, type } of KEYWORD_TYPES) {
    if (!pattern.test(text)) continue;
    const matches = findings
      .map((finding, index) => ({ finding, index }))
      .filter((entry) => entry.finding.type === type);
    if (matches.length === 1) return matches[0].index;
  }

  if (findings.length === 1) return 0;
  return null;
}

export function parseAnomalyReply(
  text: string,
  findings: ShiftAnomalyFinding[],
  logs: ShiftLogRow[],
  sessionDate: string
): ParseResult {
  const reply = text.trim();
  if (!reply) return { ok: false, error: "Empty reply." };
  if (findings.length === 0) {
    return { ok: false, error: "That shift had nothing flagged, so there is nothing to correct." };
  }

  const index = selectFinding(reply, findings);
  if (index === null) {
    return {
      ok: false,
      error: `I could not tell which item you mean. Start the reply with its number — 1 to ${findings.length}.`,
    };
  }

  const finding = findings[index];
  const label = findingLabel(finding, logs);

  if (/\b(delete|remove|drop|discard)\b/i.test(reply)) {
    return {
      ok: true,
      fix: {
        findingIndex: index,
        logId: finding.logId,
        changes: { deleted_at: new Date().toISOString() },
        summary: `Delete ${label}. It stops counting toward billable hours.`,
      },
    };
  }

  if (/\b(un|non[\s-]?)billable\b/i.test(reply) || /\b(not|don'?t|do not)\b.*\bbill/i.test(reply)) {
    return {
      ok: true,
      fix: {
        findingIndex: index,
        logId: finding.logId,
        changes: { billable: "false" },
        summary: `Mark ${label} non-billable. The entry stays in the log; its time stops being billed.`,
      },
    };
  }

  const endMatch = reply.match(/\bend(?:\s*time)?\b\s*(?:to|=|at)?\s*(.+)$/i);
  const startMatch = reply.match(/\bstart(?:\s*time)?\b\s*(?:to|=|at)?\s*(.+)$/i);
  const timeTarget = endMatch ? "end_time" : startMatch ? "start_time" : null;

  if (timeTarget) {
    const clock = parseClockInput((endMatch ?? startMatch)![1]);
    if (!clock) {
      return {
        ok: false,
        error: "I could not read that time. Write it like “3:40pm” or “15:40”.",
      };
    }
    const iso = orgWallClockToUtc(sessionDate, clock);
    return {
      ok: true,
      fix: {
        findingIndex: index,
        logId: finding.logId,
        changes: { [timeTarget]: iso },
        summary: `Set the ${timeTarget === "end_time" ? "end" : "start"} time of ${label} to ${clockTime(iso)} ET. Its duration is recalculated.`,
      },
    };
  }

  return {
    ok: false,
    error:
      "I understand four fixes: “delete”, “not billable”, “set end time <time>”, “set start time <time>”. Prefix with the item number if more than one is flagged.",
  };
}
