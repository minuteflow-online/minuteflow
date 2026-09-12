import { useCallback, useEffect, useRef, useState } from "react";
import LoginScreen from "./components/LoginScreen";
import ClockPanel, { type ClockState } from "./components/ClockPanel";
import TasksPanel from "./components/TasksPanel";
import TodoPanel from "./components/TodoPanel";
import * as auth from "./lib/db";
import * as clock from "./lib/clock";
import { fetchAssignedTasks, reorderAssignedTasks, type VAAssignedTask } from "./lib/tasks";
import { startAssignedTask } from "./lib/startTask";
import { captureAndUploadScreenshot } from "./lib/screenshot";

const SESSION_POLL_MS = 15000;
const TASKS_POLL_MS = 30000;

function isOnBreak(activeTask: clock.ActiveTask | null): boolean {
  if (!activeTask) return false;
  return Boolean(activeTask.isBreak) || activeTask.category === "Personal";
}

export default function App() {
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<clock.Profile | null>(null);
  const [orgTimezone, setOrgTimezone] = useState("UTC");

  const [sessionRow, setSessionRow] = useState<clock.SessionRow | null>(null);
  const [actionPending, setActionPending] = useState(false);

  const [tasks, setTasks] = useState<VAAssignedTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<VAAssignedTask | null>(null);
  const [startingId, setStartingId] = useState<number | null>(null);

  const [captureStatus, setCaptureStatus] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  const userIdRef = useRef<string | null>(null);
  useEffect(() => {
    userIdRef.current = userId;
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
    const sessionTimer = setInterval(() => {
      clock.fetchSession(userId).then(setSessionRow).catch(() => {});
    }, SESSION_POLL_MS);
    const tasksTimer = setInterval(() => loadTasks(userId), TASKS_POLL_MS);
    return () => {
      clearInterval(sessionTimer);
      clearInterval(tasksTimer);
    };
  }, [userId, loadTasks]);

  // Tells the main process whether to warn before quitting — see
  // electron/main.js's close handler. Also clears the flag on sign-out
  // (userId null), so a signed-out app never warns on a stale clocked-in
  // state it can no longer act on.
  useEffect(() => {
    window.mfDesktop.setClockedIn(Boolean(userId && sessionRow?.clocked_in));
  }, [userId, sessionRow?.clocked_in]);

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
      const result = await clock.clockOut(userId);
      if (result.session) setSessionRow(result.session);
    } finally {
      setActionPending(false);
    }
  }, [userId, actionPending]);

  const handleStartBreak = useCallback(async () => {
    if (!userId || actionPending) return;
    setActionPending(true);
    try {
      await clock.startBreak(userId);
      const s = await clock.fetchSession(userId);
      setSessionRow(s);
    } finally {
      setActionPending(false);
    }
  }, [userId, actionPending]);

  const handleEndBreak = useCallback(async () => {
    if (!userId || actionPending) return;
    setActionPending(true);
    try {
      await clock.endBreak(userId);
      const s = await clock.fetchSession(userId);
      setSessionRow(s);
    } finally {
      setActionPending(false);
    }
  }, [userId, actionPending]);

  const handleStart = useCallback(
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

      {captureStatus && (
        <div className="px-5 pt-2 text-[11px] text-walnut shrink-0">{captureStatus}</div>
      )}

      {/* Body — matches the wireframe: left column timer+tasks, right column to-do+description */}
      <div className="flex flex-1 min-h-0 gap-4 p-4">
        <div className="flex w-[320px] shrink-0 flex-col gap-4 min-h-0">
          <ClockPanel
            state={clockState}
            clockInTime={sessionRow?.clock_in_time ?? null}
            actionPending={actionPending}
            onClockIn={handleClockIn}
            onClockOut={handleClockOut}
            onStartBreak={handleStartBreak}
            onEndBreak={handleEndBreak}
          />
          <TasksPanel
            tasks={tasks}
            loading={tasksLoading}
            selectedId={selectedTask?.id ?? null}
            onSelect={setSelectedTask}
            startingId={startingId}
            onStart={handleStart}
            onReorder={handleReorder}
          />
        </div>

        <div className="flex flex-1 min-h-0">
          <TodoPanel task={selectedTask} />
        </div>
      </div>
    </div>
  );
}
