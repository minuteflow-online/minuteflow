"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import SessionBanner, { type SessionState } from "@/components/SessionBanner";
import ActiveTaskBar from "@/components/ActiveTaskBar";
import TaskEntryForm, { type TaskFormData } from "@/components/TaskEntryForm";
import TeamSidebar from "@/components/TeamSidebar";
import ActivityLog from "@/components/ActivityLog";
import LiveSessionPrompt from "@/components/LiveSessionPrompt";
import ProjectSidebar from "@/components/ProjectSidebar";
import DailyTaskPlanner from "@/components/DailyTaskPlanner";
import { useScreenCapture } from "@/hooks/useScreenCapture";
import { getTodayBoundsInTimezone } from "@/lib/utils";
import type {
  Profile,
  Session,
  ActiveTask,
  TimeLog,
  TaskScreenshot,
  UserRole,
  Message,
  PlannedTask,
} from "@/types/database";

// ─── Helpers ───────────────────────────────────────────────

function getGreeting(timezone?: string): string {
  const now = new Date();
  const hourStr = now.toLocaleTimeString("en-US", {
    timeZone: timezone || "America/New_York",
    hour: "numeric",
    hour12: false,
  });
  const h = parseInt(hourStr, 10);
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function formatDateLong(timezone?: string): string {
  return new Date().toLocaleDateString("en-US", {
    timeZone: timezone || "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatHoursMinutes(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  return `${minutes}m`;
}

function secondsSince(isoDate: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000));
}

// ─── Page Component ────────────────────────────────────────

export default function DashboardPage() {
  const supabase = createClient();
  // Auth & profile
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  // Session state
  const [session, setSession] = useState<Session | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [sessionElapsed, setSessionElapsed] = useState(0);
  const [breakElapsed, setBreakElapsed] = useState(0);
  const [breakStartTime, setBreakStartTime] = useState<string | null>(null);
  const [preBreakTask, setPreBreakTask] = useState<ActiveTask | null>(null);

  // Active task
  const [activeTask, setActiveTask] = useState<ActiveTask | null>(null);
  const [taskElapsed, setTaskElapsed] = useState(0);

  // Team & logs
  const [teamMembers, setTeamMembers] = useState<
    { profile: Profile; session: Session | null }[]
  >([]);
  const [timeLogs, setTimeLogs] = useState<TimeLog[]>([]);
  const [screenshots, setScreenshots] = useState<
    Record<number, TaskScreenshot[]>
  >({});

  // Role
  const [role, setRole] = useState<UserRole>("va");

  // Live session rejoin
  const [liveSessionData, setLiveSessionData] = useState<TimeLog | null>(null);
  const [showLivePrompt, setShowLivePrompt] = useState(false);
  const [pendingFormData, setPendingFormData] = useState<TaskFormData | null>(null);

  // Close-old-task wizard state
  const [closeOldStep, setCloseOldStep] = useState<"screenshot" | "details" | null>(null);
  const [closeOldScreenshotBlob, setCloseOldScreenshotBlob] = useState<Blob | null>(null);
  const [closeOldStatus, setCloseOldStatus] = useState("");
  const [closeOldMemoType, setCloseOldMemoType] = useState<"client" | "internal" | "">("");
  const [closeOldMemoText, setCloseOldMemoText] = useState("");
  const [closeOldClientMemo, setCloseOldClientMemo] = useState("");
  const [closeOldInternalMemo, setCloseOldInternalMemo] = useState("");
  const [closeOldCapturing, setCloseOldCapturing] = useState(false);

  // Close-task-before-clockout modal state
  const [showClockOutModal, setShowClockOutModal] = useState(false);
  const [clockOutTaskStatus, setClockOutTaskStatus] = useState("");
  const [clockOutClientMemo, setClockOutClientMemo] = useState("");
  const [clockOutInternalMemo, setClockOutInternalMemo] = useState("");
  const [showClockOutClientMemo, setShowClockOutClientMemo] = useState(false);
  const [showClockOutInternalMemo, setShowClockOutInternalMemo] = useState(false);
  const [clockingOut, setClockingOut] = useState(false);
  const [clockOutMood, setClockOutMood] = useState<'bad' | 'neutral' | 'good' | null>(null);

  // Org timezone
  const [orgTimezone, setOrgTimezone] = useState<string>("America/New_York");

  // In-app messages
  const [messages, setMessages] = useState<(Message & { senderName?: string })[]>([]);

  // Loading state
  const [loading, setLoading] = useState(true);

  // Timer refs
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Persistent Screen Capture ─────────────────────────────
  const { isActive: screenShareActive, requestStream, captureFrame, stopStream } = useScreenCapture();
  const captureTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const activeLogIdRef = useRef<number | null>(null);
  const captureWorkerRef = useRef<Worker | null>(null);
  const silentCaptureRef = useRef<((logId: number, screenshotType: 'start' | 'progress' | 'end' | 'manual') => Promise<boolean>) | null>(null);
  const isCapturingRef = useRef(false);
  const lastCaptureTimeRef = useRef(0);

  // ─── Auth ──────────────────────────────────────────────────

  useEffect(() => {
    async function getUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);
      }
    }
    getUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Initial Data Load ────────────────────────────────────

  useEffect(() => {
    if (!userId) return;

    async function loadData() {
      setLoading(true);

      const [profileRes, sessionRes, allProfilesRes, allSessionsRes, logsRes, ssRes, orgSettingsRes] =
        await Promise.all([
          supabase.from("profiles").select("*").eq("id", userId!).single(),
          supabase.from("sessions").select("*").eq("user_id", userId!).maybeSingle(),
          supabase.from("profiles").select("*"),
          supabase.from("sessions").select("*"),
          supabase
            .from("time_logs")
            .select("*")
            .order("start_time", { ascending: false })
            .limit(200),
          supabase.from("task_screenshots").select("*"),
          supabase.from("organization_settings").select("timezone").limit(1).single(),
        ]);

      // Set org timezone
      if (orgSettingsRes.data?.timezone) {
        setOrgTimezone(orgSettingsRes.data.timezone);
      }

      if (profileRes.data) {
        setProfile(profileRes.data);
        setRole(profileRes.data.role || "va");
      }

      // Process session
      if (sessionRes.data) {
        const s = sessionRes.data as Session;
        setSession(s);

        if (s.clocked_in) {
          if (s.active_task?.isBreak) {
            setSessionState("on-break");
            if (s.active_task.start_time) {
              setBreakStartTime(s.active_task.start_time);
              setBreakElapsed(secondsSince(s.active_task.start_time));
            }
          } else {
            setSessionState("clocked-in");
          }
          if (s.clock_in_time) {
            setSessionElapsed(secondsSince(s.clock_in_time));
          }
          if (s.active_task && !s.active_task.isBreak) {
            setActiveTask(s.active_task);
            if (s.active_task.start_time) {
              setTaskElapsed(secondsSince(s.active_task.start_time));
            }
          }
        } else {
          setSessionState("idle");
        }
      }

      // Team members (filter out inactive VAs)
      if (allProfilesRes.data && allSessionsRes.data) {
        const sessionsMap = new Map<string, Session>();
        (allSessionsRes.data as Session[]).forEach((s) =>
          sessionsMap.set(s.user_id, s)
        );
        const members = (allProfilesRes.data as Profile[])
          .filter((p) => p.is_active !== false)
          .map((p) => ({
            profile: p,
            session: sessionsMap.get(p.id) || null,
          }));
        setTeamMembers(members);
      }

      // Time logs
      if (logsRes.data) setTimeLogs(logsRes.data as TimeLog[]);

      // Screenshots grouped by log_id
      if (ssRes.data) {
        const grouped: Record<number, TaskScreenshot[]> = {};
        (ssRes.data as TaskScreenshot[]).forEach((ss) => {
          if (ss.log_id) {
            if (!grouped[ss.log_id]) grouped[ss.log_id] = [];
            grouped[ss.log_id].push(ss);
          }
        });
        setScreenshots(grouped);
      }

      setLoading(false);
    }

    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ─── Screenshot polling (refresh counts every 15s) ───────
  useEffect(() => {
    if (!userId || role === "va") return;
    const interval = setInterval(async () => {
      const { data } = await supabase.from("task_screenshots").select("*");
      if (data) {
        const grouped: Record<number, TaskScreenshot[]> = {};
        (data as TaskScreenshot[]).forEach((ss) => {
          if (ss.log_id) {
            if (!grouped[ss.log_id]) grouped[ss.log_id] = [];
            grouped[ss.log_id].push(ss);
          }
        });
        setScreenshots(grouped);
      }
    }, 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, role]);

  // ─── In-app message polling ──────────────────────────────
  useEffect(() => {
    if (!userId) return;

    async function fetchMessages() {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("target_user_id", userId!)
        .eq("read", false)
        .order("created_at", { ascending: false });

      if (data && data.length > 0) {
        // Fetch sender names
        const senderIds = [...new Set((data as Message[]).map((m) => m.sender_id))];
        const { data: senderProfiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", senderIds);
        const senderMap = new Map((senderProfiles || []).map((p: { id: string; full_name: string }) => [p.id, p.full_name]));

        setMessages(
          (data as Message[]).map((m) => ({
            ...m,
            senderName: senderMap.get(m.sender_id) || "Admin",
          }))
        );
      }
    }

    fetchMessages();
    const interval = setInterval(fetchMessages, 10000); // Poll every 10s

    // Also listen for realtime inserts
    const channel = supabase
      .channel("messages-for-user")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `target_user_id=eq.${userId}` },
        () => fetchMessages()
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const dismissMessage = useCallback(
    async (messageId: number) => {
      await supabase.from("messages").update({ read: true }).eq("id", messageId);
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    },
    [supabase]
  );

  // ─── Timers ───────────────────────────────────────────────

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);

    if (sessionState === "clocked-in" || sessionState === "on-break") {
      timerRef.current = setInterval(() => {
        if (session?.clock_in_time) {
          setSessionElapsed(secondsSince(session.clock_in_time));
        }
        if (sessionState === "on-break" && breakStartTime) {
          setBreakElapsed(secondsSince(breakStartTime));
        }
        if (activeTask?.start_time && sessionState === "clocked-in") {
          setTaskElapsed(secondsSince(activeTask.start_time));
        }
      }, 1000);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [sessionState, session?.clock_in_time, activeTask?.start_time, breakStartTime]);

  // ─── Session heartbeat (keeps updated_at fresh for stale detection) ───
  useEffect(() => {
    if (!userId || sessionState === "idle") return;
    const heartbeat = setInterval(async () => {
      await supabase
        .from("sessions")
        .update({ updated_at: new Date().toISOString() })
        .eq("user_id", userId);
    }, 60_000); // every 60 seconds
    return () => clearInterval(heartbeat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, sessionState]);

  // ─── Stop Task (defined early so clockOut can reference it) ─

  const stopCurrentTask = useCallback(async () => {
    if (!activeTask?.logId || !userId) return;
    const now = new Date().toISOString();
    const logId = parseInt(activeTask.logId, 10);
    const durationMs = taskElapsed * 1000;

    if (logId) {
      await supabase
        .from("time_logs")
        .update({ end_time: now, duration_ms: durationMs })
        .eq("id", logId);

      setTimeLogs((prev) =>
        prev.map((log) =>
          log.id === logId
            ? { ...log, end_time: now, duration_ms: durationMs }
            : log
        )
      );
    }

    await supabase.from("sessions").upsert(
      {
        user_id: userId,
        clocked_in: true,
        clock_in_time: session?.clock_in_time || now,
        active_task: null,
        updated_at: now,
      },
      { onConflict: "user_id" }
    );

    setActiveTask(null);
    setTaskElapsed(0);
    setSession((prev) => (prev ? { ...prev, active_task: null } : prev));
  }, [activeTask, taskElapsed, userId, supabase, session]);

  // ─── Actions ──────────────────────────────────────────────

  const clockIn = useCallback(async () => {
    if (!userId || !profile) return;
    const now = new Date().toISOString();

    // Create a "Sorting Tasks" time_log entry so clock-in registers in activity log
    const { data: sortingLog } = await supabase
      .from("time_logs")
      .insert({
        user_id: userId,
        username: profile.username,
        full_name: profile.full_name,
        department: profile.department,
        position: profile.position,
        task_name: "Clock In",
        category: "Sorting Tasks",
        account: "Virtual Concierge",
        client_name: "Toni Colina",
        start_time: now,
        billable: true,
      })
      .select()
      .single();

    const sortingTask: ActiveTask = {
      task_name: "Clock In",
      category: "Sorting Tasks",
      project: "",
      account: "Virtual Concierge",
      client_name: "Toni Colina",
      client_memo: "",
      internal_memo: "",
      start_time: now,
      end_time: null,
      duration_ms: 0,
      logId: sortingLog?.id?.toString() || "",
      _startMs: Date.now(),
    };

    const { error } = await supabase.from("sessions").upsert(
      {
        user_id: userId,
        clocked_in: true,
        clock_in_time: now,
        active_task: sortingTask,
        session_date: new Date().toISOString().split("T")[0],
        updated_at: now,
      },
      { onConflict: "user_id" }
    );

    if (!error) {
      setSession((prev) => ({
        ...(prev || {
          id: 0,
          user_id: userId,
          clock_out_time: null,
          updated_at: now,
        }),
        clocked_in: true,
        clock_in_time: now,
        active_task: sortingTask,
        session_date: new Date().toISOString().split("T")[0],
      } as Session));
      setSessionState("clocked-in");
      setSessionElapsed(0);
      setActiveTask(sortingTask);
      setTaskElapsed(0);
      if (sortingLog) {
        setTimeLogs((prev) => [sortingLog as TimeLog, ...prev]);
      }
    }
  }, [userId, profile, supabase]);

  const performClockOut = useCallback(async (mood?: 'bad' | 'neutral' | 'good' | null) => {
    if (!userId) return;
    const now = new Date().toISOString();

    const upsertPayload: Record<string, unknown> = {
      user_id: userId,
      clocked_in: false,
      clock_in_time: null,
      clock_out_time: now,
      active_task: null,
      updated_at: now,
    };
    if (mood) {
      upsertPayload.mood = mood;
    }

    const { error } = await supabase.from("sessions").upsert(
      upsertPayload,
      { onConflict: "user_id" }
    );

    if (!error) {
      // Persist mood to mood_logs for historical tracking
      if (mood) {
        const moodDate = session?.session_date || new Date().toISOString().split("T")[0];
        await supabase.from("mood_logs").upsert(
          { user_id: userId, session_date: moodDate, mood },
          { onConflict: "user_id,session_date" }
        );
      }
      // Create a "Clocked Out" time_log entry to mark the boundary
      if (profile) {
        const { data: clockOutLog } = await supabase
          .from("time_logs")
          .insert({
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
          })
          .select()
          .single();

        if (clockOutLog) {
          setTimeLogs((prev) => [clockOutLog as TimeLog, ...prev]);
        }
      }

      // --- Billable Break Allowance: recalculate at clock-out ---
      const clockInTime = session?.clock_in_time;
      const sessionDate = session?.session_date || new Date().toISOString().split("T")[0];

      if (clockInTime) {
        const shiftMs = new Date(now).getTime() - new Date(clockInTime).getTime();

        // Break tier table (shift hours → allowed break ms)
        const shiftHours = shiftMs / (1000 * 60 * 60);
        let allowedBreakMs = 0;
        if (shiftHours >= 8) allowedBreakMs = 45 * 60 * 1000;
        else if (shiftHours >= 7) allowedBreakMs = 30 * 60 * 1000;
        else if (shiftHours >= 6) allowedBreakMs = 25 * 60 * 1000;
        else if (shiftHours >= 5) allowedBreakMs = 20 * 60 * 1000;
        else if (shiftHours >= 4) allowedBreakMs = 15 * 60 * 1000;
        // Under 4 hours = no billable break allowed

        // Fetch all completed break logs for this session
        const { data: breakLogs } = await supabase
          .from("time_logs")
          .select("id, duration_ms, start_time")
          .eq("user_id", userId)
          .eq("category", "Break")
          .gte("start_time", clockInTime)
          .lte("start_time", now)
          .not("end_time", "is", null)
          .order("start_time", { ascending: true });

        if (breakLogs && breakLogs.length > 0) {
          const totalBreakMs = breakLogs.reduce((sum, b) => sum + (b.duration_ms || 0), 0);
          const excessMs = Math.max(0, totalBreakMs - allowedBreakMs);

          if (excessMs > 0) {
            // Determine which break logs to flip to non-billable (latest first, consuming excess)
            const sortedDesc = [...breakLogs].sort(
              (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
            );
            let remaining = excessMs;
            const idsToFlip: number[] = [];

            for (const bl of sortedDesc) {
              if (remaining <= 0) break;
              idsToFlip.push(bl.id);
              remaining -= (bl.duration_ms || 0);
            }

            // Flip excess break logs to non-billable
            if (idsToFlip.length > 0) {
              await supabase
                .from("time_logs")
                .update({ billable: false })
                .in("id", idsToFlip);
            }

            // Create a break_correction_request for admin review
            await supabase
              .from("break_correction_requests")
              .insert({
                user_id: userId,
                session_date: sessionDate,
                clock_in_time: clockInTime,
                clock_out_time: now,
                shift_duration_ms: shiftMs,
                total_break_ms: totalBreakMs,
                allowed_break_ms: allowedBreakMs,
                excess_break_ms: excessMs,
                break_log_ids: breakLogs.map((b) => b.id),
                status: "pending",
              });
          }
        }
      }
      // --- End Billable Break Allowance ---

      setSession((prev) =>
        prev
          ? {
              ...prev,
              clocked_in: false,
              clock_in_time: null,
              active_task: null,
              clock_out_time: now,
              mood: mood || null,
            }
          : prev
      );
      setSessionState("idle");
      setSessionElapsed(0);
      setActiveTask(null);
      setTaskElapsed(0);
      setBreakElapsed(0);
      setBreakStartTime(null);

      // Stop screen sharing and clear capture timers on clock out
      captureTimersRef.current.forEach((t) => clearTimeout(t));
      captureTimersRef.current = [];
      if (captureWorkerRef.current) {
        captureWorkerRef.current.postMessage({ type: "stop" });
      }
      stopStream();
      activeLogIdRef.current = null;
    }
  }, [userId, profile, supabase, stopStream]);

  const clockOut = useCallback(async () => {
    if (!userId) return;

    // If there's an active task, show the close-task modal instead of clocking out directly
    if (activeTask) {
      setShowClockOutModal(true);
      return;
    }

    // No active task — clock out immediately
    await performClockOut();
  }, [userId, activeTask, performClockOut]);

  const handleCloseTaskAndClockOut = useCallback(async () => {
    if (!clockOutTaskStatus || (!clockOutClientMemo.trim() && !clockOutInternalMemo.trim())) return;
    if (!activeTask?.logId || !userId) return;
    setClockingOut(true);

    try {
      const now = new Date().toISOString();
      const logId = parseInt(activeTask.logId, 10);
      const durationMs = taskElapsed * 1000;

      // Close the active task with status and memo
      if (logId) {
        const updatePayload: Record<string, unknown> = {
          end_time: now,
          duration_ms: durationMs,
        };
        if (clockOutClientMemo.trim()) {
          updatePayload.client_memo = clockOutClientMemo.trim();
        }
        if (clockOutInternalMemo.trim()) {
          updatePayload.internal_memo = clockOutInternalMemo.trim();
        }

        await supabase.from("time_logs").update(updatePayload).eq("id", logId);

        setTimeLogs((prev) =>
          prev.map((log) =>
            log.id === logId
              ? { ...log, ...updatePayload, end_time: now, duration_ms: durationMs } as TimeLog
              : log
          )
        );
      }

      // Capture mood before resetting
      const savedMood = clockOutMood;

      // Reset modal state
      setShowClockOutModal(false);
      setClockOutTaskStatus("");
      setClockOutClientMemo("");
      setClockOutInternalMemo("");
      setShowClockOutClientMemo(false);
      setShowClockOutInternalMemo(false);
      setClockingOut(false);
      setClockOutMood(null);

      // Clear active task locally before clocking out
      setActiveTask(null);
      setTaskElapsed(0);

      // Now clock out with mood
      await performClockOut(savedMood);
    } catch (err) {
      console.error("Error closing task before clock out:", err);
      setClockingOut(false);
    }
  }, [activeTask, taskElapsed, userId, supabase, clockOutTaskStatus, clockOutClientMemo, clockOutInternalMemo, clockOutMood, performClockOut]);

  const cancelClockOutModal = useCallback(() => {
    setShowClockOutModal(false);
    setClockOutTaskStatus("");
    setClockOutClientMemo("");
    setClockOutInternalMemo("");
    setShowClockOutClientMemo(false);
    setShowClockOutInternalMemo(false);
    setClockingOut(false);
    setClockOutMood(null);
  }, []);

  // Track if we're triggering the wizard for a break (vs switching tasks)
  const [breakPending, setBreakPending] = useState(false);

  // Show pre-break wizard if there's an active task, otherwise start break directly
  const startBreak = useCallback(async () => {
    if (!userId || !profile) return;

    if (activeTask && !activeTask.isBreak) {
      // Use the existing close-task wizard to collect status + memos
      setBreakPending(true);
      const taskAsLog: TimeLog = {
        id: parseInt(activeTask.logId, 10) || 0,
        user_id: userId,
        username: profile.username,
        full_name: profile.full_name,
        department: profile.department || null,
        position: profile.position || null,
        task_name: activeTask.task_name,
        category: activeTask.category,
        project: activeTask.project || null,
        account: activeTask.account || null,
        client_name: activeTask.client_name || null,
        start_time: activeTask.start_time,
        end_time: null,
        duration_ms: taskElapsed * 1000,
        billable: activeTask.category !== "Personal",
        client_memo: activeTask.client_memo || null,
        internal_memo: activeTask.internal_memo || null,
        is_manual: false,
        form_fill_ms: 0,
        progress: null,
        created_at: activeTask.start_time,
      };
      setLiveSessionData(taskAsLog);
      setCloseOldStep("details");
      return;
    }

    // No active task, start break directly
    await doStartBreak();
  }, [userId, profile, activeTask, taskElapsed]);

  // Actually start the break (called after wizard or directly)
  const doStartBreak = useCallback(async () => {
    if (!userId || !profile) return;
    const now = new Date().toISOString();

    // Close any orphaned break logs first
    await supabase
      .from("time_logs")
      .update({ end_time: now, duration_ms: 0 })
      .eq("user_id", userId)
      .eq("category", "Break")
      .is("end_time", null);

    // Save current task info so we can resume after break
    if (activeTask && !activeTask.isBreak) {
      setPreBreakTask({ ...activeTask });
      await stopCurrentTask();
    } else {
      setPreBreakTask(null);
    }

    // Create a break time log
    const { data: logData } = await supabase
      .from("time_logs")
      .insert({
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
        billable: true,
      })
      .select()
      .single();

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
      logId: logData?.id?.toString() || "",
      _startMs: Date.now(),
      isBreak: true,
    };

    await supabase.from("sessions").upsert(
      {
        user_id: userId,
        clocked_in: true,
        clock_in_time: session?.clock_in_time || now,
        active_task: breakTask,
        updated_at: now,
      },
      { onConflict: "user_id" }
    );

    setActiveTask(null);
    setSessionState("on-break");
    setBreakStartTime(now);
    setBreakElapsed(0);

    // Update local session state so endBreak can find the break logId
    setSession((prev) => prev ? { ...prev, active_task: breakTask } : prev);

    if (logData) {
      setTimeLogs((prev) => [logData as TimeLog, ...prev]);
    }
  }, [userId, profile, supabase, session, activeTask, stopCurrentTask]);



  // Post-break prompt state
  const [showPostBreakPrompt, setShowPostBreakPrompt] = useState(false);

  const endBreak = useCallback(async () => {
    if (!userId) return;
    const now = new Date().toISOString();

    // Update the break log
    if (session?.active_task?.logId) {
      const logId = parseInt(session.active_task.logId, 10);
      if (logId) {
        const breakDurationMs = breakElapsed * 1000;
        await supabase
          .from("time_logs")
          .update({ end_time: now, duration_ms: breakDurationMs })
          .eq("id", logId);

        setTimeLogs((prev) =>
          prev.map((log) =>
            log.id === logId
              ? { ...log, end_time: now, duration_ms: breakDurationMs }
              : log
          )
        );
      }
    }

    // Close any other orphaned break logs for this user
    await supabase
      .from("time_logs")
      .update({ end_time: now, duration_ms: 0 })
      .eq("user_id", userId)
      .eq("category", "Break")
      .is("end_time", null);

    await supabase.from("sessions").upsert(
      {
        user_id: userId,
        clocked_in: true,
        clock_in_time: session?.clock_in_time || now,
        active_task: null,
        updated_at: now,
      },
      { onConflict: "user_id" }
    );

    setSessionState("clocked-in");
    setBreakElapsed(0);
    setBreakStartTime(null);
    setActiveTask(null);
    setTaskElapsed(0);
    setSession((prev) => (prev ? { ...prev, active_task: null } : prev));

    // If there was a task before break, show resume/new prompt
    if (preBreakTask) {
      setShowPostBreakPrompt(true);
    }
  }, [userId, supabase, session, breakElapsed, preBreakTask]);

  // Resume the pre-break task
  const resumePreBreakTask = useCallback(async () => {
    if (!preBreakTask || !userId || !profile) return;
    const now = new Date().toISOString();

    const isBillable = preBreakTask.category !== "Personal";

    const { data: logData } = await supabase
      .from("time_logs")
      .insert({
        user_id: userId,
        username: profile.username,
        full_name: profile.full_name,
        department: profile.department,
        position: profile.position,
        task_name: preBreakTask.task_name,
        category: preBreakTask.category,
        project: preBreakTask.project || null,
        account: preBreakTask.account || null,
        client_name: preBreakTask.client_name || null,
        start_time: now,
        billable: isBillable,
      })
      .select()
      .single();

    const resumedTask: ActiveTask = {
      ...preBreakTask,
      start_time: now,
      end_time: null,
      duration_ms: 0,
      logId: logData?.id?.toString() || "",
      _startMs: Date.now(),
      isBreak: false,
    };

    await supabase.from("sessions").upsert(
      {
        user_id: userId,
        clocked_in: true,
        clock_in_time: session?.clock_in_time || now,
        active_task: resumedTask,
        updated_at: now,
      },
      { onConflict: "user_id" }
    );

    setActiveTask(resumedTask);
    setTaskElapsed(0);
    if (logData) {
      setTimeLogs((prev) => [logData as TimeLog, ...prev]);
    }

    setShowPostBreakPrompt(false);
    setPreBreakTask(null);
  }, [preBreakTask, userId, profile, supabase, session]);

  // Resume an on-hold task (Play button from Activity Log)
  const resumeOnHoldTask = useCallback(async (log: TimeLog) => {
    if (!userId || !profile) return;
    const now = new Date().toISOString();

    // Stop current task if any
    if (activeTask && !activeTask.isBreak) {
      await stopCurrentTask();
    }

    const isBillable = log.category !== "Personal";

    const { data: logData } = await supabase
      .from("time_logs")
      .insert({
        user_id: userId,
        username: profile.username,
        full_name: profile.full_name,
        department: profile.department,
        position: profile.position,
        task_name: log.task_name,
        category: log.category,
        project: log.project || null,
        account: log.account || null,
        client_name: log.client_name || null,
        start_time: now,
        billable: isBillable,
      })
      .select()
      .single();

    const resumedTask: ActiveTask = {
      task_name: log.task_name,
      category: log.category,
      project: log.project || "",
      account: log.account || "",
      client_name: log.client_name || "",
      client_memo: "",
      internal_memo: "",
      start_time: now,
      end_time: null,
      duration_ms: 0,
      logId: logData?.id?.toString() || "",
      _startMs: Date.now(),
      isBreak: false,
    };

    await supabase.from("sessions").upsert(
      {
        user_id: userId,
        clocked_in: true,
        clock_in_time: session?.clock_in_time || now,
        active_task: resumedTask,
        updated_at: now,
      },
      { onConflict: "user_id" }
    );

    setActiveTask(resumedTask);
    setTaskElapsed(0);
    if (logData) {
      setTimeLogs((prev) => [logData as TimeLog, ...prev]);
    }
  }, [userId, profile, supabase, session, activeTask, stopCurrentTask]);

  // Post-break memo step (when choosing "Start New Task")
  const [postBreakMemoStep, setPostBreakMemoStep] = useState(false);
  const [postBreakClientMemo, setPostBreakClientMemo] = useState("");
  const [postBreakInternalMemo, setPostBreakInternalMemo] = useState("");
  const [postBreakStatus, setPostBreakStatus] = useState("");

  // User chose "Start New Task" — show memo step first
  const showPostBreakMemos = useCallback(() => {
    setPostBreakMemoStep(true);
  }, []);

  // Save memos to the pre-break task, then dismiss to wizard
  const savePostBreakMemosAndDismiss = useCallback(async () => {
    if (preBreakTask?.logId) {
      const logId = parseInt(preBreakTask.logId, 10);
      const updatePayload: Record<string, unknown> = {};
      if (postBreakClientMemo.trim()) updatePayload.client_memo = postBreakClientMemo.trim();
      if (postBreakInternalMemo.trim()) updatePayload.internal_memo = postBreakInternalMemo.trim();
      if (Object.keys(updatePayload).length > 0) {
        await supabase.from("time_logs").update(updatePayload).eq("id", logId);
        setTimeLogs((prev) =>
          prev.map((log) =>
            log.id === logId ? { ...log, ...updatePayload } as TimeLog : log
          )
        );
      }
    }
    setShowPostBreakPrompt(false);
    setPostBreakMemoStep(false);
    setPostBreakClientMemo("");
    setPostBreakInternalMemo("");
    setPostBreakStatus("");
    setPreBreakTask(null);
  }, [preBreakTask, postBreakClientMemo, postBreakInternalMemo, supabase]);

  // Skip memos and go straight to wizard
  const skipPostBreakMemos = useCallback(() => {
    setShowPostBreakPrompt(false);
    setPostBreakMemoStep(false);
    setPostBreakClientMemo("");
    setPostBreakInternalMemo("");
    setPostBreakStatus("");
    setPreBreakTask(null);
  }, []);

  // ─── Screenshot utilities (must be before startTask) ──────

  /** Upload a blob to Supabase Storage and insert a task_screenshots record */
  const uploadScreenshot = useCallback(
    async (blob: Blob, logId: number, screenshotType: 'start' | 'progress' | 'end' | 'manual') => {
      if (!userId) return;

      const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
      const storagePath = `${userId}/${filename}`;

      const { error: uploadError } = await supabase.storage
        .from("screenshots")
        .upload(storagePath, blob, { contentType: "image/png" });

      if (uploadError) {
        console.error("Upload failed:", uploadError);
        return;
      }

      const { data: ssData } = await supabase
        .from("task_screenshots")
        .insert({
          user_id: userId,
          log_id: logId,
          filename,
          storage_path: storagePath,
          screenshot_type: screenshotType,
        })
        .select()
        .single();

      if (ssData) {
        setScreenshots((prev) => ({
          ...prev,
          [logId]: [...(prev[logId] || []), ssData as TaskScreenshot],
        }));
      }
    },
    [userId, supabase]
  );

  /** Capture a frame silently from the persistent stream. Returns true if captured. */
  const silentCapture = useCallback(
    async (logId: number, screenshotType: 'start' | 'progress' | 'end' | 'manual'): Promise<boolean> => {
      // Guard: skip if a capture is already in progress
      if (isCapturingRef.current) return false;
      // Guard: enforce 45-second cooldown between captures (skip for 'end' and 'manual' — those are intentional)
      if (screenshotType !== 'end' && screenshotType !== 'manual') {
        const now = Date.now();
        if (now - lastCaptureTimeRef.current < 45_000) return false;
      }
      isCapturingRef.current = true;
      try {
        const blob = await captureFrame();
        if (!blob) return false;
        await uploadScreenshot(blob, logId, screenshotType);
        lastCaptureTimeRef.current = Date.now();
        return true;
      } finally {
        isCapturingRef.current = false;
      }
    },
    [captureFrame, uploadScreenshot]
  );

  /** Clear all scheduled auto-capture timers and stop worker */
  const clearCaptureTimers = useCallback(() => {
    // Clear fallback timers
    captureTimersRef.current.forEach((t) => clearTimeout(t));
    captureTimersRef.current = [];
    // Stop worker timers
    if (captureWorkerRef.current) {
      captureWorkerRef.current.postMessage({ type: "stop" });
    }
  }, []);

  // Keep silentCaptureRef in sync so the Worker listener can call it
  useEffect(() => {
    silentCaptureRef.current = silentCapture;
  }, [silentCapture]);

  // Initialize Web Worker for capture timers (not throttled in background tabs)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const worker = new Worker("/capture-worker.js");
      worker.onmessage = (e: MessageEvent) => {
        const { type, logId, screenshotType } = e.data;
        if (type === "capture" && silentCaptureRef.current) {
          silentCaptureRef.current(logId, screenshotType);
        }
      };
      worker.onerror = () => {
        // Worker failed to load — fallback timers will be used instead
        captureWorkerRef.current = null;
      };
      captureWorkerRef.current = worker;
    } catch {
      // Web Workers not supported — fallback timers will be used
      captureWorkerRef.current = null;
    }
    return () => {
      captureWorkerRef.current?.terminate();
      captureWorkerRef.current = null;
    };
  }, []);

  /** Schedule the auto-capture sequence using Web Worker (with setTimeout fallback) */
  const scheduleCaptureSequence = useCallback(
    (logId: number) => {
      clearCaptureTimers();
      activeLogIdRef.current = logId;

      // Use Web Worker if available (timers won't be throttled in background tabs)
      if (captureWorkerRef.current) {
        captureWorkerRef.current.postMessage({ type: "start", logId });
        return;
      }

      // ── Fallback: main-thread timers (throttled in background tabs) ──

      // Immediate start screenshot
      silentCapture(logId, "start");

      // 1 minute progress check
      const t1 = setTimeout(() => {
        if (activeLogIdRef.current === logId) {
          silentCapture(logId, "progress");
        }
      }, 60_000);

      // 3 minute progress check
      const t2 = setTimeout(() => {
        if (activeLogIdRef.current === logId) {
          silentCapture(logId, "progress");
        }
      }, 180_000);

      captureTimersRef.current = [t1, t2];

      // After 3 minutes, start random 3-8 minute intervals
      const scheduleRandom = (afterMs: number) => {
        const randomDelay = (3 + Math.random() * 5) * 60_000; // 3-8 minutes
        const t = setTimeout(() => {
          if (activeLogIdRef.current === logId) {
            silentCapture(logId, "progress");
            scheduleRandom(0); // Schedule next random capture
          }
        }, afterMs + randomDelay);
        captureTimersRef.current.push(t);
      };

      // First random capture starts after the 3-minute mark
      scheduleRandom(180_000);
    },
    [clearCaptureTimers, silentCapture]
  );

  // ─── Start Task ─────────────────────────────────────────────

  const startTask = useCallback(
    async (formData: TaskFormData) => {
      if (!userId || !profile) return;
      const now = new Date().toISOString();

      // Capture end screenshot for the previous task before stopping it
      if (activeTask?.logId && screenShareActive) {
        const prevLogId = parseInt(activeTask.logId, 10);
        silentCapture(prevLogId, "end");
        clearCaptureTimers();
      }

      // If closing an old task via wizard, save the memos to the OLD task (not the new one)
      if (formData.task_status && activeTask?.logId) {
        const oldLogId = parseInt(activeTask.logId, 10);
        const oldTaskUpdate: Record<string, unknown> = {};
        if (formData.client_memo) oldTaskUpdate.client_memo = formData.client_memo;
        if (formData.internal_memo) oldTaskUpdate.internal_memo = formData.internal_memo;
        if (formData.task_status) oldTaskUpdate.progress = formData.task_status.toLowerCase().replace(' ', '_');
        if (Object.keys(oldTaskUpdate).length > 0) {
          await supabase.from("time_logs").update(oldTaskUpdate).eq("id", oldLogId);
          setTimeLogs((prev) =>
            prev.map((log) =>
              log.id === oldLogId ? { ...log, ...oldTaskUpdate } as TimeLog : log
            )
          );
        }
      }

      // Stop previous active task
      if (activeTask) {
        await stopCurrentTask();
      }

      const isBillable =
        formData.category !== "Personal";

      // If memos were for the old task (wizard flow), don't put them on the new task
      const newTaskClientMemo = formData.task_status ? null : formData.client_memo || null;
      const newTaskInternalMemo = formData.task_status ? null : formData.internal_memo || null;

      // Insert time log
      const { data: logData } = await supabase
        .from("time_logs")
        .insert({
          user_id: userId,
          username: profile.username,
          full_name: profile.full_name,
          department: profile.department,
          position: profile.position,
          task_name: formData.task_name,
          category: formData.category,
          project: formData.project || null,
          account: formData.account || null,
          client_name: formData.client_name || null,
          start_time: now,
          billable: isBillable,
          client_memo: newTaskClientMemo,
          internal_memo: newTaskInternalMemo,
          form_fill_ms: formData.form_fill_ms || 0,
        })
        .select()
        .single();

      // If category is 'Sorting Tasks', auto-create a sorting_review record
      if (formData.category === "Sorting Tasks" && logData?.id) {
        await supabase.from("sorting_review").insert({
          log_id: logData.id,
          status: "pending",
          bill_to: "internal",
          original_account: formData.account || null,
          original_client: formData.client_name || null,
        });
      }

      const newActiveTask: ActiveTask = {
        task_name: formData.task_name,
        category: formData.category,
        project: formData.project,
        account: formData.account,
        client_name: formData.client_name,
        client_memo: newTaskClientMemo || "",
        internal_memo: newTaskInternalMemo || "",
        start_time: now,
        end_time: null,
        duration_ms: 0,
        logId: logData?.id?.toString() || "",
        _startMs: Date.now(),
      };

      // Auto-clock in if idle
      const clockInTime =
        sessionState === "idle" ? now : session?.clock_in_time || now;

      await supabase.from("sessions").upsert(
        {
          user_id: userId,
          clocked_in: true,
          clock_in_time: clockInTime,
          active_task: newActiveTask,
          session_date: new Date().toISOString().split("T")[0],
          updated_at: now,
        },
        { onConflict: "user_id" }
      );

      setActiveTask(newActiveTask);
      setTaskElapsed(0);

      if (logData) {
        setTimeLogs((prev) => [logData as TimeLog, ...prev]);
      }

      if (sessionState === "idle") {
        setSession((prev) => ({
          ...(prev || {
            id: 0,
            user_id: userId,
            clock_out_time: null,
          }),
          clocked_in: true,
          clock_in_time: now,
          active_task: newActiveTask,
          session_date: new Date().toISOString().split("T")[0],
          updated_at: now,
        } as Session));
        setSessionState("clocked-in");
        setSessionElapsed(0);
      } else if (sessionState === "on-break") {
        // Close any open break logs when starting a new task from break
        if (session?.active_task?.logId && session.active_task.isBreak) {
          const breakLogId = parseInt(session.active_task.logId, 10);
          if (breakLogId) {
            const breakDurationMs = Date.now() - new Date(session.active_task.start_time || now).getTime();
            await supabase
              .from("time_logs")
              .update({ end_time: now, duration_ms: breakDurationMs })
              .eq("id", breakLogId);
            setTimeLogs((prev) =>
              prev.map((log) =>
                log.id === breakLogId
                  ? { ...log, end_time: now, duration_ms: breakDurationMs }
                  : log
              )
            );
          }
        }
        // Also close any other orphaned break logs
        await supabase
          .from("time_logs")
          .update({ end_time: now, duration_ms: 0 })
          .eq("user_id", userId)
          .eq("category", "Break")
          .is("end_time", null);

        setSessionState("clocked-in");
        setBreakElapsed(0);
        setBreakStartTime(null);
      }

      // ─── Screen capture: request stream on first task, then schedule ───
      if (logData) {
        const newLogId = logData.id;
        if (screenShareActive) {
          // Stream already active — just start the capture schedule
          scheduleCaptureSequence(newLogId);
        } else {
          // First task of the session — prompt for screen share
          const granted = await requestStream();
          if (granted) {
            scheduleCaptureSequence(newLogId);
          }
        }
      }
    },
    [userId, profile, supabase, session, activeTask, sessionState, stopCurrentTask, screenShareActive, silentCapture, clearCaptureTimers, scheduleCaptureSequence, requestStream]
  );

  // ─── Screenshot (manual + fallback) ─────────────────────────

  /** Manual screenshot: uses persistent stream if available, fallback to prompt */
  const captureScreenshot = useCallback(
    async (logId: number) => {
      if (!userId) return;

      // Try persistent stream first
      const captured = await silentCapture(logId, "manual");
      if (captured) return;

      // Fallback: prompt user (old behavior)
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const video = document.createElement("video");
        video.srcObject = stream;
        video.muted = true;

        await new Promise<void>((resolve) => {
          video.onloadedmetadata = () => { video.play(); resolve(); };
        });
        await new Promise((resolve) => requestAnimationFrame(resolve));

        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d")!.drawImage(video, 0, 0);
        stream.getTracks().forEach((t) => t.stop());
        video.srcObject = null;

        const blob = await new Promise<Blob>((resolve) => {
          canvas.toBlob((b) => resolve(b!), "image/png");
        });

        await uploadScreenshot(blob, logId, "manual");
      } catch (err) {
        console.log("Screenshot cancelled or failed:", err);
      }
    },
    [userId, silentCapture, uploadScreenshot]
  );

  const handleActiveTaskScreenshot = useCallback(() => {
    if (activeTask?.logId) {
      captureScreenshot(parseInt(activeTask.logId, 10));
    }
  }, [activeTask, captureScreenshot]);

  // Clean up capture timers and worker on unmount
  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      captureTimersRef.current.forEach((t) => clearTimeout(t));
      captureWorkerRef.current?.terminate();
    };
  }, []);

  // ─── Live Session Check ─────────────────────────────────

  const checkLiveSession = useCallback(async (): Promise<TimeLog | null> => {
    if (!userId) return null;
    const { data } = await supabase
      .from("time_logs")
      .select("*")
      .eq("user_id", userId)
      .is("end_time", null)
      .neq("category", "Break")
      .order("start_time", { ascending: false })
      .limit(1);
    if (data && data.length > 0) {
      return data[0] as TimeLog;
    }
    return null;
  }, [userId, supabase]);

  const rejoinTask = useCallback(
    async (liveLog: TimeLog) => {
      const task: ActiveTask = {
        task_name: liveLog.task_name,
        category: liveLog.category,
        project: liveLog.project || "",
        account: liveLog.account || "",
        client_name: liveLog.client_name || "",
        client_memo: liveLog.client_memo || "",
        internal_memo: liveLog.internal_memo || "",
        start_time: liveLog.start_time,
        end_time: null,
        duration_ms: 0,
        logId: liveLog.id.toString(),
        _startMs: new Date(liveLog.start_time).getTime(),
        isBreak: liveLog.category === "Break",
      };

      setActiveTask(task);
      setTaskElapsed(secondsSince(liveLog.start_time));

      // Update session to reflect rejoined task
      const now = new Date().toISOString();
      await supabase.from("sessions").upsert(
        {
          user_id: userId!,
          clocked_in: true,
          clock_in_time: session?.clock_in_time || liveLog.start_time,
          active_task: task,
          session_date: new Date().toISOString().split("T")[0],
          updated_at: now,
        },
        { onConflict: "user_id" }
      );

      if (sessionState === "idle") {
        setSession((prev) => ({
          ...(prev || {
            id: 0,
            user_id: userId!,
            clock_out_time: null,
          }),
          clocked_in: true,
          clock_in_time: session?.clock_in_time || liveLog.start_time,
          active_task: task,
          session_date: new Date().toISOString().split("T")[0],
          updated_at: now,
        } as Session));
        setSessionState("clocked-in");
        setSessionElapsed(secondsSince(session?.clock_in_time || liveLog.start_time));
      }

      setShowLivePrompt(false);
      setLiveSessionData(null);
      setPendingFormData(null);
    },
    [userId, supabase, session, sessionState]
  );

  // Close old task with details, then start new task
  const closeOldAndStartNew = useCallback(async () => {
    if (!liveSessionData || !userId) return;
    const now = new Date().toISOString();
    const logId = liveSessionData.id;
    const durationMs = Date.now() - new Date(liveSessionData.start_time).getTime();

    // Update old task with end_time, duration, and memos
    const updatePayload: Record<string, unknown> = {
      end_time: now,
      duration_ms: durationMs,
    };
    // Save both memo fields
    if (closeOldClientMemo.trim()) {
      updatePayload.client_memo = closeOldClientMemo.trim();
    }
    if (closeOldInternalMemo.trim()) {
      updatePayload.internal_memo = closeOldInternalMemo.trim();
    }
    // Fallback: also check old single-memo field
    if (closeOldMemoType === "client" && closeOldMemoText.trim()) {
      updatePayload.client_memo = closeOldMemoText.trim();
    } else if (closeOldMemoType === "internal" && closeOldMemoText.trim()) {
      updatePayload.internal_memo = closeOldMemoText.trim();
    }
    // Save progress status
    if (closeOldStatus) {
      updatePayload.progress = closeOldStatus.toLowerCase().replace(' ', '_');
    }

    await supabase.from("time_logs").update(updatePayload).eq("id", logId);

    // Update local state for the closed log
    setTimeLogs((prev) =>
      prev.map((log) =>
        log.id === logId
          ? { ...log, ...updatePayload, end_time: now, duration_ms: durationMs } as TimeLog
          : log
      )
    );

    // Upload screenshot for old task if captured
    if (closeOldScreenshotBlob) {
      const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
      const storagePath = `${userId}/${filename}`;
      await supabase.storage
        .from("screenshots")
        .upload(storagePath, closeOldScreenshotBlob, { contentType: "image/png" });
      await supabase.from("task_screenshots").insert({
        user_id: userId,
        log_id: logId,
        filename,
        storage_path: storagePath,
      });
    }

    // Clear the active task locally
    setActiveTask(null);
    setTaskElapsed(0);

    // Reset close-old wizard state
    setCloseOldStep(null);
    setCloseOldScreenshotBlob(null);
    setCloseOldStatus("");
    setCloseOldMemoType("");
    setCloseOldMemoText("");
    setCloseOldClientMemo("");
    setCloseOldInternalMemo("");
    setLiveSessionData(null);
    setShowLivePrompt(false);

    // If break is pending, start break instead of new task
    if (breakPending) {
      setBreakPending(false);
      await doStartBreak();
      return;
    }

    // Now start the new task if we have pending form data
    if (pendingFormData) {
      // Slight delay to ensure old task is closed before starting new
      const formData = pendingFormData;
      setPendingFormData(null);
      await startTask(formData);
    }
  }, [liveSessionData, userId, supabase, closeOldScreenshotBlob, closeOldMemoType, closeOldMemoText, closeOldClientMemo, closeOldInternalMemo, closeOldStatus, pendingFormData, startTask, breakPending, doStartBreak]);

  const captureCloseOldScreenshot = useCallback(async () => {
    setCloseOldCapturing(true);
    try {
      // Try persistent stream first
      const persistentBlob = await captureFrame();
      if (persistentBlob) {
        setCloseOldScreenshotBlob(persistentBlob);
        setCloseOldStep("details");
        return;
      }

      // Fallback: prompt user
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => { video.play(); resolve(); };
      });
      await new Promise((r) => requestAnimationFrame(r));
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")!.drawImage(video, 0, 0);
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      const fallbackBlob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b!), "image/png");
      });
      setCloseOldScreenshotBlob(fallbackBlob);
      setCloseOldStep("details");
    } catch {
      // User cancelled
    } finally {
      setCloseOldCapturing(false);
    }
  }, [captureFrame]);

  const skipCloseOldScreenshot = useCallback(() => {
    setCloseOldScreenshotBlob(null);
    setCloseOldStep("details");
  }, []);

  // Handle the "Start New Task" from LiveSessionPrompt
  const handleStartNewFromLivePrompt = useCallback(() => {
    setShowLivePrompt(false);
    setCloseOldStep("screenshot");
  }, []);

  // Called from DailyTaskPlanner when Start button is clicked on a planned task.
  // Prefills the TaskEntryForm via the custom event and scrolls up.
  const handleStartPlannedTask = useCallback((task: PlannedTask) => {
    window.dispatchEvent(
      new CustomEvent("minuteflow-prefill", {
        detail: {
          task_name: task.task_name,
          account: task.account || "",
          category: "Task",
        },
      })
    );
    // Scroll to top so user sees the form
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // Called from TaskEntryForm when Start Task is clicked
  const handleCheckAndStartTask = useCallback(
    async (formData: TaskFormData) => {
      // If we already have an active task locally, the dashboard knows about it.
      // The wizard (TaskEntryForm) handles closing it via the status/memo flow.
      // Just start the new task — stopCurrentTask is called inside startTask.
      if (activeTask) {
        await startTask(formData);
        return;
      }

      // No local active task — check DB for orphaned live sessions
      // (different browser, disconnect, crash)
      const liveLog = await checkLiveSession();
      if (liveLog) {
        // Orphaned task found — show the rejoin/close prompt
        setLiveSessionData(liveLog);
        setPendingFormData(formData);
        setShowLivePrompt(true);
        return;
      }

      // No live session anywhere — proceed normally (first task)
      await startTask(formData);
    },
    [checkLiveSession, startTask, activeTask]
  );

  // ─── Notes modal ──────────────────────────────────────────

  const [showNotesModal, setShowNotesModal] = useState(false);
  const [notesContent, setNotesContent] = useState("");
  const [notesClientMemo, setNotesClientMemo] = useState("");

  const handleNotes = useCallback(() => {
    if (activeTask) {
      setNotesContent(activeTask.internal_memo || "");
      setNotesClientMemo(activeTask.client_memo || "");
      setShowNotesModal(true);
    }
  }, [activeTask]);

  const saveNotes = useCallback(async () => {
    if (!activeTask?.logId) return;
    const logId = parseInt(activeTask.logId, 10);

    const updatePayload: Record<string, string> = {};
    if (notesClientMemo.trim()) updatePayload.client_memo = notesClientMemo.trim();
    else updatePayload.client_memo = "";
    if (notesContent.trim()) updatePayload.internal_memo = notesContent.trim();
    else updatePayload.internal_memo = "";

    await supabase
      .from("time_logs")
      .update(updatePayload)
      .eq("id", logId);

    setActiveTask((prev) =>
      prev ? { ...prev, internal_memo: updatePayload.internal_memo, client_memo: updatePayload.client_memo } : prev
    );
    setTimeLogs((prev) =>
      prev.map((log) =>
        log.id === logId ? { ...log, internal_memo: updatePayload.internal_memo, client_memo: updatePayload.client_memo } : log
      )
    );
    setShowNotesModal(false);
  }, [activeTask, notesContent, notesClientMemo, supabase]);

  // ─── Project Sidebar Handlers ─────────────────────────────

  const [sidebarClientMemo, setSidebarClientMemo] = useState("");
  const [sidebarInternalMemo, setSidebarInternalMemo] = useState("");

  const handleProjectSelect = useCallback(
    (account: string, project: string) => {
      // Pre-fill the task form with account and project
      // This triggers a custom event the TaskEntryForm listens for
      window.dispatchEvent(
        new CustomEvent("minuteflow-prefill", {
          detail: { account, project },
        })
      );
    },
    []
  );

  const handleQuickAction = useCallback(
    (action: string) => {
      const QUICK_ACTION_MAP: Record<string, { category: string; task_name: string; account?: string; client_name?: string }> = {
        "sorting-tasks": { category: "Sorting Tasks", task_name: "Sorting Tasks", account: "Virtual Concierge", client_name: "Toni Colina" },
        "message": { category: "Message", task_name: "Message" },
        "personal": { category: "Personal", task_name: "Personal Time" },
        "coaching": { category: "Task", task_name: "Coaching" },
        "training": { category: "Task", task_name: "Training" },
        "feedback": { category: "Task", task_name: "Feedback" },
        "collaboration": { category: "Collaboration", task_name: "Collaboration" },
        "team-development": { category: "Task", task_name: "Team Development" },
        "personal-development": { category: "Task", task_name: "Personal Development" },
      };

      const mapping = QUICK_ACTION_MAP[action];
      if (mapping) {
        window.dispatchEvent(
          new CustomEvent("minuteflow-prefill", {
            detail: mapping,
          })
        );
      }
    },
    []
  );

  const handleSidebarMemoSave = useCallback(async () => {
    if (!activeTask?.logId) return;
    if (!sidebarClientMemo.trim() && !sidebarInternalMemo.trim()) return;
    const logId = parseInt(activeTask.logId, 10);
    const updatePayload: Record<string, string> = {};
    if (sidebarClientMemo.trim()) updatePayload.client_memo = sidebarClientMemo.trim();
    if (sidebarInternalMemo.trim()) updatePayload.internal_memo = sidebarInternalMemo.trim();
    await supabase
      .from("time_logs")
      .update(updatePayload)
      .eq("id", logId);
    setActiveTask((prev) =>
      prev ? {
        ...prev,
        ...(sidebarClientMemo.trim() ? { client_memo: sidebarClientMemo.trim() } : {}),
        ...(sidebarInternalMemo.trim() ? { internal_memo: sidebarInternalMemo.trim() } : {}),
      } : prev
    );
    setTimeLogs((prev) =>
      prev.map((log) =>
        log.id === logId ? {
          ...log,
          ...(sidebarClientMemo.trim() ? { client_memo: sidebarClientMemo.trim() } : {}),
          ...(sidebarInternalMemo.trim() ? { internal_memo: sidebarInternalMemo.trim() } : {}),
        } : log
      )
    );
  }, [activeTask, sidebarClientMemo, sidebarInternalMemo, supabase]);

  // Sync sidebar memos with active task
  useEffect(() => {
    setSidebarClientMemo(activeTask?.client_memo || "");
    setSidebarInternalMemo(activeTask?.internal_memo || "");
  }, [activeTask?.logId, activeTask?.client_memo, activeTask?.internal_memo]);

  // ─── Summary stats ────────────────────────────────────────

  const todayStats = (() => {
    const { start, end } = getTodayBoundsInTimezone(orgTimezone);
    const todayLogs = timeLogs.filter((l) => {
      return l.start_time >= start && l.start_time <= end;
    });
    return {
      taskCount: todayLogs.length,
      totalMs: todayLogs.reduce((sum, l) => sum + l.duration_ms, 0),
    };
  })();

  // ─── Render ───────────────────────────────────────────────

  if (loading) {
    return (
      <div>
        <div className="animate-pulse">
          <div className="h-8 w-64 bg-parchment rounded mb-2" />
          <div className="h-4 w-96 bg-parchment rounded mb-7" />
          <div className="h-20 bg-parchment rounded-[14px] mb-6" />
          <div className="grid grid-cols-2 gap-5 mb-6">
            <div className="h-80 bg-parchment rounded-xl" />
            <div className="h-80 bg-parchment rounded-xl" />
          </div>
          <div className="h-96 bg-parchment rounded-xl" />
        </div>
      </div>
    );
  }

  const firstName = profile?.full_name?.split(" ")[0] || "there";

  return (
    <div>
      {/* Greeting */}
      <div className="mb-7">
        <h1 className="font-serif text-[26px] font-normal text-espresso mb-1">
          {getGreeting(orgTimezone)},{" "}
          <strong className="font-bold">{firstName}</strong>
        </h1>
        <p className="text-sm text-bark">
          {formatDateLong(orgTimezone)} &mdash;{" "}
          {todayStats.taskCount > 0
            ? `${todayStats.taskCount} task${todayStats.taskCount !== 1 ? "s" : ""} logged \u00B7 ${formatHoursMinutes(todayStats.totalMs)} tracked today`
            : "No tasks logged yet today"}
        </p>
      </div>

      {/* Session Banner */}
      <SessionBanner
        state={sessionState}
        clockInTime={session?.clock_in_time || null}
        elapsedSeconds={sessionElapsed}
        breakElapsedSeconds={breakElapsed}
        screenShareActive={screenShareActive}
        onClockIn={clockIn}
        onClockOut={clockOut}
        onStartBreak={startBreak}
        onEndBreak={endBreak}
      />

      {/* Active Task Bar */}
      {activeTask && sessionState === "clocked-in" && (
        <ActiveTaskBar
          task={activeTask}
          elapsedSeconds={taskElapsed}
          onScreenshot={handleActiveTaskScreenshot}
          onNotes={handleNotes}
        />
      )}

      {/* Layout: Team (left) + Task Form (center) + Daily Planner + Projects (right) */}
      <div className={`grid gap-5 mb-6 ${role === "va" ? "grid-cols-1 md:grid-cols-[1fr_260px_260px]" : "grid-cols-1 md:grid-cols-[1fr_280px] lg:grid-cols-[240px_1fr_280px_280px]"}`}>
        {role !== "va" && <TeamSidebar members={teamMembers} timeLogs={timeLogs} />}
        <TaskEntryForm
          onStartTask={handleCheckAndStartTask}
          hasActiveTask={!!activeTask || sessionState === "clocked-in" || sessionState === "on-break"}
          role={role}
        />
        {userId && (
          <DailyTaskPlanner
            userId={userId}
            role={role}
            onStartPlannedTask={handleStartPlannedTask}
            teamMembers={teamMembers.map((m) => m.profile)}
          />
        )}
        <ProjectSidebar
          onSelectProject={handleProjectSelect}
          onQuickAction={handleQuickAction}
          isAdmin={role === "admin" || role === "manager"}
        />
      </div>

      {/* Activity Log — VAs see only their own entries */}
      <ActivityLog
        logs={role === "va" ? timeLogs.filter((l) => l.user_id === userId) : timeLogs}
        screenshots={screenshots}
        onAddScreenshot={captureScreenshot}
        role={role}
        currentUserId={userId || ""}
        profiles={teamMembers.map((m) => m.profile)}
        timezone={orgTimezone}
        onResumeTask={resumeOnHoldTask}
        onRefresh={async () => {
          // Re-fetch logs after edit/create/correction
          const { data } = await supabase
            .from("time_logs")
            .select("*")
            .order("start_time", { ascending: false })
            .limit(200);
          if (data) setTimeLogs(data as TimeLog[]);
        }}
      />

      {/* ─── Live Session Prompt ─── */}
      {showLivePrompt && liveSessionData && (
        <LiveSessionPrompt
          liveSession={liveSessionData}
          onRejoin={() => rejoinTask(liveSessionData)}
          onStartNew={handleStartNewFromLivePrompt}
          onCancel={() => {
            setShowLivePrompt(false);
            setLiveSessionData(null);
            setPendingFormData(null);
          }}
        />
      )}

      {/* ─── Close Old Task: Screenshot Prompt ─── */}
      {closeOldStep === "screenshot" && liveSessionData && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl border border-sand shadow-xl w-full max-w-md mx-4">
            <div className="py-4 px-5 border-b border-parchment flex items-center justify-between">
              <h3 className="text-sm font-bold text-espresso">Close Previous Task</h3>
              <button
                onClick={() => {
                  setCloseOldStep(null);
                  setLiveSessionData(null);
                  setPendingFormData(null);
                }}
                className="text-bark hover:text-terracotta text-lg leading-none cursor-pointer"
              >
                &times;
              </button>
            </div>
            <div className="p-5 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-cream flex items-center justify-center">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-terracotta">
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <circle cx="12" cy="10" r="3" />
                  <path d="M5 21l3-3h8l3 3" />
                </svg>
              </div>
              <p className="text-sm text-espresso font-medium mb-1">Document your progress</p>
              <p className="text-xs text-bark mb-5">
                Take a screenshot before closing <strong>{liveSessionData.task_name}</strong>
              </p>
              <div className="flex gap-3">
                <button
                  onClick={skipCloseOldScreenshot}
                  className="flex-1 py-2.5 rounded-lg bg-parchment text-walnut border border-sand text-[13px] font-semibold cursor-pointer transition-all hover:bg-sand hover:text-espresso"
                >
                  Skip
                </button>
                <button
                  onClick={captureCloseOldScreenshot}
                  disabled={closeOldCapturing}
                  className="flex-1 py-2.5 rounded-lg bg-terracotta text-white text-[13px] font-semibold cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50"
                >
                  {closeOldCapturing ? "Capturing..." : "Take Screenshot"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Close Old Task: Status + Memo ─── */}
      {closeOldStep === "details" && liveSessionData && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl border border-sand shadow-xl w-full max-w-lg mx-4">
            <div className="py-4 px-5 border-b border-parchment flex items-center justify-between">
              <h3 className="text-sm font-bold text-espresso">
                Close: {liveSessionData.task_name}
              </h3>
              <button
                onClick={() => {
                  setCloseOldStep(null);
                  setLiveSessionData(null);
                  setPendingFormData(null);
                  setCloseOldScreenshotBlob(null);
                  setCloseOldStatus("");
                  setCloseOldMemoType("");
                  setCloseOldMemoText("");
                  setCloseOldClientMemo("");
                  setCloseOldInternalMemo("");
                  setBreakPending(false);
                }}
                className="text-bark hover:text-terracotta text-lg leading-none cursor-pointer"
              >
                &times;
              </button>
            </div>
            <div className="p-5">
              {/* Task Status */}
              <div className="mb-4">
                <p className="text-[11px] font-semibold text-walnut mb-2 tracking-wide">Task Status</p>
                <div className="flex gap-2">
                  {["In Progress", "Completed", "On Hold"].map((status) => (
                    <button
                      key={status}
                      onClick={() => setCloseOldStatus(status)}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                        closeOldStatus === status
                          ? status === "Completed"
                            ? "bg-sage text-white border border-sage"
                            : status === "On Hold"
                            ? "bg-amber text-white border border-amber"
                            : "bg-terracotta text-white border border-terracotta"
                          : "border border-sand bg-white text-bark hover:border-terracotta"
                      }`}
                    >
                      {status}
                    </button>
                  ))}
                </div>
              </div>

              {/* Memos */}
              <div className="mb-3">
                <p className="text-[11px] font-semibold text-walnut mb-2 tracking-wide">Client Memo <span className="text-stone font-normal">(at least one memo required)</span></p>
                <textarea
                  value={closeOldClientMemo}
                  onChange={(e) => setCloseOldClientMemo(e.target.value)}
                  placeholder="Notes visible to the client..."
                  rows={3}
                  className="w-full py-2.5 px-[13px] border border-sand rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)] placeholder:text-stone resize-none"
                />
              </div>

              {/* Internal Memo */}
              <div className="mb-3">
                <p className="text-[11px] font-semibold text-walnut mb-2 tracking-wide">Internal Memo</p>
                <textarea
                  value={closeOldInternalMemo}
                  onChange={(e) => setCloseOldInternalMemo(e.target.value)}
                  placeholder="Internal notes (not visible to client)..."
                  rows={3}
                  className="w-full py-2.5 px-[13px] border border-sand rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)] placeholder:text-stone resize-none"
                />
              </div>

              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => {
                    setCloseOldStep(null);
                    setLiveSessionData(null);
                    setPendingFormData(null);
                    setCloseOldScreenshotBlob(null);
                    setCloseOldStatus("");
                    setCloseOldMemoType("");
                    setCloseOldMemoText("");
                    setCloseOldClientMemo("");
                    setCloseOldInternalMemo("");
                    setBreakPending(false);
                  }}
                  className="flex-1 py-2.5 rounded-lg bg-parchment text-walnut border border-sand text-[13px] font-semibold cursor-pointer transition-all hover:bg-sand hover:text-espresso"
                >
                  Cancel
                </button>
                <button
                  onClick={closeOldAndStartNew}
                  disabled={!closeOldStatus || (!closeOldClientMemo.trim() && !closeOldInternalMemo.trim())}
                  className="flex-1 py-2.5 rounded-lg bg-terracotta text-white text-[13px] font-semibold cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {breakPending ? "Close & Break" : "Close & Start New Task"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notes Modal */}
      {showNotesModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl border border-sand shadow-xl w-full max-w-md mx-4">
            <div className="py-4 px-5 border-b border-parchment flex items-center justify-between">
              <h3 className="text-sm font-bold text-espresso">Task Notes</h3>
              <button
                onClick={() => setShowNotesModal(false)}
                className="text-bark hover:text-terracotta text-lg leading-none cursor-pointer"
              >
                &times;
              </button>
            </div>
            <div className="p-5">
              <div className="mb-3">
                <label className="block text-[11px] font-semibold text-slate-blue mb-1">
                  Client Memo
                </label>
                <textarea
                  value={notesClientMemo}
                  onChange={(e) => setNotesClientMemo(e.target.value)}
                  placeholder="Notes visible to the client..."
                  rows={3}
                  className="w-full py-2.5 px-[13px] border border-slate-blue/30 rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-slate-blue focus:shadow-[0_0_0_3px_rgba(100,116,139,0.08)] placeholder:text-stone resize-none"
                />
              </div>
              <div className="mb-4">
                <label className="block text-[11px] font-semibold text-walnut mb-1">
                  Internal Memo
                </label>
                <textarea
                  value={notesContent}
                  onChange={(e) => setNotesContent(e.target.value)}
                  placeholder="Internal notes (not visible to client)..."
                  rows={3}
                  className="w-full py-2.5 px-[13px] border border-walnut/30 rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-walnut focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)] placeholder:text-stone resize-none"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowNotesModal(false)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-parchment text-walnut border border-sand text-[13px] font-semibold cursor-pointer transition-all hover:bg-sand hover:text-espresso"
                >
                  Cancel
                </button>
                <button
                  onClick={saveNotes}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-terracotta text-white text-[13px] font-semibold cursor-pointer transition-all hover:bg-[#a85840]"
                >
                  Save Notes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Close Task Before Clock Out Modal ─── */}
      {showClockOutModal && activeTask && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl border border-sand shadow-xl w-full max-w-lg mx-4">
            <div className="py-4 px-5 border-b border-parchment flex items-center justify-between">
              <h3 className="text-sm font-bold text-espresso">
                Close Active Task Before Clocking Out
              </h3>
              <button
                onClick={cancelClockOutModal}
                className="text-bark hover:text-terracotta text-lg leading-none cursor-pointer"
              >
                &times;
              </button>
            </div>
            <div className="p-5">
              {/* Info banner */}
              <div className="mb-4 p-3 rounded-lg bg-amber-soft border border-[#d4c07a] text-xs text-amber font-medium">
                You have an active task: <strong>{activeTask.task_name}</strong>. Please close it before clocking out.
              </div>

              {/* Task Status */}
              <div className="mb-4">
                <p className="text-[11px] font-semibold text-walnut mb-2 tracking-wide">
                  Task Status <span className="text-terracotta">*</span>
                </p>
                <div className="flex gap-2">
                  {["In Progress", "Completed", "On Hold"].map((status) => (
                    <button
                      key={status}
                      onClick={() => setClockOutTaskStatus(status)}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                        clockOutTaskStatus === status
                          ? status === "Completed"
                            ? "bg-sage text-white border border-sage"
                            : status === "On Hold"
                            ? "bg-amber text-white border border-amber"
                            : "bg-terracotta text-white border border-terracotta"
                          : "border border-sand bg-white text-bark hover:border-terracotta"
                      }`}
                    >
                      {status}
                    </button>
                  ))}
                </div>
              </div>

              {/* Memos — both independently fillable */}
              <div className="mb-3">
                <p className="text-[11px] font-semibold text-walnut mb-2 tracking-wide">
                  Add Comments <span className="text-stone font-normal">(at least one required)</span>
                </p>

                <div className="mb-3">
                  <button
                    onClick={() => setShowClockOutClientMemo(!showClockOutClientMemo)}
                    className={`w-full flex items-center justify-between py-2.5 px-3.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                      showClockOutClientMemo || clockOutClientMemo
                        ? "bg-slate-blue text-white border border-slate-blue"
                        : "border border-slate-blue/30 bg-slate-blue-soft text-slate-blue hover:border-slate-blue"
                    }`}
                  >
                    <span>Client Memo</span>
                    <span className="text-[10px] opacity-75">
                      {clockOutClientMemo ? "filled" : showClockOutClientMemo ? "collapse" : "expand"}
                    </span>
                  </button>
                  {showClockOutClientMemo && (
                    <textarea
                      value={clockOutClientMemo}
                      onChange={(e) => setClockOutClientMemo(e.target.value)}
                      placeholder="Notes visible to the client..."
                      rows={2}
                      autoFocus
                      className="w-full mt-1.5 py-2.5 px-[13px] border border-slate-blue/30 rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-slate-blue focus:shadow-[0_0_0_3px_rgba(100,116,139,0.08)] placeholder:text-stone resize-none"
                    />
                  )}
                </div>

                <div>
                  <button
                    onClick={() => setShowClockOutInternalMemo(!showClockOutInternalMemo)}
                    className={`w-full flex items-center justify-between py-2.5 px-3.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                      showClockOutInternalMemo || clockOutInternalMemo
                        ? "bg-walnut text-white border border-walnut"
                        : "border border-walnut/30 bg-amber-soft text-walnut hover:border-walnut"
                    }`}
                  >
                    <span>Internal Memo</span>
                    <span className="text-[10px] opacity-75">
                      {clockOutInternalMemo ? "filled" : showClockOutInternalMemo ? "collapse" : "expand"}
                    </span>
                  </button>
                  {showClockOutInternalMemo && (
                    <textarea
                      value={clockOutInternalMemo}
                      onChange={(e) => setClockOutInternalMemo(e.target.value)}
                      placeholder="Internal notes (not visible to client)..."
                      rows={2}
                      autoFocus
                      className="w-full mt-1.5 py-2.5 px-[13px] border border-walnut/30 rounded-lg text-[13px] text-ink bg-white outline-none transition-all focus:border-walnut focus:shadow-[0_0_0_3px_rgba(93,75,60,0.08)] placeholder:text-stone resize-none"
                    />
                  )}
                </div>
              </div>

              {/* Mood Rating */}
              <div className="mb-3">
                <p className="text-[11px] font-semibold text-walnut mb-2 tracking-wide">
                  How was your day? <span className="text-stone font-normal">(optional)</span>
                </p>
                <div className="flex gap-2">
                  {([
                    { value: 'bad' as const, emoji: "\uD83D\uDE1E", label: "Not great" },
                    { value: 'neutral' as const, emoji: "\uD83D\uDE10", label: "Okay" },
                    { value: 'good' as const, emoji: "\uD83D\uDE0A", label: "Great" },
                  ]).map((mood) => (
                    <button
                      key={mood.value}
                      onClick={() => setClockOutMood(clockOutMood === mood.value ? null : mood.value)}
                      className={`flex-1 flex flex-col items-center gap-1 py-2.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                        clockOutMood === mood.value
                          ? mood.value === 'good'
                            ? "bg-sage text-white border-2 border-sage"
                            : mood.value === 'bad'
                            ? "bg-terracotta text-white border-2 border-terracotta"
                            : "bg-amber text-white border-2 border-amber"
                          : "border border-sand bg-white text-bark hover:border-terracotta"
                      }`}
                    >
                      <span className="text-xl">{mood.emoji}</span>
                      <span className="text-[10px]">{mood.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Submit */}
              <div className="flex gap-3 mt-4">
                <button
                  onClick={cancelClockOutModal}
                  className="flex-1 py-2.5 rounded-lg bg-parchment text-walnut border border-sand text-[13px] font-semibold cursor-pointer transition-all hover:bg-sand hover:text-espresso"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCloseTaskAndClockOut}
                  disabled={!clockOutTaskStatus || (!clockOutClientMemo.trim() && !clockOutInternalMemo.trim()) || clockingOut}
                  className="flex-1 py-2.5 rounded-lg bg-terracotta text-white text-[13px] font-semibold cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {clockingOut ? "Closing & clocking out..." : "Close Task & Clock Out"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ─── Post-Break Prompt: Resume or New Task ─── */}
      {showPostBreakPrompt && preBreakTask && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl border border-sand shadow-xl w-full max-w-md mx-4">
            {!postBreakMemoStep ? (
              <>
                {/* Step 1: Choose resume or new */}
                <div className="py-4 px-5 border-b border-parchment">
                  <h3 className="text-sm font-bold text-espresso">Welcome Back!</h3>
                  <p className="text-xs text-bark mt-1">Your break has ended. What would you like to do?</p>
                </div>
                <div className="p-5 space-y-3">
                  <button
                    onClick={resumePreBreakTask}
                    className="w-full flex items-center gap-3 p-3 rounded-lg border border-sage bg-sage-soft text-left cursor-pointer transition-all hover:bg-sage/10 hover:border-sage"
                  >
                    <div className="w-9 h-9 rounded-full bg-sage flex items-center justify-center shrink-0">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21" /></svg>
                    </div>
                    <div>
                      <div className="text-[13px] font-semibold text-espresso">Resume Task</div>
                      <div className="text-[11px] text-bark mt-0.5">
                        {preBreakTask.task_name}
                        {preBreakTask.project ? ` · ${preBreakTask.project}` : ""}
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      setShowPostBreakPrompt(false);
                      setPostBreakMemoStep(false);
                      setPreBreakTask(null);
                    }}
                    className="w-full flex items-center gap-3 p-3 rounded-lg border border-sand text-left cursor-pointer transition-all hover:bg-parchment hover:border-terracotta"
                  >
                    <div className="w-9 h-9 rounded-full bg-parchment flex items-center justify-center shrink-0">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-terracotta)" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    </div>
                    <div>
                      <div className="text-[13px] font-semibold text-espresso">Start New Task</div>
                      <div className="text-[11px] text-bark mt-0.5">Use the form to log a new task</div>
                    </div>
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Step 2: Add memos to the pre-break task */}
                <div className="py-4 px-5 border-b border-parchment">
                  <h3 className="text-sm font-bold text-espresso">Close Previous Task</h3>
                  <p className="text-xs text-bark mt-1">
                    Add notes for <strong>{preBreakTask.task_name}</strong> before starting something new.
                  </p>
                </div>
                <div className="p-5 space-y-3">
                  {/* Status */}
                  <div>
                    <label className="block text-[11px] font-semibold text-walnut mb-1.5 tracking-wide">
                      Task Status
                    </label>
                    <div className="flex gap-2">
                      {["completed", "in-progress", "on-hold"].map((s) => (
                        <button
                          key={s}
                          onClick={() => setPostBreakStatus(s)}
                          className={`flex-1 py-2 rounded-lg text-[11px] font-semibold cursor-pointer transition-all ${
                            postBreakStatus === s
                              ? "bg-terracotta text-white"
                              : "bg-parchment text-bark border border-sand hover:border-terracotta"
                          }`}
                        >
                          {s === "completed" ? "Completed" : s === "in-progress" ? "In Progress" : "On Hold"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Client Memo */}
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-blue mb-1 tracking-wide">
                      Client Memo
                    </label>
                    <textarea
                      value={postBreakClientMemo}
                      onChange={(e) => setPostBreakClientMemo(e.target.value)}
                      placeholder="Notes visible to the client..."
                      rows={2}
                      className="w-full rounded-lg border border-sand px-3 py-2 text-xs text-espresso outline-none focus:border-slate-blue resize-none"
                    />
                  </div>

                  {/* Internal Memo */}
                  <div>
                    <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide">
                      Internal Memo
                    </label>
                    <textarea
                      value={postBreakInternalMemo}
                      onChange={(e) => setPostBreakInternalMemo(e.target.value)}
                      placeholder="Internal notes (not visible to client)..."
                      rows={2}
                      className="w-full rounded-lg border border-sand px-3 py-2 text-xs text-espresso outline-none focus:border-walnut resize-none"
                    />
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={skipPostBreakMemos}
                      className="flex-1 py-2.5 rounded-lg border border-sand text-[12px] font-semibold text-bark cursor-pointer transition-all hover:border-terracotta hover:text-terracotta"
                    >
                      Skip
                    </button>
                    <button
                      onClick={savePostBreakMemosAndDismiss}
                      disabled={!postBreakClientMemo.trim() && !postBreakInternalMemo.trim()}
                      className="flex-1 py-2.5 rounded-lg bg-terracotta text-white text-[12px] font-semibold cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50"
                    >
                      Save & Continue
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ─── Message Notifications ─── */}
      {messages.length > 0 && (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 max-w-sm">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className="bg-white rounded-xl border border-sand shadow-lg p-4 animate-in slide-in-from-right"
            >
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-terracotta flex items-center justify-center shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold text-terracotta mb-0.5">
                    Message from {msg.senderName}
                  </div>
                  <div className="text-[13px] text-espresso leading-snug">
                    {msg.content}
                  </div>
                  <div className="text-[10px] text-stone mt-1">
                    {new Date(msg.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </div>
                </div>
                <button
                  onClick={() => dismissMessage(msg.id)}
                  className="text-bark hover:text-terracotta text-lg leading-none shrink-0 cursor-pointer"
                >
                  &times;
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
