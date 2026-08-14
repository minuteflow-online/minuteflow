/**
 * Session (Clock In/Out) + task-level (Log a Task / switch) logic for the
 * desktop mini-dashboard.
 *
 * Ported from src/app/(app)/dashboard/page.tsx's two-layer model (see spec
 * section 1c): a SESSION layer (clockIn / performClockOut, ~lines 1030-1276)
 * and a TASK layer (startTask, ~lines 2067-2387; the "close old task" memo
 * step from src/components/TaskEntryForm.tsx's submitTask, lines 348-398).
 * This module reuses that exact pattern instead of inventing a new one:
 *
 *   1. An in-process reentrancy lock per action type — mirrors the web app's
 *      `isStartingTaskRef` / `sessionActionPendingRef` refs exactly:
 *        - `isStartingTask` guards startTask() (task-switch)
 *        - `isSessionActionPending` guards clockIn() + performClockOut()
 *          (the web app shares ONE ref between these two as well)
 *        - `isClosingTask` guards closeTaskAndClockOut()'s own entry, mirroring
 *          the `clockingOut` state that disables the web app's submit button,
 *          before it delegates to performClockOut()'s own lock
 *      Each lock is checked-and-set with no `await` in between, so two
 *      near-simultaneous calls of the same action can never both proceed.
 *   2. Before inserting a new time_log, we always re-query the DB for
 *      whatever is *actually* open right now (never cached/local state) and
 *      close it. This is what prevents the TOCTOU pattern found in
 *      claimable-tasks/route.ts (check "is a slot available", then insert as
 *      a disconnected second step) — "close what's open" and "insert the new
 *      row" both read/write the DB fresh, inside the same guarded call.
 *
 * Caveat, same as the web app: this guards the same-client rapid-double-click
 * scenario, not a true DB-level uniqueness constraint across processes — the
 * web app's own code has this identical limitation, and fixing it for real
 * would need a Postgres migration, which is out of scope here.
 */

const { getCorrectSessionDate } = require("./sessionDate");

let isStartingTask = false;
let isSessionActionPending = false;
let isClosingTask = false;

const VA_VISIBLE_STATUSES = ["on_queue", "in_progress"];

function countWords(text) {
  const trimmed = (text || "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** GET /api/assigned-tasks?selfOnly=true, filtered/shaped for the mini-dashboard list. */
async function listTasks(webApiClient) {
  const rows = await webApiClient.fetchAssignedTasksSelf();
  return rows
    .filter((row) => VA_VISIBLE_STATUSES.includes(row.status))
    .map((row) => ({
      assigneeId: row.id,
      assignedTaskId: row.assigned_tasks?.id ?? null,
      status: row.status,
      task_name: row.assigned_tasks?.task_name ?? "(untitled task)",
      task_detail: row.assigned_tasks?.task_detail ?? null,
      account: row.assigned_tasks?.account ?? null,
      project: row.assigned_tasks?.project ?? null,
      due_date: row.assigned_tasks?.due_date ?? null,
      logId: row.log_id ?? null,
    }))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "on_queue" ? -1 : 1));
}

/**
 * GET /api/assigned-tasks?selfOnly=true, shaped for the spec 1d task table,
 * filtered down to status "on_queue" only (spec 1e point 3 — "they only need
 * to see what's on queue... their focus area"; in_progress isn't shown here
 * either since that's already the one task the timer/active-task display
 * covers). Same underlying call as listTasks() (no new fetch/auth logic),
 * with the extra fields the table + detail panel need (category, dates,
 * notes) plus each task's to-do items.
 *
 * The `/api/assigned-tasks` route already embeds `task_todos(id, text,
 * sort_order)` on `assigned_tasks` for the VA selfOnly query (see
 * src/app/api/assigned-tasks/route.ts's vaSelectString) — so reading a
 * task's existing to-dos needs no separate request, just this mapping.
 */
