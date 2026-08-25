// Receives Supabase database webhooks for the `sessions` table and turns row
// changes into Telegram alerts (clocked in, clocked out, break started/ended).
//
// Why a webhook rather than calling this from the UI: `sessions` is written
// from ~20 places across the dashboard, TopNav, the admin panel and the
// idle-timeout cron. Alerting from the database means every one of those paths
// is covered, including any added later, and no client code has to remember to
// fire an event.
//
// Set up in Supabase → Database → Webhooks: table `sessions`, events INSERT and
// UPDATE, HTTP POST to https://minuteflow.click/api/session-events, with header
// x-session-events-secret matching SESSION_EVENTS_SECRET.

import { createClient } from "@supabase/supabase-js";
import { sendTelegram, sendTelegramTo, telegramEnabled, esc } from "@/lib/telegram";
import { clockInGreeting, clockOutGreeting, timeOfDayGreeting } from "@/lib/clockInGreeting";
import { ORG_TIMEZONE } from "@/lib/taskSchedule";

export const dynamic = "force-dynamic";

type SessionRow = {
  user_id?: string;
  clocked_in?: boolean;
  clock_out_time?: string | null;
  active_task?: { isBreak?: boolean } | null;
  auto_closed_reason?: string | null;
};

/** How each automatic close reads in the alert. A close nobody chose should
 *  never look like someone finishing their day. */
const CLOSE_REASONS: Record<string, string> = {
  idle: "no activity",
  screen_unchanged: "unchanged screen activity",
  admin: "by admin",
};

type WebhookPayload = {
  type?: "INSERT" | "UPDATE" | "DELETE";
  table?: string;
  record?: SessionRow | null;
  old_record?: SessionRow | null;
};

const EVENTS = {
  clock_in: "🟢",
  clock_out: "⚪",
  break_start: "☕",
  break_end: "🔵",
} as const;

/** Reads as a sentence with a time after it: "clocked in at 8:02 AM ET." */
const VERBS: Record<keyof typeof EVENTS, string> = {
  clock_in: "clocked in",
  clock_out: "clocked out",
  break_start: "started a break",
  break_end: "came back from break",
};

/** Which alert this row change represents, or null when nothing alertable moved.
 *  Only transitions fire — an UPDATE that leaves both flags unchanged (a task
 *  switch, a mood write) is silent, which is what keeps this from being noise. */
function classify(record: SessionRow | null, old: SessionRow | null): keyof typeof EVENTS | null {
  const wasIn = Boolean(old?.clocked_in);
  const isIn = Boolean(record?.clocked_in);
  if (!wasIn && isIn) return "clock_in";
  if (wasIn && !isIn) return "clock_out";

  // Break transitions only count while clocked in, so clearing active_task as
  // part of clocking out does not also report a break ending.
  if (!isIn) return null;
  const wasBreak = Boolean(old?.active_task?.isBreak);
  const isBreak = Boolean(record?.active_task?.isBreak);
  if (!wasBreak && isBreak) return "break_start";
  if (wasBreak && !isBreak) return "break_end";

  return null;
}

