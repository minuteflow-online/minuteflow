// Telegram delivery for MinuteFlow alerts.
//
// THREE BOTS, by audience. Each is a separate BotFather account with its own
// name and avatar, because the people on the other end are different:
//   "internal" → TELEGRAM_BOT_TOKEN. Toni's own alerts: submissions, bugs,
//                financials. Never talks to VAs or clients.
//   "va"       → TELEGRAM_VA_BOT_TOKEN. The bot VAs see and reply to — idle
//                warnings, task alerts.
//   "client"   → TELEGRAM_CLIENT_BOT_TOKEN. Anything a client receives.
//
// Each falls back to the internal token when its own is unset, so adding a bot
// is purely an env change and nothing goes dark before the bots exist. Keeping
// them separate means a leaked VA token cannot read financial alerts, and each
// audience sees a bot named for them rather than a shared one.
//
// Topic-based sends are internal by definition. Person-based sends
// (sendTelegramTo) name their bot, defaulting to the VA one.
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
//   "ops"         → TELEGRAM_OPS_CHAT_ID, falling back to the financial chat.
//                   Anything that singles a person out: idle warnings, forced
//                   clock-outs, screenshot failures. These went to the
//                   submissions chat until the team was added to it — being
//                   named in front of everyone for going quiet is a different
//                   thing from being seen submitting work. The fallback is a
//                   private chat on purpose, so this can never leak into a
//                   group by simply forgetting to set a variable.
//
// Adding a category later is one entry here plus one env var; pointing an
// existing category at a different group is an env change with no code at all.

export type TelegramTopic = "financial" | "submissions" | "bugs" | "board" | "ops";

/** Which audience a message is for. Picks the bot, not the destination. */
export type TelegramBot = "internal" | "va" | "client";

function tokenFor(bot: TelegramBot): string | undefined {
  const internal = process.env.TELEGRAM_BOT_TOKEN;
  switch (bot) {
    case "va":
      return process.env.TELEGRAM_VA_BOT_TOKEN || internal;
    case "client":
      return process.env.TELEGRAM_CLIENT_BOT_TOKEN || internal;
    case "internal":
      return internal;
  }
}

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
    case "ops":
      return process.env.TELEGRAM_OPS_CHAT_ID || process.env.TELEGRAM_BUDGET_CHAT_ID;
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
 * Post to one specific chat id rather than a topic. For messages aimed at a
 * person — a VA's own chat id from profiles.telegram_chat_id, or the shared
 * group holding just them, Toni and the bot.
 *
 * Defaults to the VA bot, since that is who person-addressed messages are
 * usually for; pass "client" for anything a client receives.
 *
 * Telegram will not let a bot open a conversation, so this only reaches people
 * whose chat the bot is already in. Someone unreachable returns ok:false, which
 * callers should treat as "not reachable", not as an error worth retrying.
 */
export async function sendTelegramTo(
  chatId: string | number,
  text: string,
  bot: TelegramBot = "va"
): Promise<{ ok: boolean; error?: string }> {
  const token = tokenFor(bot);
  if (!token) return { ok: false, error: `no token for the "${bot}" bot` };
  if (!chatId) return { ok: false, error: "no chat id" };

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
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
        // allow_sending_without_reply matters: if the original was deleted,
        // Telegram would otherwise reject the whole send and the update would
        // vanish. Better a standalone message than no message.
        ...(opts.replyToMessageId
          ? {
              reply_parameters: {
                message_id: opts.replyToMessageId,
                allow_sending_without_reply: true,
              },
            }
          : {}),
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