async function listQueuedTasks(webApiClient) {
  const rows = await webApiClient.fetchAssignedTasksSelf();
  return rows
    .filter((row) => row.status === "on_queue")
    .map((row) => ({
      assigneeId: row.id,
      assignedTaskId: row.assigned_tasks?.id ?? null,
      status: row.status,
      task_name: row.assigned_tasks?.task_name ?? "(untitled task)",
      task_detail: row.assigned_tasks?.task_detail ?? null,
      task_notes: row.assigned_tasks?.task_notes ?? null,
      category: row.assigned_tasks?.category ?? null,
      account: row.assigned_tasks?.account ?? null,
      project: row.assigned_tasks?.project ?? null,
      due_date: row.assigned_tasks?.due_date ?? null,
      start_date: row.assigned_tasks?.start_date ?? null,
      created_at: row.assigned_tasks?.created_at ?? null,
      updated_at: row.assigned_tasks?.updated_at ?? row.updated_at ?? null,
      logId: row.log_id ?? null,
      todos: [...(row.assigned_tasks?.task_todos ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    }));
}

/**
 * Sum of today's tracked time_logs duration for the "Today: Xh Ym" stat (spec
 * 1d left panel). Uses the same today-in-org-timezone idiom already used
 * throughout this file/sessionDate.js (`toLocaleDateString("en-CA", {timeZone})`)
 * rather than a new date scheme. This is a plain read — it doesn't touch the
 * session_date *write* path getCorrectSessionDate governs.
 */
async function getTodayTrackedMs(supabase, userId, orgTimezone) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: orgTimezone });
  const { data, error } = await supabase
    .from("time_logs")
    .select("duration_ms")
    .eq("user_id", userId)
    .eq("session_date", today);
  if (error) throw new Error(error.message);
  return (data ?? []).reduce((sum, log) => sum + (log.duration_ms || 0), 0);
}

/** Reads current session state straight from the DB — the same row the web app writes
 *  to, so anything changed on the web (or by another desktop action) is picked up here. */
