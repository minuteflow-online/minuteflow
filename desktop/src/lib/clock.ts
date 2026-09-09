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

export interface Profile {
  id: string;
  username: string;
  full_name: string;
  department: string | null;
  position: string | null;
  clock_in_disabled: boolean;
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

/** Mirrors dashboard's cappedCloseTime: overnight/stale logs close at end-of-day
 *  of their start date rather than billing the whole dead gap up to now. */
function cappedCloseTime(startTime: string | null, now: string): { endTime: string; durationMs: number } {
  const startMs = startTime ? new Date(startTime).getTime() : new Date(now).getTime();
  const sameDay = startTime && new Date(startTime).toDateString() === new Date(now).toDateString();
  let endTime: string;
  if (!sameDay && startTime) {
    const endOfDay = new Date(startTime);
    endOfDay.setHours(23, 59, 59, 999);
    endTime = endOfDay.toISOString();
  } else {
    endTime = now;
  }
  return { endTime, durationMs: Math.max(0, new Date(endTime).getTime() - startMs) };
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const rows = await query<Profile[]>("profiles", {
    filters: `id=eq.${userId}&select=id,username,full_name,department,position,clock_in_disabled`,
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
 *  end-of-day for stale/overnight ones. Runs before every clock-in and
 *  clock-out, same as the web app — a stale open row otherwise blocks the
 *  next clock-in via the one-active-log unique index. */
export async function closeOpenLogs(userId: string, now: string, excludeLogId?: number): Promise<void> {
  let filters = `user_id=eq.${userId}&end_time=is.null&category=neq.${encodeURIComponent("Clock Out")}&select=id,start_time`;
  if (excludeLogId !== undefined) filters += `&id=neq.${excludeLogId}`;

  const openLogs = await query<{ id: number; start_time: string }[]>("time_logs", { filters });
  for (const log of openLogs) {
    const { endTime, durationMs } = cappedCloseTime(log.start_time, now);
    await query("time_logs", {
      method: "PATCH",
      filters: `id=eq.${log.id}`,
      body: { end_time: endTime, duration_ms: durationMs },
    });
  }
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
  await closeOpenLogs(userId, now);

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

/** Mirrors performClockOut(): closes any orphaned open logs (including a
 *  still-open break), then marks the session clocked out. */
export async function clockOut(userId: string): Promise<ClockInResult> {
  const now = new Date().toISOString();
  await closeOpenLogs(userId, now);

  const rows = await query<SessionRow[]>("sessions", {
    method: "POST",
    filters: "on_conflict=user_id",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: {
      user_id: userId,
      clocked_in: false,
      clock_out_time: now,
      active_task: null,
      updated_at: now,
    },
  });

  return { ok: true, session: rows[0] };
}

/** Simple break toggle — the same shape SessionContext's default (non-dashboard)
 *  startBreak/endBreak use. Does not run the dashboard's full task-switch wizard
 *  (memo collection for the paused task); that's still web/extension-only. */
export async function startBreak(userId: string): Promise<void> {
  const now = new Date().toISOString();
  await query("sessions", {
    method: "PATCH",
    filters: `user_id=eq.${userId}`,
    body: { active_task: { isBreak: true, start_time: now }, updated_at: now },
  });
}

export async function endBreak(userId: string): Promise<void> {
  const now = new Date().toISOString();
  await query("sessions", {
    method: "PATCH",
    filters: `user_id=eq.${userId}`,
    body: { active_task: null, updated_at: now },
  });
}
