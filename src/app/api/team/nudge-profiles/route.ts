import { createClient } from "@/lib/supabase/server";
import { hasBroadAdminAccess } from "@/lib/financialAccess";
import { sendTelegram, telegramEnabled, mention } from "@/lib/telegram";
import { findProfileGaps } from "@/lib/profileGaps";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/team/nudge-profiles?confirm=1
 *
 * A general "please finish your profile" note to the team chat, sent when Toni
 * asks for it rather than on a schedule.
 *
 * @everyone pings the room, and the people who still have gaps are named at
 * the end so nobody has to guess whether it means them. What they are missing
 * stays out of it — the weekly direct messages carry the specifics, and a
 * public list of whose bank details are blank is a different message entirely.
 *
 * Dry run by default so the count can be checked before anything is posted.
 * Reviewer-only, since it writes to the whole team's chat.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department")
    .eq("id", user.id)
    .single();
  if (!hasBroadAdminAccess(profile)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!telegramEnabled("team")) {
    return Response.json({ error: "TELEGRAM_TEAM_CHAT_ID is not set" }, { status: 400 });
  }

  const gaps = await findProfileGaps();

  // @everyone works when a bot sends it — confirmed in the team chat on
  // 2026-08-27. That replaced a line that mentioned all eleven people
  // individually, which pinged the room but opened every message with a wall
  // of names before it said anything.
  //
  // The people with gaps are still mentioned by name, so nobody has to work
  // out whether the message means them. Anyone not yet linked to Telegram
  // appears as plain text and is not pinged — nothing can change that until
  // they message the bot.
  const named = gaps.map((g) => mention(g.name, g.chatId)).join(", ");

  const message = [
    "📋 <b>A quick housekeeping ask</b>",
    "",
    "@everyone",
    "",
    "Some profiles are still missing a few details — payment information, address, birthday or a photo.",
    "",
    "The payment details matter most: they are what your pay is sent against. The birthday is so we know when to celebrate you, and a photo makes the team feel like a team.",
    ...(named ? ["", `Still to complete: ${named}`] : []),
    "",
    "If you have a spare two minutes, have a look in your Portal: https://minuteflow.click/portal",
    "",
    "Thank you! 🙏",
  ].join("\n");

  if (request.nextUrl.searchParams.get("confirm") !== "1") {
    return Response.json({
      wouldPost: true,
      peopleWithGaps: gaps.length,
      preview: message.replace(/<[^>]+>/g, ""),
      hint: "Add ?confirm=1 to actually send it to the team chat.",
    });
  }

  const sent = await sendTelegram("team", message);
  return Response.json({ ok: sent.ok, peopleWithGaps: gaps.length, error: sent.error });
}
