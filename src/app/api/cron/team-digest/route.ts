import { NextRequest } from "next/server";
import { buildTeamDigest, buildWeeklyRecap, buildMeetingReminder, buildSchedulePost, buildOverdue, buildUnclaimed } from "@/lib/teamDigest";
import { findProfileGaps, gapMessage } from "@/lib/profileGaps";
import { notifyVaPrivately } from "@/lib/vaNotify";
import { sendTelegram, sendTelegramTo, sendTelegramSticker, telegramEnabled, esc } from "@/lib/telegram";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { ORG_TIMEZONE } from "@/lib/taskSchedule";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/team-digest?kind=today|tomorrow|weekly
 *
 * The team chat's scheduled posts.
 *
 * Three schedules rather than one, because they answer different questions.
 * "today" is what is happening now — birthdays, anniversaries, what is due, who
 * is away. "tomorrow" is a heads-up, and the only way the 6am Saturday meeting
 * gets mentioned while there is still time to plan around it. "weekly" is
 * Friday's recap of what the team shipped.
 *
 * Silent when there is nothing to say. A digest that posts "nothing today"
 * every morning is one people stop reading, and then the morning it matters
 * they do not read that either.
 */

/**
 * A birthday-card sticker from Telegram's own public pack.
 *
 * Sent as a separate message after the digest: a sticker cannot carry text, and
 * a card that fills the screen reads as an occasion where the same words with a
 * cake emoji read as an alert.
 */
const BIRTHDAY_STICKER = "CAACAgIAAxkBAAEBpZ9k5Z0AAWxYqZ0AAWxYqZ0AAWxYqZ0AAg0AA1advQpKlZlHtIcxvzAE";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const accepted = [process.env.CRON_SECRET, process.env.IDLE_TIMEOUT_CRON_SECRET]
    .filter(Boolean)
    .map((s) => `Bearer ${s}`);
  if (accepted.length === 0 || !authHeader || !accepted.includes(authHeader)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const kind = request.nextUrl.searchParams.get("kind") ?? "today";
  if (!telegramEnabled("team")) {
    return Response.json({ ok: true, skipped: "TELEGRAM_TEAM_CHAT_ID not set" });
  }

  // Meeting reminders run at three fixed clock times every day and simply say
  // nothing on the six days there is no meeting. Tying the schedule to a
  // weekday instead would keep firing at the old time the first week Ari moves
  // it — the calendar is the source of truth, not the crontab.
  if (kind === "meeting-tomorrow" || kind === "meeting-today") {
    const when = kind === "meeting-today" ? "today" : "tomorrow";
    const reminder = await buildMeetingReminder(when);
    if (!reminder) return Response.json({ ok: true, skipped: `no meeting ${when}` });
    await sendTelegram("team", reminder.groupMessage);

    // And to each person directly. A group post is easy to scroll past on a
    // busy chat, and this is the one thing everybody has to actually turn up
    // for. Anyone without Telegram linked simply does not get the direct copy.
    const admin = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { data: team } = await admin
      .from("profiles")
      .select("full_name, username, telegram_chat_id")
      .eq("is_active", true);

    let dmSent = 0;
    const unlinked: string[] = [];
    for (const person of team ?? []) {
      const name = (person.full_name as string) || (person.username as string) || "Someone";
      if (!person.telegram_chat_id) {
        unlinked.push(name);
        continue;
      }
      const result = await sendTelegramTo(
        person.telegram_chat_id as number,
        reminder.personalMessage,
        "va"
      );
      if (result.ok) dmSent++;
    }

    // One summary rather than a log line per person. Toni asked to see what
    // reaches people privately, but ten identical entries three times a meeting
    // day would bury everything else in that chat.
    if (telegramEnabled("ops")) {
      await sendTelegram(
        "ops",
        [
          `🔔 Meeting reminder (${when}) sent to the team chat and to <b>${dmSent}</b> people directly.`,
          "",
          esc(reminder.personalMessage.replace(/<[^>]+>/g, "")),
          ...(unlinked.length > 0 ? ["", `No Telegram link: ${esc(unlinked.join(", "))}`] : []),
        ].join("\n")
      );
    }

    return Response.json({ ok: true, kind, dmSent, unlinked: unlinked.length });
  }

  // Each person hears only about their own profile, privately. A list of
  // whose details are missing, posted to the team, would be a public tally of
  // who has not filled in their bank account.
  if (kind === "profiles") {
    const gaps = await findProfileGaps();
    for (const gap of gaps) {
      await notifyVaPrivately({
        chatId: gap.chatId,
        userId: gap.userId,
        vaName: gap.name,
        topic: "Profile",
        message: gapMessage(gap),
      });
    }
    return Response.json({ ok: true, kind, reminded: gaps.length });
  }

  if (kind === "unclaimed") {
    const post = await buildUnclaimed();
    if (!post) return Response.json({ ok: true, skipped: "nothing unclaimed" });
    await sendTelegram("team", post);
    return Response.json({ ok: true, kind });
  }

  if (kind === "overdue") {
    const post = await buildOverdue();
    if (!post) return Response.json({ ok: true, skipped: "nothing overdue" });
    await sendTelegram("team", post);
    return Response.json({ ok: true, kind });
  }

  if (kind === "schedule") {
    const post = await buildSchedulePost();
    if (!post) return Response.json({ ok: true, skipped: "nobody active" });
    await sendTelegram("team", post);
    return Response.json({ ok: true, kind });
  }

  if (kind === "weekly") {
    const recap = await buildWeeklyRecap();
    if (!recap) return Response.json({ ok: true, skipped: "nothing shipped this week" });
    await sendTelegram("team", recap);
    return Response.json({ ok: true, kind });
  }

  if (kind !== "today" && kind !== "tomorrow") {
    return Response.json({ error: "kind must be today, tomorrow or weekly" }, { status: 400 });
  }

  const digest = await buildTeamDigest(kind);
  if (!digest) return Response.json({ ok: true, skipped: "nothing to report" });

  await sendTelegram("team", digest.text);

  // After the message, so the card lands under the greeting rather than
  // ahead of it with nothing to explain itself.
  for (let i = 0; i < digest.birthdayPeople.length; i++) {
    await sendTelegramSticker("team", BIRTHDAY_STICKER);
  }

  return Response.json({
    ok: true,
    kind,
    birthdays: digest.birthdayPeople.length,
    at: new Date().toLocaleString("en-US", { timeZone: ORG_TIMEZONE }),
  });
}
