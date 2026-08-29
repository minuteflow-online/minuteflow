import { createClient as createServiceClient } from "@supabase/supabase-js";
import { clockTime, type ShiftAnomalyFinding } from "@/lib/shiftAnomalies";
import { entryDurationMs, humanDuration } from "@/lib/shiftSummary";

/**
 * The review room: entries set aside pending a look, and entries flagged for
 * investigation.
 *
 * Nothing here destroys a row. "Held" means the entry stops counting toward
 * paid hours and appears in the review room; the row itself stays exactly
 * where it was, marked, and its previous billable value is recorded so putting
 * it back is exact rather than a guess. That distinction matters — this acts
 * on someone's pay without their say-so, and an action that cannot be undone
 * cleanly should not be taken automatically at all.
 *
 * Two ways in:
 *   held    — the system set it aside, and the person is told and can appeal.
 *   flagged — a human marked it for a closer look. Nothing changes about the
 *             entry; it is only made easy to find again.
 */

export type ReviewState = "held" | "flagged" | "restored" | "upheld";
export type ReviewSource = "auto" | "manual";

export interface ReviewInput {
  logId: number;
  userId: string;
  reason: string;
  findingType?: string | null;
  /** Who marked it. Null for the system. */
  createdBy?: string | null;
}

export type ReviewResult =
  | { ok: true; reviewId: number }
  | { ok: false; error: string };

/**
 * Whether the system should set an entry aside on its own, or only flag it.
 *
 * The screenshot count is the deciding evidence for an orphaned Clock In. A
 * placeholder that ran for hours with nothing captured behind it is time
 * nobody can account for; the same placeholder with screenshots throughout is
 * someone working while the task label went stale, which is a labelling
 * problem and not a billing one.
 *
 * That distinction is the whole lesson of the July clock-outs: Arianne was
 * closed as idle while uploading a screenshot every five minutes, and the
 * screenshots said so plainly. Nothing is set aside here without checking them.
 *
 * Breaks are never set aside automatically. A billable break is now a data
 * problem rather than a policy one, and the fix is to unbill it, not to remove
 * it from the day.
 */
export function shouldAutoHold(
  finding: ShiftAnomalyFinding,
  screenshotCount: number
): boolean {
  if (finding.type !== "orphaned_clock_in") return false;
  // One screenshot is the automatic capture taken at the moment of clocking in.
  // It says somebody pressed the button, not that anybody worked.
  return screenshotCount <= 1;
}

/** What the person is told. Plain, specific, and not an accusation. */
export function holdNotice(
  finding: ShiftAnomalyFinding,
  screenshotCount: number
): string {
  const span = `${clockTime(finding.windowStart)}–${clockTime(finding.windowEnd)}`;
  const length = humanDuration(finding.minutes * 60_000);

  return [
    "🔎 <b>One entry has been set aside</b>",
    "",
    `Your <b>${finding.taskName}</b> from ${span} ran ${length} without a task attached, and there ${screenshotCount === 1 ? "was only one screenshot" : `were ${screenshotCount} screenshots`} captured in that time.`,
    "",
    "It has been set aside for now, so it is not counting toward your hours. This is not a mark against you — the system could not tell what the time was spent on, and it would rather ask than guess.",
    "",
    "If it should count, open your Portal and send an explanation. Toni reviews these, and if it goes back it goes back in full.",
    "",
    "https://minuteflow.click/portal",
  ].join("\n");
}

/**
 * Sets an entry aside: stops it counting toward paid hours, and records it.
 *
 * The previous billable value is stored before it is changed, so a restore
 * puts the entry back as it was rather than assuming it was billable.
 */
