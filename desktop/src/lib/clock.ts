// Clock in/out, ported from the web app's dashboard (src/app/(app)/dashboard/page.tsx)
// and SessionContext (src/contexts/SessionContext.tsx). Writes go straight to
// the `sessions` and `time_logs` tables via db.ts — the same RLS-scoped path
// the dashboard itself uses client-side, so a shift started here and one
// started on the web look identical in Reports/Activity Log.
//
// Ported, not reduced: the duplicate-active-log guard, the overnight-log
// capping, and the orphan-close safety net are all here because dropping any
// of them reproduces bugs the web app already fixed (see the "one active log"
// unique index and time-log-duplicate-bug-fix history).
import { query, PostgrestError } from "./db";
import { cappedCloseTime } from "./cappedCloseTime";
import { isBillableCategory } from "./billable";

export interface Profile {
  id: string;
  username: string;
  full_name: string;
  department: string | null;
  position: string | null;
  clock_in_disabled: boolean;
  /** Gates admin-only UI (the Team tab) — see team.ts. Matches the same
   *  6-role admin-equivalent list used throughout this app and the web RLS
   *  policies it reads against (admin/manager/coordinator/specialist/ceo/
   *  founder) by simply checking role !== "va", same as web's dashboard. */
  role: string;
}

export interface ActiveTask {
  task_name: string;
  category: string;
  project: string;
  account: string;
  client_name: string;
  client_memo: string;
  internal_memo: string;
  start_time: string;
  end_time: string | null;
  duration_ms: number;
  logId: string;
  _startMs: number;
  isBreak?: boolean;
  assignedTaskId?: number | null;
  todoLabel?: string | null;
}

export interface SessionRow {
  id: number;
  user_id: string;
  clocked_in: boolean;
  clock_in_time: string | null;
  active_task: ActiveTask | null;
  clock_out_time: string | null;
  session_date: string | null;
  updated_at: string;
}

const LEGACY_POSITIONS: Record<string, string> = {
  "Full-time VA": "Full Time",
  "Part-time VA": "Part Time",
  "Project Based VA": "Project Based",
  "Per Task VA": "Output Based",
};

function normalizePosition(position: string | null | undefined): string | null {
  if (!position) return null;
  return LEGACY_POSITIONS[position] ?? position;
}

/** Mirrors src/lib/clockInAccess.ts's clockInBlockedReason exactly. */
export function clockInBlockedReason(profile: Profile | null): string | null {
  if (!profile) return null;
  if (profile.clock_in_disabled) {
    return "Clocking in is turned off for your account. Ask an admin if you think this is wrong.";
  }
  if (normalizePosition(profile.position) === "Output Based") {
    return "Output Based work is paid per task, so there is no clock to run. Pick up a task instead.";
  }
  return null;
}

export function isDuplicateActiveLogError(err: unknown): boolean {
  if (!(err instanceof PostgrestError)) return false;
  return err.code === "23505" && (err.message?.includes("time_logs_one_active_per_user") ?? false);
}

// Overnight shifts that cross midnight keep the Clock In day's date if it's
// still within this many hours of midnight; older than that is a missed
// Clock Out, not a real overnight shift, and gets today's date instead.
const OVERNIGHT_CUTOFF_HOUR = 6;

/** Mirrors dashboard's getCorrectSessionDate: which calendar day a new
 *  time_log belongs to — "today" normally, but stays on the session's
 *  existing date for a genuine overnight shift (within OVERNIGHT_CUTOFF_HOUR
 *  of midnight) rather than splitting one shift across two session_dates. */
export function getCorrectSessionDate(
  session: { session_date?: string | null } | null | undefined,
  orgTimezone: string
): string {
  const now = new Date();
  const todayStr = now.toLocaleDateString("en-CA", { timeZone: orgTimezone });
  const storedDate = session?.session_date;

  if (!storedDate || storedDate === todayStr) {
    return storedDate || todayStr;
  }

  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayStr = yesterday.toLocaleDateString("en-CA", { timeZone: orgTimezone });
  const currentHour = Number(
    now.toLocaleString("en-US", { timeZone: orgTimezone, hour: "numeric", hour12: false })
  );

  if (storedDate === yesterdayStr && currentHour < OVERNIGHT_CUTOFF_HOUR) {
    return storedDate;
  }

  return todayStr;
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const rows = await query<Profile[]>("profiles", {
    filters: `id=eq.${userId}&select=id,username,full_name,department,position,clock_in_disabled,role`,
  });
  return rows[0] ?? null;
}

