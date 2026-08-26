import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { sendTelegramTo, esc } from "@/lib/telegram";
import { checkShiftAnomalies, formatShiftMessage } from "@/lib/shiftAnomalies";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/shift-anomaly-check
 *
 * Runs the same checks as the manual August time review (billed breaks,
 * orphaned "Clock In" placeholders, overlapping billable entries) against
 * each VA's shift right after they clock out, and DMs Toni privately — one
 * message per shift, clean or flagged.
 *
 * Only hourly-paid VAs are checked: output-based (per-task) and fixed-monthly
 * profiles don't accrue billable hours the same way, so pay_rate_type !==
 * "hourly" is skipped without a message.
 *
 * Idempotent via sessions.shift_review_sent_at — a shift is only reviewed
 * once per clock-out, re-armed automatically the next time clock_out_time
 * moves forward (the next shift).
 *
 * NOT YET LIVE: sessions.shift_review_sent_at does not exist yet (proposed
 * migration, pending approval) and nothing calls this route on a schedule.
 * Wire up SHIFT_ANOMALY_CRON_SECRET and a VPS crontab entry (same pattern as
 * idle-timeout, every 10-15 min) once ready to turn this on.
 *
 * Secured by SHIFT_ANOMALY_CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const expectedSecret = process.env.SHIFT_ANOMALY_CRON_SECRET;
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // shift_review_sent_at is a pending migration (see route doc comment). Probe
  // for it and stay quiet rather than error if it hasn't landed yet — a
  // deploy landing ahead of the SQL should never break the cron.
  const { error: columnsError } = await supabase
    .from("sessions")
    .select("shift_review_sent_at")
    .limit(1);
  if (columnsError) {
    console.warn("shift-anomaly-check: disabled — sessions needs shift_review_sent_at", columnsError.message);
    return Response.json({ mode: "disabled", reason: "missing column: sessions.shift_review_sent_at" });
  }

  const { data: closedSessions, error: sessionsError } = await supabase
    .from("sessions")
    .select("user_id, clock_out_time, session_date, shift_review_sent_at")
    .eq("clocked_in", false)
    .not("clock_out_time", "is", null)
    .not("session_date", "is", null);

  if (sessionsError) {
    console.error("shift-anomaly-check: failed to query sessions", sessionsError);
    return Response.json({ error: "Failed to query sessions" }, { status: 500 });
  }

  const pending = (closedSessions || []).filter((s) => {
    if (!s.shift_review_sent_at) return true;
    return (
      new Date(s.shift_review_sent_at as string).getTime() <
      new Date(s.clock_out_time as string).getTime()
    );
  });

  const { data: founder } = await supabase
    .from("profiles")
    .select("telegram_chat_id")
    .eq("role", "founder")
    .single();
  const toniChatId = founder?.telegram_chat_id ?? null;

  let sent = 0;
  let skipped = 0;

  for (const s of pending) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name, username, pay_rate_type")
      .eq("id", s.user_id)
      .single();

    if (!prof) continue;

    // Output-based and fixed-monthly VAs aren't reviewed for billable-hour
    // anomalies — mark reviewed so the next cron tick doesn't re-check them.
    if (prof.pay_rate_type !== "hourly") {
      await supabase
        .from("sessions")
        .update({ shift_review_sent_at: new Date().toISOString() })
        .eq("user_id", s.user_id);
      skipped++;
      continue;
    }

    const who = prof.full_name || prof.username || "Someone";
    const result = await checkShiftAnomalies(supabase, s.user_id as string, s.session_date as string);
    const message = formatShiftMessage(esc(who), (s.session_date as string) ?? "", result);

    if (toniChatId) {
      await sendTelegramTo(toniChatId, message, "internal");
      sent++;
    }

    await supabase
      .from("sessions")
      .update({ shift_review_sent_at: new Date().toISOString() })
      .eq("user_id", s.user_id);
  }

  return Response.json({ checked: pending.length, sent, skipped });
}
