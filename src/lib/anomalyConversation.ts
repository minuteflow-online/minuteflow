import { createClient as createServiceClient } from "@supabase/supabase-js";
import { sendTelegram, esc } from "@/lib/telegram";
import { hasFinancialAccess } from "@/lib/financialAccess";
import { parseAnomalyReply, type ProposedFix } from "@/lib/anomalyReply";
import { applyCorrection } from "@/lib/applyCorrection";
import type { ShiftAnomalyFinding, ShiftLogRow } from "@/lib/shiftAnomalies";

/**
 * The reply-to-fix conversation on a shift anomaly alert.
 *
 * Two turns, always. The first reply is parsed into a proposal and echoed back;
 * nothing is written. Only a second reply confirming it touches the database.
 * The reason is that the first reply is free text — a misread "set end time to
 * 3:40" silently changes billable hours, and billable hours feed invoice
 * subtotals, which are the source of truth invoice line items are
 * back-calculated from. A wrong edit here is not visibly wrong anywhere.
 *
 * The write itself goes through time_correction_requests and applyCorrection,
 * the same path a VA's correction takes when Toni approves it in the panel, so
 * a fix made from Telegram is as auditable as one made from the admin screen.
 */

/** A proposal older than this is treated as abandoned and re-parsed instead. */
const PENDING_TTL_MINUTES = 30;

const CONFIRM_PATTERN = /^(yes|yep|yeah|y|confirm|confirmed|do it|go ahead|go|ok|okay)\b/i;
const CANCEL_PATTERN = /^(no|nope|n|cancel|stop|never\s?mind|forget it)\b/i;

interface AlertRow {
  id: number;
  chat_id: number;
  message_id: number;
  confirm_message_id: number | null;
  user_id: string;
  session_date: string;
  findings: ShiftAnomalyFinding[];
  pending_action: ProposedFix | null;
  pending_at: string | null;
}

export interface AnomalyReplyContext {
  chatId: number;
  replyToMessageId: number;
  text: string;
  fromId: number | undefined;
}

/**
 * Handles one inbound reply. Returns false when the replied-to message is not
 * an anomaly alert, so the webhook can fall through to whatever else it does.
 */
export async function handleAnomalyReply(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: ReturnType<typeof createServiceClient<any>>,
  ctx: AnomalyReplyContext
): Promise<boolean> {
  // Either the alert itself or the bot's own confirmation echo is a valid thing
  // to reply to — expecting her to scroll back up to the original would make
  // confirming harder than it needs to be.
  const { data: alert, error } = await supabase
    .from("telegram_anomaly_alerts")
    .select("*")
    .eq("chat_id", ctx.chatId)
    .or(`message_id.eq.${ctx.replyToMessageId},confirm_message_id.eq.${ctx.replyToMessageId}`)
    .maybeSingle();

  // A missing table means the migration has not run yet. Stay quiet rather than
  // erroring: the rest of the webhook (account linking) must keep working.
  if (error || !alert) return false;
  const row = alert as unknown as AlertRow;

  const reply = (text: string, replyTo?: number) =>
    sendTelegram("financial", text, { replyToMessageId: replyTo ?? row.message_id });

  // Editing billable time is a financial action, so the gate is the financial
  // one — not merely "is an admin". The chat being private is not the check;
  // a group can gain members.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, username, role, department")
    .eq("telegram_chat_id", ctx.fromId ?? 0)
    .maybeSingle();

  if (!profile || !hasFinancialAccess(profile)) {
    await reply("🔒 Only Toni can action these from Telegram. Nothing was changed.");
    return true;
  }

  const logs = await loadDayLogs(supabase, row.user_id, row.session_date);
  const pendingFresh =
    row.pending_action &&
    row.pending_at &&
    Date.now() - new Date(row.pending_at).getTime() < PENDING_TTL_MINUTES * 60_000;

  if (pendingFresh && CANCEL_PATTERN.test(ctx.text.trim())) {
    await clearPending(supabase, row.id);
    await reply("👍 Cancelled — nothing was changed.");
    return true;
  }

  if (pendingFresh && CONFIRM_PATTERN.test(ctx.text.trim())) {
    const fix = row.pending_action as ProposedFix;
    const result = await commitFix(supabase, {
      fix,
      reviewerId: profile.id as string,
      sessionDate: row.session_date,
    });
    await clearPending(supabase, row.id);

    if (!result.ok) {
      await reply(`❌ Could not apply it: ${esc(result.error)}\n\nNothing was changed.`);
      return true;
    }

    await reply(
      [
        "✅ <b>Applied.</b>",
        "",
        esc(fix.summary),
        "",
        `Logged as correction #${result.requestId}, approved by ${esc((profile.full_name as string) || (profile.username as string) || "you")} — it shows in the admin panel's correction history like any other.`,
      ].join("\n")
    );
    return true;
  }

  // A "yes" with no live proposal behind it must never be read as confirming
  // whatever came last. Say so and make her state the fix again.
  if (CONFIRM_PATTERN.test(ctx.text.trim()) && !pendingFresh) {
    await reply(
      "There is nothing waiting to confirm — the last proposal expired or was already applied. Reply with the fix again."
    );
    return true;
  }

  const parsed = parseAnomalyReply(ctx.text, row.findings ?? [], logs, row.session_date);
  if (!parsed.ok) {
    await reply(`🤔 ${esc(parsed.error)}`);
    return true;
  }

  await supabase
    .from("telegram_anomaly_alerts")
    .update({ pending_action: parsed.fix, pending_at: new Date().toISOString() })
    .eq("id", row.id);

  const echo = await reply(
    [
      "🔁 <b>Confirm this change</b>",
      "",
      esc(parsed.fix.summary),
      "",
      "<i>Reply “yes” to apply it, or “no” to cancel. Nothing has been written yet.</i>",
    ].join("\n")
  );

  // Remembered so "yes" can be a reply to this message rather than the alert.
  if (echo.messageId) {
    await supabase
      .from("telegram_anomaly_alerts")
      .update({ confirm_message_id: echo.messageId })
      .eq("id", row.id);
  }

  return true;
}

