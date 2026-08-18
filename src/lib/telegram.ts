// Telegram delivery for MinuteFlow alerts.
//
// One bot (TELEGRAM_BOT_TOKEN) posts to several chats, chosen by topic. This
// mirrors what extension-status and budget-requests already did inline, so
// those call sites can route through here instead of re-implementing fetch.
//
// Routing rules — read before adding a topic:
//   "submissions" → TELEGRAM_SUBMISSIONS_CHAT_ID. Day-to-day operations: task
//                   submissions, VA requests, clock-ins, extension installs.
//                   Falls back to TELEGRAM_GROUP_CHAT_ID, the older team-group
//                   var, so nothing goes dark mid-migration.
//   "bugs"        → TELEGRAM_BUGS_CHAT_ID, falling back to the submissions chat
//                   when no dedicated bug group exists.
//   "financial"   → TELEGRAM_BUDGET_CHAT_ID ONLY. Never falls back to any
//                   operations group: those include non-financial managers
//                   (e.g. IT) who are blocked from financials everywhere else
//                   in the app. Unset means the alert is skipped, by design.
//   "board"       → TELEGRAM_BOARD_CHAT_ID ONLY. No fallback either — board
//                   posts are conversation, not alerts, and would drown an ops
//                   group that people are meant to be able to skim.
//
// Adding a category later is one entry here plus one env var; pointing an
// existing category at a different group is an env change with no code at all.

export type TelegramTopic = "financial" | "submissions" | "bugs" | "board";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

function chatIdFor(topic: TelegramTopic): string | undefined {
  const submissions = process.env.TELEGRAM_SUBMISSIONS_CHAT_ID || process.env.TELEGRAM_GROUP_CHAT_ID;
  switch (topic) {
    // No fallbacks — see the routing rules above.
    case "financial":
      return process.env.TELEGRAM_BUDGET_CHAT_ID;
    case "board":
      return process.env.TELEGRAM_BOARD_CHAT_ID;
    case "submissions":
      return submissions;
    case "bugs":
      return process.env.TELEGRAM_BUGS_CHAT_ID || submissions;
  }
}

/** Escape for Telegram's HTML parse mode. Use on every interpolated value —
 *  VA names, memos and task titles are free text and a stray "<" kills the send. */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** True when a topic has somewhere to go. Lets callers skip building a message
 *  (and the profile lookups that feed it) when Telegram isn't configured. */
export function telegramEnabled(topic: TelegramTopic): boolean {
  return Boolean(BOT_TOKEN && chatIdFor(topic));
}

/**
 * Post to one specific chat id rather than a topic. For direct messages to a
 * person — a VA's own chat id from profiles.telegram_chat_id.
 *
 * Telegram will not let a bot open a conversation, so this only reaches people
 * who have messaged the bot first. A VA who never did returns ok:false, which
 * callers should treat as "not reachable", not as an error worth retrying.
 */
export async function sendTelegramTo(
  chatId: string | number,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  if (!BOT_TOKEN) return { ok: false, error: "TELEGRAM_BOT_TOKEN not set" };
  if (!chatId) return { ok: false, error: "no chat id" };

  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      }),
    });
    if (!res.ok) return { ok: false, error: await res.text() };
    return { ok: true };
  } catch (err) {
    console.error("telegram DM failed:", err);
    return { ok: false, error: String(err) };
  }
}

/**
 * Post to the chat for `topic`. Best-effort: never throws, so a Telegram
 * outage can never fail the request that triggered the alert.
 *
 * `text` is HTML parse mode — run untrusted values through esc() first.
 */
export async function sendTelegram(
  topic: TelegramTopic,
  text: string,
  opts: { disablePreview?: boolean; replyToMessageId?: number } = {}
): Promise<{ ok: boolean; messageId?: number; error?: string }> {
  const chatId = chatIdFor(topic);
  if (!BOT_TOKEN || !chatId) return { ok: false, error: `telegram not configured for "${topic}"` };

  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: opts.disablePreview !== false },
        ...(opts.replyToMessageId ? { reply_parameters: { message_id: opts.replyToMessageId } } : {}),
      }),
    });
    if (!res.ok) return { ok: false, error: await res.text() };

    // The message id is what lets a later reply be threaded back to the row
    // that produced it. Parsing is best-effort: a send that worked is still a
    // success even if we cannot read the id back.
    let messageId: number | undefined;
    try {
      messageId = ((await res.json()) as { result?: { message_id?: number } }).result?.message_id;
    } catch { /* non-fatal */ }
    return { ok: true, messageId };
  } catch (err) {
    // Swallowed on purpose — the caller's own work has already succeeded.
    console.error(`telegram send failed (${topic}):`, err);
    return { ok: false, error: String(err) };
  }
}
