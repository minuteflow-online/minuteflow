import { notifyVaPrivately } from "./vaNotify";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Notify one specific person — in-app (a `messages` row that drives the bell)
 * and a private Telegram DM. Best-effort: never throws, so a job-order action
 * can't fail just because a notification couldn't be delivered.
 */
export async function notifyOne(
  supabase: SupabaseClient,
  opts: { targetUserId: string; senderId: string; content: string; telegram: string; topic: string }
): Promise<void> {
  try {
    await supabase.from("messages").insert({
      target_user_id: opts.targetUserId,
      sender_id: opts.senderId,
      content: opts.content,
      read: false,
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
