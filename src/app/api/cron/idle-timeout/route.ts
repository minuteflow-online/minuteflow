import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { sendTelegram, telegramEnabled, esc } from "@/lib/telegram";
import { ORG_TIMEZONE } from "@/lib/taskSchedule";

export const dynamic = "force-dynamic";

/** How long after the warning a VA has to come back before the session is
 *  closed. Measured from profiles.idle_warned_at, so any heartbeat in between
 *  clears it and the countdown restarts from scratch. */
const GRACE_MS = 10 * 60 * 1000;

/** Categories where going quiet is expected, not suspicious. Breaks are matched
 *  separately via active_task.isBreak, which is how the break flow stores them. */
const IDLE_EXEMPT_CATEGORIES = ["Personal", "Break"];

// How long a session heartbeat (sessions.updated_at, refreshed every 60s while a tab
// is open) must be stale before we consider the session *possibly* idle. This is used
// for REPORTING ONLY — see the note below.
const STALE_THRESHOLD_MS = 15 * 60 * 1000;

/** Resolves a user's login email plus every admin's, for the to/cc pair these
 *  notices use. Returns nulls rather than throwing — a mail lookup problem must
 *  not stop the cron finishing its run. */
async function recipientsFor(
  userId: string
): Promise<{ to: string | null; cc: string[] }> {
  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  try {
    const { data: authData } = await supabase.auth.admin.getUserById(userId);
    const { data: admins } = await supabase.from("profiles").select("id").eq("role", "admin");
    const cc: string[] = [];
    for (const a of (admins ?? []) as { id: string }[]) {
      const { data: adminAuth } = await supabase.auth.admin.getUserById(a.id);
      if (adminAuth?.user?.email) cc.push(adminAuth.user.email);
    }
    return { to: authData?.user?.email ?? null, cc };
  } catch (err) {
    console.error("idle-timeout: recipient lookup failed", err);
    return { to: null, cc: [] };
  }
}

/** Fire-and-forget Resend send. Everything here is a courtesy notice; a mail
 *  failure must never change what the cron did to the session. */
async function sendMail(to: string, cc: string[], subject: string, html: string): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "MinuteFlow <noreply@minuteflow.click>",
        to: [to],
        ...(cc.length > 0 ? { cc } : {}),
        subject,
        html,
      }),
    });
  } catch (err) {
    console.error("idle-timeout: email failed", err);
  }
}