async function getSessionState(supabase, userId) {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/** Convenience wrapper used by the dashboard's initial load / realtime refresh. */
async function getActiveTask(supabase, userId) {
  const session = await getSessionState(supabase, userId);
  if (session?.active_task && !session.active_task.isBreak) return session.active_task;
  return null;
}

/**
 * Closes every open (end_time IS NULL) non-Break/non-Clock-Out time_log for this user,
 * reading "open" fresh from the DB every time — never from cached state. Ported from
 * `closeOpenNonBreakLogs` in dashboard/page.tsx (lines 828-898), including its overnight
 * handling: a log started on a previous calendar day is capped at 23:59:59.999 of that
 * day instead of running its duration all the way to `nowIso`, so an overnight/weekend
 * straggler doesn't get an impossibly long duration.
 */
async function closeAllOpenLogs(supabase, userId, nowIso) {
  const { data: openLogs, error: fetchError } = await supabase
    .from("time_logs")
    .select("id, start_time")
    .eq("user_id", userId)
    .is("end_time", null)
    .neq("category", "Break")
    .neq("category", "Clock Out");

  if (fetchError) {
    throw new Error(`Couldn't check for open tasks: ${fetchError.message}`);
  }

  const nowDate = new Date(nowIso).toDateString();

  for (const log of openLogs ?? []) {
    const startMs = log.start_time ? new Date(log.start_time).getTime() : Date.now();

    let endTime = nowIso;
    if (log.start_time && new Date(log.start_time).toDateString() !== nowDate) {
      const endOfDay = new Date(log.start_time);
      endOfDay.setHours(23, 59, 59, 999);
      endTime = endOfDay.toISOString();
    }
    const durationMs = Math.max(0, new Date(endTime).getTime() - startMs);

    const { error: closeError } = await supabase
      .from("time_logs")
      .update({ end_time: endTime, duration_ms: durationMs })
      .eq("id", log.id);

    if (closeError) {
      // Bail rather than start a new task on top of one that failed to close —
      // that would create the exact overlapping-duplicate-log situation this
      // whole function exists to prevent. Same rationale as dashboard/page.tsx.
      throw new Error(`Couldn't switch tasks (failed to close previous task): ${closeError.message}`);
    }
  }
}

/**
 * Writes status + memos onto the CURRENTLY active task's time_log (read fresh
 * from the DB, not trusted from the renderer) before it gets closed. Ported
 * from the "old task" branch of TaskEntryForm.tsx's submitTask (via
 * dashboard/page.tsx's startTask, lines 2141-2158): `task_status` becomes the
 * log's `progress` field, and either/both memos get written.
 *
 * Returns the resolved logId (string) if there was an active task to close,
 * or null if there wasn't one (nothing to do).
 */
async function applyOldTaskClose(supabase, userId, oldTaskClose) {
  if (!oldTaskClose) return null;

  const session = await getSessionState(supabase, userId);
  const activeTask = session?.active_task;
  if (!activeTask?.logId || activeTask.isBreak) return null;

  const logId = parseInt(activeTask.logId, 10);
  const updatePayload = {};
  if (oldTaskClose.status) {
    updatePayload.progress = oldTaskClose.status.toLowerCase().replace(/ /g, "_");
  }
  if (oldTaskClose.clientMemo?.trim()) updatePayload.client_memo = oldTaskClose.clientMemo.trim();
  if (oldTaskClose.internalMemo?.trim()) updatePayload.internal_memo = oldTaskClose.internalMemo.trim();

  if (Object.keys(updatePayload).length > 0) {
    const { error } = await supabase.from("time_logs").update(updatePayload).eq("id", logId);
    if (error) {
      throw new Error(`Couldn't save the previous task's status/memo: ${error.message}`);
    }
  }
  return activeTask.logId;
}

/**
 * Starts a task, automatically ending whatever's currently active first (no
 * separate manual "end task" step — see spec section 1b).
 *
 * If `task.oldTaskClose` is provided (`{status, clientMemo, internalMemo}`),
 * it's applied to the currently-active task first — this is the desktop
 * equivalent of TaskEntryForm.tsx's "close old task" wizard / the Clock Out
 * confirm dialog, reused for task-switching too (see renderer/closeTaskModal.js).
 *
 * `deps` is injected (supabase client, webApiClient, currentUser, and
 * getSessionRow/getOrgTimezone loaders) so this function has no Electron
 * dependency and can be unit-tested with a mock Supabase client — see
 * desktop/test/taskManager.race.test.js.
 */
async function startTask(deps, task) {
  const { supabase, webApiClient, currentUser, getSessionRow, getOrgTimezone } = deps;

  // ─── Reentrancy guard (layer 1) ───
  if (isStartingTask) {
    return { ok: false, error: "A task is already starting — please wait a moment." };
  }
  isStartingTask = true;

  try {
    if (!currentUser) {
      return { ok: false, error: "Not logged in." };
    }
    if (!task?.task_name) {
      return { ok: false, error: "Task is missing a name." };
    }

    const now = new Date().toISOString();
    const [sessionRow, orgTimezone] = await Promise.all([getSessionRow(), getOrgTimezone()]);
    const sessionDate = getCorrectSessionDate(sessionRow, orgTimezone);

    // ─── Write status/memo onto the OLD task first (if this is a switch) ───
    try {
      await applyOldTaskClose(supabase, currentUser.id, task.oldTaskClose);
    } catch (err) {
      return { ok: false, error: err.message };
    }

    // ─── Then close whatever's actually open in the DB (layer 2, safety net) ───
    await closeAllOpenLogs(supabase, currentUser.id, now);

    const { data: logData, error: insertError } = await supabase
      .from("time_logs")
      .insert({
        user_id: currentUser.id,
        username: currentUser.username,
        full_name: currentUser.fullName,
        department: currentUser.department ?? null,
        position: currentUser.position ?? null,
        task_name: task.task_name,
        category: task.category || "Task",
        project: task.project || null,
        account: task.account || null,
        client_name: task.client_name || null,
        start_time: now,
        billable: task.category !== "Personal",
        client_memo: task.client_memo || null,
        internal_memo: null,
        form_fill_ms: 0,
        billing_type: task.billing_type || "hourly",
        task_rate: task.task_rate ?? null,
        session_date: sessionDate,
      })
      .select()
      .single();

    if (insertError || !logData) {
      // The old task was already closed above — surface this clearly rather than
      // silently leave the VA idle with nothing tracked. Same rationale as the
      // alert() in dashboard/page.tsx's startTask.
      return {
        ok: false,
        error: `Failed to start task: ${insertError?.message || "unknown error"}. Nothing is being tracked right now.`,
      };
    }

    // Best-effort: mirror the assignee status to the web app (matches
    // handlePlayAssignedTask's `void setAssignedTaskStatus(...)`). Non-fatal —
    // the time_log above is already the real source of truth for the timer.
    if (task.assignedTaskId) {
      try {
        await webApiClient.patchAssignedTaskStatus(task.assignedTaskId, {
          status: "in_progress",
          va_id: currentUser.id,
          log_id: logData.id,
        });
      } catch (err) {
        console.error("[taskManager] assigned-task status sync failed (non-fatal):", err.message);
      }
    }

    const newActiveTask = {
      task_name: task.task_name,
      category: task.category || "Task",
      project: task.project || "",
      account: task.account || "",
      client_name: task.client_name || "",
      client_memo: task.client_memo || "",
      internal_memo: "",
      start_time: now,
      end_time: null,
      duration_ms: 0,
      logId: String(logData.id),
      billing_type: task.billing_type || "hourly",
      task_rate: task.task_rate ?? null,
    };

    // Auto-clock-in if idle, same as startTask() in dashboard/page.tsx.
    const clockInTime = sessionRow?.clocked_in ? sessionRow.clock_in_time : now;
    const { error: sessionError } = await supabase.from("sessions").upsert(
      {
        user_id: currentUser.id,
        clocked_in: true,
        clock_in_time: clockInTime,
        active_task: newActiveTask,
        session_date: sessionDate,
        updated_at: now,
      },
      { onConflict: "user_id" }
    );

    if (sessionError) {
      return {
        ok: true,
        activeTask: newActiveTask,
        warning: `Task started, but your session status may not update everywhere until you refresh. (${sessionError.message})`,
      };
    }

    return { ok: true, activeTask: newActiveTask };
  } finally {
    isStartingTask = false;
  }
}

/**
 * Clock In — ported from dashboard/page.tsx's `clockIn` (lines 1030-1138).
 * Creates the same "Clock In" / Planning / Set-up / Virtual Concierge time_log
 * used as the day's activity-log boundary marker, then upserts `sessions`.
 *
 * Deliberately not ported: the SCE (browser extension) heartbeat staleness
 * check and the Notification.requestPermission() call — both are web-app/
 * browser-extension-specific side effects with no desktop equivalent yet.
 */
async function clockIn(deps) {
  const { supabase, currentUser, getOrgTimezone } = deps;

  if (isSessionActionPending) {
    return { ok: false, error: "A session action is already in progress — please wait a moment." };
  }
  isSessionActionPending = true;

  try {
    if (!currentUser) return { ok: false, error: "Not logged in." };

    const now = new Date().toISOString();
    await closeAllOpenLogs(supabase, currentUser.id, now);

    // Matches dashboard/page.tsx line 1041 exactly: a fresh Clock In always uses
    // today's date directly (there's no prior session to have gone stale yet),
    // rather than getCorrectSessionDate.
    const orgTimezone = await getOrgTimezone();
    const clockInSessionDate = new Date().toLocaleDateString("en-CA", { timeZone: orgTimezone });

    const { data: clockInLog, error: insertError } = await supabase
      .from("time_logs")
      .insert({
        user_id: currentUser.id,
        username: currentUser.username,
        full_name: currentUser.fullName,
        department: currentUser.department ?? null,
        position: currentUser.position ?? null,
        task_name: "Clock In",
        category: "Planning",
        project: "Set-up",
        account: "Virtual Concierge",
        client_name: "Toni Colina",
        start_time: now,
        billable: true,
        billing_type: "hourly",
        session_date: clockInSessionDate,
      })
      .select()
      .single();

    if (insertError) {
      return { ok: false, error: `Clock In failed: ${insertError.message}` };
    }

    const clockInTask = {
      task_name: "Clock In",
      category: "Planning",
      project: "Set-up",
      account: "Virtual Concierge",
      client_name: "Toni Colina",
      client_memo: "",
      internal_memo: "",
      start_time: now,
      end_time: null,
      duration_ms: 0,
      logId: clockInLog?.id?.toString() || "",
      billing_type: "hourly",
    };

    const { error: sessionError } = await supabase.from("sessions").upsert(
      {
        user_id: currentUser.id,
        clocked_in: true,
        clock_in_time: now,
        active_task: clockInTask,
        session_date: clockInSessionDate,
        updated_at: now,
      },
      { onConflict: "user_id" }
    );

    if (sessionError) {
      return {
        ok: false,
        error: `Clock In may not have registered — something went wrong saving it. (${sessionError.message}) Please refresh and check your status before continuing.`,
      };
    }

    return { ok: true, activeTask: clockInTask };
  } finally {
    isSessionActionPending = false;
  }
}

/**
 * Clocks out — ported from dashboard/page.tsx's `performClockOut` (lines
 * 1140-1276): safety-net-closes any orphaned open logs, upserts `sessions`
 * to clocked_in:false with mood/day_rating (written directly — see the
 * module docblock on why these two aren't in database.ts's Session type but
 * are still real columns), upserts `mood_logs`, and inserts the "Clocked Out"
 * boundary-marker time_log.
 */
async function performClockOut(deps, { mood, dayRating, dayRatingNote } = {}) {
  const { supabase, currentUser, getSessionRow, getOrgTimezone } = deps;

  if (isSessionActionPending) {
    return { ok: false, error: "A session action is already in progress — please wait a moment." };
  }
  isSessionActionPending = true;

  try {
    if (!currentUser) return { ok: false, error: "Not logged in." };

    const now = new Date().toISOString();
    await closeAllOpenLogs(supabase, currentUser.id, now);

    const upsertPayload = {
      user_id: currentUser.id,
      clocked_in: false,
      clock_in_time: null,
      clock_out_time: now,
      active_task: null,
      updated_at: now,
    };
    if (mood) upsertPayload.mood = mood;
    if (dayRating) upsertPayload.day_rating = dayRating;
    if (dayRatingNote?.trim()) upsertPayload.day_rating_note = dayRatingNote.trim();

    const { error: sessionError } = await supabase
      .from("sessions")
      .upsert(upsertPayload, { onConflict: "user_id" });

    if (sessionError) {
      // This is exactly the class of failure spec 1c calls out (e.g. the known
      // manager-role RLS bug on `sessions`) — surface it clearly rather than
      // silently leaving the VA clocked in with no indication anything failed.
      return {
        ok: false,
        error: `Clock Out may not have registered — something went wrong saving it. (${sessionError.message}) Please refresh and check your status before trying again.`,
      };
    }

    const [sessionRow, orgTimezone] = await Promise.all([getSessionRow(), getOrgTimezone()]);
    const sessionDate = getCorrectSessionDate(sessionRow, orgTimezone);

    if (mood) {
      await supabase
        .from("mood_logs")
        .upsert({ user_id: currentUser.id, session_date: sessionDate, mood }, { onConflict: "user_id,session_date" });
    }

    await supabase.from("time_logs").insert({
      user_id: currentUser.id,
      username: currentUser.username,
      full_name: currentUser.fullName,
      department: currentUser.department ?? null,
      position: currentUser.position ?? null,
      task_name: "Clocked Out",
      category: "Clock Out",
      start_time: now,
      end_time: now,
      duration_ms: 0,
      billable: false,
      session_date: sessionDate,
    });

    return { ok: true };
  } finally {
    isSessionActionPending = false;
  }
}

/**
 * Closes the active task with status + memo, then clocks out — ported from
 * dashboard/page.tsx's `handleCloseTaskAndClockOut` (lines 1294-1358).
 *
 * Validation is identical to the web app's disabled-button condition (line
 * 3862-3867): status required, at least one of client/internal memo required,
 * and if a day rating is given its note needs ≥5 words. NOTE: like the real
 * `handleCloseTaskAndClockOut`, `status` is required for the confirm step but
 * is NOT written to the closed task's `progress` field — that's the actual
 * behavior of the code being ported here, not an omission on this port's part.
 */
async function closeTaskAndClockOut(deps, { status, clientMemo, internalMemo, mood, dayRating, dayRatingNote } = {}) {
  if (!status) {
    return { ok: false, error: "Task status is required." };
  }
  if (!clientMemo?.trim() && !internalMemo?.trim()) {
    return { ok: false, error: "At least one memo (client or internal) is required." };
  }
  if (dayRating != null && countWords(dayRatingNote) < 5) {
    return { ok: false, error: "Please write at least 5 words to explain your day rating." };
  }

  if (isClosingTask) {
    return { ok: false, error: "Already closing the current task — please wait a moment." };
  }
  isClosingTask = true;

  try {
    const { supabase, currentUser, getSessionRow } = deps;
    if (!currentUser) return { ok: false, error: "Not logged in." };

    const sessionRow = await getSessionRow();
    const activeTask = sessionRow?.active_task;
    if (!activeTask?.logId) {
      return { ok: false, error: "No active task to close." };
    }

    const now = new Date().toISOString();
    const logId = parseInt(activeTask.logId, 10);
    const startMs = activeTask.start_time ? new Date(activeTask.start_time).getTime() : Date.now();
    const durationMs = Math.max(0, new Date(now).getTime() - startMs);

    const updatePayload = { end_time: now, duration_ms: durationMs };
    if (clientMemo?.trim()) updatePayload.client_memo = clientMemo.trim();
    if (internalMemo?.trim()) updatePayload.internal_memo = internalMemo.trim();

    const { error: closeError } = await supabase.from("time_logs").update(updatePayload).eq("id", logId);
    if (closeError) {
      return { ok: false, error: `Couldn't close the active task: ${closeError.message}` };
    }
  } finally {
    isClosingTask = false;
  }

  // Task is closed — now clock out (separate lock, same as the web app calling
  // performClockOut() at the end of handleCloseTaskAndClockOut).
  return performClockOut(deps, { mood, dayRating, dayRatingNote });
}

module.exports = {
  listTasks,
  listQueuedTasks,
  getTodayTrackedMs,
  getSessionState,
  getActiveTask,
  closeAllOpenLogs,
  startTask,
  clockIn,
  performClockOut,
  closeTaskAndClockOut,
  // test-only: reset the module-level locks between unit tests
  _resetForTests: () => {
    isStartingTask = false;
    isSessionActionPending = false;
    isClosingTask = false;
  },
};
