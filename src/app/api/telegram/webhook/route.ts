import { createClient } from "@supabase/supabase-js";
import { sendTelegram, sendTelegramTo, telegramEnabled, esc } from "@/lib/telegram";
import { parseLinkPayload } from "@/lib/telegramLink";

export const dynamic = "force-dynamic";

/**
 * POST /api/telegram/webhook
 *
 * Inbound from Telegram. Its only job today is /start: recording which chat
 * belongs to which person, so the bot can message them privately afterwards.
 *
 * Telegram forbids a bot from opening a conversation, so this moment — the
 * person messaging first — is the only chance to learn their chat id. Missing
 * it means they are unreachable until they try again.
 *
 * Two ways in. A /start carrying a signed payload came from the "Connect
 * Telegram" link inside MinuteFlow, so we already know who it is and the link
 * is made automatically. A bare /start is someone who found the bot on their
 * own; Toni is told who appeared and links them by hand, because the display
 * name Telegram reports is chosen by the person and need not match anything.
 *
 * Secured by the secret Telegram echoes in x-telegram-bot-api-secret-token.
 * The endpoint is public by necessity, so without that header it is an open
 * door for anyone who guesses the URL.
 */

type TgUpdate = {
  message?: {
    text?: string;
    chat?: { id?: number; type?: string; first_name?: string; username?: string };
    from?: { first_name?: string; username?: string };
  };
};

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const update = (await request.json().catch(() => ({}))) as TgUpdate;
  const message = update.message;
  const chatId = message?.chat?.id;
  const text = (message?.text ?? "").trim();

  // Only private chats: a group's id is no use for a personal notice, and
  // linking one to a profile would send that person's messages to a room.
  if (!chatId || message?.chat?.type !== "private" || !text.startsWith("/start")) {
    // 200 regardless — a non-200 makes Telegram retry the same update forever.
    return Response.json({ ok: true });
  }

  const displayName =
    message?.from?.first_name ||
    message?.chat?.first_name ||
    message?.from?.username ||
    "Someone";

  const payload = text.slice("/start".length).trim();
  const userId = payload ? parseLinkPayload(payload) : null;

  if (userId) {
    const supabase = admin();
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, username")
      .eq("id", userId)
      .single();

    // One chat cannot serve two people. Clearing it elsewhere first means a
    // re-link moves the chat instead of quietly delivering to both.
    await supabase
      .from("profiles")
      .update({ telegram_chat_id: null })
      .eq("telegram_chat_id", chatId)
      .neq("id", userId);
    await supabase.from("profiles").update({ telegram_chat_id: chatId }).eq("id", userId);

    const who = profile?.full_name || profile?.username || displayName;

    await sendTelegramTo(
      chatId,
      [
        "✅ <b>Connected</b>",
        "",
        `Hi ${esc(who)} — MinuteFlow can now reach you here.`,
        "You will get a message if your session goes quiet, if your screenshots stop uploading, or if your extension needs updating. Nothing here is shared with the team.",
      ].join("\n"),
      "va"
    );

    if (telegramEnabled("ops")) {
      await sendTelegram("ops", `🔗 <b>${esc(who)}</b> connected Telegram.`);
    }
    return Response.json({ ok: true, linked: userId });
  }

  // Unsigned /start — we know a chat exists but not whose it is.
  await sendTelegramTo(
    chatId,
    [
      "👋 <b>MinuteFlow</b>",
      "",
      "Thanks — you are through to the bot. Toni still needs to connect this chat to your MinuteFlow account before it can send you anything.",
    ].join("\n"),
    "va"
  );

  if (telegramEnabled("ops")) {
    await sendTelegram(
      "ops",
      [
        `👋 <b>${esc(displayName)}</b> started the bot — not linked yet.`,
        `Chat id: <code>${chatId}</code>`,
        "",
        "Link them: https://minuteflow.click/admin/telegram-chats",
      ].join("\n")
    );
  }

  return Response.json({ ok: true, linked: null });
}
