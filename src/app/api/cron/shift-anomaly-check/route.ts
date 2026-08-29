import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { sendTelegram, chatIdFor, esc } from "@/lib/telegram";
import { checkShiftAnomalies, formatShiftMessage } from "@/lib/shiftAnomalies";
import {
  shouldAutoHold,
  holdLog,
  holdNotice,
  autoHoldReason,
  screenshotCountFor,
} from "@/lib/timeLogReview";
import { notifyVaPrivately } from "@/lib/vaNotify";

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
  // Vercel's scheduler sends CRON_SECRET, not this route's own name. Accepting
  // both means the schedule works without giving up the ability to fire it by
  // hand with a dedicated secret.
  const authHeader = request.headers.get("authorization");
  const accepted = [process.env.SHIFT_ANOMALY_CRON_SECRET, process.env.CRON_SECRET]
    .filter(Boolean)
    .map((secret) => `Bearer ${secret}`);
  if (accepted.length === 0 || !authHeader || !accepted.includes(authHeader)) {
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

  let sent = 0;
  let autoHeld = 0;
  let skipped = 0;

  for (const s of pending) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name, username, pay_rate_type, telegram_chat_id")
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

    // Set aside anything the screenshots do not account for, before the alert
    // is written, so the message describes the day as it now stands rather
    // than as it was a moment ago.
    //
    // Only unbacked Clock In placeholders qualify — see shouldAutoHold. The
    // person is told the same minute, because finding out later that hours
    // quietly stopped counting is how a system loses people's trust.
    for (const finding of result.findings) {
      const shots = await screenshotCountFor(supabase, finding.logId);
      if (!shouldAutoHold(finding, shots)) continue;

      const held = await holdLog(supabase, {
        logId: finding.logId,
        userId: s.user_id as string,
        source: "auto",
        findingType: finding.type,
        reason: autoHoldReason(finding, shots),
      });
      if (!held.ok) {
        console.error("shift-anomaly-check: could not hold log", finding.logId, held.error);
        continue;
      }

      await notifyVaPrivately({
        chatId: prof.telegram_chat_id as number | null,
        userId: s.user_id as string,
        vaName: who,
        topic: "Entry set aside",
        message: holdNotice(finding, shots),
      });

      await supabase
        .from("time_log_reviews")
        .update({ notified_at: new Date().toISOString() })
        .eq("id", held.reviewId);

      autoHeld++;
    }

    const message = formatShiftMessage(esc(who), (s.session_date as string) ?? "", result);

    // The finance chat, not a DM. These are billing questions, and they
    // belong where the invoices and paystubs are already discussed.
    const posted = await sendTelegram("financial", message);
    sent++;

    // Recorded so a reply to this exact message can be traced back to the
    // shift it reviewed. Without the message id there is no way to know which
    // VA and which day a bare "1 delete" is about.
    const chatId = chatIdFor("financial");
    if (posted.messageId && chatId) {
      await supabase.from("telegram_anomaly_alerts").insert({
        chat_id: Number(chatId),
        message_id: posted.messageId,
        user_id: s.user_id,
        session_date: s.session_date,
        findings: result.findings,
      });
    }

    await supabase
      .from("sessions")
      .update({ shift_review_sent_at: new Date().toISOString() })
      .eq("user_id", s.user_id);
  }

  return Response.json({ checked: pending.length, sent, skipped, autoHeld });
}