async function loadDayLogs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: ReturnType<typeof createServiceClient<any>>,
  userId: string,
  sessionDate: string
): Promise<ShiftLogRow[]> {
  const { data } = await supabase
    .from("time_logs")
    .select("id, task_name, category, billable, start_time, end_time, duration_ms")
    .eq("user_id", userId)
    .eq("session_date", sessionDate)
    .is("deleted_at", null)
    .order("start_time", { ascending: true });
  return (data ?? []) as unknown as ShiftLogRow[];
}

async function clearPending(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: ReturnType<typeof createServiceClient<any>>,
  alertId: number
) {
  await supabase
    .from("telegram_anomaly_alerts")
    .update({ pending_action: null, pending_at: null })
    .eq("id", alertId);
}

/**
 * Records the fix as a correction request and applies it in one step — Toni is
 * both the requester and the approver here, so splitting them would leave a
 * row she has to go and approve in the panel to finish a fix she already
 * confirmed twice.
 */
async function commitFix(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: ReturnType<typeof createServiceClient<any>>,
  input: { fix: ProposedFix; reviewerId: string; sessionDate: string }
): Promise<{ ok: true; requestId: number } | { ok: false; error: string }> {
  const { fix, reviewerId, sessionDate } = input;

  const { data: request, error: insertError } = await supabase
    .from("time_correction_requests")
    .insert({
      log_id: fix.logId,
      requested_by: reviewerId,
      reason: `Shift anomaly review (${sessionDate}), actioned from Telegram: ${fix.summary}`,
      requested_changes: fix.changes,
      status: "pending",
    })
    .select("id")
    .single();

  if (insertError || !request) {
    return { ok: false, error: insertError?.message ?? "Could not record the correction." };
  }

  const applied = await applyCorrection(supabase, {
    requestId: request.id as number,
    logId: fix.logId,
    changes: fix.changes,
    reviewerId,
    reviewNotes: "Confirmed in the finance Telegram chat.",
  });

  if (!applied.ok) {
    // The request stays behind as a denied row rather than a pending one that
    // looks like it is still waiting on somebody.
    await supabase
      .from("time_correction_requests")
      .update({
        status: "denied",
        reviewed_by: reviewerId,
        review_notes: `Not applied: ${applied.error}`,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", request.id);
    return { ok: false, error: applied.error };
  }

  return { ok: true, requestId: request.id as number };
}
