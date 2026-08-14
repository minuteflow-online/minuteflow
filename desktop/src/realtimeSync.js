/**
 * Realtime sync — ported from the exact pattern already used in
 * dashboard/page.tsx around line 648 (the "messages-for-user" channel) and
 * again for capture_requests around line 677:
 *
 *   supabase.channel(name)
 *     .on("postgres_changes", { event, schema: "public", table, filter }, cb)
 *     .subscribe();
 *   // cleanup:
 *   supabase.removeChannel(channel);
 *
 * Per spec section 1c, subscribes to `time_logs` and `sessions`, filtered to
 * the logged-in user's user_id, and calls `onChange` on any INSERT/UPDATE/
 * DELETE so the caller can refresh active-task/timer state without a manual
 * refresh.
 *
 * IMPORTANT CAVEAT (can't be resolved from inside desktop/): postgres_changes
 * only fires for tables added to the Supabase project's `supabase_realtime`
 * publication. The web app already relies on this for `messages` and
 * `capture_requests`, but per spec 1c the web app does NOT currently subscribe
 * to `time_logs`/`sessions` — meaning whether those two tables are in that
 * publication at all is unconfirmed. Enabling it (Supabase dashboard →
 * Database → Replication, or an `ALTER PUBLICATION` statement) is a
 * DB-side/project config change, not something this module or any code under
 * desktop/ can do — it needs the "don't touch supabase/migrations" boundary
 * to be crossed by whoever manages that project, not by Jun's desktop-only
 * change. If it's off, `subscribe()` below still succeeds (no error) but the
 * callback simply never fires — the mini-dashboard would silently fall back
 * to whatever polling/manual-refresh already exists elsewhere in the app.
 */

function subscribeToUserChanges(supabase, userId, onChange) {
  const filter = `user_id=eq.${userId}`;

  const timeLogsChannel = supabase
    .channel("desktop-time-logs-for-user")
    .on("postgres_changes", { event: "*", schema: "public", table: "time_logs", filter }, onChange)
    .subscribe();

  const sessionsChannel = supabase
    .channel("desktop-sessions-for-user")
    .on("postgres_changes", { event: "*", schema: "public", table: "sessions", filter }, onChange)
    .subscribe();

  return function unsubscribe() {
    supabase.removeChannel(timeLogsChannel);
    supabase.removeChannel(sessionsChannel);
  };
}

module.exports = { subscribeToUserChanges };
