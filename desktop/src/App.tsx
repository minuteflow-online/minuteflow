import { useCallback, useEffect, useRef, useState } from "react";
import LoginScreen from "./components/LoginScreen";
import ClockPanel, { type ClockState } from "./components/ClockPanel";
import TasksPanel from "./components/TasksPanel";
import TodoPanel from "./components/TodoPanel";
import MessageBoardPanel from "./components/MessageBoardPanel";
import NotificationBell from "./components/NotificationBell";
import SubmitWorkModal from "./components/SubmitWorkModal";
import * as auth from "./lib/db";
import * as clock from "./lib/clock";
import { fetchAssignedTasks, reorderAssignedTasks, setAssignedTaskStatus, todoLabel, type VAAssignedTask, type AssignedTaskStatus, type TaskTodo } from "./lib/tasks";
import { startAssignedTask } from "./lib/startTask";
import { captureAndUploadScreenshot } from "./lib/screenshot";
import { startAutoCapture } from "./lib/autoCapture";
import { fetchTeamRoster, fetchTeamTimeLogs, type TeamRosterMember, type TeamTimeLog } from "./lib/team";
import TeamPanel from "./components/TeamPanel";

// Desktop has no realtime channel (no supabase-js here), so this poll is the
// whole web -> desktop sync latency; 15s was noticeably laggy in testing. It's
// one single-row read per user.
const SESSION_POLL_MS = 5000;
const TASKS_POLL_MS = 30000;
const TEAM_POLL_MS = 30000;

function isOnBreak(activeTask: clock.ActiveTask | null): boolean {
  if (!activeTask) return false;
  return Boolean(activeTask.isBreak) || activeTask.category === "Personal";
}

function isPaused(activeTask: clock.ActiveTask | null): boolean {
  return Boolean(activeTask?.isPause);
}

