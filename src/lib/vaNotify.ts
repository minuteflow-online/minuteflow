import { createClient } from "@supabase/supabase-js";
import { sendTelegram, sendTelegramTo, esc, telegramEnabled } from "./telegram";

/**
 * Private message to one VA, with a copy of the fact in Toni's own chat.
 *
 * The shape Toni asked for: a VA hears about their own clock-out, budget or
 * screenshot problem in a direct message rather than in front of the team, and
 * Toni still sees that it happened without sitting in a group with every VA
 * individually. The log carries the message itself, so Toni can see exactly
 * what the person read rather than only its subject.
 *
 * `topic` is the label on the log line ("Activity", "Screenshot", ...).
 *
 * Delivery is never guaranteed. Telegram forbids a bot from opening a
 * conversation, so a VA who has not messaged the bot is unreachable — that case
 * is logged too, and loudly, because silence would otherwise look like success.
 */

/** A still screen and a quiet session are the point of a break, and Personal
 *  time is time someone is meant to be away from work entirely. */
const OFF_DUTY_CATEGORIES = ["Personal", "Break"];

/**
 * True while someone is on a break or on personal time.
 *
 * Checked here rather than at each call site so every private message obeys it,
 * including any added later. The idle and screen checks already skip breaks
 * before they get this far; the screenshot and extension-update notices did
 * not, and would have buzzed someone's phone mid-lunch about their laptop.
 *
 * Errs towards sending: an unreadable session means we cannot say they are on
 * a break, and silently swallowing a real problem is worse than one badly
 * timed message.
 */
async function isOffDuty(userId: string): Promise<boolean> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { data } = await supabase
      .from("sessions")
      .select("clocked_in, active_task")
      .eq("user_id", userId)
      .single();
    if (!data?.clocked_in) return false;

    const task = data.active_task as { isBreak?: boolean; category?: string } | null;
    return Boolean(task?.isBreak) || OFF_DUTY_CATEGORIES.includes(task?.category ?? "");
  } catch {
    return false;
  }
}

export async function notifyVaPrivately(opts: {
  chatId: number | string | null | undefined;
  vaName: string;
  topic: string;
  message: string;
  /** Enables the break check. Without it the message always goes out. */
  userId?: string;
}): Promise<{ delivered: boolean; held?: boolean }> {
  const { chatId, vaName, topic, message, userId } = opts;

  const offDuty = userId ? await isOffDuty(userId) : false;

  let delivered = false;
  if (chatId && !offDuty) {
    const result = await sendTelegramTo(chatId, message, "va");
    delivered = result.ok;
  }

  // The log goes to the ops chat, which falls back to the financial one — both
  // private. Never the team chat: the point of the DM was that the team does
  // not see it, and a log line naming the person would undo that.
  if (telegramEnabled("ops")) {
    const lines = [
      offDuty
        ? `⏸️ <b>${esc(vaName)}</b> — on break, message held. Topic: ${esc(topic)}`
        : delivered
          ? `📤 <b>${esc(vaName)}</b> — sent privately. Topic: ${esc(topic)}`
          : chatId
            ? `⚠️ <b>${esc(vaName)}</b> — private message FAILED. Topic: ${esc(topic)}`
            : `⚠️ <b>${esc(vaName)}</b> — not on Telegram, nothing sent. Topic: ${esc(topic)}`,
    ];

    // The words themselves, not just the subject. A topic label says something
    // happened; it does not say what the person was told, and several of these
    // messages vary in wording. Shown when held or failed too, so the log
    // records what they would have read.
    //
    // Tags are stripped rather than re-escaped: the message body was already
    // escaped when it was built, so escaping again would show &amp; to Toni
    // where the VA saw &.
    const plain = message.replace(/<[^>]+>/g, "").replace(/\n{2,}/g, "\n").trim();
    if (plain) lines.push("", `Message ${offDuty || !delivered ? "not sent" : "sent"}: ${plain}`);

    await sendTelegram("ops", lines.join("\n"));
  }

  return { delivered, held: offDuty };
}
