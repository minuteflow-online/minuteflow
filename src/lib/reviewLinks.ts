import { makeApprovalToken } from "./approvalToken";

/**
 * The Approve / Needs revision links that go on a submission's Telegram alert.
 *
 * Lives here rather than in the route that handles them so both sides import
 * one definition — a link built differently from the way it is verified fails
 * silently, and only for whoever taps it.
 *
 * The token is an HMAC over task, action and a server secret, the same scheme
 * the VA-request approval emails use. Anyone holding the link can act, which is
 * the point of tapping from a phone, but it cannot be guessed or edited into a
 * different task.
 */

export const REVIEW_ACTION_URL = "https://minuteflow.click/api/assigned-tasks/review-action";

export type ReviewAction = "approve" | "revision";

export function reviewLink(taskId: number, action: ReviewAction): string {
  return `${REVIEW_ACTION_URL}?id=${taskId}&do=${action}&t=${makeApprovalToken("submission", taskId, action)}`;
}

export function reviewLinks(taskId: number): { approve: string; revision: string } {
  return {
    approve: reviewLink(taskId, "approve"),
    revision: reviewLink(taskId, "revision"),
  };
}

/**
 * Congratulates whoever did the work, in the team chat, when their task is
 * approved.
 *
 * Lives here rather than at one call site because a task can be approved from
 * the Telegram button or from the admin panel, and a congratulation that only
 * fires from one of them is worse than none — the person would learn it depends
 * on which screen Toni happened to use.
 *
 * Best-effort and silent on failure: the approval itself has already been
 * recorded, and a missed cheer must never look like a failed approval.
 */
export async function cheerApproval(taskId: number): Promise<void> {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const { sendTelegram, telegramEnabled, mention } = await import("./telegram");
    const { approvalCheer } = await import("./submissionCheer");

    if (!telegramEnabled("team")) return;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // The person who submitted, not whoever approved it. Congratulating the
    // reviewer for their own decision would be an odd thing to post.
    const { data: sub } = await supabase
      .from("task_submissions")
      .select("user_id")
      .eq("assigned_task_id", taskId)
      .eq("message_type", "submission")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sub?.user_id) return;

    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name, username, telegram_chat_id")
      .eq("id", sub.user_id)
      .single();

    const who = prof?.full_name || prof?.username || "Someone";
    await sendTelegram("team", approvalCheer(mention(who, prof?.telegram_chat_id)));
  } catch (err) {
    console.error("approval cheer failed:", err);
  }
}
