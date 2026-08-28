import { createClient } from "@supabase/supabase-js";
import { verifyApprovalToken } from "@/lib/approvalToken";
import { resultPage } from "@/lib/approvalPages";
import { cheerApproval } from "@/lib/reviewLinks";
import type { ReviewAction } from "@/lib/reviewLinks";
import { sendTelegram, telegramEnabled, esc } from "@/lib/telegram";
import { syncFixedPayTaskStatus } from "@/lib/fixedPayTaskSync";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/assigned-tasks/review-action?id=<taskId>&do=approve|revision&t=<token>
 *
 * Approving or bouncing a submission straight from the Telegram alert, without
 * opening the admin panel.
 *
 * A tapped link rather than an inline button on purpose: buttons need the
 * inbound webhook registered, and registering that switches off the chat
 * listing still being used to connect people. This works today and needs
 * nothing turned on. Once the webhook is live these can become real buttons.
 *
 * The token is an HMAC over task, action and a server secret — the same scheme
 * the VA-request approval emails use. Anyone holding the link can act, which is
 * the point, but it cannot be guessed or edited into a different task.
 */

const ACTIONS = {
  approve: {
    status: "approved",
    entry: "approval",
    body: "Approved from Telegram",
    heading: "Approved",
  },
  revision: {
    status: "revision_needed",
    entry: "revision",
    body: "Revision requested from Telegram",
    heading: "Revision requested",
  },
} as const;

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const id = Number(searchParams.get("id"));
  const action = searchParams.get("do") as ReviewAction | null;
  const token = searchParams.get("t") ?? "";

  if (!id || !action || !(action in ACTIONS)) {
    return resultPage(false, "Bad link", "That link is not valid.");
  }
  if (!verifyApprovalToken("submission", id, action, token)) {
    return resultPage(
      false,
      "Link could not be verified",
      "Please act on the task in MinuteFlow instead."
    );
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: task } = await admin
    .from("assigned_tasks")
    .select("id, task_name, status")
    .eq("id", id)
    .single();
  if (!task) {
    return resultPage(false, "Task not found", "It may have been deleted.");
  }

  const cfg = ACTIONS[action];
  const taskName = String(task.task_name ?? "This task");

  // Already there — say so rather than writing it twice and posting a second
  // alert. Two people tapping the same link is a normal thing to happen.
  if (task.status === cfg.status) {
    return resultPage(
      true,
      `Already ${cfg.heading.toLowerCase()}`,
      `${taskName} is already marked ${cfg.heading.toLowerCase()}.`
    );
  }

  const stamp = new Date().toISOString();
  await admin
    .from("assigned_task_assignees")
    .update({ status: cfg.status, updated_at: stamp })
    .eq("assigned_task_id", id);
  await admin.from("assigned_tasks").update({ status: cfg.status, updated_at: stamp }).eq("id", id);
  await syncFixedPayTaskStatus(admin, id, cfg.status);

  // Written into the thread so the decision leaves the same trail it would
  // have from the admin panel, rather than a status that changed with no record.
  await admin.from("task_submissions").insert({
    assigned_task_id: id,
    va_task_assignment_id: null,
    user_id: null,
    message_type: cfg.entry,
    content: cfg.body,
    submission_comment: cfg.body,
  });

  if (action === "approve") await cheerApproval(id);

  if (telegramEnabled("submissions")) {
    const emoji = action === "approve" ? "✅" : "🔁";
    await sendTelegram("submissions", `${emoji} <b>${cfg.heading}</b> — ${esc(taskName)}`);
  }

  return resultPage(true, cfg.heading, `${taskName} is now marked ${cfg.heading.toLowerCase()}.`);
}
