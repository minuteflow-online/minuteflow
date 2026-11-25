import { requireClientOrgVaIds, serviceClient, isResponse } from "@/lib/clientAdminAccess";
import { syncFixedPayTaskStatus } from "@/lib/fixedPayTaskSync";
import { notifyAssigneesOfApproval } from "@/lib/notifyApproval";
import { notifyOne } from "@/lib/notifyOne";
import { esc } from "@/lib/telegram";

export const dynamic = "force-dynamic";

const ACTIONS = {
  approve: { status: "approved", entry: "approval" as const, body: "Approved by client" },
  revision: { status: "revision_needed", entry: "revision" as const, body: "Revision requested by client" },
} as const;

/**
 * POST /api/client-admin/submissions/review
 * body: { taskId: number, action: "approve" | "revision", note?: string }
 * Same effect as an admin reviewer's Approve / Request Revision — only ever
 * for a task this client assigned themselves (assigned_tasks.organization_id
 * matches their own org), checked server-side regardless of which task id
 * is named. Deliberately separate from the admin review-action route so this
 * client path can never reach a task that isn't theirs.
 */
export async function POST(request: Request) {
  const auth = await requireClientOrgVaIds();
  if (isResponse(auth)) return auth;
  const { userId, organizationId } = auth;

  const { taskId, action, note } = (await request.json()) as {
    taskId?: number;
    action?: "approve" | "revision";
    note?: string;
  };

  if (!taskId || !action || !Object.hasOwn(ACTIONS, action)) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const admin = serviceClient();
  const { data: task } = await admin
    .from("assigned_tasks")
    .select("id, task_name, organization_id, status")
    .eq("id", taskId)
    .single();

  if (!task || task.organization_id !== organizationId) {
    return Response.json({ error: "That task isn't yours to review." }, { status: 403 });
  }

  // Only work that's been handed in can be approved or sent back — never a
  // task nobody has submitted yet, nor one already approved, completed or paid.
  const { data: assigneeRows } = await admin
    .from("assigned_task_assignees")
    .select("status")
    .eq("assigned_task_id", taskId);
  const waitingForReview = (assigneeRows ?? []).some((a) => a.status === "submitted" || a.status === "reviewing");
  if (!waitingForReview) {
    return Response.json({ error: "There's no submitted work on this task to review right now." }, { status: 409 });
  }

  const cfg = ACTIONS[action];
  const stamp = new Date().toISOString();

  await admin.from("assigned_task_assignees").update({ status: cfg.status, updated_at: stamp }).eq("assigned_task_id", taskId);
  await admin.from("assigned_tasks").update({ status: cfg.status, updated_at: stamp }).eq("id", taskId);
  await syncFixedPayTaskStatus(admin, taskId, cfg.status);

  // user_id is NOT NULL on task_submissions — this used to pass null, which
  // the insert below silently rejected (the error was never checked), so the
  // task's status flipped but no thread entry — and no revision note — was
  // ever recorded. Caught live while building the client Submissions hub,
  // which is the first place that reads this table for display rather than
  // just the task's own status column.
  const { data: entry, error: insertError } = await admin
    .from("task_submissions")
    .insert({
      assigned_task_id: taskId,
      user_id: userId,
      message_type: cfg.entry,
      content: note?.trim() || cfg.body,
      submission_comment: note?.trim() || cfg.body,
    })
    .select("id")
    .single();
  if (insertError) {
    return Response.json({ error: insertError.message }, { status: 500 });
  }

  // Tell the VA, the same way a staff reviewer's decision does (bell +
  // private Telegram). This used to pass no reviewer, which skips the bell
  // entirely, and a revision request notified nobody at all — the VA only
  // found out by stumbling on the task's status.
  const { data: me } = await admin.from("profiles").select("full_name, username").eq("id", userId).single();
  const reviewerName = me?.full_name || me?.username || "Your client";
  const trimmedNote = note?.trim() || null;

  if (action === "approve") {
    await notifyAssigneesOfApproval(admin, {
      taskId,
      taskName: task.task_name,
      reviewerId: userId,
      reviewerName,
      note: trimmedNote,
      submissionId: entry?.id as number | undefined,
    });
  } else {
    const { data: assignees } = await admin
      .from("assigned_task_assignees")
      .select("va_id")
      .eq("assigned_task_id", taskId);
    const snippet = trimmedNote && trimmedNote.length > 160 ? `${trimmedNote.slice(0, 160)}…` : trimmedNote;
    for (const a of assignees ?? []) {
      if (!a.va_id || a.va_id === userId) continue;
      await notifyOne(admin, {
        targetUserId: a.va_id as string,
        senderId: userId,
        content: `${reviewerName} requested a revision on “${task.task_name ?? "a task"}”${snippet ? `: ${snippet}` : ""}`,
        telegram: `🔁 <b>${esc(reviewerName)}</b> requested a revision on <b>${esc(task.task_name ?? "a task")}</b>${snippet ? `\n\n${esc(snippet)}` : ""}`,
        topic: "submissions",
        assignedTaskId: taskId,
        submissionId: entry?.id as number | undefined,
      });
    }
  }

  return Response.json({ success: true });
}
