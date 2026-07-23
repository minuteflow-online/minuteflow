import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// A task is considered abandoned once its session's heartbeat (sessions.updated_at,
// refreshed every 60s while a tab is open) has gone stale for this long. Covers the
// case where a VA's computer goes idle, the lid closes, or it loses power/network
// while a task is active — nothing else in the app currently detects or caps that.
const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes (Toni's preference, 2026-07-23)

/**
 * GET /api/cron/idle-timeout
 * Every 10 min (triggered by VPS crontab, not Vercel Cron): find sessions with an active task whose heartbeat has gone stale,
 * and close that task's time_logs row using the LAST KNOWN heartbeat time as
 * end_time (never "now") — so dead/offline time is never counted as worked time.
 * The VA can file a time_correction_requests request for Tony's approval if the
 * stop was wrong (e.g. a legitimate brief disconnect).
 * Secured by CRON_SECRET (set in Vercel env + vercel.json crons).
 */
export async function GET(request: NextRequest) {
  // Dedicated secret (not the shared Vercel CRON_SECRET) — this endpoint is triggered
  // by the VPS crontab, not Vercel Cron, since Vercel Cron on the Hobby plan only
  // supports daily schedules and this needs to run every ~10 minutes.
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

  const results: { user_id: string; log_id: number | null; stopped_at: string }[] = [];

  for (const s of staleSessions || []) {
    const activeTask = s.active_task as { logId?: string; start_time?: string } | null;
    const lastHeartbeat = s.updated_at as string;
    const logId = activeTask?.logId ? parseInt(activeTask.logId, 10) : null;

    if (logId) {
      const { data: log } = await supabase
        .from("time_logs")
        .select("id, start_time, end_time, internal_memo")
        .eq("id", logId)
        .single();

      // Only close it if it's genuinely still open — avoid clobbering a log that
      // was already closed through a normal path between our query and this write.
      if (log && !log.end_time) {
        const startMs = log.start_time ? new Date(log.start_time).getTime() : new Date(lastHeartbeat).getTime();
        const endMs = new Date(lastHeartbeat).getTime();
        const durationMs = Math.max(0, endMs - startMs);
        const note = `[Auto-stopped by idle-timeout cron: no heartbeat since ${lastHeartbeat}]`;

        await supabase
          .from("time_logs")
          .update({
            end_time: lastHeartbeat,
            duration_ms: durationMs,
            internal_memo: log.internal_memo ? `${log.internal_memo}\n${note}` : note,
          })
          .eq("id", logId);
      }
    }

    // Clear active_task but leave clocked_in as-is — this stops the task, it
    // does not clock the VA out. They'll see the post-stop state on next load.
    await supabase
      .from("sessions")
      .update({ active_task: null })
      .eq("user_id", s.user_id);

    results.push({ user_id: s.user_id, log_id: logId, stopped_at: lastHeartbeat });
  }

  if (results.length > 0) {
    console.log(`idle-timeout cron: auto-stopped ${results.length} stale task(s)`, results);
  }

  return Response.json({ stopped: results.length, results });
}
