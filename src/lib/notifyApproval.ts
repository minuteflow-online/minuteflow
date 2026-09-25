import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyOne } from "./notifyOne";
import { notifyVaPrivately } from "./vaNotify";
import { esc } from "./telegram";

const SNIPPET_MAX = 160;

/**
 * The wording of an approval notice — the bell line and the private Telegram
 * message. Kept pure so the text can be tested without any network or DB.
 * `reviewer` is null when the approval came from a Telegram/email link, where
 * nobody is signed in and so there is no name to give.
 */
export function buildApprovalNotice(opts: {
  reviewer: string | null;
  taskName: string | null | undefined;
  note?: string | null;
}): { bell: string; telegram: string } {
  const task = opts.taskName || "a task";
  const note = (opts.note ?? "").trim();
  const snippet = note.length > SNIPPET_MAX ? `${note.slice(0, SNIPPET_MAX)}…` : note;

  const bell = opts.reviewer
    ? `${opts.reviewer} approved “${task}”${snippet ? `: ${snippet}` : ""}`
    : `“${task}” was approved${snippet ? `: ${snippet}` : ""}`;

  const telegram = opts.reviewer
    ? `✅ <b>${esc(opts.reviewer)}</b> approved <b>${esc(task)}</b>${snippet ? `\n\n${esc(snippet)}` : ""}`
    : `✅ <b>${esc(task)}</b> was approved${snippet ? `\n\n${esc(snippet)}` : ""}`;

  return { bell, telegram };
}

/**
 * Tells whoever is doing a task that it was approved — the counterpart of the
 * revision notice in the submissions route. Best-effort: never throws, so a
 * notification problem can never make an approval look like it failed.
 *
 * With a signed-in reviewer the assignee gets a bell entry and a private
 * Telegram message (notifyOne). Without one (the Telegram/email approve link)
 * there is no sender to put on a bell entry — the column is required — so only
 * the private Telegram message is sent.
 */
export async function notifyAssigneesOfApproval(
  admin: SupabaseClient,
  opts: {
    taskId: number;
    taskName: string | null | undefined;
    reviewerId: string | null;
    reviewerName: string | null;
    note?: string | null;
    submissionId?: number;
  }
): Promise<void> {
  try {
    const { data: assignees } = await admin
      .from("assigned_task_assignees")
      .select("va_id")
      .eq("assigned_task_id", opts.taskId);

    const targets = new Set<string>();
    for (const a of assignees ?? []) {
      if (a.va_id && a.va_id !== opts.reviewerId) targets.add(a.va_id as string);
    }
    if (targets.size === 0) return;

    const notice = buildApprovalNotice({
      reviewer: opts.reviewerName,
      taskName: opts.taskName,
      note: opts.note,
    });

    for (const target of targets) {
      if (opts.reviewerId) {
        await notifyOne(admin, {
          targetUserId: target,
          senderId: opts.reviewerId,
          content: notice.bell,
          telegram: notice.telegram,
          topic: "submissions",
          assignedTaskId: opts.taskId,
          submissionId: opts.submissionId,
        });
      } else {
        const { data: p } = await admin
          .from("profiles")
          .select("full_name, username, telegram_chat_id")
          .eq("id", target)
          .single();
        await notifyVaPrivately({
          chatId: p?.telegram_chat_id,
          vaName: p?.full_name || p?.username || "there",
          topic: "submissions",
          userId: target,
          message: notice.telegram,
        });
      }
    }
  } catch (err) {
    console.error("approval notification failed:", err);
  }
}