export async function POST(request: Request) {
  const secret = process.env.SESSION_EVENTS_SECRET;
  // Refuse to run unauthenticated: this endpoint is public, and without a
  // configured secret anyone could forge clock-in alerts.
  if (!secret) return Response.json({ error: "SESSION_EVENTS_SECRET not configured" }, { status: 503 });
  if (request.headers.get("x-session-events-secret") !== secret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as WebhookPayload;
  if (payload.table !== "sessions") return Response.json({ ok: true, skipped: "not sessions" });

  const event = classify(payload.record ?? null, payload.old_record ?? null);
  if (!event) return Response.json({ ok: true, skipped: "no transition" });
  if (!telegramEnabled("ops")) return Response.json({ ok: true, skipped: "telegram off" });

  const userId = payload.record?.user_id;
  let who = "Someone";
  let chatId: number | null = null;
  if (userId) {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: prof } = await admin
      .from("profiles")
      .select("full_name, username, telegram_chat_id")
      .eq("id", userId)
      .single();
    who = prof?.full_name || prof?.username || "Someone";
    chatId = (prof?.telegram_chat_id as number | null) ?? null;

    // A new session starts clean. Belt and braces alongside the freshness
    // check above: clearing it here means the flag does not survive to be
    // misread at all, rather than being caught after the fact.
    //
    // This write fires the webhook again, which is harmless — the second pass
    // sees no clocked_in transition and classifies as nothing.
    if (event === "clock_in" && payload.record?.auto_closed_reason) {
      await admin.from("sessions").update({ auto_closed_reason: null }).eq("user_id", userId);
    }
  }

  const now = new Date();
  const time = now.toLocaleTimeString("en-US", {
    timeZone: ORG_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  // A word at each end of the day, sent before the log line so the log can say
  // whether it actually arrived.
  //
  // The hour comes from the org's timezone, not the server's — a greeting that
  // says "good evening" to someone at breakfast is worse than none.
  // Nobody is thanked for a session they did not end. "Today's effort went
  // somewhere real, rest well" landing straight after "you have been clocked
  // out" reads as mockery, however well meant.
  //
  // Only trusted when the close is recent. The flag sits on the session row
  // until something overwrites it, so a forced close in the morning was still
  // sitting there when Arianne finished her shift at noon — and her own
  // clock-out was reported as automatic. A reason older than a couple of
  // minutes describes some earlier close, not this one.
  const closedBy = payload.record?.auto_closed_reason ?? null;
  const closedAt = payload.record?.clock_out_time
    ? new Date(payload.record.clock_out_time).getTime()
    : null;
  const reasonIsFresh = closedAt !== null && Date.now() - closedAt < 2 * 60 * 1000;
  const wasAutomatic = event === "clock_out" && Boolean(closedBy) && reasonIsFresh;

  let greeting: "sent" | "failed" | "unlinked" | null = null;
  let greetingText = "";
  if ((event === "clock_in" || event === "clock_out") && !wasAutomatic) {
    if (!chatId) {
      greeting = "unlinked";
    } else {
      const hour = Number(
        now.toLocaleString("en-US", { timeZone: ORG_TIMEZONE, hour: "numeric", hour12: false })
      );
      const firstName = who.split(" ")[0];

      // Kept as a variable so the log below can quote the exact words that were
      // sent. The lines are picked at random, so "a greeting went out" would
      // leave Toni unable to tell what any given person actually received.
      greetingText = event === "clock_in" ? clockInGreeting() : clockOutGreeting();
      const heading =
        event === "clock_in"
          ? `☀️ <b>${timeOfDayGreeting(hour)}, ${esc(firstName)}</b>`
          : `🌙 <b>Thanks, ${esc(firstName)}</b>`;

      const result = await sendTelegramTo(
        chatId,
        [heading, "", esc(greetingText)].join("\n"),
        "va"
      );
      greeting = result.ok ? "sent" : "failed";
    }
  }

  // Private, not the team chat. When someone starts and stops work is between
  // them and Toni — posting it where the whole team reads turns a log into a
  // scoreboard of who arrived when.
  //
  // Delivery is reported on this line rather than as a second message. Toni
  // asked to know when something reaches a VA privately, and one clock-in
  // producing two notifications would double the traffic for no extra fact.
  // An automatic close says so in the same breath as the time, rather than
  // reading exactly like someone finishing their day by choice.
  const how = wasAutomatic
    ? ` — automatically (${CLOSE_REASONS[closedBy as string] ?? closedBy})`
    : "";
  const lines = [
    `${wasAutomatic ? "⚠️" : EVENTS[event]} <b>${esc(who)}</b> ${VERBS[event]}${how} at ${time} ET.`,
  ];
  // The exact words, not just that something went out. The lines are random,
  // so "greeting sent" would leave no way to know what a given person read.
  if (greeting === "sent") lines.push(`Message sent: ${esc(greetingText)}`);
  if (greeting === "failed") lines.push("⚠️ Message FAILED to send.");
  if (greeting === "unlinked") lines.push("⚠️ No Telegram link — no message sent.");

  await sendTelegram("ops", lines.join("\n"));

  return Response.json({ ok: true, event, greeting });
}