export async function fetchOrgTimezone(): Promise<string> {
  try {
    const rows = await query<{ timezone: string }[]>("organization_settings", {
      filters: "select=timezone&limit=1",
    });
    return rows[0]?.timezone || "UTC";
  } catch {
    return "UTC";
  }
}

export async function fetchSession(userId: string): Promise<SessionRow | null> {
  const rows = await query<SessionRow[]>("sessions", {
    filters: `user_id=eq.${userId}&select=*&limit=1`,
  });
  return rows[0] ?? null;
}

/** Closes any of this user's still-open time_logs (end_time null), capped at
 *  end-of-org-day for stale/overnight ones. Runs before every clock-in and
 *  clock-out, same as the web app — a stale open row otherwise blocks the
 *  next clock-in via the one-active-log unique index. */
export async function closeOpenLogs(userId: string, now: string, orgTimezone: string, excludeLogId?: number): Promise<void> {
  let filters = `user_id=eq.${userId}&end_time=is.null&category=neq.${encodeURIComponent("Clock Out")}&select=id,start_time,assigned_task_id`;
  if (excludeLogId !== undefined) filters += `&id=neq.${excludeLogId}`;

  const openLogs = await query<{ id: number; start_time: string; assigned_task_id: number | null }[]>("time_logs", { filters });
  for (const log of openLogs) {
    const { endTime, durationMs } = cappedCloseTime(log.start_time, now, orgTimezone);
    await query("time_logs", {
      method: "PATCH",
      filters: `id=eq.${log.id}`,
      body: { end_time: endTime, duration_ms: durationMs },
    });
  }

  // Closing a log here does NOT touch the assignment's own status — once a
  // task is started it stays "in_progress" until Submit, even across a
  // clock-out, clock-in, or switching to a different task (Toni's call,
  // 2026-11-03, reversing the auto-demote-to-on_queue behavior from Phase 1).
  // A task left in_progress with nothing running behind it is expected and
  // fine: TasksPanel's Start button already shows for any in_progress task
  // that isn't the live active one, so it's always one click to resume.
}

export interface ClockInResult {
  ok: boolean;
  error?: string;
  session?: SessionRow;
}

/** Mirrors the dashboard's clockIn(): closes stray open logs, inserts the
 *  "Clock In" planning time_log, then marks the session clocked in with that
 *  log as the active task. */
export async function clockIn(userId: string, profile: Profile, orgTimezone: string): Promise<ClockInResult> {
  const blocked = clockInBlockedReason(profile);
  if (blocked) return { ok: false, error: blocked };

  const now = new Date().toISOString();
  await closeOpenLogs(userId, now, orgTimezone);

  const sessionDate = new Date().toLocaleDateString("en-CA", { timeZone: orgTimezone });

  let sortingLog: { id: number };
  try {
    const rows = await query<{ id: number }[]>("time_logs", {
      method: "POST",
      body: {
        user_id: userId,
        username: profile.username,
        full_name: profile.full_name,
        department: profile.department,
        position: profile.position,
        task_name: "Clock In",
        category: "Planning",
        project: "Set-up",
        account: "Virtual Concierge",
        client_name: "Toni Colina",
        start_time: now,
        billable: true,
        billing_type: "hourly",
        session_date: sessionDate,
      },
    });
    sortingLog = rows[0];
  } catch (err) {
    return {
      ok: false,
      error: isDuplicateActiveLogError(err)
        ? "You're already clocked in somewhere else (another device or the extension?). Refresh to see your current status."
        : `Couldn't clock you in: ${err instanceof Error ? err.message : "unknown error"}. Nothing is being tracked right now.`,
    };
  }

  const activeTask: ActiveTask = {
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
    logId: String(sortingLog.id),
    _startMs: Date.now(),
  };

  const rows = await query<SessionRow[]>("sessions", {
    method: "POST",
    filters: "on_conflict=user_id",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: {
      user_id: userId,
      clocked_in: true,
      clock_in_time: now,
      active_task: activeTask,
      session_date: sessionDate,
      updated_at: now,
    },
  });

  return { ok: true, session: rows[0] };
}

