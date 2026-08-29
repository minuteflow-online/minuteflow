import { createClient as createServiceClient } from "@supabase/supabase-js";

/**
 * Applying an approved time correction to its time_log.
 *
 * Lifted out of the admin panel so the Telegram anomaly workflow writes through
 * the same code rather than a second mutation that drifts from it. Every fix to
 * a time log — a VA's request approved in the panel, or Toni replying to an
 * anomaly alert — lands here, leaves the same time_log_edits audit trail, and
 * marks the same time_correction_requests row reviewed.
 *
 * The client is passed in because the two callers authenticate differently: the
 * panel uses the browser client under Toni's session, the webhook uses the
 * service client. Neither is assumed here.
 */

/** Fields stored as booleans; a correction carries them as "true"/"false" strings. */
const BOOLEAN_FIELDS = new Set(["billable"]);

/** Fields holding an instant. Values may be datetime-local or a full ISO string. */
const TIME_FIELDS = new Set(["start_time", "end_time", "deleted_at"]);

export interface ApplyCorrectionInput {
  requestId: number;
  logId: number;
  changes: Record<string, string>;
  reviewerId: string;
  reviewNotes?: string | null;
}

export type ApplyCorrectionFailure = "end_before_start" | "missing_log" | "write_failed";

export type ApplyCorrectionResult =
  | { ok: true }
  // The code lets a caller say it better: the admin panel can point at the
  // date fields on screen, where Telegram has nothing to point at.
  | { ok: false; error: string; code: ApplyCorrectionFailure };

/**
 * A datetime-local value ("2026-08-27T15:40") carries no zone, so new Date()
 * reads it as the *runtime's* local time — Eastern in Toni's browser, UTC on
 * Vercel. Anything already carrying a zone (trailing Z or ±hh:mm) is passed
 * through untouched, which is how the server-side callers stay correct.
 */
function toIso(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export async function applyCorrection(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: ReturnType<typeof createServiceClient<any>>,
  input: ApplyCorrectionInput
): Promise<ApplyCorrectionResult> {
  const { requestId, logId, changes, reviewerId, reviewNotes } = input;

  const { data: currentLog } = await supabase
    .from("time_logs")
    .select("*")
    .eq("id", logId)
    .single();

  if (!currentLog) {
    return { ok: false, error: `Time log ${logId} no longer exists.`, code: "missing_log" };
  }

  const updatePayload: Record<string, unknown> = {};
  const auditRecords: {
    log_id: number;
    edited_by: string;
    field_name: string;
    old_value: string | null;
    new_value: string | null;
  }[] = [];

  const readField = (field: string) => {
    const raw = (currentLog as Record<string, unknown>)[field];
    return raw != null ? String(raw) : null;
  };

  for (const [field, newValue] of Object.entries(changes)) {
    let valueToStore: unknown;
    if (BOOLEAN_FIELDS.has(field)) {
      valueToStore = newValue === "true";
    } else if (TIME_FIELDS.has(field)) {
      valueToStore = newValue ? toIso(newValue) : null;
    } else {
      valueToStore = newValue || null;
    }

    updatePayload[field] = valueToStore;
    auditRecords.push({
      log_id: logId,
      edited_by: reviewerId,
      field_name: field,
      old_value: readField(field),
      new_value: valueToStore == null ? null : String(valueToStore),
    });
  }

  // Every other write path derives billable from category (billable = category
  // !== "Personal"). Correction approval was the one place that didn't, so a log
  // corrected out of "Clock Out"/"Personal" into a real task kept its old flag.
  // An explicit billable change in the same correction wins over this default.
  if (changes.category && !("billable" in changes)) {
    const newBillable = changes.category !== "Personal";
    updatePayload.billable = newBillable;
    auditRecords.push({
      log_id: logId,
      edited_by: reviewerId,
      field_name: "billable",
      old_value: readField("billable"),
      new_value: String(newBillable),
    });
  }

  if (changes.start_time || changes.end_time) {
    const startTime = changes.start_time ? toIso(changes.start_time) : currentLog.start_time;
    const endTime = changes.end_time ? toIso(changes.end_time) : currentLog.end_time;
    if (startTime && endTime) {
      if (new Date(endTime).getTime() <= new Date(startTime).getTime()) {
        return {
          ok: false,
          error: "The requested end time is before or equal to the task's start time.",
          code: "end_before_start",
        };
      }
      updatePayload.duration_ms = Math.max(
        0,
        new Date(endTime).getTime() - new Date(startTime).getTime()
      );
    }
  }

  // A deleted log should stop counting toward billable hours. Without this the
  // row is hidden from every view but its duration still lands in the totals.
  if ("deleted_at" in changes && updatePayload.deleted_at) {
    updatePayload.billable = false;
  }

  const { error: updateError } = await supabase
    .from("time_logs")
    .update(updatePayload)
    .eq("id", logId);
  if (updateError) return { ok: false, error: updateError.message, code: "write_failed" };

  if (auditRecords.length > 0) {
    await supabase.from("time_log_edits").insert(auditRecords);
  }

  // If end_time moved, pull the next task's start to match so the change does
  // not leave a gap. Skipped when it would shrink that task to nothing.
  if (changes.end_time && updatePayload.end_time) {
    const newEndIso = updatePayload.end_time as string;
    const { data: nextTask } = await supabase
      .from("time_logs")
      .select("id, start_time, end_time, duration_ms")
      .eq("user_id", currentLog.user_id)
      .gt("start_time", currentLog.start_time)
      .is("deleted_at", null)
      .order("start_time", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (nextTask) {
      const newEndMs = new Date(newEndIso).getTime();
      const nextEndMs = nextTask.end_time ? new Date(nextTask.end_time).getTime() : null;
      if (!nextEndMs || newEndMs < nextEndMs) {
        await supabase
          .from("time_logs")
          .update({
            start_time: newEndIso,
            ...(nextEndMs ? { duration_ms: nextEndMs - newEndMs } : {}),
          })
          .eq("id", nextTask.id);
      }
    }
  }

  await supabase
    .from("time_correction_requests")
    .update({
      status: "approved",
      reviewed_by: reviewerId,
      review_notes: reviewNotes || null,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  return { ok: true };
}
