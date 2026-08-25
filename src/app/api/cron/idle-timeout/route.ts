import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { notifyVaPrivately } from "@/lib/vaNotify";
import { checkStaticScreens } from "@/lib/staticScreen";
import { forceClockOut } from "@/lib/forceClockOut";
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

/**
 * Automatic closing is off unless IDLE_AUTO_CLOSE is explicitly "on".
 *
 * On 2026-08-24 this cron clocked out Arianne while she was working. She had
 * uploaded a screenshot every five minutes throughout, and the check never
 * looked at them — it trusted sessions.updated_at alone, which is exactly the
 * unreliable signal that got this behaviour switched off in July.
 *
 * Warnings and reporting continue regardless. The close stays behind a switch
 * so it cannot be turned back on by accident, and so it can be watched for a
 * few days before anyone's day is ended by it again.
 */
const AUTO_CLOSE_ENABLED = process.env.IDLE_AUTO_CLOSE === "on";

/**
 * True when the person has uploaded a screenshot recently.
 *
 * Screenshots are the honest signal. They are produced by the extension every
 * five minutes from the machine actually being worked on, whereas
 * sessions.updated_at only moves when a MinuteFlow tab feels like writing to
 * it — and a VA working in Sheets all morning touches that tab never.
 *
 * Any doubt counts as working: an unreadable table returns true, because the
 * cost of a wrong "yes" is a missed idle case and the cost of a wrong "no" is
 * taking someone's time away from them.
 */
async function hasRecentScreenshots(userId: string, sinceMs: number): Promise<boolean> {
  try {
    const supabase = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { data, error } = await supabase
      .from("task_screenshots")
      .select("id")
      .eq("user_id", userId)
      .gte("created_at", new Date(Date.now() - sinceMs).toISOString())
      .limit(1);
    if (error) return true;
    return (data?.length ?? 0) > 0;
  } catch {
    return true;
  }
}

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
 *   - Both the warning and the close reach the VA privately: a direct message
 *     from the bot plus an email holding the detail. The team chat sees none
 *     of it; Toni gets a log line recording that it was sent, and a loud one
 *     when the VA has no Telegram link and could not be reached.
 *
 * Requires profiles.idle_warned_at and profiles.telegram_chat_id.
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
  const wouldClose: string[] = [];
  const working: string[] = [];

  for (const c of candidates) {
    // Screenshots settle it before anything else is considered. A stale
    // heartbeat with fresh captures is not an idle person — it is a person
    // working somewhere other than a MinuteFlow tab, which is most of the day
    // for most of this team.
    //
    // Checked over the same window the staleness is measured against, and it
    // also clears any standing warning: someone who was quiet and came back
    // should start from zero rather than resume a countdown.
    if (await hasRecentScreenshots(c.user_id, STALE_THRESHOLD_MS)) {
      await supabase.from("profiles").update({ idle_warned_at: null }).eq("id", c.user_id);
      working.push(c.user_id);
      continue;
    }

    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name, username, idle_warned_at, telegram_chat_id")
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
      await notifyVaPrivately({
        chatId: prof.telegram_chat_id,
        userId: c.user_id,
        vaName: who,
        topic: "Activity",
        message: [
          "⏰ <b>Are you still there?</b>",
          "",
          `MinuteFlow has not seen activity on your session for ${Math.round(STALE_THRESHOLD_MS / 60000)} minutes. Open MinuteFlow to keep your time running.`,
          `If nothing changes in the next ${Math.round(GRACE_MS / 60000)} minutes you will be clocked out automatically.`,
        ].join("\n"),
      });
      continue;
    }

    // Still silent after the grace period — close the session, if closing is
    // switched on at all. Off by default after this cron ended sessions that
    // were plainly active; the warning still goes out either way, so a genuine
    // case is visible without anyone losing their afternoon to a false one.
    //
    // Through the shared helper rather than inline, so both automatic closes
    // write the same fields and record why.
    if (Date.now() - graceStarted >= GRACE_MS) {
      if (!AUTO_CLOSE_ENABLED) {
        wouldClose.push(who);
        continue;
      }
      const now = new Date().toISOString();
      await forceClockOut(c.user_id, c.log_id, "idle");
      closed.push(who);

      // Email is the record they keep; the DM is what they actually see in
      // time to react. Toni gets a log line from notifyVaPrivately either way.
      await emailForcedClockOut(c.user_id, who, now);
      await notifyVaPrivately({
        chatId: prof.telegram_chat_id,
        userId: c.user_id,
        vaName: who,
        topic: "Activity",
        message: [
          "⚪ <b>You have been clocked out</b>",
          "",
          "No activity was seen after the warning, so MinuteFlow ended your session and closed the open task.",
          "The details are in your email. If this was wrong, tell Toni — the time can be corrected.",
        ].join("\n"),
      });
    }
  }

  // Separate pass, and deliberately over every clocked-in session rather than
  // just the stale ones. A tab left open keeps the heartbeat fresh, so someone
  // can look perfectly active here while their screen has not moved at all —
  // that is exactly the case the idle check above cannot see.
  const { data: liveSessions } = await supabase
    .from("sessions")
    .select("user_id, active_task")
    .eq("clocked_in", true)
    .not("active_task", "is", null);

  const liveCandidates = (liveSessions ?? []).map((s) => {
    const activeTask = s.active_task as { category?: string; isBreak?: boolean; logId?: string } | null;
    return {
      user_id: s.user_id as string,
      category: activeTask?.category ?? null,
      isBreak: Boolean(activeTask?.isBreak),
      log_id: activeTask?.logId ? parseInt(activeTask.logId, 10) : null,
    };
  });

  const staticScreens = await checkStaticScreens(liveCandidates, IDLE_EXEMPT_CATEGORIES);

  return Response.json({
    autoCloseEnabled: AUTO_CLOSE_ENABLED,
    working: working.length,
    wouldClose: wouldClose.length,
    warned: warned.length,
    closed: closed.length,
    staticScreens: staticScreens.length,
    candidates,
  });
}