/** What the clock-out wizard collects, same fields as web's Close Active Task
 *  dialog (dashboard's handleCloseTaskAndClockOut). */
export interface ClockOutWizardResult {
  clientMemo: string;
  internalMemo: string;
  mood: "bad" | "neutral" | "good" | null;
  dayRating: number | null;
  dayRatingNote: string;
}

/** Closes the task that's running, saving the memos on its log — the first
 *  half of web's handleCloseTaskAndClockOut (the second half is clockOut()
 *  above, which now also takes the mood/day-rating). Task Status in the
 *  dialog is required but, as on web, isn't stored by this step. */
export async function closeActiveTaskWithMemos(
  task: ActiveTask,
  clientMemo: string,
  internalMemo: string
): Promise<void> {
  const logId = Number(task.logId);
  if (!logId) return;
  const now = Date.now();
  const startMs = task.start_time ? new Date(task.start_time).getTime() : now;
  const body: Record<string, unknown> = {
    end_time: new Date(now).toISOString(),
    // Never negative (clock skew), same guard as web.
    duration_ms: Math.max(0, now - startMs),
  };
  if (clientMemo.trim()) body.client_memo = clientMemo.trim();
  if (internalMemo.trim()) body.internal_memo = internalMemo.trim();
  await query("time_logs", { method: "PATCH", filters: `id=eq.${logId}`, body });
}

export interface StopTaskResult {
  ok: boolean;
  error?: string;
  session?: SessionRow;
}

/** Real Stop — mirrors web's stopCurrentTask (Phase 1/4, Toni's call,
 *  2026-11-02): closes the running task's own log and clears the session's
 *  active_task to null while staying clocked in. The assignment itself
 *  stays "in_progress" — Stop just pauses the timer, it doesn't send the
 *  task back to on_queue (Toni's call, 2026-11-03). Nothing else starts —
 *  the clock-in timer (shown by ClockPanel) keeps running on its own, same
 *  as web's top-bar clock. */
export async function stopCurrentTask(
  userId: string,
  currentSession: SessionRow | null
): Promise<StopTaskResult> {
  const activeTask = currentSession?.active_task;
  if (!activeTask?.logId) return { ok: false, error: "Nothing is currently running." };

  const now = Date.now();
  const startMs = activeTask.start_time ? new Date(activeTask.start_time).getTime() : now;
  await query("time_logs", {
    method: "PATCH",
    filters: `id=eq.${activeTask.logId}`,
    body: {
      end_time: new Date(now).toISOString(),
      duration_ms: Math.max(0, now - startMs),
    },
  });

  const rows = await query<SessionRow[]>("sessions", {
    method: "POST",
    filters: "on_conflict=user_id",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: {
      user_id: userId,
      clocked_in: true,
      clock_in_time: currentSession?.clock_in_time ?? null,
      active_task: null,
      session_date: currentSession?.session_date ?? null,
      updated_at: new Date(now).toISOString(),
    },
  });

  return { ok: true, session: rows[0] };
}

/** Mirrors performClockOut(): closes any orphaned open logs (including a
 *  still-open break), then marks the session clocked out and writes the
 *  zero-duration "Clocked Out" marker log web writes (reports use it as the
 *  shift boundary). Mood/day-rating prompts are not ported. */
