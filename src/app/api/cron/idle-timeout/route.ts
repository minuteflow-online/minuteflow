import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// How long a session heartbeat (sessions.updated_at, refreshed every 60s while a tab
// is open) must be stale before we consider the session *possibly* idle. This is used
// for REPORTING ONLY — see the note below.
const STALE_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * GET /api/cron/idle-timeout
 *
 * REPORT-ONLY as of 2026-07-24. This endpoint no longer ends anything.
 *
 * The time model (authoritative): a SESSION (clock-in -> clock-out) is one
 * continuous span. TASKS only ever START — starting a new task hands off from the
 * previous one. A task may ONLY be ended by a task-switch or a logout, NEVER by
 * inactivity. A task with an end and no successor is a bug, not a fact.
 *
 * The previous version auto-closed time_logs rows and cleared sessions.active_task
 * when a heartbeat went stale, which read to the client as the system losing worked
 * time. It also gated that kill on extension_heartbeats.last_seen being fresh, which
 * failed for 9 of 10 VAs (stale/old extension versions), so the guard never protected
 * them. Both behaviours are removed. This route now only reports candidates so the
 * pattern stays observable in the cron log.
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
      `idle-timeout cron (REPORT-ONLY, no action taken): ${candidates.length} session(s) with a stale heartbeat`,
      candidates
    );
  }

  return Response.json({ mode: "report-only", stopped: 0, candidates });
}
