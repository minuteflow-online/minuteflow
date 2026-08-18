import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { sendTelegram, sendTelegramTo, telegramEnabled, esc } from "@/lib/telegram";
import { ORG_TIMEZONE } from "@/lib/taskSchedule";

export const dynamic = "force-dynamic";

/** How long after the warning DM a VA has to come back before the session is
 *  closed. Measured from profiles.idle_warned_at, so any heartbeat in between
 *  clears it and the countdown restarts from scratch. */
const GRACE_MS = 15 * 60 * 1000;

// How long a session heartbeat (sessions.updated_at, refreshed every 60s while a tab
// is open) must be stale before we consider the session *possibly* idle. This is used
// for REPORTING ONLY — see the note below.
const STALE_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * GET /api/cron/idle-timeout
 *
 * Warn-then-close, reinstated 2026-08-18 at Toni's request. Read the history
 * before touching the thresholds.
 *
 * The time model (authoritative): a SESSION (clock-in -> clock-out) is one
 * continuous span. TASKS only ever START — starting a new task hands off from the
 * previous one. A task may ONLY be ended by a task-switch or a logout, NEVER by
 * inactivity. A task with an end and no successor is a bug, not a fact.
 *
 * An earlier version auto-closed time_logs and cleared sessions.active_task the
 * moment a heartbeat went stale. It was made report-only on 2026-07-24 because
 * it read to VAs as the system losing worked time, and because its safety guard
 * keyed on extension_heartbeats.last_seen, which was stale for 9 of 10 VAs on
 * old extension versions — so the guard never actually protected anyone.
 *
 * What is different now, and why this is not a repeat:
 *   - Nobody is closed without warning. The first stale run only sets
 *     idle_warned_at and DMs the VA, giving them a grace period to come back.
 *   - The close only happens if they are STILL stale after that grace. Any
 *     heartbeat in between clears the warning and nothing further happens.
 *   - The trigger is the session heartbeat, not the extension. The old guard
 *     failed precisely because it trusted extension state.
 *   - Every forced close is announced to the VA and to the admin group, so a
 *     wrong one surfaces immediately instead of turning up in payroll later.
 *
 * Requires profiles.telegram_chat_id and profiles.idle_warned_at.
 *
 * Secured by IDLE_TIMEOUT_CRON_SECRET (VPS crontab, every 10 min).
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const expectedSecret = process.env.IDLE_TIMEOUT_CRON_SECRET;
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();

  const { data: staleSessions, error: sessionsError } = await supabase
    .from("sessions")
    .select("user_id, active_task, updated_at")
    .eq("clocked_in", true)
    .not("active_task", "is", null)
    .lt("updated_at", cutoff);

  if (sessionsError) {
    console.error("idle-timeout cron: failed to query sessions", sessionsError);
    return Response.json({ error: "Failed to query sessions" }, { status: 500 });
  }

  const candidates = (staleSessions || []).map((s) => {
    const activeTask = s.active_task as { logId?: string; start_time?: string } | null;
    return {
      user_id: s.user_id as string,
      log_id: activeTask?.logId ? parseInt(activeTask.logId, 10) : null,
      last_heartbeat: s.updated_at as string,
    };
  });

  if (candidates.length > 0) {
    console.log(
      `idle-timeout cron: ${candidates.length} session(s) with a stale heartbeat`,
      candidates
    );
  }

  // Anyone who came back clears their warning, so the grace period always
  // measures one uninterrupted stretch of silence rather than accumulating
  // across the day.
  const staleIds = candidates.map((c) => c.user_id);
  let clearQuery = supabase.from("profiles").update({ idle_warned_at: null }).not("idle_warned_at", "is", null);
  if (staleIds.length > 0) clearQuery = clearQuery.not("id", "in", `(${staleIds.join(",")})`);
  await clearQuery;

  const warned: string[] = [];
  const closed: string[] = [];
  const unreachable: string[] = [];

  for (const c of candidates) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name, username, telegram_chat_id, idle_warned_at")
      .eq("id", c.user_id)
      .single();
    if (!prof) continue;

    const who = prof.full_name || prof.username || "Someone";
    const graceStarted = prof.idle_warned_at ? new Date(prof.idle_warned_at).getTime() : null;

    // No way to reach them, so no way to warn them. Closing someone who never
    // got the warning is the exact behaviour that made the old version unfair,
    // so an unlinked VA is reported and left running.
    if (!prof.telegram_chat_id) {
      unreachable.push(who);
      continue;
    }

    // First stale run for this stretch: warn only, never close.
    if (!graceStarted) {
      await supabase.from("profiles").update({ idle_warned_at: new Date().toISOString() }).eq("id", c.user_id);
      warned.push(who);
      await sendTelegramTo(
        prof.telegram_chat_id,
        `⏰ <b>Are you still there?</b>\n\nMinuteFlow has not seen activity on your session for ${Math.round(
          STALE_THRESHOLD_MS / 60000
        )} minutes. If you are still working, open MinuteFlow to keep your time running.\n\nIf nothing changes in the next ${Math.round(
          GRACE_MS / 60000
        )} minutes you will be clocked out automatically.`
      );
      continue;
    }

    // Still silent after the grace period — close the session.
    if (Date.now() - graceStarted >= GRACE_MS) {
      const now = new Date().toISOString();

      if (c.log_id) {
        const { data: log } = await supabase
          .from("time_logs")
          .select("start_time, end_time")
          .eq("id", c.log_id)
          .single();
        // Only close a log that is genuinely still open, so a task the VA
        // already ended by hand is never rewritten.
        if (log && !log.end_time) {
          await supabase
            .from("time_logs")
            .update({
              end_time: now,
              duration_ms: new Date(now).getTime() - new Date(log.start_time as string).getTime(),
            })
            .eq("id", c.log_id);
        }
      }

      await supabase
        .from("sessions")
        .update({ clocked_in: false, clock_out_time: now, active_task: null, updated_at: now })
        .eq("user_id", c.user_id);
      await supabase.from("profiles").update({ idle_warned_at: null }).eq("id", c.user_id);
      closed.push(who);

      await sendTelegramTo(
        prof.telegram_chat_id,
        `⚪ <b>You have been clocked out</b>\n\nNo activity was seen after the warning, so MinuteFlow ended your session. If this was wrong, tell Toni — the time can be corrected.`
      );
    }
  }

  // Always tell the admin group about a forced close. A wrong one needs to be
  // visible the same day, not discovered at payroll.
  if (closed.length > 0 && telegramEnabled("submissions")) {
    const at = new Date().toLocaleTimeString("en-US", {
      timeZone: ORG_TIMEZONE,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    await sendTelegram(
      "submissions",
      `⚠️ <b>Forced clock-out</b> — ${esc(closed.join(", "))} at ${at} ET after no activity through the warning period.`
    );
  }

  return Response.json({
    warned: warned.length,
    closed: closed.length,
    unreachable: unreachable.length,
    candidates,
  });
}