export async function clockOut(
  userId: string,
  orgTimezone: string,
  profile?: Profile | null,
  currentSession?: SessionRow | null,
  wizard?: ClockOutWizardResult
): Promise<ClockInResult> {
  const now = new Date().toISOString();
  await closeOpenLogs(userId, now, orgTimezone);

  const body: Record<string, unknown> = {
    user_id: userId,
    clocked_in: false,
    clock_in_time: null,
    clock_out_time: now,
    active_task: null,
    updated_at: now,
  };
  if (wizard?.mood) body.mood = wizard.mood;
  if (wizard?.dayRating) body.day_rating = wizard.dayRating;
  if (wizard?.dayRatingNote.trim()) body.day_rating_note = wizard.dayRatingNote.trim();

  const rows = await query<SessionRow[]>("sessions", {
    method: "POST",
    filters: "on_conflict=user_id",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body,
  });

  // Mood history for reports/Team — same upsert web's performClockOut does.
  // Not fatal: the session row above is what clocks them out.
  if (wizard?.mood) {
    try {
      await query("mood_logs", {
        method: "POST",
        filters: "on_conflict=user_id,session_date",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: {
          user_id: userId,
          session_date: getCorrectSessionDate(currentSession, orgTimezone),
          mood: wizard.mood,
        },
      });
    } catch {
      // see above
    }
  }

  if (profile) {
    // Not fatal, same as web: it's a zero-duration marker, so losing it costs
    // no tracked time and must not strand someone on the clock.
    try {
      await query("time_logs", {
        method: "POST",
        body: {
          user_id: userId,
          username: profile.username,
          full_name: profile.full_name,
          department: profile.department,
          position: profile.position,
          task_name: "Clocked Out",
          category: "Clock Out",
          start_time: now,
          end_time: now,
          duration_ms: 0,
          billable: false,
          session_date: getCorrectSessionDate(currentSession, orgTimezone),
        },
      });
    } catch {
      // see above
    }
  }

  return { ok: true, session: rows[0] };
}

export interface AdHocTaskInput {
  task_name: string;
  category: string;
  account: string;
  project: string;
  client_name: string;
  /** Client Notes, typed before Start — saved on the NEW task's log. */
  client_memo: string;
}

/** What the "Close Current Task" wizard collects — status + memo go on the
 *  OLD task, same split web's dashboard startTask() makes between a
 *  wizard-driven close and the form's own Client Notes. */
export interface CloseOldTaskInput {
  status: "In Progress" | "Completed" | "On Hold";
  clientMemo: string;
  internalMemo: string;
}

export interface StartAdHocResult {
  ok: boolean;
  error?: string;
  session?: SessionRow;
}

/** Starts a free-form task from the Log an Activity tab — mirrors the
 *  dashboard's TaskEntryForm hourly submit path (startTask in
 *  dashboard/page.tsx), minus the fixed-pay billing and task-library lookups
 *  that stay web-only. Pass `closeOld` when something's already running (the
 *  "Close Current Task" wizard result); its status/memos save on the OLD
 *  task's log, while `input.client_memo` is the NEW task's own Client Notes.
 *  Omitting `closeOld` just closes whatever was open with no memo, same as
 *  pressing Start with nothing running. */
export async function startAdHocTask(
  userId: string,
  profile: Profile,
  currentSession: SessionRow | null,
  orgTimezone: string,
  input: AdHocTaskInput,
  closeOld?: CloseOldTaskInput
): Promise<StartAdHocResult> {
  const now = new Date().toISOString();
  const active = currentSession?.active_task;

  if (active?.logId) {
    const logId = Number(active.logId);
    const startMs = active.start_time ? new Date(active.start_time).getTime() : Date.now();
    const body: Record<string, unknown> = {
      end_time: now,
      duration_ms: Math.max(0, Date.now() - startMs),
    };
    if (closeOld) {
      body.progress = closeOld.status.toLowerCase().replace(/ /g, "_");
      if (closeOld.clientMemo.trim()) body.client_memo = closeOld.clientMemo.trim();
      if (closeOld.internalMemo.trim()) body.internal_memo = closeOld.internalMemo.trim();
    }
    await query("time_logs", { method: "PATCH", filters: `id=eq.${logId}`, body });
  }

  await closeOpenLogs(userId, now, orgTimezone);

  const sessionDate = getCorrectSessionDate(currentSession, orgTimezone);

  let log: { id: number };
  try {
    const rows = await query<{ id: number }[]>("time_logs", {
      method: "POST",
      body: {
        user_id: userId,
        username: profile.username,
        full_name: profile.full_name,
        department: profile.department,
        position: profile.position,
        task_name: input.task_name,
        category: input.category,
        project: input.project || null,
        account: input.account || null,
        client_name: input.client_name || null,
        client_memo: input.client_memo.trim() || null,
        start_time: now,
        billable: isBillableCategory(input.category),
        billing_type: "hourly",
        session_date: sessionDate,
      },
    });
    log = rows[0];
  } catch (err) {
    return {
      ok: false,
      error: isDuplicateActiveLogError(err)
        ? "You're already tracking something else somewhere (another device or the extension?). Refresh to see your current status."
        : `Couldn't start that: ${err instanceof Error ? err.message : "unknown error"}.`,
    };
  }

  const newActive: ActiveTask = {
    task_name: input.task_name,
    category: input.category,
    project: input.project || "",
    account: input.account || "",
    client_name: input.client_name || "",
    client_memo: input.client_memo.trim(),
    internal_memo: "",
    start_time: now,
    end_time: null,
    duration_ms: 0,
    logId: String(log.id),
    _startMs: Date.now(),
  };

  const rows = await query<SessionRow[]>("sessions", {
    method: "POST",
    filters: "on_conflict=user_id",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: {
      user_id: userId,
      clocked_in: true,
      clock_in_time: currentSession?.clock_in_time || now,
      active_task: newActive,
      session_date: sessionDate,
      updated_at: now,
    },
  });

  return { ok: true, session: rows[0] };
}

