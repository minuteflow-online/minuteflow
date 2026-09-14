import { formatDateLocalTZ } from "@/lib/utils";

/**
 * Dating and timing a submission by its round.
 *
 * A round is one attempt at a task: round 0 is the original work, round 1 the
 * first rework, and so on. A time log belongs to round N when N revisions had
 * been issued before it started — the same rule the R badge uses, so a round's
 * hours and its label can never disagree.
 *
 * Two things come out of this, and both differ from the obvious answer:
 *
 * The DATE is the day the round's work STARTED, not the day it was handed in.
 * Someone can begin a piece Monday, break the hours across two days and submit
 * it Tuesday; counting it Tuesday makes Monday look idle and Tuesday look
 * twice as productive. A revision is its own round and lands on the day the
 * rework began.
 *
 * The HOURS are the round's own hours, summed across however many sittings it
 * took, and counted once. Two submissions inside one round (a resubmission
 * with no revision between) do not each claim the same hours — the round's
 * time goes to the first of them and the rest report zero.
 */

export type RoundRevision = { created_at: string };

export type RoundSubmission = { id: number; created_at: string };

export type RoundLog = { start_time: string; duration_ms: number | null };

export type RoundTask = {
  /** Output-based work is paid per deliverable, so it carries no logged time. */
  isOutputBased: boolean;
  /** The block booked in the task editor, if one was ("from X to Y"). */
  scheduledStart: string | null;
  scheduledEnd: string | null;
  /** The editor's duration field, as a fallback for a block with no times. */
  plannedMinutes: number | null;
};

export type RoundResult = {
  submissionId: number;
  round: number;
  /** Local date (org timezone) the round's work started. */
  workStartDate: string;
  durationMs: number;
  /**
   * Where the time came from:
   *   logged   — real time logs, the normal case
   *   scheduled — no logs, but the task editor booked a block for it
   *   none     — output-based work, or nothing to go on
   *   counted  — an earlier submission in this same round already holds the
   *              round's hours; reporting them twice would inflate the total
   */
  timeSource: "logged" | "scheduled" | "none" | "counted";
};

/** How many revisions had been issued before `at`. */
function roundOf(revisionTimes: string[], at: string): number {
  let count = 0;
  for (const t of revisionTimes) if (t < at) count += 1;
  return count;
}

/** The block booked in the task editor, in milliseconds, or 0 if none was. */
function scheduledMs(task: RoundTask): number {
  if (task.scheduledStart && task.scheduledEnd) {
    const ms = new Date(task.scheduledEnd).getTime() - new Date(task.scheduledStart).getTime();
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  if (task.plannedMinutes && task.plannedMinutes > 0) return task.plannedMinutes * 60000;
  return 0;
}

export function computeSubmissionRounds({
  submissions,
  revisions,
  logs,
  task,
  timezone,
}: {
  submissions: RoundSubmission[];
  revisions: RoundRevision[];
  logs: RoundLog[];
  task: RoundTask;
  timezone: string;
}): RoundResult[] {
  const revisionTimes = revisions.map((r) => r.created_at).sort();

  // Oldest first, so the first submission of a round is the one that holds
  // that round's hours.
  const ordered = [...submissions].sort((a, b) => a.created_at.localeCompare(b.created_at));

  const roundsCounted = new Set<number>();

  return ordered.map((submission) => {
    const round = roundOf(revisionTimes, submission.created_at);
    const roundLogs = logs.filter((log) => roundOf(revisionTimes, log.start_time) === round);

    const firstStart = roundLogs.reduce<string | null>(
      (earliest, log) => (!earliest || log.start_time < earliest ? log.start_time : earliest),
      null
    );

    // The work started when the first log of the round started. With no logs,
    // the booked block is the next best statement of when it was meant to
    // happen; failing both, the submission itself is all there is.
    const anchor = firstStart ?? (roundLogs.length === 0 ? task.scheduledStart : null);
    const workStartDate = formatDateLocalTZ(anchor ?? submission.created_at, timezone);

    if (roundsCounted.has(round)) {
      return { submissionId: submission.id, round, workStartDate, durationMs: 0, timeSource: "counted" as const };
    }
    roundsCounted.add(round);

    if (roundLogs.length > 0) {
      const durationMs = roundLogs.reduce((sum, log) => sum + Number(log.duration_ms ?? 0), 0);
      return { submissionId: submission.id, round, workStartDate, durationMs, timeSource: "logged" as const };
    }

    // Output-based work is paid on the deliverable and is not clocked, so it
    // contributes no time rather than a guessed one.
    if (task.isOutputBased) {
      return { submissionId: submission.id, round, workStartDate, durationMs: 0, timeSource: "none" as const };
    }

    const booked = scheduledMs(task);
    return {
      submissionId: submission.id,
      round,
      workStartDate,
      durationMs: booked,
      timeSource: booked > 0 ? ("scheduled" as const) : ("none" as const),
    };
  });
}