export async function holdLog(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: ReturnType<typeof createServiceClient<any>>,
  input: ReviewInput & { source: ReviewSource }
): Promise<ReviewResult> {
  const { data: log } = await supabase
    .from("time_logs")
    .select("id, billable")
    .eq("id", input.logId)
    .maybeSingle();

  if (!log) return { ok: false, error: `Time log ${input.logId} no longer exists.` };

  const { data: review, error } = await supabase
    .from("time_log_reviews")
    .insert({
      log_id: input.logId,
      user_id: input.userId,
      state: "held",
      source: input.source,
      finding_type: input.findingType ?? null,
      reason: input.reason,
      original_billable: log.billable,
      created_by: input.createdBy ?? null,
    })
    .select("id")
    .single();

  if (error || !review) {
    return { ok: false, error: error?.message ?? "Could not record the hold." };
  }

  // Only after the record exists. The other order risks unpaying an entry with
  // nothing on file saying why, or how to put it back.
  await supabase.from("time_logs").update({ billable: false }).eq("id", input.logId);

  return { ok: true, reviewId: review.id as number };
}

/** Marks an entry for a closer look. Changes nothing about the entry itself. */
export async function flagLog(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: ReturnType<typeof createServiceClient<any>>,
  input: ReviewInput & { source: ReviewSource }
): Promise<ReviewResult> {
  const { data: review, error } = await supabase
    .from("time_log_reviews")
    .insert({
      log_id: input.logId,
      user_id: input.userId,
      state: "flagged",
      source: input.source,
      finding_type: input.findingType ?? null,
      reason: input.reason,
      created_by: input.createdBy ?? null,
    })
    .select("id")
    .single();

  if (error || !review) {
    return { ok: false, error: error?.message ?? "Could not flag the entry." };
  }
  return { ok: true, reviewId: review.id as number };
}

/** Puts a held entry back exactly as it was. */
export async function restoreLog(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: ReturnType<typeof createServiceClient<any>>,
  reviewId: number,
  resolvedBy: string,
  note?: string | null
): Promise<ReviewResult> {
  const { data: review } = await supabase
    .from("time_log_reviews")
    .select("id, log_id, state, original_billable")
    .eq("id", reviewId)
    .maybeSingle();

  if (!review) return { ok: false, error: `Review ${reviewId} not found.` };
  if (review.state === "restored") {
    return { ok: false, error: "That entry has already been put back." };
  }

  // A flagged entry was never unpaid, so restoring one only closes the flag.
  if (review.state === "held") {
    await supabase
      .from("time_logs")
      .update({ billable: review.original_billable ?? false })
      .eq("id", review.log_id);
  }

  await supabase
    .from("time_log_reviews")
    .update({
      state: "restored",
      resolved_by: resolvedBy,
      resolved_at: new Date().toISOString(),
      resolution_note: note ?? null,
    })
    .eq("id", reviewId);

  return { ok: true, reviewId };
}

/** Confirms the entry stays as it is. Leaves a held entry unpaid. */
export async function upholdLog(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: ReturnType<typeof createServiceClient<any>>,
  reviewId: number,
  resolvedBy: string,
  note?: string | null
): Promise<ReviewResult> {
  const { error } = await supabase
    .from("time_log_reviews")
    .update({
      state: "upheld",
      resolved_by: resolvedBy,
      resolved_at: new Date().toISOString(),
      resolution_note: note ?? null,
    })
    .eq("id", reviewId);

  if (error) return { ok: false, error: error.message };
  return { ok: true, reviewId };
}

/** How many screenshots back an entry — the evidence shouldAutoHold turns on. */
export async function screenshotCountFor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: ReturnType<typeof createServiceClient<any>>,
  logId: number
): Promise<number> {
  const { count } = await supabase
    .from("task_screenshots")
    .select("id", { count: "exact", head: true })
    .eq("log_id", logId);
  return count ?? 0;
}

/** Reason text stored against an automatic hold, so the room explains itself. */
export function autoHoldReason(
  finding: ShiftAnomalyFinding,
  screenshotCount: number
): string {
  const length = humanDuration(finding.minutes * 60_000);
  return `${finding.taskName} ran ${length} with no task attached and ${screenshotCount} screenshot(s) captured. Set aside automatically pending review.`;
}

/** Duration of a log, for the room's listing. Re-exported so callers agree. */
export { entryDurationMs };