export interface QuickMessageMapping {
  task_name: string;
  category: string;
  account: string;
  project: string;
  client_name: string;
}

export interface HoldResult {
  ok: boolean;
  error?: string;
  session?: SessionRow;
  /** The task that was running before the hold, for App.tsx to hold onto and
   *  offer a "Resume" banner for — null if nothing billable was running
   *  (idle, or already on a Break/Pause, which this never holds). */
  heldTask?: ActiveTask | null;
}

/** Quick Pick's "Message for Guidance/Instructions" and "General Message"
 *  buttons — mirrors the dashboard's handleAutoHoldAndStartMessage: silently
 *  holds whatever's running (closes its log, flagged progress "on_hold" so
 *  it reads as interrupted rather than finished) and starts the message task
 *  in its place. No wizard — the whole point is an instant interruption. */
export async function startHoldAndMessage(
  userId: string,
  profile: Profile,
  currentSession: SessionRow | null,
  orgTimezone: string,
  mapping: QuickMessageMapping
): Promise<HoldResult> {
  const now = new Date().toISOString();
  const active = currentSession?.active_task;
  const holdable = active && !active.isBreak ? active : null;

  // Flag the running task's own log on_hold before the generic close below
  // (which only ever sets end_time/duration) touches it.
  if (holdable?.logId) {
    const logId = Number(holdable.logId);
    const startMs = holdable.start_time ? new Date(holdable.start_time).getTime() : Date.now();
    await query("time_logs", {
      method: "PATCH",
      filters: `id=eq.${logId}`,
      body: { end_time: now, duration_ms: Math.max(0, Date.now() - startMs), progress: "on_hold" },
    });
  }

  await closeOpenLogs(userId, now, orgTimezone);

  const sessionDate = getCorrectSessionDate(currentSession, orgTimezone);

  let log: { id: number };
  try {
    const rows = await query<{ id: number }[]>("time_logs", {
      method: "POST",
      body: {
        user_id: userId,
        username: profile.username,
        full_name: profile.full_name,
        department: profile.department,
        position: profile.position,
        task_name: mapping.task_name,
        category: mapping.category,
        project: mapping.project || null,
        account: mapping.account || null,
        client_name: mapping.client_name || null,
        start_time: now,
        billable: isBillableCategory(mapping.category),
        billing_type: "hourly",
        session_date: sessionDate,
      },
    });
    log = rows[0];
  } catch (err) {
    return {
      ok: false,
      error: isDuplicateActiveLogError(err)
        ? "You're already tracking something else somewhere (another device or the extension?). Refresh to see your current status."
        : `Couldn't start that: ${err instanceof Error ? err.message : "unknown error"}.`,
    };
  }

  const newActive: ActiveTask = {
    task_name: mapping.task_name,
    category: mapping.category,
    project: mapping.project || "",
    account: mapping.account || "",
    client_name: mapping.client_name || "",
    client_memo: "",
    internal_memo: "",
    start_time: now,
    end_time: null,
    duration_ms: 0,
    logId: String(log.id),
    _startMs: Date.now(),
  };

  const rows = await query<SessionRow[]>("sessions", {
    method: "POST",
    filters: "on_conflict=user_id",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: {
      user_id: userId,
      clocked_in: true,
      clock_in_time: currentSession?.clock_in_time || now,
      active_task: newActive,
      session_date: sessionDate,
      updated_at: now,
    },
  });

  return { ok: true, session: rows[0], heldTask: holdable };
}

