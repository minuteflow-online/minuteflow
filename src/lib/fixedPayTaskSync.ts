import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Maps an assigned_tasks / assigned_task_assignees status onto the narrower
 * status enum fixed_pay_tasks actually stores. Output Based work has no
 * "unassigned", "reviewing", or "approved" state of its own — it goes
 * straight from submitted/revision_needed to completed — so those collapse
 * onto the closest fixed-pay equivalent. Anything with no sensible
 * equivalent (i.e. missing from this map) is left alone rather than guessed.
 */
const FIXED_PAY_STATUS_MAP: Record<string, string> = {
  pending: "pending",
  on_queue: "on_queue",
  in_progress: "in_progress",
  submitted: "submitted",
  reviewing: "submitted",
  revision_needed: "revision_needed",
  approved: "completed",
  completed: "completed",
  paid: "paid",
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
