import { createClient } from "@/lib/supabase/server";
import { hasBroadAdminAccess } from "@/lib/financialAccess";
import { sendTelegram, telegramEnabled } from "@/lib/telegram";
import { findProfileGaps } from "@/lib/profileGaps";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/team/nudge-profiles?confirm=1
 *
 * A general "please finish your profile" note to the team chat, sent when Toni
 * asks for it rather than on a schedule.
 *
 * Nobody is named. The weekly direct messages already tell each person exactly
 * what they are missing; this is the group-level nudge that gives those a
 * reason, and naming people here would turn a reminder into a roll call.
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

  const message = [
    "📋 <b>A quick housekeeping ask</b>",
    "",
    "Some profiles are still missing a few details — payment information, address, birthday or a photo.",
    "",
    "The payment details matter most: they are what your pay is sent against. The birthday is so we know when to celebrate you, and a photo just makes the team feel like a team.",
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