export default function App() {
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<clock.Profile | null>(null);
  const [orgTimezone, setOrgTimezone] = useState("UTC");

  const [sessionRow, setSessionRow] = useState<clock.SessionRow | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [tasks, setTasks] = useState<VAAssignedTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<VAAssignedTask | null>(null);
  const [startingId, setStartingId] = useState<number | null>(null);
  const [playingTodoId, setPlayingTodoId] = useState<number | null>(null);
  const [submitTarget, setSubmitTarget] = useState<VAAssignedTask | null>(null);
  // The task that was active right before Pause — held in local state the
  // same way the dashboard's preBreakTask is, so Resume can land straight
  // back on it with no prompt (Toni's call). See clock.ts's startPause/
  // endPause for why this can't just live on the session row instead.
  const [pausedTask, setPausedTask] = useState<clock.ActiveTask | null>(null);

  const [captureStatus, setCaptureStatus] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [rightTab, setRightTab] = useState<"todo" | "messages" | "team">("todo");
  const [teamMembers, setTeamMembers] = useState<TeamRosterMember[]>([]);
  const [teamTimeLogs, setTeamTimeLogs] = useState<TeamTimeLog[]>([]);
  const [teamLoading, setTeamLoading] = useState(true);
  const [dmRequest, setDmRequest] = useState<{ senderId: string; nonce: number } | null>(null);
  const [launchAtStartup, setLaunchAtStartupState] = useState(false);

  const userIdRef = useRef<string | null>(null);
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  // Read by autoCapture's loop on every tick (see sessionRowRef effect below)
  // rather than closed over once — sessionRow updates far more often than
  // the 5-minute capture interval restarts, and a closure taken at effect-run
  // time would otherwise freeze on whatever task/break state happened to be
  // current when the VA signed in.
  const sessionRowRef = useRef<clock.SessionRow | null>(null);
  useEffect(() => {
    sessionRowRef.current = sessionRow;
  }, [sessionRow]);

  // Automatic screenshot every 5 minutes while clocked in — desktop's
  // equivalent of the Chrome extension's background capture loop (see
  // autoCapture.ts). Tied to userId alone (not sessionRow) so the interval
  // itself isn't torn down and recreated on every clock in/out/task switch —
  // each tick reads the live session state off the ref above instead.
  useEffect(() => {
    if (!userId) return;
    return startAutoCapture(() => {
      const row = sessionRowRef.current;
      if (!row?.clocked_in) return null;
      const task = row.active_task;
      return {
        userId,
        isOnBreak: isOnBreak(task) || isPaused(task),
        activeLogId: task?.logId ? Number(task.logId) : null,
      };
    });
  }, [userId]);

  const loadForUser = useCallback(async (uid: string) => {
    const [p, tz, s] = await Promise.all([
      clock.fetchProfile(uid),
      clock.fetchOrgTimezone(),
      clock.fetchSession(uid),
    ]);
    setProfile(p);
    setOrgTimezone(tz);
    setSessionRow(s);
  }, []);

  const loadTasks = useCallback(async (uid: string) => {
    setTasksLoading(true);
    try {
      const rows = await fetchAssignedTasks(uid);
      setTasks(rows);
      // Without this, a selected task's own object goes stale the moment a
      // poll refreshes `tasks` — same fix MessageBoardPanel's loadTopics
      // already uses for activeThread. Caught live: a brand-new task's
      // to-dos are added a moment after the task itself (TaskEditor posts
      // them one at a time after the create), so selecting it right away
      // could freeze on the zero-to-dos snapshot forever, even once the
      // to-dos existed server-side. `?? prev` leaves it alone when the
      // selected task isn't in this list for some other reason.
      setSelectedTask((prev) => (prev ? (rows.find((t) => t.id === prev.id) ?? prev) : prev));
    } catch {
      // Non-critical — leave the previous list showing rather than blank it.
    } finally {
      setTasksLoading(false);
    }
  }, []);

  // Initial auth check — restores a session saved from a previous run.
  useEffect(() => {
    (async () => {
      const session = await auth.ensureAuth();
      if (session) {
        setUserId(session.user.id);
        await Promise.all([loadForUser(session.user.id), loadTasks(session.user.id)]);
      }
      setCheckingAuth(false);
    })();
  }, [loadForUser, loadTasks]);

  // Poll session + tasks so a clock-in/task change made on the web app or the
  // extension shows up here too, same idea as the extension's own poll loop.
  useEffect(() => {
    if (!userId) return;
    // A failed poll used to be swallowed silently, leaving stale clock state on
    // screen with no hint anything was wrong; surface it, and clear on success.
    const pollSession = () => {
      clock
        .fetchSession(userId)
        .then((s) => {
          setSessionRow(s);
          setSyncError(null);
        })
        .catch((err) => {
          setSyncError(err instanceof Error ? err.message : "unknown error");
        });
    };
    const sessionTimer = setInterval(pollSession, SESSION_POLL_MS);
    const tasksTimer = setInterval(() => {
      loadTasks(userId);
    }, TASKS_POLL_MS);
    // Catch up right away when the window is brought back (it hides to tray,
    // where timers are slowed) instead of waiting out the next interval.
    const onFocus = () => pollSession();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(sessionTimer);
      clearInterval(tasksTimer);
      window.removeEventListener("focus", onFocus);
    };
  }, [userId, loadTasks]);

  const loadTeam = useCallback(async () => {
    setTeamLoading(true);
    try {
      const [members, logs] = await Promise.all([fetchTeamRoster(), fetchTeamTimeLogs()]);
      setTeamMembers(members);
      setTeamTimeLogs(logs);
    } catch {
      // Non-critical — leave the previous list showing rather than blank it.
    } finally {
      setTeamLoading(false);
    }
  }, []);

  // Team roster — admin-only (role !== "va"), same gate web's dashboard uses
  // for TeamSidebar. Separate from the initial auth-check Promise.all since
  // profile.role isn't known until loadForUser resolves and sets state; this
  // fires once role becomes available (and again if it ever changes without
  // a re-login).
  useEffect(() => {
    if (!userId || !profile?.role || profile.role === "va") return;
    loadTeam();
    const timer = setInterval(loadTeam, TEAM_POLL_MS);
    return () => clearInterval(timer);
  }, [userId, profile?.role, loadTeam]);

  // Tells the main process whether to warn before quitting — see
  // electron/main.js's close handler. Also clears the flag on sign-out
  // (userId null), so a signed-out app never warns on a stale clocked-in
  // state it can no longer act on.
  useEffect(() => {
    window.mfDesktop.setClockedIn(Boolean(userId && sessionRow?.clocked_in));
  }, [userId, sessionRow?.clocked_in]);

  // Reads the OS's actual "run at login" registration on mount, rather than
  // assuming — it can be flipped from outside the app (Startup tab, System
  // Settings), and this is a login-independent OS setting, not per-account.
  useEffect(() => {
    window.mfDesktop.getLaunchAtStartup().then(setLaunchAtStartupState).catch(() => {});
  }, []);

  const handleToggleLaunchAtStartup = useCallback(async (enabled: boolean) => {
    const actual = await window.mfDesktop.setLaunchAtStartup(enabled);
    setLaunchAtStartupState(actual);
  }, []);

  const handleLogin = useCallback(
    async (email: string, password: string) => {
      const session = await auth.signIn(email, password);
      setUserId(session.user.id);
      await Promise.all([loadForUser(session.user.id), loadTasks(session.user.id)]);
    },
    [loadForUser, loadTasks]
  );

  const handleLogout = useCallback(async () => {
    await auth.signOut();
    setUserId(null);
    setProfile(null);
    setSessionRow(null);
    setTasks([]);
    setSelectedTask(null);
    setTeamMembers([]);
    setTeamTimeLogs([]);
    setPausedTask(null);
  }, []);

  const handleClockIn = useCallback(async () => {
    if (!userId || !profile || actionPending) return;
    setActionPending(true);
    try {
      const result = await clock.clockIn(userId, profile, orgTimezone);
      if (!result.ok) {
        alert(result.error);
        return;
      }
      if (result.session) setSessionRow(result.session);
    } finally {
      setActionPending(false);
    }
  }, [userId, profile, orgTimezone, actionPending]);

  const handleClockOut = useCallback(async () => {
    if (!userId || actionPending) return;
    setActionPending(true);
    try {
      const result = await clock.clockOut(userId, orgTimezone, profile, sessionRow);
      if (result.session) setSessionRow(result.session);
      setPausedTask(null);
    } catch (err) {
      alert(`Couldn't clock you out: ${err instanceof Error ? err.message : "unknown error"}. You are still clocked in — try again.`);
    } finally {
      setActionPending(false);
    }
  }, [userId, profile, sessionRow, orgTimezone, actionPending]);

  // Break: same real close-and-reopen as Pause (unpaid Break log, previous
  // task snapshotted for End Break) — it used to only flip a display flag and
  // left the running task's log open and billable. Still no memo wizard.
  const handleStartBreak = useCallback(async () => {
    if (!userId || !profile || actionPending) return;
    setActionPending(true);
    try {
      const result = await clock.startPause(userId, profile, sessionRow, orgTimezone, "Break");
      if (!result.ok) {
        alert(result.error);
        return;
      }
      setPausedTask(result.resumeTask ?? null);
      if (result.session) setSessionRow(result.session);
    } catch (err) {
      alert(`Couldn't start your break: ${err instanceof Error ? err.message : "unknown error"}.`);
    } finally {
      setActionPending(false);
    }
  }, [userId, profile, sessionRow, orgTimezone, actionPending]);

  const handleEndBreak = useCallback(async () => {
    if (!userId || !profile || actionPending) return;
    setActionPending(true);
    try {
      const result = await clock.endPause(userId, profile, pausedTask, sessionRow, orgTimezone);
      if (!result.ok) {
        alert(result.error);
        return;
      }
      if (result.session) setSessionRow(result.session);
      setPausedTask(null);
    } catch (err) {
      alert(`Couldn't end your break: ${err instanceof Error ? err.message : "unknown error"}.`);
    } finally {
      setActionPending(false);
    }
  }, [userId, profile, pausedTask, sessionRow, orgTimezone, actionPending]);

  // Pause: unpaid, like Break — unlike Break above, this one actually closes
  // and reopens time_logs rather than just flipping a flag, since "unpaid"
  // has to be a real payroll outcome here, not just a display label. See
  // clock.ts's startPause for the full reasoning.
  const handlePause = useCallback(async () => {
    if (!userId || !profile || actionPending) return;
    setActionPending(true);
    try {
      const result = await clock.startPause(userId, profile, sessionRow, orgTimezone);
      if (!result.ok) {
        alert(result.error);
        return;
      }
      setPausedTask(result.resumeTask ?? null);
      if (result.session) setSessionRow(result.session);
    } catch (err) {
      alert(`Couldn't pause: ${err instanceof Error ? err.message : "unknown error"}.`);
    } finally {
      setActionPending(false);
    }
  }, [userId, profile, sessionRow, orgTimezone, actionPending]);

  // Resume: lands straight back on whatever was running before Pause, no
  // prompt — Toni's explicit call.
  const handleResume = useCallback(async () => {
    if (!userId || !profile || actionPending) return;
    setActionPending(true);
    try {
      const result = await clock.endPause(userId, profile, pausedTask, sessionRow, orgTimezone);
      if (!result.ok) {
        alert(result.error);
        return;
      }
      if (result.session) setSessionRow(result.session);
      setPausedTask(null);
    } catch (err) {
      alert(`Couldn't resume: ${err instanceof Error ? err.message : "unknown error"}.`);
    } finally {
      setActionPending(false);
    }
  }, [userId, profile, pausedTask, sessionRow, orgTimezone, actionPending]);

  const handleStart =useCallback(
    async (task: VAAssignedTask) => {
      if (!userId || !profile || startingId != null) return;
      setStartingId(task.id);
      try {
        const result = await startAssignedTask(task, userId, profile, sessionRow, orgTimezone);
        if (!result.ok) {
          alert(result.error);
          return;
        }
        if (result.session) setSessionRow(result.session);
        setSelectedTask(task);
        await loadTasks(userId);
      } finally {
        setStartingId(null);
      }
    },
    [userId, profile, sessionRow, orgTimezone, startingId, loadTasks]
  );

  // Play a specific to-do: mirrors the dashboard's handlePlayTodo. Always
  // closes whatever's open and starts a fresh log tagged with this to-do's
  // label (startAssignedTask's todoLabel param) — even if the same task is
  // already the active one, switching between to-dos still splits the time
  // into separate segments rather than silently merging them. No
  // task-switch wizard (same simplification as plain Start).
  const handlePlayTodo = useCallback(
    async (task: VAAssignedTask, todo: TaskTodo) => {
      if (!userId || !profile || playingTodoId != null) return;
      setPlayingTodoId(todo.id);
      try {
        const result = await startAssignedTask(task, userId, profile, sessionRow, orgTimezone, todoLabel(todo.sort_order));
        if (!result.ok) {
          alert(result.error);
          return;
        }
        if (result.session) setSessionRow(result.session);
        setSelectedTask(task);
        await loadTasks(userId);
      } finally {
        setPlayingTodoId(null);
      }
    },
    [userId, profile, sessionRow, orgTimezone, playingTodoId, loadTasks]
  );

  // Submit: mirrors AssignedTasksWidget's SubmitWorkModal wiring. The server
  // decides the resulting status (submitted, or auto-completed/approved for
  // logged categories / tasks that skip review) — the modal just reports it
  // back. No task-switch wizard here (same simplification as startTask.ts),
  // but if the submitted task is the one actively being clocked, its open log
  // still needs closing — otherwise time keeps ticking against a task
  // that's already turned in, the exact "submit to task" gap that wizard
  // exists to prevent on web.
  const handleSubmitted = useCallback(
    async (task: VAAssignedTask, status: AssignedTaskStatus) => {
      setSubmitTarget(null);
      await setAssignedTaskStatus({
        assignedTaskId: task.assigned_tasks.id,
        status,
        vaId: task.va_id,
      });
      if (userId && sessionRow?.active_task?.assignedTaskId === task.assigned_tasks.id) {
        await clock.closeOpenLogs(userId, new Date().toISOString(), orgTimezone);
        const s = await clock.fetchSession(userId);
        setSessionRow(s);
      }
      if (userId) await loadTasks(userId);
    },
    [userId, sessionRow, orgTimezone, loadTasks]
  );

  // Drag-to-reorder — mirrors AssignedTasksWidget's handleDrop/persistOrder.
  // App owns `tasks`, so the splice + optimistic update happens here; the
  // drag gesture itself (draggedId/dragOverId) is local UI state in
  // TasksPanel.
  const handleReorder = useCallback((source: VAAssignedTask, target: VAAssignedTask) => {
    setTasks((prev) => {
      const fromIndex = prev.findIndex((t) => t.id === source.id);
      const toIndex = prev.findIndex((t) => t.id === target.id);
      if (fromIndex === -1 || toIndex === -1) return prev;

      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);

      const orderedIds = next.filter((t) => t.va_id === userIdRef.current).map((t) => t.id);
      if (orderedIds.length > 0) void reorderAssignedTasks(orderedIds);

      return next;
    });
  }, []);

  // Clicking a DM notification (bell dropdown or the native toast) — switch
  // to Message Board and tell it which conversation to open. `nonce` so
  // clicking the same sender twice in a row still re-triggers the effect
  // that reads this in MessageBoardPanel.
  const handleOpenDm = useCallback((senderId: string) => {
    setRightTab("messages");
    setDmRequest({ senderId, nonce: Date.now() });
  }, []);

  const activeLogId = sessionRow?.active_task?.logId ? Number(sessionRow.active_task.logId) : null;

  const handleCapture = useCallback(async () => {
    if (!userId || !activeLogId || capturing) return;
    setCapturing(true);
    setCaptureStatus(null);
    try {
      const result = await captureAndUploadScreenshot({ userId, logId: activeLogId, screenshotType: "manual" });
      setCaptureStatus(result.ok ? "Captured — sent to Drive." : result.error || "Capture failed.");
    } finally {
      setCapturing(false);
      setTimeout(() => setCaptureStatus(null), 4000);
    }
  }, [userId, activeLogId, capturing]);

  if (checkingAuth) {
    return (
      <div className="flex h-full items-center justify-center bg-cream">
        <p className="text-sm text-stone">Loading…</p>
      </div>
    );
  }

  if (!userId) {
    return <LoginScreen onSubmit={handleLogin} />;
  }

  const clockState: ClockState = !sessionRow?.clocked_in
    ? "idle"
    : isPaused(sessionRow.active_task)
      ? "paused"
      : isOnBreak(sessionRow.active_task)
        ? "on-break"
        : "clocked-in";

  return (
    <div className="flex h-full flex-col bg-cream">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-sand bg-white px-5 py-3 shrink-0">
        <div>
          <p className="text-sm font-bold text-espresso">MinuteFlow</p>
          <p className="text-[11px] text-stone">{profile?.full_name || "—"}</p>
        </div>
        <div className="flex items-center gap-2">
          <label
            className="flex items-center gap-1 text-[10px] text-stone cursor-pointer select-none"
            title="Automatically open MinuteFlow when you log in to this computer"
          >
            <input
              type="checkbox"
              className="accent-sage"
              checked={launchAtStartup}
              onChange={(e) => void handleToggleLaunchAtStartup(e.target.checked)}
            />
            Launch at startup
          </label>
          <NotificationBell userId={userId} onOpenDm={handleOpenDm} />
          <button
            onClick={handleCapture}
            disabled={!activeLogId || capturing}
            title={activeLogId ? "Capture your entire screen and send it to Drive" : "Clock in to capture"}
            className="flex items-center gap-1.5 text-[11px] font-semibold py-1.5 px-3 rounded-lg bg-sage text-white hover:bg-sage/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8" />
              <path d="M12 17v4" />
            </svg>
            {capturing ? "Capturing…" : "Capture Now"}
          </button>
          <button
            onClick={handleLogout}
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors cursor-pointer"
          >
            Sign Out
          </button>
        </div>
      </div>

      {syncError && (
        <div className="px-5 py-1.5 text-[11px] text-terracotta bg-terracotta-soft shrink-0">
          Can&apos;t reach MinuteFlow right now ({syncError}). What you see may be out of date — retrying automatically.
        </div>
      )}

      {captureStatus && (
        <div className="px-5 pt-2 text-[11px] text-walnut shrink-0">{captureStatus}</div>
      )}

      {/* Body — matches the wireframe: left column timer+tasks, right column to-do+description.
          Left column scales with the window instead of a fixed 450px: ~45%
          of the available width, floored at 360px (the main.js minWidth of
          810px floors out there too) and capped at 500px so a maximized
          window doesn't stretch the clock/task list wider than they need —
          the freed-up width goes to the right panel instead. */}
      <div className="flex flex-1 min-h-0 gap-4 p-4">
        <div className="flex w-[45%] min-w-[360px] max-w-[500px] shrink-0 flex-col gap-4 min-h-0">
          <ClockPanel
            state={clockState}
            clockInTime={sessionRow?.clock_in_time ?? null}
            awaySince={sessionRow?.active_task?.start_time ?? null}
            actionPending={actionPending}
            onClockIn={handleClockIn}
            onClockOut={handleClockOut}
            onStartBreak={handleStartBreak}
            onEndBreak={handleEndBreak}
            onPause={handlePause}
            onResume={handleResume}
          />
          <TasksPanel
            tasks={tasks}
            loading={tasksLoading}
            selectedId={selectedTask?.id ?? null}
            onSelect={setSelectedTask}
            startingId={startingId}
            onStart={handleStart}
            onSubmit={setSubmitTarget}
            onReorder={handleReorder}
          />
        </div>

        <div className="flex flex-1 min-h-0 flex-col gap-2">
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setRightTab("todo")}
              className={`rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors cursor-pointer ${
                rightTab === "todo"
                  ? "bg-terracotta-soft text-terracotta"
                  : "text-bark hover:bg-parchment hover:text-espresso"
              }`}
            >
              To-Do
            </button>
            <button
              onClick={() => setRightTab("messages")}
              className={`rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors cursor-pointer ${
                rightTab === "messages"
                  ? "bg-terracotta-soft text-terracotta"
                  : "text-bark hover:bg-parchment hover:text-espresso"
              }`}
            >
              Message Board
            </button>
            {profile?.role && profile.role !== "va" && (
              <button
                onClick={() => setRightTab("team")}
                className={`rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors cursor-pointer ${
                  rightTab === "team"
                    ? "bg-terracotta-soft text-terracotta"
                    : "text-bark hover:bg-parchment hover:text-espresso"
                }`}
              >
                Team
              </button>
            )}
          </div>
          {rightTab === "todo" ? (
            <TodoPanel
              task={selectedTask}
              onTodosChanged={() => {
                if (userId) loadTasks(userId);
              }}
              userId={userId}
              activeAssignedTaskId={sessionRow?.active_task?.assignedTaskId ?? null}
              activeTodoLabel={sessionRow?.active_task?.todoLabel ?? null}
              playingTodoId={playingTodoId}
              onPlayTodo={handlePlayTodo}
            />
          ) : rightTab === "messages" ? (
            <MessageBoardPanel userId={userId} openDmRequest={dmRequest} />
          ) : (
            <TeamPanel members={teamMembers} timeLogs={teamTimeLogs} loading={teamLoading} />
          )}
        </div>
      </div>

      {submitTarget && (
        <SubmitWorkModal
          taskId={submitTarget.assigned_tasks.id}
          taskName={submitTarget.assigned_tasks.task_name}
          instructions={submitTarget.assigned_tasks.instructions}
          reviewRequired={submitTarget.assigned_tasks.review_required}
          onClose={() => setSubmitTarget(null)}
          onSubmitted={(status) => void handleSubmitted(submitTarget, status)}
        />
      )}
    </div>
  );
}
