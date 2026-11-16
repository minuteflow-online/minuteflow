import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Maps an assigned_tasks / assigned_task_assignees status onto the narrower
 * status enum fixed_pay_tasks actually stores.
 *
 * "reviewing" and "approved" are deliberately NOT mapped here — they're
 * left alone rather than collapsed onto a fixed-pay equivalent:
 *
 *   - GET /api/fixed-pay-tasks already overlays the live assigned_tasks
 *     mirror status on top of this column for display, so those two states
 *     show up correctly (as "Reviewing"/"Approved") without this column
 *     ever needing to say so.
 *   - "completed" on fixed_pay_tasks is a distinct, deliberate, manual
 *     signal — paystub.ts and FinancialSummaryTab.tsx sum a VA's pay by
 *     querying fixed_pay_tasks.status = "completed" directly. Writing
 *     "completed" the instant a reviewer clicks Approve (rather than
 *     whatever separate step actually marks a task payroll-ready) would
 *     count it toward a paystub before it's meant to be.
 *
 * "unassigned" has no fixed-pay equivalent either and is left out for the
 * same reason: nothing here should ever guess at billing-relevant state.
 *
 * "paid" is deliberately absent — payment is a separate dimension from
 * workflow status now (see syncFixedPayTaskPaid below). A caller that still
 * passes "paid" here is ignored rather than propagated, so it can never
 * overwrite whatever real review status a task was actually at.
 */
const FIXED_PAY_STATUS_MAP: Record<string, string> = {
  pending: "pending",
  on_queue: "on_queue",
  in_progress: "in_progress",
  submitted: "submitted",
  revision_needed: "revision_needed",
  completed: "completed",
  cancelled: "cancelled",
};

/**
 * Keeps fixed_pay_tasks.status in step with the linked assigned_tasks row.
 *
 * These are two separate columns. An Output Based task's real progress
 * (Submit, Approve, Revision) is written to assigned_tasks /
 * assigned_task_assignees by the submission flow (SubmitWorkModal, the
 * Submissions review actions, the Telegram approve/revision links) — but the
 * Output Based Tasks table (FixedPayTasksPanel) reads fixed_pay_tasks.status,
 * which none of those paths ever wrote to. Without this, a VA who submits
 * real work through the normal Submit button sees the task sit at "Open"
 * forever on their own Output Based Tasks table, even though the submission
 * itself landed and is sitting in the review queue.
 *
 * Best-effort and silent: a sync failure here must never break the caller's
 * own status write, which has already succeeded by the time this runs.
 */
export async function syncFixedPayTaskStatus(
  admin: Pick<SupabaseClient, "from">,
  assignedTaskId: number | string,
  status: string
): Promise<void> {
  const mapped = FIXED_PAY_STATUS_MAP[status];
  if (!mapped) return;

  try {
    const { data: task } = await admin
      .from("assigned_tasks")
      .select("fixed_pay_task_id")
      .eq("id", assignedTaskId)
      .maybeSingle();

    const fixedPayTaskId = (task as { fixed_pay_task_id?: number | null } | null)?.fixed_pay_task_id;
    if (fixedPayTaskId == null) return;

    await admin
      .from("fixed_pay_tasks")
      .update({ status: mapped, updated_at: new Date().toISOString() })
      .eq("id", fixedPayTaskId);
  } catch {
    // best-effort — the caller's own status write already succeeded
  }
}

/**
 * Keeps fixed_pay_tasks.paid_at/paid_manually in step with the linked
 * assigned_tasks row — the payment counterpart to syncFixedPayTaskStatus
 * above. Deliberately separate: paying a task never touches status, on
 * either side, so a task paid mid-review keeps showing as "Submitted" (or
 * whatever it actually was) instead of jumping to a "Paid" status that
 * erases where it stood in the review workflow.
 *
 * Best-effort and silent, same reasoning as syncFixedPayTaskStatus.
 */
export async function syncFixedPayTaskPaid(
  admin: Pick<SupabaseClient, "from">,
  assignedTaskId: number | string,
  paidAt: string | null,
  paidManually: boolean
): Promise<void> {
  try {
    const { data: task } = await admin
      .from("assigned_tasks")
      .select("fixed_pay_task_id")
      .eq("id", assignedTaskId)
      .maybeSingle();

    const fixedPayTaskId = (task as { fixed_pay_task_id?: number | null } | null)?.fixed_pay_task_id;
    if (fixedPayTaskId == null) return;

    await admin
      .from("fixed_pay_tasks")
      .update({ paid_at: paidAt, paid_manually: paidManually, updated_at: new Date().toISOString() })
      .eq("id", fixedPayTaskId);
  } catch {
    // best-effort — the caller's own paid_at write already succeeded
  }
}

/**
 * Keeps an Output Based task's wording on fixed_pay_tasks in step with the
 * linked assigned_tasks row.
 *
 * A VA renaming the task from their own task list (or while submitting it)
 * writes assigned_tasks only, but the paystub and the Output Based Tasks table
 * read fixed_pay_tasks — so Rhealin's renamed reels kept showing on her stub as
 * "Reel (" with no title, and older renames made reels look like repeats of
 * ones already paid.
 *
 * Only the fields passed are written. Best-effort and silent, like the status
 * sync above: the caller's own write has already succeeded.
 */
export async function syncFixedPayTaskDetails(
  admin: Pick<SupabaseClient, "from">,
  assignedTaskId: number | string,
  fields: { task_name?: string; task_detail?: string | null; task_notes?: string | null; link?: string | null }
): Promise<void> {
  const updates: Record<string, unknown> = {};
  if (fields.task_name !== undefined) updates.task_name = fields.task_name.trim();
  if (fields.task_detail !== undefined) updates.task_detail = fields.task_detail;
  if (fields.task_notes !== undefined) updates.task_notes = fields.task_notes;
  if (fields.link !== undefined) updates.link = fields.link;
  if (Object.keys(updates).length === 0) return;
  try {
    const { data: row } = await admin
      .from("assigned_tasks")
      .select("fixed_pay_task_id")
      .eq("id", assignedTaskId)
      .maybeSingle();
    const fixedPayTaskId = (row as { fixed_pay_task_id: number | null } | null)?.fixed_pay_task_id;
    if (!fixedPayTaskId) return;
    await admin
      .from("fixed_pay_tasks")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", fixedPayTaskId);
  } catch {
    // Best-effort; see above.
  }
}
