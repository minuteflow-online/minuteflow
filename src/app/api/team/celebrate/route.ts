import { createClient } from "@/lib/supabase/server";
import { hasBroadAdminAccess } from "@/lib/financialAccess";
import { sendTelegram, sendTelegramSticker, telegramEnabled } from "@/lib/telegram";
import { buildCelebrations } from "@/lib/teamDigest";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/team/celebrate?when=today|tomorrow&confirm=1
 *
 * Posts today's or tomorrow's birthdays and anniversaries to the team chat by
 * hand.
 *
 * The scheduled greeting goes out the evening before, which is their morning.
 * This exists for the times that one lands wrong — as Rhealin's did on
 * 2026-09-05, sent as the first line of a digest above four content deadlines.
 * Rather than leave the botched one standing as the only greeting, it can be
 * sent again properly, on the day.
 *
 * Dry run by default, so the message can be read before the room sees it.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, username, role, department")
    .eq("id", user.id)
    .single();
  if (!hasBroadAdminAccess(profile)) {
    return Response.json(
      {
        error: "Forbidden",
        signedInAs: profile?.full_name ?? profile?.username ?? "(no profile row found)",
        role: profile?.role ?? null,
      },
      { status: 403 }
    );
  }
  if (!telegramEnabled("team")) {
    return Response.json({ error: "TELEGRAM_TEAM_CHAT_ID is not set" }, { status: 400 });
  }

  const when = request.nextUrl.searchParams.get("when") === "tomorrow" ? "tomorrow" : "today";
  const celebrations = await buildCelebrations(when);

  if (!celebrations) {
    return Response.json({ error: `Nobody is celebrating ${when}.` }, { status: 404 });
  }

  if (request.nextUrl.searchParams.get("confirm") !== "1") {
    return Response.json({
      wouldPost: true,
      when,
      people: celebrations.birthdayPeople,
      preview: celebrations.text.replace(/<[^>]+>/g, ""),
      hint: "Add &confirm=1 to post it to the team chat.",
    });
  }

  const sent = await sendTelegram("team", celebrations.text);
  for (let i = 0; i < celebrations.birthdayPeople.length; i++) {
    await sendTelegramSticker("team", BIRTHDAY_STICKER);
  }

  return Response.json({
    ok: sent.ok,
    when,
    people: celebrations.birthdayPeople,
    error: sent.error,
  });
}

/** The same card the scheduled greeting sends, from Telegram's public pack. */
const BIRTHDAY_STICKER = "CAACAgIAAxkBAAEBpZ9k5Z0AAWxYqZ0AAWxYqZ0AAWxYqZ0AAg0AA1advQpKlZlHtIcxvzAE";
