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
import { sendTelegram, telegramEnabled, esc } from "@/lib/telegram";
import { ORG_TIMEZONE } from "@/lib/taskSchedule";

export const dynamic = "force-dynamic";

type SessionRow = {
  user_id?: string;
  clocked_in?: boolean;
  active_task?: { isBreak?: boolean } | null;
};

type WebhookPayload = {
  type?: "INSERT" | "UPDATE" | "DELETE";
  table?: string;
  record?: SessionRow | null;
  old_record?: SessionRow | null;
};

const EVENTS = {
  clock_in: "🟢 clocked in",
  clock_out: "⚪ clocked out",
  break_start: "☕ started a break",
  break_end: "🔵 is back from break",
} as const;

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
  if (!telegramEnabled("submissions")) return Response.json({ ok: true, skipped: "telegram off" });

  const userId = payload.record?.user_id;
  let who = "Someone";
  if (userId) {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: prof } = await admin.from("profiles").select("full_name, username").eq("id", userId).single();
    who = prof?.full_name || prof?.username || "Someone";
  }

  const time = new Date().toLocaleTimeString("en-US", {
    timeZone: ORG_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  await sendTelegram("submissions", `<b>${esc(who)}</b> ${EVENTS[event]} — ${time} ET`);
  return Response.json({ ok: true, event });
}
