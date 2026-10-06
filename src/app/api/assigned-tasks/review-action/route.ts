import { createClient } from "@supabase/supabase-js";
import { verifyApprovalToken } from "@/lib/approvalToken";
import { resultPage, htmlResponse, card, summaryBlock, primaryButton, esc as escHtml } from "@/lib/approvalPages";
import { cheerApproval } from "@/lib/reviewLinks";
import type { ReviewAction } from "@/lib/reviewLinks";
import { sendTelegram, telegramEnabled, esc } from "@/lib/telegram";
import { syncFixedPayTaskStatus } from "@/lib/fixedPayTaskSync";
import { notifyAssigneesOfApproval } from "@/lib/notifyApproval";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/assigned-tasks/review-action?id=<taskId>&do=approve|revision&t=<token>
 *   shows a confirm page and changes nothing.
 * POST /api/assigned-tasks/review-action (form: id, do, t)
 *   makes the change, from the confirm page's button.
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

function makeAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/** Validates the link's task, action and token. Returns the parsed link, or a
 * ready-to-return page when it isn't a good one. */
function checkLink(
  rawId: unknown,
  rawAction: unknown,
  rawToken: unknown
): { id: number; action: ReviewAction } | Response {
  const id = Number(rawId);
  const action = String(rawAction ?? "");
  const token = String(rawToken ?? "");

  if (!id || !Object.hasOwn(ACTIONS, action)) {
    return resultPage(false, "Bad link", "That link is not valid.");
  }
  if (!verifyApprovalToken("submission", id, action, token)) {
    return resultPage(
      false,
      "Link could not be verified",
      "Please act on the task in MinuteFlow instead."
    );
  }
  return { id, action: action as ReviewAction };
}

/**
 * Opening the link only shows what it would do, with a button. Link previews
 * and mail scanners fetch links on their own, so a GET that changed the task
 * could approve it before anyone had looked. The change happens in POST, from
 * the button — the same way the VA-request and budget-request links work.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const link = checkLink(searchParams.get("id"), searchParams.get("do"), searchParams.get("t"));
  if (link instanceof Response) return link;
  const { id, action } = link;

  const { data: task } = await makeAdmin()
    .from("assigned_tasks")
    .select("id, task_name, status")
    .eq("id", id)
    .single();
  if (!task) {
    return resultPage(false, "Task not found", "It may have been deleted.");
  }

  const cfg = ACTIONS[action];
  const taskName = String(task.task_name ?? "This task");

  if (task.status === cfg.status) {
    return resultPage(
      true,
      `Already ${cfg.heading.toLowerCase()}`,
      `${escHtml(taskName)} is already marked ${cfg.heading.toLowerCase()}.`
    );
  }

  const token = String(searchParams.get("t") ?? "");
  const hidden = `<input type="hidden" name="id" value="${escHtml(id)}"><input type="hidden" name="do" value="${escHtml(action)}"><input type="hidden" name="t" value="${escHtml(token)}">`;
  const question = action === "approve" ? "Approve this task?" : "Ask for a revision on this task?";
  const color = action === "approve" ? "#6b8f71" : "#c2694f";
  const button = action === "approve" ? "✓ Confirm Approve" : "Confirm Revision Request";
  return htmlResponse(
    card(
      `<h2 style="color:${color};margin:0 0 12px">${question}</h2>${summaryBlock(
        `<strong>${escHtml(taskName)}</strong><br>Currently ${escHtml(String(task.status).replace(/_/g, " "))}.`
      )}<form method="post">${hidden}${primaryButton(button, color)}</form>`
    )
  );
}

export async function POST(request: NextRequest) {
  // Backs a link opened from Telegram, so a replayed or malformed POST is a
  // realistic hit and should land on the same styled page as every other failure.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return resultPage(false, "Invalid submission", "That form could not be read. Open the link again and resubmit.");
  }
  const link = checkLink(form.get("id"), form.get("do"), form.get("t"));
  if (link instanceof Response) return link;
  const { id, action } = link;

  const admin = makeAdmin();

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
      `${escHtml(taskName)} is already marked ${cfg.heading.toLowerCase()}.`
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

  if (action === "approve") {
    await cheerApproval(id);
    // No signed-in reviewer on this link, so the person doing the work gets
    // the private Telegram message only (a bell entry needs a sender).
    await notifyAssigneesOfApproval(admin, {
      taskId: id,
      taskName,
      reviewerId: null,
      reviewerName: null,
    });
  }

  if (telegramEnabled("submissions")) {
    const emoji = action === "approve" ? "✅" : "🔁";
    await sendTelegram("submissions", `${emoji} <b>${cfg.heading}</b> — ${esc(taskName)}`);
  }

  return resultPage(true, cfg.heading, `${escHtml(taskName)} is now marked ${cfg.heading.toLowerCase()}.`);
}