/** Resumes a task startHoldAndMessage held — a fresh log built from the
 *  snapshot, same shape endPause's resume branch uses, no wizard. The
 *  on_hold log from the hold itself is left alone as the historical record
 *  of the interruption rather than reopened. */
export async function resumeHeldTask(
  userId: string,
  profile: Profile,
  heldTask: ActiveTask,
  currentSession: SessionRow | null,
  orgTimezone: string
): Promise<ClockInResult> {
  const now = new Date().toISOString();
  await closeOpenLogs(userId, now, orgTimezone);

  const sessionDate = getCorrectSessionDate(currentSession, orgTimezone);

  let log: { id: number };
  try {
    const rows = await query<{ id: number }[]>("time_logs", {
      method: "POST",
      body: {
        user_id: userId,
        username: profile.username,
        full_name: profile.full_name,
        department: profile.department,
        position: profile.position,
        task_name: heldTask.task_name,
        category: heldTask.category,
        project: heldTask.project || null,
        account: heldTask.account || null,
        client_name: heldTask.client_name || null,
        client_memo: heldTask.client_memo || null,
        internal_memo: heldTask.internal_memo || null,
        start_time: now,
        billable: isBillableCategory(heldTask.category),
        billing_type: "hourly",
        session_date: sessionDate,
      },
    });
    log = rows[0];
  } catch (err) {
    return {
      ok: false,
      error: isDuplicateActiveLogError(err)
        ? "You're already tracking something else somewhere (another device or the extension?). Refresh to see your current status."
        : `Couldn't resume: ${err instanceof Error ? err.message : "unknown error"}.`,
    };
  }

  const resumed: ActiveTask = {
    ...heldTask,
    start_time: now,
    end_time: null,
    duration_ms: 0,
    logId: String(log.id),
    _startMs: Date.now(),
  };

  const rows = await query<SessionRow[]>("sessions", {
    method: "POST",
    filters: "on_conflict=user_id",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: {
      user_id: userId,
      clocked_in: true,
      clock_in_time: currentSession?.clock_in_time || now,
      active_task: resumed,
      session_date: sessionDate,
      updated_at: now,
    },
  });

  return { ok: true, session: rows[0] };
}

export interface BreakResult {
  ok: boolean;
  error?: string;
  session?: SessionRow;
  /** The task that was active before the break — App.tsx holds onto this in
   *  local React state (same as the dashboard's preBreakTask) so endBreak
   *  can resume it with no prompt, per Toni's "just back on the same task
   *  automatically" call. There's no good place to stash it server-side that
   *  doesn't itself look like a second active task, so — same limitation the
   *  dashboard's own preBreakTask already has — it's lost if the app
   *  restarts mid-break. */
  resumeTask?: ActiveTask | null;
}

/** Starts a Break: closes whatever's running and logs an explicit unpaid
 *  "Break" row (billable: false) — the real close-and-reopen Break's own
 *  *dashboard* version does on web (handleStartBreak in
 *  src/app/(app)/dashboard/page.tsx), not a display-flag shortcut, so Break
 *  actually stops paid time rather than just flipping a flag nobody reads
 *  for billing. */
