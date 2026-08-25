import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { checkStaticScreens } from "@/lib/staticScreen";

export const dynamic = "force-dynamic";

/** Categories where a still screen is expected. Breaks are matched separately
 *  via active_task.isBreak, which is how the break flow stores them. */
const IDLE_EXEMPT_CATEGORIES = ["Personal", "Break"];

/**
 * GET /api/cron/idle-timeout
 *
 * Looks for people whose screen has stopped changing while a task runs, and
 * hands them to the screenshot comparison in lib/staticScreen.
 *
 * ── Why the heartbeat is gone ────────────────────────────────────────────
 *
 * This used to key on sessions.updated_at going stale. That field only moves
 * when a MinuteFlow tab writes to it, so it answers "is a MinuteFlow tab
 * open?" — a question with no bearing on whether someone is working. A VA in
 * Sheets, Docs, Canva or a client's admin panel all morning is working, and
 * the heartbeat calls every one of them idle.
 *
 * It did exactly that on 2026-08-25: Arianne was clocked out at 9:10 with a
 * screenshot every five minutes from 8:16 onward, all of them ignored. The
 * same signal had this whole behaviour switched off once before, in July, for
 * the same reason. It is not a signal that can be patched into reliability,
 * so it is no longer consulted.
 *
 * What replaces it is the only thing that actually shows work: whether the
 * screen changed. That is true in any application, which is the entire point.
 *
 * ── What still cannot be concluded ───────────────────────────────────────
 *
 * No screenshots at all means nothing is known, not that nobody worked. A
 * broken extension, a signed-out extension and an idle person all produce the
 * same silence. staticScreen requires captures that exist AND are identical
 * before it says anything, so silence is reported to Toni and acted on by
 * nobody.
 *
 * Secured by IDLE_TIMEOUT_CRON_SECRET (VPS crontab, every 10 min).
 */
export async function GET(request: NextRequest) {
  // Two callers, two secrets. Vercel's scheduler sends CRON_SECRET; the older
  // VPS crontab sends IDLE_TIMEOUT_CRON_SECRET. Both are accepted so moving
  // this onto Vercel's schedule does not depend on someone remembering to
  // switch the VPS entry off at the same moment.
  const authHeader = request.headers.get("authorization");
  const accepted = [process.env.CRON_SECRET, process.env.IDLE_TIMEOUT_CRON_SECRET]
    .filter(Boolean)
    .map((s) => `Bearer ${s}`);
  if (accepted.length === 0 || !authHeader || !accepted.includes(authHeader)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Everyone currently on a task — not a filtered subset. Whether they look
  // active is precisely what the screenshot comparison decides, so filtering
  // beforehand on any other signal would reintroduce the bug.
  const { data: liveSessions, error } = await supabase
    .from("sessions")
    .select("user_id, active_task")
    .eq("clocked_in", true)
    .not("active_task", "is", null);

  if (error) {
    console.error("idle-timeout cron: failed to query sessions", error);
    return Response.json({ error: "Failed to query sessions" }, { status: 500 });
  }

  const candidates = (liveSessions ?? []).map((s) => {
    const activeTask = s.active_task as {
      logId?: string;
      category?: string;
      isBreak?: boolean;
    } | null;
    return {
      user_id: s.user_id as string,
      log_id: activeTask?.logId ? parseInt(activeTask.logId, 10) : null,
      category: activeTask?.category ?? null,
      isBreak: Boolean(activeTask?.isBreak),
    };
  });

  const flagged = await checkStaticScreens(candidates, IDLE_EXEMPT_CATEGORIES);

  return Response.json({
    checked: candidates.length,
    flagged: flagged.length,
    names: flagged,
  });
}
