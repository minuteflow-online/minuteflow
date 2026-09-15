import { notifyVaPrivately } from "./vaNotify";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Notify one specific person — in-app (a `messages` row that drives the bell)
 * and a private Telegram DM. Best-effort: never throws, so a job-order action
 * can't fail just because a notification couldn't be delivered.
 */
export async function notifyOne(
  supabase: SupabaseClient,
  opts: {
    targetUserId: string;
    senderId: string;
    content: string;
    telegram: string;
    topic: string;
    /** The task this notification is about, if any — lets the bell link
     *  straight back to it instead of leaving the reader to go find it. */
    assignedTaskId?: number;
    submissionId?: number;
  }
): Promise<void> {
  try {
    await supabase.from("messages").insert({
      target_user_id: opts.targetUserId,
      sender_id: opts.senderId,
      content: opts.content,
      // What kind of thing this is, so a reader can separate a direct message
      // from a comment on someone's work. Older rows have none and read as
      // comments, which is what they were.
      kind: opts.topic,
      read: false,
      assigned_task_id: opts.assignedTaskId ?? null,
      submission_id: opts.submissionId ?? null,
    });
  } catch { /* ignore */ }
  try {
    const { data: p } = await supabase
      .from("profiles")
      .select("full_name, username, telegram_chat_id")
      .eq("id", opts.targetUserId)
      .single();
    await notifyVaPrivately({
      chatId: p?.telegram_chat_id,
      vaName: p?.full_name || p?.username || "there",
      topic: opts.topic,
      userId: opts.targetUserId,
      message: opts.telegram,
    });
  } catch { /* ignore */ }
}
