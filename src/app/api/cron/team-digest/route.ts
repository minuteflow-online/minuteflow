import { NextRequest } from "next/server";
import { buildTeamDigest, buildWeeklyRecap, buildMeetingReminder } from "@/lib/teamDigest";
import { sendTelegram, sendTelegramSticker, telegramEnabled } from "@/lib/telegram";
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
    await sendTelegram("team", reminder);
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