/** Warns the VA that their session has gone quiet and what happens next. */
async function emailIdleWarning(userId: string, who: string): Promise<void> {
  const { to, cc } = await recipientsFor(userId);
  if (!to) return;
  await sendMail(
    to,
    cc,
    "Your MinuteFlow session has gone quiet",
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#3d3229">
      <h2 style="color:#b8860b">Are you still working?</h2>
      <p>Hi ${who},</p>
      <p>MinuteFlow has not seen any activity on your session for
      <strong>${Math.round(STALE_THRESHOLD_MS / 60000)} minutes</strong>, and a task is still running.</p>
      <p>If you are still working, open MinuteFlow and your time keeps recording as normal.</p>
      <p style="background:#f5ecd0;padding:10px 12px;border-radius:8px">If nothing changes in the next
      <strong>${Math.round(GRACE_MS / 60000)} minutes</strong>, your session will be clocked out
      automatically and the open task closed.</p>
      <p style="color:#b5a898;font-size:12px">Sent automatically by MinuteFlow.</p>
    </div>`
  );
}

/**
 * Emails the VA the record of their forced clock-out, copying admins so the
 * same account of it exists on both sides.
 *
 * Best-effort throughout: the session is already closed, and a mail problem
 * must not stop the cron finishing the rest of the run.
 */
async function emailForcedClockOut(userId: string, who: string, closedAt: string): Promise<void> {
  const { to, cc } = await recipientsFor(userId);
  if (!to) return;

  const at = new Date(closedAt).toLocaleString("en-US", {
    timeZone: ORG_TIMEZONE,
    dateStyle: "medium",
    timeStyle: "short",
  });

  await sendMail(
    to,
    cc,
    "You were clocked out for inactivity",
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#3d3229">
      <h2 style="color:#c2694f">Clocked out automatically</h2>
      <p>Hi ${who},</p>
      <p>MinuteFlow ended your session at <strong>${at} ET</strong>. There was no activity for
      ${Math.round(STALE_THRESHOLD_MS / 60000)} minutes, a warning was sent, and nothing changed
      in the ${Math.round(GRACE_MS / 60000)} minutes that followed.</p>
      <p>Your open task was closed at that time. Any work done after it stopped recording is not
      in your log.</p>
      <p style="background:#f3ede4;padding:10px 12px;border-radius:8px">If you were working and
      this is wrong, tell Toni — the time can be corrected.</p>
      <p style="color:#b5a898;font-size:12px">Sent automatically by MinuteFlow.</p>
    </div>`
  );
}

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
 *     idle_warned_at and posts a warning, giving a grace period to come back.
 *   - The close only happens if they are STILL stale after that grace. Any
 *     heartbeat in between clears the warning and nothing further happens.
 *   - The trigger is the session heartbeat, not the extension. The old guard
 *     failed precisely because it trusted extension state.
 *   - Detail goes by email to the VA with admins copied; the team chat only
 *     carries a one-line notice that an email was sent. The person knows to
 *     look and a teammate can nudge them, without the specifics of someone's
 *     quiet stretch being posted in front of everyone.
 *
 * Requires profiles.idle_warned_at.
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

  const candidates = (staleSessions || [])
    .map((s) => {
      const activeTask = s.active_task as {
        logId?: string;
        start_time?: string;
        category?: string;
        isBreak?: boolean;
      } | null;
      return {
        user_id: s.user_id as string,
        log_id: activeTask?.logId ? parseInt(activeTask.logId, 10) : null,
        last_heartbeat: s.updated_at as string,
        category: activeTask?.category ?? null,
        isBreak: Boolean(activeTask?.isBreak),
      };
    })
    // Being idle is the whole point of a break, and Personal time is time the
    // VA is legitimately away from the screen. Only silence while a real task
    // is running counts as unexplained.
    .filter((c) => !c.isBreak && !IDLE_EXEMPT_CATEGORIES.includes(c.category ?? ""));

  if (candidates.length > 0) {
    console.log(
      `idle-timeout cron: ${candidates.length} session(s) with a stale heartbeat`,
      candidates
    );
  }

  // The warn-then-close flow needs profiles.idle_warned_at, which may not have
  // been added yet. Probe once and fall back to report-only rather than
  // throwing: a missing migration should make this cron quiet, not broken.
  const { error: columnsError } = await supabase
    .from("profiles")
    .select("idle_warned_at")
    .limit(1);
  if (columnsError) {
    console.warn(
      "idle-timeout: warn/close disabled — profiles needs idle_warned_at",
      columnsError.message
    );
    return Response.json({ mode: "report-only", reason: "missing columns", candidates });
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

  for (const c of candidates) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name, username, idle_warned_at")
      .eq("id", c.user_id)
      .single();
    if (!prof) continue;

    const who = prof.full_name || prof.username || "Someone";
    const graceStarted = prof.idle_warned_at ? new Date(prof.idle_warned_at).getTime() : null;

    // First stale run for this stretch: warn only, never close.
    //
    // Detail by email, notice in the team chat. The chat line names the person
    // and the subject so they know to look, and so a teammate can nudge them
    // before the clock-out lands — but the specifics of someone's quiet stretch
    // stay in their inbox rather than in front of everyone.
    if (!graceStarted) {
      await supabase.from("profiles").update({ idle_warned_at: new Date().toISOString() }).eq("id", c.user_id);
      warned.push(who);
      await emailIdleWarning(c.user_id, who);
      await sendTelegram(
        "submissions",
        `⏰ <b>${esc(who)}</b> — emailed about inactivity on your session. Please check your email.`
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

      // The detail goes to the VA by email — what was closed, when, and how to
      // get it corrected. That is a record they keep, rather than a line in a
      // group chat that scrolls away.
      await emailForcedClockOut(c.user_id, who, now);
    }
  }

  // Telegram carries only the notice, not the detail: enough for the team to
  // see it happened and for the VA to know an email is waiting.
  if (closed.length > 0 && telegramEnabled("submissions")) {
    const at = new Date().toLocaleTimeString("en-US", {
      timeZone: ORG_TIMEZONE,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    await sendTelegram(
      "submissions",
      `⚠️ <b>Clocked out</b> — ${esc(closed.join(", "))} at ${at} ET after no activity through the warning period. Details have been emailed.`
    );
  }

  return Response.json({
    warned: warned.length,
    closed: closed.length,
    candidates,
  });
}
