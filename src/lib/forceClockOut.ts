import { createClient } from "@supabase/supabase-js";

/**
 * Ends a session the person did not end themselves.
 *
 * Shared by both automatic closes — the silent-heartbeat one and the
 * unchanged-screen one — so there is a single definition of what "clocked out
 * by the system" does to the data. Two copies would drift, and this writes to
 * time_logs, which is what payroll reads.
 *
 * The open log is closed only if it is genuinely still open: a task the person
 * already ended by hand must never be rewritten with a later end time.
 */
export async function forceClockOut(userId: string, logId: number | null): Promise<void> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const now = new Date().toISOString();

  if (logId) {
    const { data: log } = await supabase
      .from("time_logs")
      .select("start_time, end_time")
      .eq("id", logId)
      .single();
    if (log && !log.end_time) {
      await supabase
        .from("time_logs")
        .update({
          end_time: now,
          duration_ms: new Date(now).getTime() - new Date(log.start_time as string).getTime(),
        })
        .eq("id", logId);
    }
  }

  await supabase
    .from("sessions")
    .update({ clocked_in: false, clock_out_time: now, active_task: null, updated_at: now })
    .eq("user_id", userId);

  // Both markers cleared: whatever triggered this is finished, and the next
  // quiet stretch should be judged from scratch rather than inheriting a stamp.
  await supabase
    .from("profiles")
    .update({ idle_warned_at: null, screen_static_warned_at: null })
    .eq("id", userId);
}
