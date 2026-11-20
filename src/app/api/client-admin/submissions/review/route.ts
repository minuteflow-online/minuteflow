import { requireClientOrgVaIds, serviceClient, isResponse } from "@/lib/clientAdminAccess";
import { syncFixedPayTaskStatus } from "@/lib/fixedPayTaskSync";
import { notifyAssigneesOfApproval } from "@/lib/notifyApproval";

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
  const { error: insertError } = await admin.from("task_submissions").insert({
    assigned_task_id: taskId,
    user_id: userId,
    message_type: cfg.entry,
    content: note?.trim() || cfg.body,
    submission_comment: note?.trim() || cfg.body,
  });
  if (insertError) {
    return Response.json({ error: insertError.message }, { status: 500 });
  }

  if (action === "approve") {
    await notifyAssigneesOfApproval(admin, {
      taskId,
      taskName: task.task_name,
      reviewerId: null,
      reviewerName: null,
    });
  }

  return Response.json({ success: true });
}
