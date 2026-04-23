"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import SessionBanner, { type SessionState } from "@/components/SessionBanner";
import ActiveTaskBar from "@/components/ActiveTaskBar";
import TaskEntryForm, { type TaskFormData } from "@/components/TaskEntryForm";
import TeamSidebar from "@/components/TeamSidebar";
import ActivityLog from "@/components/ActivityLog";
import LiveSessionPrompt from "@/components/LiveSessionPrompt";
import ProjectSidebar, { type QuickActionMapping } from "@/components/ProjectSidebar";
import DailyTaskPlanner from "@/components/DailyTaskPlanner";
import VaAssignmentsColumn from "@/components/VaAssignmentsColumn";
import ClaimableTasksColumn from "@/components/ClaimableTasksColumn";
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
    timeZone: timezone || "UTC",
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
    timeZone: timezone || "UTC",
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
  const [claimRefreshKey, setClaimRefreshKey] = useState(0);
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
  const [orgTimezone, setOrgTimezone] = useState<string>("UTC");

  // In-app messages
  const [messages, setMessages] = useState<(Message & { senderName?: string })[]>([]);

  // Loading state
  const [loading, setLoading] = useState(true);

  // Session action debounce — prevents double-taps on Clock In/Out/Break
  const [sessionActionPending, setSessionActionPending] = useState(false);

  // VA has fixed/project-based task assignments
  const [hasFixedAssignments, setHasFixedAssignments] = useState(false);

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
  const consecutiveCaptureFailuresRef = useRef(0);
  const [showScreenShareAlert, setShowScreenShareAlert] = useState(false);
  const [showScreenShareDisclaimer, setShowScreenShareDisclaimer] = useState(false);
  const [showWrongSurfaceError, setShowWrongSurfaceError] = useState(false);
  const disclaimerShownRef = useRef(false);
  const pendingCaptureLogIdRef = useRef<number | null>(null);

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

      // Check if VA has fixed/project-based task assignments
      if (userId && profileRes.data?.role === "va") {
        try {
          const assignRes = await fetch(`/api/va-task-assignments?va_id=${userId}&assignment_type=include`);
          const assignData = await assignRes.json();
          setHasFixedAssignments((assignData.assignments ?? []).length > 0);
        } catch {
          // silently ignore
        }
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

  // ─── Capture Requests (admin "Capture Now") ───────────────
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel("capture-requests-for-user")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "capture_requests",
          filter: `target_user_id=eq.${userId}`,
        },
        async (payload) => {
          const request = payload.new as { id: number; status: string };
          if (request.status !== "pending") return;

          const logId = activeLogIdRef.current;
          if (!logId) {
            await supabase
              .from("capture_requests")
              .update({ status: "failed", completed_at: new Date().toISOString() })
              .eq("id", request.id);
            return;
          }

          const blob = await captureFrame();
          if (!blob) {
            await supabase
              .from("capture_requests")
              .update({ status: "failed", completed_at: new Date().toISOString() })
              .eq("id", request.id);
            return;
          }

          const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
          const storagePath = `${userId}/${filename}`;

          const { error: uploadError } = await supabase.storage
            .from("screenshots")
            .upload(storagePath, blob, { contentType: "image/png" });

          if (uploadError) {
            await supabase
              .from("capture_requests")
              .update({ status: "failed", completed_at: new Date().toISOString() })
              .eq("id", request.id);
            return;
          }

          const { data: ssData } = await supabase
            .from("task_screenshots")
            .insert({
              user_id: userId,
              log_id: logId,
              filename,
              storage_path: storagePath,
              screenshot_type: "remote",
              capture_request_id: request.id,
            })
            .select()
            .single();

          await supabase
            .from("capture_requests")
            .update({
              status: "completed",
              log_id: logId,
              screenshot_id: ssData?.id ?? null,
              completed_at: new Date().toISOString(),
            })
            .eq("id", request.id);

          if (ssData) {
            setScreenshots((prev) => ({
              ...prev,
              [logId]: [...(prev[logId] || []), ssData as TaskScreenshot],
            }));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

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
    // Guard: ensure duration is never negative (clock skew protection)
    const startMs = activeTask.start_time ? new Date(activeTask.start_time).getTime() : Date.now();
    const durationMs = Math.max(0, new Date(now).getTime() - startMs);

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
    if (!userId || !profile || sessionActionPending) return;
    setSessionActionPending(true);
    const now = new Date().toISOString();

    // Create a "Planning" time_log entry so clock-in registers in activity log
    const { data: sortingLog } = await supabase
      .from("time_logs")
      .insert({
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
      })
      .select()
      .single();

    const sortingTask: ActiveTask = {
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
      logId: sortingLog?.id?.toString() || "",
      _startMs: Date.now(),
      billing_type: "hourly",
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
    setSessionActionPending(false);
  }, [userId, profile, supabase, sessionActionPending]);

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
      // Guard: ensure duration is never negative (clock skew protection)
      const startMs = activeTask.start_time ? new Date(activeTask.start_time).getTime() : Date.now();
      const durationMs = Math.max(0, new Date(now).getTime() - startMs);

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
        manual_status: null,
        form_fill_ms: 0,
        progress: null,
        billing_type: activeTask.billing_type || "hourly",
        task_rate: activeTask.task_rate ?? null,
        created_at: activeTask.start_time,
        deleted_at: null,
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
        billing_type: "hourly",
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
      billing_type: "hourly",
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
    if (!userId || sessionActionPending) return;
    setSessionActionPending(true);
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
    setSessionActionPending(false);
  }, [userId, supabase, session, breakElapsed, preBreakTask, sessionActionPending]);

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
        billing_type: preBreakTask.billing_type || "hourly",
        task_rate: preBreakTask.task_rate ?? null,
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
        billing_type: log.billing_type || "hourly",
        task_rate: log.task_rate ?? null,
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
      billing_type: log.billing_type || "hourly",
      task_rate: log.task_rate ?? null,
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

  // ─── Update progress status on a time_log (clickable badge) ───
  const updateLogProgress = useCallback(async (logId: number, progress: string) => {
    await supabase.from("time_logs").update({ progress }).eq("id", logId);
    setTimeLogs((prev) =>
      prev.map((log) =>
        log.id === logId ? { ...log, progress } as TimeLog : log
      )
    );
  }, [supabase]);

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
    async (blob: Blob, logId: number, screenshotType: 'start' | 'progress' | 'end' | 'manual' | 'remote', captureRequestId?: number) => {
      if (!userId) return undefined;

      const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
      const storagePath = `${userId}/${filename}`;

      const { error: uploadError } = await supabase.storage
        .from("screenshots")
        .upload(storagePath, blob, { contentType: "image/png" });

      if (uploadError) {
        console.error("Upload failed:", uploadError);
        return undefined;
      }

      const { data: ssData } = await supabase
        .from("task_screenshots")
        .insert({
          user_id: userId,
          log_id: logId,
          filename,
          storage_path: storagePath,
          screenshot_type: screenshotType,
          ...(captureRequestId !== undefined ? { capture_request_id: captureRequestId } : {}),
        })
        .select()
        .single();

      if (ssData) {
        setScreenshots((prev) => ({
          ...prev,
          [logId]: [...(prev[logId] || []), ssData as TaskScreenshot],
        }));
      }

      return ssData ?? undefined;
    },
    [userId, supabase]
  );

  /** Log a screenshot failure to task_screenshots (no file, just a record of what went wrong) */
  const logCaptureFailure = useCallback(
    async (logId: number, reason: string) => {
      if (!userId) return;
      await supabase.from("task_screenshots").insert({
        user_id: userId,
        log_id: logId,
        screenshot_type: "failed",
        failure_reason: reason,
      });
    },
    [userId, supabase]
  );

  /** Capture a frame silently from the persistent stream. Returns true if captured. */
  const silentCapture = useCallback(
    async (logId: number, screenshotType: 'start' | 'progress' | 'end' | 'manual'): Promise<boolean> => {
      // Guard: skip if a capture is already in progress
      if (isCapturingRef.current) {
        console.warn(`[Screenshot] Skipped (${screenshotType}): another capture is already in progress.`);
        return false;
      }
      // Guard: enforce 45-second cooldown between captures (skip for 'end' and 'manual' — those are intentional)
      if (screenshotType !== 'end' && screenshotType !== 'manual') {
        const now = Date.now();
        const secsSinceLast = Math.round((now - lastCaptureTimeRef.current) / 1000);
        if (now - lastCaptureTimeRef.current < 45_000) {
          console.warn(`[Screenshot] Skipped (${screenshotType}): cooldown active (${secsSinceLast}s since last capture, need 45s).`);
          return false;
        }
      }
      isCapturingRef.current = true;
      try {
        const blob = await captureFrame();
        if (!blob) {
          const reason = "Screen share stream stopped. VA may have clicked 'Stop sharing' in the browser.";
          console.warn(`[Screenshot] Failed (${screenshotType}) for log ${logId}: ${reason}`);
          await logCaptureFailure(logId, reason);
          consecutiveCaptureFailuresRef.current += 1;
          if (consecutiveCaptureFailuresRef.current >= 3) {
            setShowScreenShareAlert(true);
          }
          return false;
        }
        await uploadScreenshot(blob, logId, screenshotType);
        lastCaptureTimeRef.current = Date.now();
        consecutiveCaptureFailuresRef.current = 0; // Reset on success
        console.info(`[Screenshot] Captured (${screenshotType}) for log ${logId}.`);
        return true;
      } catch (err) {
        const reason = `Unexpected error during capture: ${err instanceof Error ? err.message : String(err)}`;
        console.error(`[Screenshot] Error during capture (${screenshotType}) for log ${logId}:`, err);
        await logCaptureFailure(logId, reason);
        consecutiveCaptureFailuresRef.current += 1;
        if (consecutiveCaptureFailuresRef.current >= 3) {
          setShowScreenShareAlert(true);
        }
        return false;
      } finally {
        isCapturingRef.current = false;
      }
    },
    [captureFrame, uploadScreenshot, logCaptureFailure]
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

  // No visibility change listener needed — screenshots are taken on a fixed
  // 10-minute schedule regardless of tab activity/inactivity.

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

      // Every 10 minutes consistently
      const scheduleRepeating = (afterMs: number) => {
        const t = setTimeout(() => {
          if (activeLogIdRef.current === logId) {
            silentCapture(logId, "progress");
            scheduleRepeating(600_000); // Next one in 10 min
          }
        }, afterMs);
        captureTimersRef.current.push(t);
      };

      // First repeating capture at 10 min
      scheduleRepeating(600_000);
    },
    [clearCaptureTimers, silentCapture]
  );

  // ─── Auto-update assignment status helper ───────────────────
  const autoUpdateAssignmentStatus = useCallback(
    async (taskName: string) => {
      if (role !== "va" || !taskName || !userId) return;
      try {
        const assignRes = await fetch(`/api/va-task-assignments?va_id=${userId}&assignment_type=include`);
        const assignData = await assignRes.json();
        const formTaskLower = taskName.trim().toLowerCase();
        const matching = (assignData.assignments ?? []).find(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (a: any) => {
            if (a.status !== "not_started" && a.status !== "revision_needed") return false;
            const libName = (a.project_task_assignments?.task_library?.task_name ?? "").trim().toLowerCase();
            if (!libName) return false;
            return libName === formTaskLower || libName.includes(formTaskLower) || formTaskLower.includes(libName);
          }
        );
        if (matching) {
          await fetch("/api/va-task-assignments", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: matching.id, status: "in_progress" }),
          });
        }
      } catch (err) {
        console.error("Auto-status update failed:", err);
      }
    },
    [role, userId]
  );

  // ─── Start Task ─────────────────────────────────────────────

  const startTask = useCallback(
    async (formData: TaskFormData) => {
      if (!userId || !profile) return;
      const now = new Date().toISOString();

      // ─── Fixed Task Log: instant insert, no timer, no screenshots ───
      if (formData._isFixedTaskLog) {
        const progressValue = formData.task_status
          ? formData.task_status.toLowerCase().replace(" ", "_")
          : "in_progress";

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
            end_time: now,
            duration_ms: 0,
            billable: formData.category !== "Personal",
            client_memo: formData.client_memo || null,
            internal_memo: formData.internal_memo || null,
            form_fill_ms: formData.form_fill_ms || 0,
            billing_type: "fixed",
            task_rate: formData.task_rate ?? null,
            progress: progressValue,
          })
          .select()
          .single();

        if (logData) {
          setTimeLogs((prev) => [logData as TimeLog, ...prev]);
        }
        // Auto-update assignment status for fixed tasks too
        await autoUpdateAssignmentStatus(formData.task_name);
        return; // No timer, no active task, no screenshots
      }

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

      // If memos were for the old task (wizard flow), use new_task_client_memo for the new task
      const newTaskClientMemo = formData.task_status
        ? (formData.new_task_client_memo || null)
        : (formData.client_memo || null);
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
          billing_type: formData.billing_type || "hourly",
          task_rate: formData.task_rate ?? null,
        })
        .select()
        .single();

      // Auto-update assignment status to "in_progress" when VA starts working
      await autoUpdateAssignmentStatus(formData.task_name);

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
        billing_type: formData.billing_type || "hourly",
        task_rate: formData.task_rate ?? null,
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
        } else if (!disclaimerShownRef.current) {
          // First time this session — show disclaimer before prompting
          pendingCaptureLogIdRef.current = newLogId;
          setShowScreenShareDisclaimer(true);
        } else {
          // Disclaimer already acknowledged — go straight to share picker
          const result = await requestStream();
          if (result === 'granted') {
            scheduleCaptureSequence(newLogId);
          } else if (result === 'wrong-surface') {
            setShowWrongSurfaceError(true);
          }
        }
      }
    },
    [userId, profile, supabase, session, activeTask, sessionState, stopCurrentTask, screenShareActive, silentCapture, clearCaptureTimers, scheduleCaptureSequence, requestStream, autoUpdateAssignmentStatus]
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
        billing_type: liveLog.billing_type || "hourly",
        task_rate: liveLog.task_rate ?? null,
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
          client_memo: task.task_name,
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
    (mapping: QuickActionMapping) => {
      window.dispatchEvent(
        new CustomEvent("minuteflow-prefill", {
          detail: mapping,
        })
      );
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
      {/* Screen Share Alert — shown after 3 consecutive capture failures */}
      {showScreenShareAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 text-center">
            <div className="text-3xl mb-3">⚠️</div>
            <h2 className="font-serif text-lg font-bold text-espresso mb-2">Screenshots Stopped</h2>
            <p className="text-sm text-bark mb-4">
              Your screen share may have stopped. Screenshots haven&apos;t been captured for the last 3 attempts.
              Please re-share your screen so your activity can be tracked.
            </p>
            <button
              onClick={async () => {
                setShowScreenShareAlert(false);
                consecutiveCaptureFailuresRef.current = 0;
                const result = await requestStream();
                if (result === 'wrong-surface') setShowWrongSurfaceError(true);
              }}
              className="w-full bg-terracotta text-white rounded-lg py-2.5 text-sm font-medium hover:bg-terracotta/90 transition-colors"
            >
              Re-share My Screen
            </button>
            <button
              onClick={() => {
                setShowScreenShareAlert(false);
                consecutiveCaptureFailuresRef.current = 0;
              }}
              className="w-full mt-2 text-xs text-stone hover:text-bark transition-colors py-1"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Screen Share Disclaimer — shown before the share picker on first task */}
      {showScreenShareDisclaimer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 text-center">
            <div className="text-3xl mb-3">📷</div>
            <h2 className="font-serif text-lg font-bold text-espresso mb-2">Screen Capture Active</h2>
            <p className="text-sm text-bark mb-3">
              MinuteFlow will capture screenshots of your <strong>entire screen</strong> while you&apos;re clocked in to track your work progress.
            </p>
            <p className="text-sm text-bark mb-4">
              During work hours, keep only work-related tabs and apps open. If you need to open something personal, do it on your break — not while you&apos;re clocked in.
            </p>
            <button
              onClick={async () => {
                disclaimerShownRef.current = true;
                setShowScreenShareDisclaimer(false);
                const result = await requestStream();
                if (result === 'granted') {
                  const logId = pendingCaptureLogIdRef.current;
                  if (logId) scheduleCaptureSequence(logId);
                } else if (result === 'wrong-surface') {
                  setShowWrongSurfaceError(true);
                }
              }}
              className="w-full bg-terracotta text-white rounded-lg py-2.5 text-sm font-medium hover:bg-terracotta/90 transition-colors"
            >
              Got It — Share My Screen
            </button>
          </div>
        </div>
      )}

      {/* Wrong Surface Error — shown when user picks a window/tab instead of entire screen */}
      {showWrongSurfaceError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 text-center">
            <div className="text-3xl mb-3">🖥️</div>
            <h2 className="font-serif text-lg font-bold text-espresso mb-2">Please Share Your Entire Screen</h2>
            <p className="text-sm text-bark mb-4">
              It looks like you shared a window or browser tab instead of your entire screen.
              Please try again and select <strong>&quot;Entire Screen&quot;</strong> (or your monitor) from the share picker.
            </p>
            <button
              onClick={async () => {
                setShowWrongSurfaceError(false);
                const result = await requestStream();
                if (result === 'granted') {
                  const logId = pendingCaptureLogIdRef.current ?? activeLogIdRef.current;
                  if (logId) scheduleCaptureSequence(logId);
                } else if (result === 'wrong-surface') {
                  setShowWrongSurfaceError(true);
                }
              }}
              className="w-full bg-terracotta text-white rounded-lg py-2.5 text-sm font-medium hover:bg-terracotta/90 transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={() => setShowWrongSurfaceError(false)}
              className="w-full mt-2 text-xs text-stone hover:text-bark transition-colors py-1"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

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
        timezone={orgTimezone}
        actionPending={sessionActionPending}
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

      {/* Layout: Team (left) + Task Form (center) + Daily Planner + Projects/Assignments (right) */}
      {(() => {
        // ─── VA Visibility Rules ───────────────────────────────────
        const isVa = role === "va";
        const pos = profile?.position ?? "";
        const isProjectBased = pos === "Project Based VA";
        const isPerTask = pos === "Per Task VA";
        const isHourly = !isProjectBased && !isPerTask; // Full-time, Part-time, null

        // My Assignments: Project Based → always; Per Task → always; Hourly → only if they have fixed task assignments
        const canSeeAssignments = isVa && (isProjectBased || isPerTask || (isHourly && hasFixedAssignments));
        // Available Tasks: controlled by per-VA toggle
        const canSeeAvailable = isVa && !!profile?.can_see_available_tasks;

        // Grid: when VA is idle, always show 4 columns (locked panels fill the gaps)
        const gridClass = isVa
          ? sessionState === "idle"
            ? "grid-cols-1 md:grid-cols-[1fr_260px_260px_260px]"
            : "grid-cols-1 md:grid-cols-[1fr_260px_260px]"
          : "grid-cols-1 md:grid-cols-[1fr_280px] lg:grid-cols-[240px_1fr_280px_280px]";

        return (
          <div className={`grid gap-5 mb-6 ${gridClass}`}>
            {role !== "va" && <TeamSidebar members={teamMembers} timeLogs={timeLogs} timezone={orgTimezone} />}
            <TaskEntryForm
              onStartTask={handleCheckAndStartTask}
              hasActiveTask={!!activeTask || sessionState === "clocked-in" || sessionState === "on-break"}
              role={role}
              sessionState={sessionState}
            />
            {userId && (
              <DailyTaskPlanner
                userId={userId}
                role={role}
                onStartPlannedTask={handleStartPlannedTask}
                teamMembers={teamMembers.map((m) => m.profile)}
                orgTimezone={orgTimezone}
              />
            )}
            {/* VA Assignments — visible BEFORE clock-in, based on position rules */}
            {isVa && userId && sessionState === "idle" && canSeeAssignments && (
              <VaAssignmentsColumn userId={userId} key={`va-assign-${claimRefreshKey}`} />
            )}
            {/* Locked panel for VAs who can't see assignments */}
            {isVa && userId && sessionState === "idle" && !canSeeAssignments && (
              <div className="rounded-xl border border-sand bg-white/60 p-3 flex flex-col items-center justify-center text-center min-h-[120px]">
                <svg className="h-6 w-6 text-stone/40 mb-1.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
                <p className="text-[11px] text-stone font-medium">My Assignments</p>
                <p className="text-[10px] text-stone/60 mt-0.5">Locked</p>
              </div>
            )}
            {/* Available Tasks to Claim — only if admin toggled on for this VA */}
            {isVa && sessionState === "idle" && canSeeAvailable && (
              <ClaimableTasksColumn onClaimed={() => setClaimRefreshKey((k) => k + 1)} />
            )}
            {/* Locked panel for VAs who can't see available tasks */}
            {isVa && sessionState === "idle" && !canSeeAvailable && (
              <div className="rounded-xl border border-sand bg-white/60 p-3 flex flex-col items-center justify-center text-center min-h-[120px]">
                <svg className="h-6 w-6 text-stone/40 mb-1.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
                <p className="text-[11px] text-stone font-medium">Available Tasks</p>
                <p className="text-[10px] text-stone/60 mt-0.5">Locked</p>
              </div>
            )}
            {/* Quick Pick — hidden for VAs before clock-in */}
            {(role !== "va" || sessionState !== "idle") && (
              <ProjectSidebar
                onSelectProject={handleProjectSelect}
                onQuickAction={handleQuickAction}
                isAdmin={role === "admin" || role === "manager"}
              />
            )}
          </div>
        );
      })()}

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
        onUpdateProgress={updateLogProgress}
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
                    {new Date(msg.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: orgTimezone })}
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
