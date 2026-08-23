import { sendTelegram, sendTelegramTo, esc, telegramEnabled } from "./telegram";

/**
 * Private message to one VA, with a copy of the fact in Toni's own chat.
 *
 * The shape Toni asked for: a VA hears about their own clock-out, budget or
 * screenshot problem in a direct message rather than in front of the team, and
 * Toni still sees that it happened without sitting in a group with every VA
 * individually. The log line carries the subject, not the message body — it is
 * a record that something was sent, not a transcript.
 *
 * `topic` is the label shown in the log ("Activity", "Screenshot", ...). It is
 * deliberately coarse for the same reason the group notices are: the log lives
 * in a chat Toni reads, but the wording should not depend on that staying true.
 *
 * Delivery is never guaranteed. Telegram forbids a bot from opening a
 * conversation, so a VA who has not messaged the bot is unreachable — that case
 * is logged too, and loudly, because silence would otherwise look like success.
 */
export async function notifyVaPrivately(opts: {
  chatId: number | string | null | undefined;
  vaName: string;
  topic: string;
  message: string;
}): Promise<{ delivered: boolean }> {
  const { chatId, vaName, topic, message } = opts;

  let delivered = false;
  if (chatId) {
    const result = await sendTelegramTo(chatId, message, "va");
    delivered = result.ok;
  }

  // The log goes to the ops chat, which falls back to the financial one — both
  // private. Never the team chat: the point of the DM was that the team does
  // not see it, and a log line naming the person would undo that.
  if (telegramEnabled("ops")) {
    const line = delivered
      ? `📤 <b>${esc(vaName)}</b> — sent privately. Topic: ${esc(topic)}`
      : chatId
        ? `⚠️ <b>${esc(vaName)}</b> — private message FAILED. Topic: ${esc(topic)}`
        : `⚠️ <b>${esc(vaName)}</b> — not on Telegram, nothing sent. Topic: ${esc(topic)}`;
    await sendTelegram("ops", line);
  }

  return { delivered };
}