export async function startBreak(
  userId: string,
  profile: Profile,
  currentSession: SessionRow | null,
  orgTimezone: string
): Promise<BreakResult> {
  const now = new Date().toISOString();
  await closeOpenLogs(userId, now, orgTimezone);

  const sessionDate = getCorrectSessionDate(currentSession, orgTimezone);

  let log: { id: number };
  try {
    const rows = await query<{ id: number }[]>("time_logs", {
      method: "POST",
      body: {
        user_id: userId,
        username: profile.username,
        full_name: profile.full_name,
        department: profile.department,
        position: profile.position,
        task_name: "Break",
        category: "Break",
        account: "Virtual Concierge",
        client_name: "Toni Colina",
        start_time: now,
        billable: false,
        billing_type: "hourly",
        session_date: sessionDate,
      },
    });
    log = rows[0];
  } catch (err) {
    return {
      ok: false,
      error: isDuplicateActiveLogError(err)
        ? "You're already tracking something else somewhere (another device or the extension?). Refresh to see your current status."
        : `Couldn't start your break: ${err instanceof Error ? err.message : "unknown error"}.`,
    };
  }

  const breakTask: ActiveTask = {
    task_name: "Break",
    category: "Break",
    project: "",
    account: "",
    client_name: "",
    client_memo: "",
    internal_memo: "",
    start_time: now,
    end_time: null,
    duration_ms: 0,
    logId: String(log.id),
    _startMs: Date.now(),
    isBreak: true,
  };

  const rows = await query<SessionRow[]>("sessions", {
    method: "POST",
    filters: "on_conflict=user_id",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: {
      user_id: userId,
      clocked_in: true,
      clock_in_time: currentSession?.clock_in_time || now,
      active_task: breakTask,
      session_date: sessionDate,
      updated_at: now,
    },
  });

  // currentSession.active_task is the task that was running right before
  // this call closed it out — exactly what the caller needs to resume.
  return { ok: true, session: rows[0], resumeTask: currentSession?.active_task ?? null };
}

/** Resumes the task a prior startBreak call returned as `resumeTask` — a
 *  fresh time_log built from that snapshot's fields, same shape the
 *  dashboard's resumePreBreakTask uses on web. No wizard, no prompt: Toni's
 *  call was to land straight back on the same task. `resumeTask` null (nothing
 *  was running before the break, or the snapshot was lost on an app restart)
 *  lands back at idle-while-clocked-in instead. */
export async function endBreak(
  userId: string,
  profile: Profile,
  resumeTask: ActiveTask | null | undefined,
  currentSession: SessionRow | null,
  orgTimezone: string
): Promise<ClockInResult> {
  const now = new Date().toISOString();
  await closeOpenLogs(userId, now, orgTimezone);

  const sessionDate = getCorrectSessionDate(currentSession, orgTimezone);

  if (!resumeTask) {
    const rows = await query<SessionRow[]>("sessions", {
      method: "POST",
      filters: "on_conflict=user_id",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: { user_id: userId, clocked_in: true, active_task: null, session_date: sessionDate, updated_at: now },
    });
    return { ok: true, session: rows[0] };
  }

  let log: { id: number };
  try {
    const rows = await query<{ id: number }[]>("time_logs", {
      method: "POST",
      body: {
        user_id: userId,
        username: profile.username,
        full_name: profile.full_name,
        department: profile.department,
        position: profile.position,
        task_name: resumeTask.task_name,
        category: resumeTask.category,
        project: resumeTask.project || null,
        account: resumeTask.account || null,
        client_name: resumeTask.client_name || null,
        client_memo: resumeTask.client_memo || null,
        internal_memo: resumeTask.internal_memo || null,
        start_time: now,
        billable: isBillableCategory(resumeTask.category),
        billing_type: "hourly",
        session_date: sessionDate,
      },
    });
    log = rows[0];
  } catch (err) {
    return {
      ok: false,
      error: isDuplicateActiveLogError(err)
        ? "You're already tracking something else somewhere (another device or the extension?). Refresh to see your current status."
        : `Couldn't resume: ${err instanceof Error ? err.message : "unknown error"}.`,
    };
  }

  const resumed: ActiveTask = {
    ...resumeTask,
    start_time: now,
    end_time: null,
    duration_ms: 0,
    logId: String(log.id),
    _startMs: Date.now(),
    isBreak: false,
  };

  const rows = await query<SessionRow[]>("sessions", {
    method: "POST",
    filters: "on_conflict=user_id",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: {
      user_id: userId,
      clocked_in: true,
      clock_in_time: currentSession?.clock_in_time || now,
      active_task: resumed,
      session_date: sessionDate,
      updated_at: now,
    },
  });

  return { ok: true, session: rows[0] };
}
