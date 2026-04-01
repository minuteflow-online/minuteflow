"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type {
  Profile,
  Session,
  TimeLog,
  TaskScreenshot,
  ExtensionHeartbeat,
  TimeCorrectionRequest,
  BreakCorrectionRequest,
  OrganizationSettings,
  SortingReview,
  TeamAssignment,
  Client,
  Invoice,
  InvoiceLineItem,
  InvoicePayment,
} from "@/types/database";
import {
  formatDuration,
  getInitials,
  getAvatarColor,
  todayStart,
  formatTimeET,
} from "@/lib/utils";

/* ── Helpers ─────────────────────────────────────────────── */

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return date.toLocaleDateString();
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatTimeShort(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function screenshotTypeLabel(type: string | null): string {
  if (!type) return "Manual";
  const labels: Record<string, string> = {
    start: "Start",
    progress: "Progress",
    end: "End",
    remote: "Remote",
    manual: "Manual",
  };
  return labels[type] || type;
}

function screenshotTypeBadge(type: string | null): { bg: string; text: string } {
  if (!type) return { bg: "bg-parchment", text: "text-bark" };
  const styles: Record<string, { bg: string; text: string }> = {
    start: { bg: "bg-sage-soft", text: "text-sage" },
    progress: { bg: "bg-slate-blue-soft", text: "text-slate-blue" },
    end: { bg: "bg-terracotta-soft", text: "text-terracotta" },
    remote: { bg: "bg-amber-soft", text: "text-amber" },
    manual: { bg: "bg-parchment", text: "text-bark" },
  };
  return styles[type] || { bg: "bg-parchment", text: "text-bark" };
}

/* ── Sidebar Tab Type ────────────────────────────────────── */

type AdminTab = "overview" | "screenshots" | "team" | "organization" | "corrections" | "sorting" | "password" | "accounts" | "clients" | "invoices";

const SIDEBAR_TABS: { id: AdminTab; label: string; icon: React.ReactNode }[] = [
  {
    id: "overview",
    label: "Overview",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    id: "screenshots",
    label: "Screenshots",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
    ),
  },
  {
    id: "team",
    label: "Team Management",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 00-3-3.87" />
        <path d="M16 3.13a4 4 0 010 7.75" />
      </svg>
    ),
  },
  {
    id: "accounts",
    label: "Accounts",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z" />
        <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
      </svg>
    ),
  },
  {
    id: "clients",
    label: "Clients",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
  {
    id: "invoices",
    label: "Invoices",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
  },
  {
    id: "organization",
    label: "Organization",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    id: "corrections",
    label: "Corrections",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    ),
  },
  {
    id: "sorting",
    label: "Sorting Review",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 6h18M3 12h12M3 18h6" />
      </svg>
    ),
  },
  {
    id: "password",
    label: "Change Password",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0110 0v4" />
      </svg>
    ),
  },
];

/* ── Main Admin Page ─────────────────────────────────────── */

export default function AdminPage() {
  const supabase = createClient();

  // Active tab
  const [activeTab, setActiveTab] = useState<AdminTab>("overview");

  // Data state
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [allScreenshots, setAllScreenshots] = useState<TaskScreenshot[]>([]);
  const [allLogs, setAllLogs] = useState<TimeLog[]>([]);
  const [heartbeats, setHeartbeats] = useState<ExtensionHeartbeat[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Screenshot viewer state
  const [selectedScreenshot, setSelectedScreenshot] = useState<TaskScreenshot | null>(null);
  const [screenshotUrls, setScreenshotUrls] = useState<Record<number, string>>({});
  const [screenshotFilter, setScreenshotFilter] = useState<string>("all");
  const [screenshotDateFilter, setScreenshotDateFilter] = useState<string>("today");
  const [loadingUrls, setLoadingUrls] = useState(false);

  // Message state
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
  const [messageText, setMessageText] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);

  // Correction requests
  const [correctionRequests, setCorrectionRequests] = useState<TimeCorrectionRequest[]>([]);
  const [breakCorrectionRequests, setBreakCorrectionRequests] = useState<BreakCorrectionRequest[]>([]);
  const [breakReviewNotes, setBreakReviewNotes] = useState<Record<number, string>>({});
  const [breakCustomMs, setBreakCustomMs] = useState<Record<number, string>>({});

  // Sorting review
  const [sortingReviews, setSortingReviews] = useState<SortingReview[]>([]);
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});

  // Clock
  const [clock, setClock] = useState("");

  useEffect(() => {
    function updateClock() {
      const now = new Date();
      setClock(
        now.toLocaleTimeString("en-US", {
          timeZone: "America/New_York",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        }) + " ET"
      );
    }
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  /* ── Data Fetching ──────────────────────────────────────── */

  const fetchData = useCallback(async () => {
    const today = todayStart();
    const supabase = createClient();

    let screenshotDateStart = today;
    if (screenshotDateFilter === "week") {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      d.setHours(0, 0, 0, 0);
      screenshotDateStart = d.toISOString();
    } else if (screenshotDateFilter === "month") {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      d.setHours(0, 0, 0, 0);
      screenshotDateStart = d.toISOString();
    } else if (screenshotDateFilter === "all-time") {
      screenshotDateStart = "2020-01-01T00:00:00.000Z";
    }

    const [
      profilesRes,
      sessionsRes,
      todayLogsRes,
      screenshotsRes,
      allLogsRes,
      heartbeatsRes,
      authRes,
      correctionsRes,
      sortingRes,
      breakCorrectionsRes,
    ] = await Promise.all([
      supabase.from("profiles").select("*"),
      supabase.from("sessions").select("*"),
      supabase.from("time_logs").select("*").gte("start_time", today),
      supabase
        .from("task_screenshots")
        .select("*")
        .gte("created_at", screenshotDateStart)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("time_logs")
        .select("*")
        .order("start_time", { ascending: false })
        .limit(500),
      supabase.from("extension_heartbeats").select("*"),
      supabase.auth.getUser(),
      supabase
        .from("time_correction_requests")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      supabase
        .from("sorting_review")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      supabase
        .from("break_correction_requests")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
    ]);

    setProfiles((profilesRes.data ?? []) as Profile[]);
    setSessions((sessionsRes.data ?? []) as Session[]);
    setLogs((todayLogsRes.data ?? []) as TimeLog[]);
    setAllScreenshots((screenshotsRes.data ?? []) as TaskScreenshot[]);
    setAllLogs((allLogsRes.data ?? []) as TimeLog[]);
    setHeartbeats((heartbeatsRes.data ?? []) as ExtensionHeartbeat[]);
    setCorrectionRequests((correctionsRes.data ?? []) as TimeCorrectionRequest[]);
    setSortingReviews((sortingRes.data ?? []) as SortingReview[]);
    setBreakCorrectionRequests((breakCorrectionsRes.data ?? []) as BreakCorrectionRequest[]);

    if (authRes.data?.user) {
      setCurrentUserId(authRes.data.user.id);
    }

    setLoading(false);
  }, [screenshotDateFilter]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);

    const supabase = createClient();
    const channel = supabase
      .channel("admin-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "sessions" }, () => fetchData())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "time_logs" }, () => fetchData())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "task_screenshots" }, () => fetchData())
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [fetchData]);

  /* ── Generate signed URLs for screenshots ───────────────── */

  useEffect(() => {
    async function loadUrls() {
      if (allScreenshots.length === 0) return;

      const supabase = createClient();
      const missing = allScreenshots.filter((s) => !screenshotUrls[s.id]);
      if (missing.length === 0) return;

      setLoadingUrls(true);
      const newUrls: Record<number, string> = { ...screenshotUrls };

      for (let i = 0; i < missing.length; i += 10) {
        const batch = missing.slice(i, i + 10);
        const results = await Promise.all(
          batch.map(async (ss) => {
            const { data } = await supabase.storage
              .from("screenshots")
              .createSignedUrl(ss.storage_path, 3600);
            return { id: ss.id, url: data?.signedUrl || "" };
          })
        );
        results.forEach((r) => {
          if (r.url) newUrls[r.id] = r.url;
        });
      }

      setScreenshotUrls(newUrls);
      setLoadingUrls(false);
    }

    loadUrls();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allScreenshots]);

  /* ── Computed data ──────────────────────────────────────── */

  const profileMap = useMemo(() => {
    const map = new Map<string, Profile>();
    profiles.forEach((p) => map.set(p.id, p));
    return map;
  }, [profiles]);

  const logMap = useMemo(() => {
    const map = new Map<number, TimeLog>();
    allLogs.forEach((l) => map.set(l.id, l));
    return map;
  }, [allLogs]);

  const monitorMembers = useMemo(() => {
    return profiles.filter((p) => p.is_active !== false).map((profile) => {
      const session = sessions.find((s) => s.user_id === profile.id) ?? null;
      const heartbeat = heartbeats.find((h) => h.user_id === profile.id) ?? null;
      const userLogs = logs.filter((l) => l.user_id === profile.id);
      const userScreenshotsToday = allScreenshots.filter(
        (s) => s.user_id === profile.id && new Date(s.created_at).toDateString() === new Date().toDateString()
      );

      let status: "live" | "break" | "off" = "off";
      let currentTask = "No activity today";

      if (session?.clocked_in && session.active_task) {
        if (session.active_task.isBreak) {
          status = "break";
          currentTask = "On Break";
        } else {
          status = "live";
          const parts = [session.active_task.task_name, session.active_task.account].filter(Boolean);
          currentTask = parts.join(" -- ") || "Working";
        }
      } else if (userLogs.length > 0) {
        const sorted = [...userLogs].sort(
          (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
        );
        currentTask = `Last: ${sorted[0].task_name}`;
      }

      const hasExtension =
        heartbeat &&
        heartbeat.is_active &&
        new Date(heartbeat.last_seen).getTime() > Date.now() - 2 * 60 * 1000;

      const latestScreenshot =
        userScreenshotsToday.length > 0 ? userScreenshotsToday[0] : null;

      return {
        profile,
        session,
        status,
        currentTask,
        hasExtension: !!hasExtension,
        latestScreenshot,
        todayScreenshots: userScreenshotsToday.length,
        todayHoursMs: userLogs
          .filter((l) => l.category !== "Break")
          .reduce((sum, l) => sum + (l.duration_ms || 0), 0),
        todayTasks: userLogs.filter((l) => l.category !== "Break").length,
        wizardTimeMs: userLogs.reduce((sum, l) => sum + (l.form_fill_ms || 0), 0),
      };
    }).sort((a, b) => {
      const order = { live: 0, break: 1, off: 2 };
      return order[a.status] - order[b.status];
    });
  }, [profiles, sessions, heartbeats, logs, allScreenshots]);

  const stats = useMemo(() => {
    const activeCount = monitorMembers.filter((m) => m.status === "live").length;
    const todayHoursMs = logs
      .filter((l) => l.category !== "Break")
      .reduce((sum, l) => sum + (l.duration_ms || 0), 0);
    const todayScreenshots = allScreenshots.filter(
      (s) => new Date(s.created_at).toDateString() === new Date().toDateString()
    ).length;
    const todayTasks = logs.filter((l) => l.end_time && l.category !== "Break").length;
    const wizardTimeMs = logs.reduce((sum, l) => sum + (l.form_fill_ms || 0), 0);

    return { activeCount, todayHoursMs, todayScreenshots, todayTasks, wizardTimeMs };
  }, [logs, allScreenshots, monitorMembers]);

  const filteredScreenshots = useMemo(() => {
    let filtered = allScreenshots;
    if (screenshotFilter !== "all") {
      filtered = filtered.filter((s) => s.user_id === screenshotFilter);
    }
    return filtered;
  }, [allScreenshots, screenshotFilter]);

  const groupedScreenshots = useMemo(() => {
    const groups: Record<string, Record<string, TaskScreenshot[]>> = {};
    filteredScreenshots.forEach((ss) => {
      const dateKey = new Date(ss.created_at).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      if (!groups[dateKey]) groups[dateKey] = {};
      const userId = ss.user_id;
      if (!groups[dateKey][userId]) groups[dateKey][userId] = [];
      groups[dateKey][userId].push(ss);
    });
    return groups;
  }, [filteredScreenshots]);

  const activityEvents = useMemo(() => {
    const events: {
      id: string;
      type: "task-start" | "task-end" | "screenshot" | "break";
      text: string;
      userName: string;
      time: string;
      timestamp: number;
    }[] = [];

    logs.forEach((l) => {
      const profile = profileMap.get(l.user_id);
      const name = profile?.full_name.split(" ")[0] || "Unknown";

      if (l.category === "Break") {
        events.push({
          id: `break-${l.id}`,
          type: "break",
          text: `took a break`,
          userName: name,
          time: getTimeAgo(new Date(l.start_time)),
          timestamp: new Date(l.start_time).getTime(),
        });
      } else if (l.end_time) {
        events.push({
          id: `end-${l.id}`,
          type: "task-end",
          text: `completed "${l.task_name}"${l.account ? ` for ${l.account}` : ""}`,
          userName: name,
          time: getTimeAgo(new Date(l.end_time)),
          timestamp: new Date(l.end_time).getTime(),
        });
      } else {
        events.push({
          id: `start-${l.id}`,
          type: "task-start",
          text: `started "${l.task_name}"${l.account ? ` for ${l.account}` : ""}`,
          userName: name,
          time: getTimeAgo(new Date(l.start_time)),
          timestamp: new Date(l.start_time).getTime(),
        });
      }
    });

    allScreenshots
      .filter((s) => new Date(s.created_at).toDateString() === new Date().toDateString())
      .forEach((ss) => {
        const profile = profileMap.get(ss.user_id);
        const name = profile?.full_name.split(" ")[0] || "Unknown";
        const typeLabel = ss.screenshot_type ? ` (${screenshotTypeLabel(ss.screenshot_type)})` : "";
        events.push({
          id: `ss-${ss.id}`,
          type: "screenshot",
          text: `screenshot captured${typeLabel}`,
          userName: name,
          time: getTimeAgo(new Date(ss.created_at)),
          timestamp: new Date(ss.created_at).getTime(),
        });
      });

    return events.sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
  }, [logs, allScreenshots, profileMap]);

  /* ── Actions ────────────────────────────────────────────── */

  const handleCaptureNow = async (targetUserId: string) => {
    if (!currentUserId) return;
    const supabase = createClient();
    await supabase.from("capture_requests").insert({
      target_user_id: targetUserId,
      requested_by: currentUserId,
      status: "pending",
    });
    fetchData();
  };

  const handleCaptureAll = async () => {
    if (!currentUserId) return;
    const supabase = createClient();
    const activeMembers = monitorMembers.filter((m) => m.status === "live");
    if (activeMembers.length === 0) return;
    await Promise.all(
      activeMembers.map((m) =>
        supabase.from("capture_requests").insert({
          target_user_id: m.profile.id,
          requested_by: currentUserId,
          status: "pending",
        })
      )
    );
    fetchData();
  };

  const handleForceClockOut = async (targetUserId: string) => {
    const supabase = createClient();
    const now = new Date().toISOString();

    // Close any open time logs for this user
    await supabase
      .from("time_logs")
      .update({ end_time: now, duration_ms: 0 })
      .eq("user_id", targetUserId)
      .is("end_time", null);

    // Reset their session (use update, not upsert — RLS INSERT policy blocks admins)
    await supabase
      .from("sessions")
      .update({
        clocked_in: false,
        active_task: null,
        updated_at: now,
      })
      .eq("user_id", targetUserId);

    fetchData();
  };

  const handleSendMessage = async () => {
    if (!currentUserId || !messageTarget || !messageText.trim()) return;
    setSendingMessage(true);
    const supabase = createClient();
    await supabase.from("messages").insert({
      target_user_id: messageTarget,
      sender_id: currentUserId,
      content: messageText.trim(),
    });
    setMessageText("");
    setMessageTarget(null);
    setSendingMessage(false);
  };

  /* ── Correction Request Handlers ───────────────────────── */

  const handleApproveCorrection = async (request: TimeCorrectionRequest) => {
    if (!currentUserId) return;
    const supabase = createClient();

    const changes = request.requested_changes as Record<string, string>;
    const updatePayload: Record<string, unknown> = {};
    const auditRecords: { log_id: number; edited_by: string; field_name: string; old_value: string | null; new_value: string | null }[] = [];

    const { data: currentLog } = await supabase
      .from("time_logs")
      .select("*")
      .eq("id", request.log_id)
      .single();

    if (currentLog) {
      Object.entries(changes).forEach(([field, newValue]) => {
        updatePayload[field] = newValue || null;
        auditRecords.push({
          log_id: request.log_id,
          edited_by: currentUserId,
          field_name: field,
          old_value: (currentLog as Record<string, unknown>)[field] != null ? String((currentLog as Record<string, unknown>)[field]) : null,
          new_value: newValue || null,
        });
      });

      if (changes.start_time || changes.end_time) {
        const startTime = changes.start_time || currentLog.start_time;
        const endTime = changes.end_time || currentLog.end_time;
        if (startTime && endTime) {
          updatePayload.duration_ms = new Date(endTime).getTime() - new Date(startTime).getTime();
        }
      }

      await supabase.from("time_logs").update(updatePayload).eq("id", request.log_id);

      if (auditRecords.length > 0) {
        await supabase.from("time_log_edits").insert(auditRecords);
      }
    }

    await supabase
      .from("time_correction_requests")
      .update({
        status: "approved",
        reviewed_by: currentUserId,
        review_notes: reviewNotes[request.id] || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", request.id);

    fetchData();
  };

  const handleDenyCorrection = async (request: TimeCorrectionRequest) => {
    if (!currentUserId) return;
    const supabase = createClient();

    await supabase
      .from("time_correction_requests")
      .update({
        status: "denied",
        reviewed_by: currentUserId,
        review_notes: reviewNotes[request.id] || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", request.id);

    fetchData();
  };

  /* ── Break Correction Handlers ─────────────────────────── */

  const handleApproveBreakCorrection = async (req: BreakCorrectionRequest) => {
    if (!currentUserId) return;
    const supabase = createClient();

    // If a custom billable amount was entered, use it. Otherwise, keep the excess as non-billable.
    const customMs = breakCustomMs[req.id] ? parseInt(breakCustomMs[req.id], 10) * 60 * 1000 : null;

    if (customMs !== null && customMs > 0) {
      // Recalculate which break logs should be billable vs non-billable
      // Custom billable amount means only (total_break - custom) is non-billable
      const nonBillableMs = Math.max(0, req.total_break_ms - customMs);

      if (nonBillableMs > 0) {
        // Flip ALL break logs to billable first, then flip the excess ones
        await supabase
          .from("time_logs")
          .update({ billable: true })
          .in("id", req.break_log_ids);

        // Now flip the last N break logs to non-billable to cover the non-billable amount
        const { data: breakLogs } = await supabase
          .from("time_logs")
          .select("id, duration_ms, start_time")
          .in("id", req.break_log_ids)
          .order("start_time", { ascending: false });

        if (breakLogs) {
          let remaining = nonBillableMs;
          const idsToFlip: number[] = [];
          for (const bl of breakLogs) {
            if (remaining <= 0) break;
            idsToFlip.push(bl.id);
            remaining -= (bl.duration_ms || 0);
          }
          if (idsToFlip.length > 0) {
            await supabase
              .from("time_logs")
              .update({ billable: false })
              .in("id", idsToFlip);
          }
        }
      } else {
        // Custom amount covers all breaks — make them all billable
        await supabase
          .from("time_logs")
          .update({ billable: true })
          .in("id", req.break_log_ids);
      }
    }
    // If no custom amount, the break logs that were already flipped to non-billable at clock-out stay as is

    await supabase
      .from("break_correction_requests")
      .update({
        status: "approved",
        custom_billable_ms: customMs,
        reviewed_by: currentUserId,
        review_notes: breakReviewNotes[req.id] || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", req.id);

    fetchData();
  };

  const handleDenyBreakCorrection = async (req: BreakCorrectionRequest) => {
    if (!currentUserId) return;
    const supabase = createClient();

    // Deny = all excess break stays non-billable (already set at clock-out)
    // But also flip ALL break logs to non-billable since the whole break is denied
    await supabase
      .from("time_logs")
      .update({ billable: false })
      .in("id", req.break_log_ids);

    await supabase
      .from("break_correction_requests")
      .update({
        status: "denied",
        reviewed_by: currentUserId,
        review_notes: breakReviewNotes[req.id] || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", req.id);

    fetchData();
  };

  /* ── Render ─────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-56px)]">
        {/* Sidebar skeleton */}
        <div className="w-[220px] shrink-0 bg-[#3d2b1f]" />
        <div className="flex-1 p-6">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="font-serif text-2xl font-bold text-espresso">Admin Dashboard</h1>
          </div>
          <div className="grid grid-cols-4 gap-4 mb-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl border border-sand bg-white" />
            ))}
          </div>
          <div className="h-96 animate-pulse rounded-xl border border-sand bg-white" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-56px)]">
      {/* ── Left Sidebar ──────────────────────────────────── */}
      <aside className="w-[220px] shrink-0 bg-[#3d2b1f] flex flex-col">
        <div className="px-5 py-5 border-b border-white/10">
          <h2 className="text-sm font-bold text-white tracking-wide">Admin Panel</h2>
          <p className="mt-0.5 text-[10px] text-white/50">{clock}</p>
        </div>
        <nav className="flex-1 py-2 px-2 space-y-0.5">
          {SIDEBAR_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            const hasBadge = (tab.id === "corrections" && (correctionRequests.length + breakCorrectionRequests.length) > 0) || (tab.id === "sorting" && sortingReviews.length > 0);
            const badgeCount = tab.id === "corrections" ? correctionRequests.length + breakCorrectionRequests.length : tab.id === "sorting" ? sortingReviews.length : 0;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium transition-all cursor-pointer ${
                  isActive
                    ? "bg-terracotta text-white"
                    : "text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                {tab.icon}
                <span className="flex-1">{tab.label}</span>
                {hasBadge && (
                  <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-terracotta-soft px-1.5 text-[10px] font-bold text-terracotta">
                    {badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="px-3 py-3 border-t border-white/10">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] text-white/60 transition-all hover:bg-white/10 hover:text-white"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back to Dashboard
          </Link>
        </div>
      </aside>

      {/* ── Main Content Area ─────────────────────────────── */}
      <main className="flex-1 overflow-y-auto bg-cream">
        <div className="mx-auto max-w-6xl px-6 py-6">
          {/* Header */}
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="font-serif text-2xl font-bold text-espresso">
                {SIDEBAR_TABS.find((t) => t.id === activeTab)?.label || "Admin Dashboard"}
              </h1>
              <p className="mt-0.5 text-[13px] text-bark">
                {activeTab === "overview" && "Monitor team activity and performance"}
                {activeTab === "screenshots" && "View and manage team screenshots"}
                {activeTab === "team" && "Manage team members, roles, and pay rates"}
                {activeTab === "accounts" && "Manage accounts and link them to clients"}
                {activeTab === "clients" && "Manage clients"}
                {activeTab === "invoices" && "Generate and manage client invoices"}
                {activeTab === "organization" && "Edit organization settings"}
                {activeTab === "corrections" && "Review pending time and break correction requests"}
                {activeTab === "sorting" && "Review sorting task entries and assign billing"}
                {activeTab === "password" && "Update your admin password"}
              </p>
            </div>
            {activeTab === "overview" && (
              <button
                onClick={handleCaptureAll}
                className="rounded-lg bg-terracotta px-4 py-2 text-[13px] font-semibold text-white transition-all hover:bg-[#a85840] hover:-translate-y-px"
              >
                Capture All Now
              </button>
            )}
          </div>

          {/* ── Tab Content ───────────────────────────────── */}

          {activeTab === "overview" && (
            <OverviewTab
              stats={stats}
              profiles={profiles}
              monitorMembers={monitorMembers}
              screenshotUrls={screenshotUrls}
              activityEvents={activityEvents}
              handleCaptureNow={handleCaptureNow}
              handleForceClockOut={handleForceClockOut}
              setMessageTarget={setMessageTarget}
            />
          )}

          {activeTab === "screenshots" && (
            <ScreenshotsTab
              profiles={profiles}
              profileMap={profileMap}
              logMap={logMap}
              filteredScreenshots={filteredScreenshots}
              groupedScreenshots={groupedScreenshots}
              screenshotFilter={screenshotFilter}
              setScreenshotFilter={setScreenshotFilter}
              screenshotDateFilter={screenshotDateFilter}
              setScreenshotDateFilter={setScreenshotDateFilter}
              screenshotUrls={screenshotUrls}
              loadingUrls={loadingUrls}
              setSelectedScreenshot={setSelectedScreenshot}
            />
          )}

          {activeTab === "team" && (
            <TeamManagementTab
              profiles={profiles}
              fetchData={fetchData}
            />
          )}

          {activeTab === "accounts" && (
            <AccountsTab />
          )}

          {activeTab === "clients" && (
            <ClientsTab />
          )}

          {activeTab === "invoices" && (
            <InvoicesTab profiles={profiles} />
          )}

          {activeTab === "organization" && (
            <OrganizationTab />
          )}

          {activeTab === "corrections" && (
            <div className="space-y-6">
              <CorrectionsTab
                correctionRequests={correctionRequests}
                profileMap={profileMap}
                logMap={logMap}
                reviewNotes={reviewNotes}
                setReviewNotes={setReviewNotes}
                handleApproveCorrection={handleApproveCorrection}
                handleDenyCorrection={handleDenyCorrection}
              />
              <BreakCorrectionsSection
                breakCorrectionRequests={breakCorrectionRequests}
                profileMap={profileMap}
                breakReviewNotes={breakReviewNotes}
                setBreakReviewNotes={setBreakReviewNotes}
                breakCustomMs={breakCustomMs}
                setBreakCustomMs={setBreakCustomMs}
                handleApproveBreakCorrection={handleApproveBreakCorrection}
                handleDenyBreakCorrection={handleDenyBreakCorrection}
              />
            </div>
          )}

          {activeTab === "sorting" && (
            <SortingReviewTab
              sortingReviews={sortingReviews}
              profileMap={profileMap}
              logMap={logMap}
              currentUserId={currentUserId}
              fetchData={fetchData}
            />
          )}

          {activeTab === "password" && (
            <ChangePasswordTab />
          )}
        </div>
      </main>

      {/* ── Screenshot Lightbox ────────────────────────────── */}
      {selectedScreenshot && (
        <ScreenshotLightbox
          screenshot={selectedScreenshot}
          url={screenshotUrls[selectedScreenshot.id] || null}
          profile={profileMap.get(selectedScreenshot.user_id) || null}
          log={selectedScreenshot.log_id ? logMap.get(selectedScreenshot.log_id) || null : null}
          onClose={() => setSelectedScreenshot(null)}
          onPrev={() => {
            const idx = filteredScreenshots.findIndex((s) => s.id === selectedScreenshot.id);
            if (idx > 0) setSelectedScreenshot(filteredScreenshots[idx - 1]);
          }}
          onNext={() => {
            const idx = filteredScreenshots.findIndex((s) => s.id === selectedScreenshot.id);
            if (idx < filteredScreenshots.length - 1) setSelectedScreenshot(filteredScreenshots[idx + 1]);
          }}
        />
      )}

      {/* ── Message Modal ──────────────────────────────────── */}
      {messageTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setMessageTarget(null)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-lg font-bold text-espresso">
              Send Message to {profileMap.get(messageTarget)?.full_name || "Team Member"}
            </h3>
            <textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder="Type your message..."
              className="mb-4 w-full rounded-lg border border-sand bg-parchment px-4 py-3 text-sm text-espresso outline-none transition-colors focus:border-terracotta placeholder:text-stone resize-none"
              rows={3}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setMessageTarget(null)}
                className="rounded-lg border border-sand px-4 py-2 text-sm font-medium text-bark transition-all hover:border-terracotta hover:text-terracotta"
              >
                Cancel
              </button>
              <button
                onClick={handleSendMessage}
                disabled={sendingMessage || !messageText.trim()}
                className="rounded-lg bg-terracotta px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sendingMessage ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB COMPONENTS
   ══════════════════════════════════════════════════════════════ */

/* ── Overview Tab ──────────────────────────────────────────── */

function OverviewTab({
  stats,
  profiles,
  monitorMembers,
  screenshotUrls,
  activityEvents,
  handleCaptureNow,
  handleForceClockOut,
  setMessageTarget,
}: {
  stats: { activeCount: number; todayHoursMs: number; todayScreenshots: number; todayTasks: number; wizardTimeMs: number };
  profiles: Profile[];
  monitorMembers: {
    profile: Profile;
    session: Session | null;
    status: "live" | "break" | "off";
    currentTask: string;
    hasExtension: boolean;
    latestScreenshot: TaskScreenshot | null;
    todayScreenshots: number;
    todayHoursMs: number;
    todayTasks: number;
  }[];
  screenshotUrls: Record<number, string>;
  activityEvents: {
    id: string;
    type: "task-start" | "task-end" | "screenshot" | "break";
    text: string;
    userName: string;
    time: string;
    timestamp: number;
  }[];
  handleCaptureNow: (id: string) => void;
  handleForceClockOut: (id: string) => void;
  setMessageTarget: (id: string) => void;
}) {
  return (
    <>
      {/* Stats */}
      <div className="mb-6 grid grid-cols-5 gap-4">
        <StatCard value={stats.activeCount} label="Active Now" sub={`of ${profiles.filter(p => p.is_active !== false).length} team members`} color="sage" />
        <StatCard value={formatDuration(stats.todayHoursMs)} label="Total Hours Today" sub="across all VAs" color="terracotta" />
        <StatCard value={stats.todayScreenshots} label="Screenshots Today" sub={profiles.filter(p => p.is_active !== false).length > 0 ? `${Math.round(stats.todayScreenshots / profiles.filter(p => p.is_active !== false).length)} avg per person` : ""} color="slate-blue" />
        <StatCard value={stats.todayTasks} label="Tasks Completed" sub="today" color="amber" />
        <StatCard value={formatDuration(stats.wizardTimeMs)} label="Wizard Time" sub="task entry form time" color="walnut" />
      </div>

      {/* Live Team Monitor */}
      <div className="mb-6 rounded-xl border border-sand bg-white">
        <div className="flex items-center justify-between border-b border-parchment px-5 py-4">
          <h2 className="text-sm font-bold text-espresso">Live Team Monitor</h2>
          <span className="text-[11px] text-bark">Auto-refresh every 15s</span>
        </div>
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {monitorMembers.map((member) => (
            <TeamMemberCard
              key={member.profile.id}
              member={member}
              screenshotUrl={
                member.latestScreenshot
                  ? screenshotUrls[member.latestScreenshot.id] || null
                  : null
              }
              onCaptureNow={() => handleCaptureNow(member.profile.id)}
              onMessage={() => setMessageTarget(member.profile.id)}
              onForceClockOut={() => handleForceClockOut(member.profile.id)}
            />
          ))}
        </div>
      </div>

      {/* Recent Activity Feed */}
      <div className="rounded-xl border border-sand bg-white">
        <div className="flex items-center justify-between border-b border-parchment px-5 py-4">
          <h2 className="text-sm font-bold text-espresso">Recent Activity</h2>
          <span className="text-[11px] text-bark">{activityEvents.length} events today</span>
        </div>
        <div className="px-5 py-4">
          {activityEvents.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-bark">No activity yet today</p>
          ) : (
            activityEvents.map((event) => {
              const dotClass =
                event.type === "task-end"
                  ? "bg-sage"
                  : event.type === "task-start"
                    ? "bg-slate-blue"
                    : event.type === "break"
                      ? "bg-amber"
                      : "bg-terracotta";

              return (
                <div
                  key={event.id}
                  className="flex gap-2.5 border-b border-parchment py-3 last:border-b-0"
                >
                  <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs leading-relaxed text-espresso">
                      <strong className="font-bold">{event.userName}</strong>{" "}
                      {event.text}
                    </div>
                    <div className="mt-0.5 text-[10px] text-stone">{event.time}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}

/* ── Screenshots Tab ───────────────────────────────────────── */

function ScreenshotsTab({
  profiles,
  profileMap,
  logMap,
  filteredScreenshots,
  groupedScreenshots,
  screenshotFilter,
  setScreenshotFilter,
  screenshotDateFilter,
  setScreenshotDateFilter,
  screenshotUrls,
  loadingUrls,
  setSelectedScreenshot,
}: {
  profiles: Profile[];
  profileMap: Map<string, Profile>;
  logMap: Map<number, TimeLog>;
  filteredScreenshots: TaskScreenshot[];
  groupedScreenshots: Record<string, Record<string, TaskScreenshot[]>>;
  screenshotFilter: string;
  setScreenshotFilter: (v: string) => void;
  screenshotDateFilter: string;
  setScreenshotDateFilter: (v: string) => void;
  screenshotUrls: Record<number, string>;
  loadingUrls: boolean;
  setSelectedScreenshot: (ss: TaskScreenshot) => void;
}) {
  return (
    <div className="rounded-xl border border-sand bg-white">
      <div className="flex items-center justify-between border-b border-parchment px-5 py-4">
        <h2 className="text-sm font-bold text-espresso">Screenshots</h2>
        <div className="flex items-center gap-2">
          <select
            value={screenshotFilter}
            onChange={(e) => setScreenshotFilter(e.target.value)}
            className="rounded-lg border border-sand bg-white px-3 py-1.5 text-xs text-espresso outline-none transition-colors focus:border-terracotta"
          >
            <option value="all">All VAs</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.full_name}</option>
            ))}
          </select>
          <select
            value={screenshotDateFilter}
            onChange={(e) => setScreenshotDateFilter(e.target.value)}
            className="rounded-lg border border-sand bg-white px-3 py-1.5 text-xs text-espresso outline-none transition-colors focus:border-terracotta"
          >
            <option value="today">Today</option>
            <option value="week">Last 7 Days</option>
            <option value="month">Last 30 Days</option>
            <option value="all-time">All Time</option>
          </select>
          <span className="ml-2 text-[11px] text-bark">
            {filteredScreenshots.length} screenshots
          </span>
        </div>
      </div>

      <div className="p-5">
        {loadingUrls && filteredScreenshots.length > 0 && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-parchment px-4 py-2.5 text-xs text-bark">
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-terracotta border-t-transparent" />
            Loading screenshot previews...
          </div>
        )}

        {filteredScreenshots.length === 0 ? (
          <div className="py-12 text-center">
            <div className="text-4xl mb-3 text-stone">No screenshots</div>
            <p className="text-sm text-bark">
              No screenshots found for the selected filters.
            </p>
          </div>
        ) : (
          Object.entries(groupedScreenshots).map(([date, userGroups]) => (
            <div key={date} className="mb-8 last:mb-0">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-bark">
                {date}
              </h3>
              {Object.entries(userGroups).map(([userId, screenshots]) => {
                const profile = profileMap.get(userId);
                if (!profile) return null;
                return (
                  <div key={userId} className="mb-5 last:mb-0">
                    <div className="mb-2 flex items-center gap-2">
                      <div
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                        style={{ backgroundColor: getAvatarColor(profile.id) }}
                      >
                        {getInitials(profile.full_name)}
                      </div>
                      <span className="text-[13px] font-semibold text-espresso">
                        {profile.full_name}
                      </span>
                      <span className="text-[11px] text-bark">
                        {screenshots.length} screenshot{screenshots.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                      {screenshots.map((ss) => {
                        const log = ss.log_id ? logMap.get(ss.log_id) : null;
                        const url = screenshotUrls[ss.id];
                        const badge = screenshotTypeBadge(ss.screenshot_type);

                        return (
                          <button
                            key={ss.id}
                            onClick={() => setSelectedScreenshot(ss)}
                            className="group relative cursor-pointer overflow-hidden rounded-lg border border-sand bg-parchment transition-all hover:border-terracotta hover:shadow-md"
                          >
                            <div className="relative aspect-video w-full overflow-hidden bg-sand">
                              {url ? (
                                <img
                                  src={url}
                                  alt={`Screenshot by ${profile.full_name}`}
                                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-xs text-stone">
                                  Loading...
                                </div>
                              )}
                              <span
                                className={`absolute top-1.5 left-1.5 rounded px-1.5 py-0.5 text-[9px] font-semibold ${badge.bg} ${badge.text}`}
                              >
                                {screenshotTypeLabel(ss.screenshot_type)}
                              </span>
                            </div>
                            <div className="px-2.5 py-2">
                              {log && (
                                <div className="truncate text-[11px] font-medium text-espresso">
                                  {log.task_name}
                                </div>
                              )}
                              <div className="text-[10px] text-stone">
                                {formatTimeShort(ss.created_at)}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ── Team Management Tab ───────────────────────────────────── */

function TeamManagementTab({
  profiles,
  fetchData,
}: {
  profiles: Profile[];
  fetchData: () => void;
}) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState("");
  const [addSuccess, setAddSuccess] = useState("");

  // Add VA form state
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newFullName, setNewFullName] = useState("");
  const [newRole, setNewRole] = useState<string>("va");
  const [newDepartment, setNewDepartment] = useState("");
  const [newPosition, setNewPosition] = useState("");
  const [newPayRate, setNewPayRate] = useState("");
  const [newPayRateType, setNewPayRateType] = useState("hourly");

  // Inline editing state
  const [editingCell, setEditingCell] = useState<{ userId: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Reset password modal state
  const [resetPasswordTarget, setResetPasswordTarget] = useState<Profile | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);
  const [resetPasswordError, setResetPasswordError] = useState("");
  const [resetPasswordSuccess, setResetPasswordSuccess] = useState("");

  // Delete VA state
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const handleDeleteUser = async () => {
    if (!deleteTarget) return;
    setDeletingUser(true);
    setDeleteError("");
    try {
      const res = await fetch(`/api/users?userId=${deleteTarget.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setDeleteError(data.error || "Failed to delete user");
      } else {
        setDeleteTarget(null);
        fetchData();
      }
    } catch {
      setDeleteError("Network error. Please try again.");
    }
    setDeletingUser(false);
  };

  // Team assignment modal state
  const [teamAssignTarget, setTeamAssignTarget] = useState<Profile | null>(null);
  const [teamAssignments, setTeamAssignments] = useState<string[]>([]);
  const [savingAssignments, setSavingAssignments] = useState(false);
  const [loadingAssignments, setLoadingAssignments] = useState(false);

  const openTeamAssignModal = async (manager: Profile) => {
    setTeamAssignTarget(manager);
    setLoadingAssignments(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("team_assignments")
      .select("va_id")
      .eq("manager_id", manager.id);
    setTeamAssignments((data ?? []).map((d: { va_id: string }) => d.va_id));
    setLoadingAssignments(false);
  };

  const toggleVaAssignment = (vaId: string) => {
    setTeamAssignments((prev) =>
      prev.includes(vaId) ? prev.filter((id) => id !== vaId) : [...prev, vaId]
    );
  };

  const saveTeamAssignments = async () => {
    if (!teamAssignTarget) return;
    setSavingAssignments(true);
    const supabase = createClient();

    // Delete all existing assignments for this manager
    await supabase
      .from("team_assignments")
      .delete()
      .eq("manager_id", teamAssignTarget.id);

    // Insert new assignments
    if (teamAssignments.length > 0) {
      await supabase.from("team_assignments").insert(
        teamAssignments.map((vaId) => ({
          manager_id: teamAssignTarget.id,
          va_id: vaId,
        }))
      );
    }

    setSavingAssignments(false);
    setTeamAssignTarget(null);
    setTeamAssignments([]);
  };

  const closeTeamAssignModal = () => {
    setTeamAssignTarget(null);
    setTeamAssignments([]);
  };

  const generateRandomPassword = () => {
    const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let result = "";
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setResetPasswordValue(result);
  };

  const handleResetPassword = async () => {
    if (!resetPasswordTarget || !resetPasswordValue) return;
    if (resetPasswordValue.length < 6) {
      setResetPasswordError("Password must be at least 6 characters.");
      return;
    }
    setResettingPassword(true);
    setResetPasswordError("");
    setResetPasswordSuccess("");

    try {
      const res = await fetch("/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: resetPasswordTarget.id,
          newPassword: resetPasswordValue,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResetPasswordError(data.error || "Failed to reset password");
      } else {
        setResetPasswordSuccess(
          `Password reset successfully! New password: ${resetPasswordValue}`
        );
      }
    } catch {
      setResetPasswordError("Network error. Please try again.");
    }
    setResettingPassword(false);
  };

  const closeResetPasswordModal = () => {
    setResetPasswordTarget(null);
    setResetPasswordValue("");
    setResetPasswordError("");
    setResetPasswordSuccess("");
  };

  const handleAddUser = async () => {
    setAddError("");
    setAddSuccess("");
    if (!newEmail || !newPassword || !newUsername || !newFullName) {
      setAddError("Email, password, username, and full name are required.");
      return;
    }
    setAddLoading(true);

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail,
          password: newPassword,
          username: newUsername,
          full_name: newFullName,
          role: newRole,
          department: newDepartment || null,
          position: newPosition || null,
          pay_rate: newPayRate ? parseFloat(newPayRate) : 0,
          pay_rate_type: newPayRateType,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error || "Failed to create user");
      } else {
        setAddSuccess(`User "${newFullName}" created successfully!`);
        setNewEmail("");
        setNewPassword("");
        setNewUsername("");
        setNewFullName("");
        setNewRole("va");
        setNewDepartment("");
        setNewPosition("");
        setNewPayRate("");
        setNewPayRateType("hourly");
        setTimeout(() => {
          setShowAddForm(false);
          setAddSuccess("");
        }, 2000);
        fetchData();
      }
    } catch {
      setAddError("Network error. Please try again.");
    }

    setAddLoading(false);
  };

  const startEditing = (userId: string, field: string, currentValue: string) => {
    setEditingCell({ userId, field });
    setEditValue(currentValue);
  };

  const saveEdit = async () => {
    if (!editingCell) return;
    setSavingEdit(true);

    try {
      const payload: Record<string, unknown> = {
        user_id: editingCell.userId,
      };

      if (editingCell.field === "pay_rate") {
        payload.pay_rate = parseFloat(editValue) || 0;
      } else {
        payload[editingCell.field] = editValue;
      }

      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        fetchData();
      }
    } catch {
      // silently fail
    }

    setSavingEdit(false);
    setEditingCell(null);
  };

  const cancelEdit = () => {
    setEditingCell(null);
    setEditValue("");
  };

  return (
    <>
      {/* Header with Add button */}
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[13px] text-bark">{profiles.length} team members</span>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="rounded-lg bg-terracotta px-4 py-2 text-[13px] font-semibold text-white transition-all hover:bg-[#a85840]"
        >
          {showAddForm ? "Cancel" : "+ Add VA"}
        </button>
      </div>

      {/* Add VA Form */}
      {showAddForm && (
        <div className="mb-6 rounded-xl border border-sand bg-white p-5">
          <h3 className="mb-4 text-sm font-bold text-espresso">Add New Team Member</h3>

          {addSuccess && (
            <div className="mb-4 rounded-lg bg-sage-soft border border-sage px-4 py-2.5 text-xs text-sage font-medium">
              {addSuccess}
            </div>
          )}
          {addError && (
            <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-xs text-red-600">
              {addError}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1">Email *</label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta"
                placeholder="va@example.com"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1">Password *</label>
              <input
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta"
                placeholder="Min 6 characters"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1">Username *</label>
              <input
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta"
                placeholder="username"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1">Full Name *</label>
              <input
                type="text"
                value={newFullName}
                onChange={(e) => setNewFullName(e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta"
                placeholder="First Last"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1">Role</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta"
              >
                <option value="va">VA</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1">Department</label>
              <input
                type="text"
                value={newDepartment}
                onChange={(e) => setNewDepartment(e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta"
                placeholder="Optional"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-walnut mb-1">Position</label>
              <input
                type="text"
                value={newPosition}
                onChange={(e) => setNewPosition(e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta"
                placeholder="Optional"
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-[11px] font-semibold text-walnut mb-1">Pay Rate</label>
                <input
                  type="number"
                  value={newPayRate}
                  onChange={(e) => setNewPayRate(e.target.value)}
                  className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta"
                  placeholder="0"
                  step="0.01"
                />
              </div>
              <div className="w-28">
                <label className="block text-[11px] font-semibold text-walnut mb-1">Type</label>
                <select
                  value={newPayRateType}
                  onChange={(e) => setNewPayRateType(e.target.value)}
                  className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta"
                >
                  <option value="hourly">Hourly</option>
                  <option value="daily">Daily</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              onClick={handleAddUser}
              disabled={addLoading}
              className="rounded-lg bg-terracotta px-5 py-2 text-[13px] font-semibold text-white transition-all hover:bg-[#a85840] disabled:opacity-50"
            >
              {addLoading ? "Creating..." : "Create User"}
            </button>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetPasswordTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={closeResetPasswordModal}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-1 text-sm font-bold text-espresso">Reset Password</h3>
            <p className="mb-4 text-[12px] text-bark">
              for {resetPasswordTarget.full_name}
            </p>

            {resetPasswordSuccess && (
              <div className="mb-4 rounded-lg bg-sage-soft border border-sage px-4 py-2.5 text-xs text-sage font-medium break-all">
                {resetPasswordSuccess}
              </div>
            )}
            {resetPasswordError && (
              <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-xs text-red-600">
                {resetPasswordError}
              </div>
            )}

            {!resetPasswordSuccess && (
              <>
                <div className="mb-3">
                  <label className="block text-[11px] font-semibold text-walnut mb-1.5">
                    New Password
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={resetPasswordValue}
                      onChange={(e) => setResetPasswordValue(e.target.value)}
                      placeholder="Min. 6 characters"
                      className="flex-1 rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none transition-all focus:border-terracotta font-mono"
                    />
                    <button
                      onClick={generateRandomPassword}
                      className="shrink-0 rounded-lg border border-sand px-3 py-2 text-[11px] font-semibold text-bark transition-all hover:border-terracotta hover:text-terracotta cursor-pointer"
                      title="Generate Random Password"
                    >
                      Generate
                    </button>
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    onClick={closeResetPasswordModal}
                    className="rounded-lg border border-sand px-4 py-2 text-[12px] font-medium text-bark transition-all hover:border-terracotta hover:text-terracotta cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleResetPassword}
                    disabled={resettingPassword || !resetPasswordValue}
                    className="rounded-lg bg-terracotta px-4 py-2 text-[12px] font-semibold text-white transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {resettingPassword ? "Resetting..." : "Reset Password"}
                  </button>
                </div>
              </>
            )}

            {resetPasswordSuccess && (
              <div className="flex justify-end">
                <button
                  onClick={closeResetPasswordModal}
                  className="rounded-lg bg-terracotta px-4 py-2 text-[12px] font-semibold text-white transition-all hover:bg-[#a85840] cursor-pointer"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Team Table */}
      <div className="rounded-xl border border-sand bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-parchment bg-parchment/30 text-[10px] font-semibold uppercase tracking-wider text-bark">
                <th className="px-4 py-3">Name</th>
                <th className="px-3 py-3 text-center">Status</th>
                <th className="px-3 py-3">Username</th>
                <th className="px-3 py-3">Role</th>
                <th className="px-3 py-3">Department</th>
                <th className="px-3 py-3">Position</th>
                <th className="px-3 py-3 text-right">Pay Rate</th>
                <th className="px-3 py-3">Rate Type</th>
                <th className="px-3 py-3">Joined</th>
                <th className="px-3 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-parchment">
              {profiles.map((p) => (
                <tr key={p.id} className="hover:bg-parchment/20 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                        style={{ backgroundColor: getAvatarColor(p.id) }}
                      >
                        {getInitials(p.full_name)}
                      </div>
                      <span className="font-semibold text-espresso text-[13px]">{p.full_name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <button
                      onClick={async () => {
                        const newVal = !(p.is_active !== false);
                        try {
                          const res = await fetch("/api/users", {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ user_id: p.id, is_active: newVal }),
                          });
                          if (res.ok) fetchData();
                        } catch { /* silent */ }
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold transition-all cursor-pointer ${
                        p.is_active !== false
                          ? "bg-sage-soft text-sage hover:bg-sage/20"
                          : "bg-parchment text-stone hover:bg-sand"
                      }`}
                      title={p.is_active !== false ? "Click to deactivate" : "Click to activate"}
                    >
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${p.is_active !== false ? "bg-sage" : "bg-stone"}`} />
                      {p.is_active !== false ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="px-3 py-3 text-bark">{p.username}</td>
                  {/* Role - editable */}
                  <td className="px-3 py-3">
                    {editingCell?.userId === p.id && editingCell.field === "role" ? (
                      <div className="flex items-center gap-1">
                        <select
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="rounded border border-terracotta px-1.5 py-0.5 text-[11px] outline-none"
                          autoFocus
                        >
                          <option value="va">va</option>
                          <option value="manager">manager</option>
                          <option value="admin">admin</option>
                        </select>
                        <button onClick={saveEdit} disabled={savingEdit} className="text-sage hover:text-sage text-sm font-bold">
                          {savingEdit ? "..." : "OK"}
                        </button>
                        <button onClick={cancelEdit} className="text-bark hover:text-terracotta text-sm">&times;</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEditing(p.id, "role", p.role)}
                        className="cursor-pointer rounded-full px-2 py-0.5 text-[10px] font-semibold bg-parchment text-bark hover:bg-sand transition-colors"
                      >
                        {p.role}
                      </button>
                    )}
                  </td>
                  {/* Department */}
                  <td className="px-3 py-3">
                    {editingCell?.userId === p.id && editingCell.field === "department" ? (
                      <div className="flex items-center gap-1">
                        <input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="w-24 rounded border border-terracotta px-1.5 py-0.5 text-[11px] outline-none"
                          autoFocus
                          onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") cancelEdit(); }}
                        />
                        <button onClick={saveEdit} disabled={savingEdit} className="text-sage text-sm font-bold">{savingEdit ? "..." : "OK"}</button>
                        <button onClick={cancelEdit} className="text-bark hover:text-terracotta text-sm">&times;</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEditing(p.id, "department", p.department || "")}
                        className="cursor-pointer text-bark hover:text-terracotta transition-colors"
                      >
                        {p.department || "\u2014"}
                      </button>
                    )}
                  </td>
                  {/* Position */}
                  <td className="px-3 py-3">
                    {editingCell?.userId === p.id && editingCell.field === "position" ? (
                      <div className="flex items-center gap-1">
                        <input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="w-24 rounded border border-terracotta px-1.5 py-0.5 text-[11px] outline-none"
                          autoFocus
                          onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") cancelEdit(); }}
                        />
                        <button onClick={saveEdit} disabled={savingEdit} className="text-sage text-sm font-bold">{savingEdit ? "..." : "OK"}</button>
                        <button onClick={cancelEdit} className="text-bark hover:text-terracotta text-sm">&times;</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEditing(p.id, "position", p.position || "")}
                        className="cursor-pointer text-bark hover:text-terracotta transition-colors"
                      >
                        {p.position || "\u2014"}
                      </button>
                    )}
                  </td>
                  {/* Pay Rate - editable */}
                  <td className="px-3 py-3 text-right">
                    {editingCell?.userId === p.id && editingCell.field === "pay_rate" ? (
                      <div className="flex items-center justify-end gap-1">
                        <input
                          type="number"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="w-20 rounded border border-terracotta px-1.5 py-0.5 text-[11px] text-right outline-none"
                          autoFocus
                          step="0.01"
                          onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") cancelEdit(); }}
                        />
                        <button onClick={saveEdit} disabled={savingEdit} className="text-sage text-sm font-bold">{savingEdit ? "..." : "OK"}</button>
                        <button onClick={cancelEdit} className="text-bark hover:text-terracotta text-sm">&times;</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEditing(p.id, "pay_rate", String(p.pay_rate || 0))}
                        className="cursor-pointer font-semibold text-espresso hover:text-terracotta transition-colors"
                      >
                        ${(p.pay_rate || 0).toFixed(2)}
                      </button>
                    )}
                  </td>
                  {/* Pay Rate Type - editable */}
                  <td className="px-3 py-3">
                    {editingCell?.userId === p.id && editingCell.field === "pay_rate_type" ? (
                      <div className="flex items-center gap-1">
                        <select
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="rounded border border-terracotta px-1.5 py-0.5 text-[11px] outline-none"
                          autoFocus
                        >
                          <option value="hourly">hourly</option>
                          <option value="daily">daily</option>
                          <option value="monthly">monthly</option>
                        </select>
                        <button onClick={saveEdit} disabled={savingEdit} className="text-sage text-sm font-bold">{savingEdit ? "..." : "OK"}</button>
                        <button onClick={cancelEdit} className="text-bark hover:text-terracotta text-sm">&times;</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEditing(p.id, "pay_rate_type", p.pay_rate_type || "hourly")}
                        className="cursor-pointer text-bark hover:text-terracotta transition-colors text-[11px]"
                      >
                        {p.pay_rate_type || "hourly"}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-3 text-[11px] text-stone whitespace-nowrap">
                    {new Date(p.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => {
                          setResetPasswordTarget(p);
                          setResetPasswordValue("");
                          setResetPasswordError("");
                          setResetPasswordSuccess("");
                        }}
                        title="Reset Password"
                        className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-sand text-bark transition-all hover:border-terracotta hover:text-terracotta cursor-pointer"
                      >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0110 0v4" />
                        </svg>
                      </button>
                      {p.role === "manager" && (
                        <button
                          onClick={() => openTeamAssignModal(p)}
                          title="Manage Team"
                          className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-sand text-bark transition-all hover:border-sage hover:text-sage cursor-pointer"
                        >
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                            <circle cx="9" cy="7" r="4" />
                            <path d="M23 21v-2a4 4 0 00-3-3.87" />
                            <path d="M16 3.13a4 4 0 010 7.75" />
                          </svg>
                        </button>
                      )}
                      {p.role !== "admin" && (
                        <button
                          onClick={() => { setDeleteTarget(p); setDeleteError(""); }}
                          title="Delete User"
                          className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-sand text-bark transition-all hover:border-red-400 hover:text-red-500 cursor-pointer"
                        >
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M3 6h18" />
                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
                            <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Team Assignment Modal ──────────────────────────────── */}
      {teamAssignTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={closeTeamAssignModal}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-1 text-sm font-bold text-espresso">
              Manage Team for {teamAssignTarget.full_name}
            </h3>
            <p className="mb-4 text-[12px] text-bark">
              Select VAs to assign to this manager.
            </p>

            {loadingAssignments ? (
              <div className="py-8 text-center text-xs text-bark">Loading...</div>
            ) : (
              <div className="max-h-64 overflow-y-auto space-y-1 mb-4">
                {profiles
                  .filter((p) => p.role === "va")
                  .map((va) => {
                    const isAssigned = teamAssignments.includes(va.id);
                    return (
                      <label
                        key={va.id}
                        className={`flex items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer transition-all ${
                          isAssigned
                            ? "bg-sage-soft border border-sage"
                            : "bg-parchment border border-transparent hover:border-sand"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isAssigned}
                          onChange={() => toggleVaAssignment(va.id)}
                          className="h-4 w-4 rounded border-sand text-sage focus:ring-sage accent-sage cursor-pointer"
                        />
                        <div
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                          style={{ backgroundColor: getAvatarColor(va.id) }}
                        >
                          {getInitials(va.full_name)}
                        </div>
                        <div className="flex-1">
                          <div className="text-[12px] font-semibold text-espresso">
                            {va.full_name}
                          </div>
                          <div className="text-[10px] text-bark">
                            {va.position || va.department || "VA"}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                {profiles.filter((p) => p.role === "va").length === 0 && (
                  <p className="py-4 text-center text-xs text-bark">No VAs found.</p>
                )}
              </div>
            )}

            <div className="flex justify-between items-center">
              <span className="text-[11px] text-bark">
                {teamAssignments.length} VA{teamAssignments.length !== 1 ? "s" : ""} selected
              </span>
              <div className="flex gap-2">
                <button
                  onClick={closeTeamAssignModal}
                  className="rounded-lg border border-sand px-4 py-2 text-[12px] font-medium text-bark transition-all hover:border-terracotta hover:text-terracotta cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={saveTeamAssignments}
                  disabled={savingAssignments}
                  className="rounded-lg bg-sage px-4 py-2 text-[12px] font-semibold text-white transition-all hover:bg-[#5a7a5a] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {savingAssignments ? "Saving..." : "Save Assignments"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete User Confirmation Modal ──────────────────────── */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-1 text-sm font-bold text-red-600">Delete User</h3>
            <p className="mb-4 text-[12px] text-bark">
              Are you sure you want to permanently delete <strong>{deleteTarget.full_name}</strong>?
              This will remove their account, all time logs, screenshots, and session data.
              This action cannot be undone.
            </p>

            {deleteError && (
              <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-xs text-red-600">
                {deleteError}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-sand px-4 py-2 text-[12px] font-medium text-bark transition-all hover:border-terracotta hover:text-terracotta cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteUser}
                disabled={deletingUser}
                className="rounded-lg bg-red-500 px-4 py-2 text-[12px] font-semibold text-white transition-all hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {deletingUser ? "Deleting..." : "Delete Permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ── Accounts Tab ─────────────────────────────────────────── */

interface AccountRow {
  id: number;
  name: string;
  active: boolean;
  created_at: string;
}

interface ClientRow {
  id: number;
  name: string;
  active: boolean;
  created_at: string;
}

interface AccountMapping {
  account_id: number;
  client_id: number;
  clients: { id: number; name: string } | null;
}

interface ClientMapping {
  account_id: number;
  client_id: number;
  accounts: { id: number; name: string } | null;
}

function AccountsTab() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [allClients, setAllClients] = useState<ClientRow[]>([]);
  const [mappings, setMappings] = useState<AccountMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [linkAccountId, setLinkAccountId] = useState<number | null>(null);
  const [linkClientId, setLinkClientId] = useState("");

  const fetchAccounts = useCallback(async () => {
    const [accRes, cliRes] = await Promise.all([
      fetch("/api/accounts"),
      fetch("/api/clients"),
    ]);
    const accData = await accRes.json();
    const cliData = await cliRes.json();
    setAccounts(accData.accounts ?? []);
    setMappings(accData.mappings ?? []);
    setAllClients(cliData.clients ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const handleAdd = async () => {
    setAddError("");
    if (!newName.trim()) return;
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (!res.ok) {
      const d = await res.json();
      setAddError(d.error || "Failed to add");
      return;
    }
    setNewName("");
    setShowAddForm(false);
    fetchAccounts();
  };

  const handleToggleActive = async (acc: AccountRow) => {
    await fetch("/api/accounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: acc.id, active: !acc.active }),
    });
    fetchAccounts();
  };

  const handleSaveEdit = async (id: number) => {
    if (!editName.trim()) return;
    await fetch("/api/accounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name: editName.trim() }),
    });
    setEditingId(null);
    fetchAccounts();
  };

  const handleLinkClient = async (accountId: number, clientId: string) => {
    if (!clientId) return;
    await fetch("/api/accounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: accountId, linkClientId: parseInt(clientId) }),
    });
    setLinkAccountId(null);
    setLinkClientId("");
    fetchAccounts();
  };

  const handleUnlinkClient = async (accountId: number, clientId: number) => {
    await fetch("/api/accounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: accountId, unlinkClientId: clientId }),
    });
    fetchAccounts();
  };

  const getLinkedClients = (accountId: number) => {
    return mappings
      .filter((m) => m.account_id === accountId && m.clients)
      .map((m) => m.clients!);
  };

  if (loading) {
    return <div className="h-48 animate-pulse rounded-xl border border-sand bg-white" />;
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[13px] text-bark">{accounts.length} accounts</span>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="rounded-lg bg-terracotta px-4 py-2 text-[13px] font-semibold text-white transition-all hover:bg-[#a85840] cursor-pointer"
        >
          {showAddForm ? "Cancel" : "+ Add Account"}
        </button>
      </div>

      {showAddForm && (
        <div className="mb-4 rounded-xl border border-sand bg-white p-5">
          <h3 className="mb-3 text-sm font-bold text-espresso">Add New Account</h3>
          {addError && (
            <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-xs text-red-600">
              {addError}
            </div>
          )}
          <div className="flex gap-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Account name"
              className="flex-1 rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta"
              onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
            />
            <button
              onClick={handleAdd}
              className="rounded-lg bg-terracotta px-5 py-2 text-[13px] font-semibold text-white transition-all hover:bg-[#a85840] cursor-pointer"
            >
              Add
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-sand bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-parchment bg-parchment/30 text-[10px] font-semibold uppercase tracking-wider text-bark">
                <th className="px-4 py-3">Name</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Linked Clients</th>
                <th className="px-3 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-parchment">
              {accounts.map((acc) => {
                const linked = getLinkedClients(acc.id);
                const unlinkedClients = allClients.filter(
                  (c) => !linked.some((l) => l.id === c.id)
                );
                return (
                  <tr key={acc.id} className="hover:bg-parchment/20 transition-colors">
                    <td className="px-4 py-3">
                      {editingId === acc.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="w-40 rounded border border-terracotta px-1.5 py-0.5 text-[11px] outline-none"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveEdit(acc.id);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                          />
                          <button onClick={() => handleSaveEdit(acc.id)} className="text-sage text-sm font-bold">OK</button>
                          <button onClick={() => setEditingId(null)} className="text-bark hover:text-terracotta text-sm">&times;</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingId(acc.id); setEditName(acc.name); }}
                          className="cursor-pointer font-semibold text-espresso text-[13px] hover:text-terracotta transition-colors"
                        >
                          {acc.name}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <button
                        onClick={() => handleToggleActive(acc)}
                        className={`cursor-pointer rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                          acc.active
                            ? "bg-sage-soft text-sage"
                            : "bg-parchment text-stone"
                        }`}
                      >
                        {acc.active ? "Active" : "Inactive"}
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {linked.map((c) => (
                          <span
                            key={c.id}
                            className="inline-flex items-center gap-1 rounded-full bg-slate-blue-soft px-2 py-0.5 text-[10px] font-medium text-slate-blue"
                          >
                            {c.name}
                            <button
                              onClick={() => handleUnlinkClient(acc.id, c.id)}
                              className="ml-0.5 text-slate-blue/60 hover:text-terracotta cursor-pointer"
                            >
                              &times;
                            </button>
                          </span>
                        ))}
                        {linkAccountId === acc.id ? (
                          <div className="flex items-center gap-1">
                            <select
                              value={linkClientId}
                              onChange={(e) => setLinkClientId(e.target.value)}
                              className="rounded border border-terracotta px-1.5 py-0.5 text-[10px] outline-none"
                              autoFocus
                            >
                              <option value="">Select client...</option>
                              {unlinkedClients.map((c) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                            <button
                              onClick={() => handleLinkClient(acc.id, linkClientId)}
                              className="text-sage text-sm font-bold"
                            >
                              OK
                            </button>
                            <button
                              onClick={() => { setLinkAccountId(null); setLinkClientId(""); }}
                              className="text-bark hover:text-terracotta text-sm"
                            >
                              &times;
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setLinkAccountId(acc.id)}
                            className="rounded-full border border-dashed border-sand px-2 py-0.5 text-[10px] text-bark hover:border-terracotta hover:text-terracotta cursor-pointer transition-colors"
                          >
                            + Link
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <button
                        onClick={() => { setEditingId(acc.id); setEditName(acc.name); }}
                        title="Edit name"
                        className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-sand text-bark transition-all hover:border-terracotta hover:text-terracotta cursor-pointer"
                      >
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ── Clients Tab ──────────────────────────────────────────── */

const PAYMENT_TERMS_OPTIONS = [
  { value: "due_on_receipt", label: "Due on Receipt" },
  { value: "net_15", label: "Net 15" },
  { value: "net_30", label: "Net 30" },
  { value: "net_45", label: "Net 45" },
  { value: "net_60", label: "Net 60" },
] as const;

function ClientsTab() {
  const supabase = createClient();
  const [clients, setClients] = useState<Client[]>([]);
  const [mappings, setMappings] = useState<ClientMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    name: "",
    contact_name: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    country: "",
    logo_url: "",
    payment_terms: "due_on_receipt" as string,
    currency: "USD",
    default_hourly_rate: "",
    tax_id: "",
    notes: "",
    active: true,
  });

  const updateForm = (field: string, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const fetchClients = useCallback(async () => {
    const res = await fetch("/api/clients");
    const data = await res.json();
    setClients(data.clients ?? []);
    setMappings(data.mappings ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const openClient = (client: Client) => {
    setSelectedClient(client);
    setIsNew(false);
    setSaveError("");
    setSaveSuccess(false);
    setDeleteConfirm(false);
    setForm({
      name: client.name || "",
      contact_name: client.contact_name || "",
      email: client.email || "",
      phone: client.phone || "",
      address: client.address || "",
      city: client.city || "",
      state: client.state || "",
      zip: client.zip || "",
      country: client.country || "",
      logo_url: client.logo_url || "",
      payment_terms: client.payment_terms || "due_on_receipt",
      currency: client.currency || "USD",
      default_hourly_rate: client.default_hourly_rate != null ? String(client.default_hourly_rate) : "",
      tax_id: client.tax_id || "",
      notes: client.notes || "",
      active: client.active,
    });
  };

  const openNewClient = () => {
    setSelectedClient(null);
    setIsNew(true);
    setSaveError("");
    setSaveSuccess(false);
    setDeleteConfirm(false);
    setForm({
      name: "",
      contact_name: "",
      email: "",
      phone: "",
      address: "",
      city: "",
      state: "",
      zip: "",
      country: "",
      logo_url: "",
      payment_terms: "due_on_receipt",
      currency: "USD",
      default_hourly_rate: "",
      tax_id: "",
      notes: "",
      active: true,
    });
  };

  const backToList = () => {
    setSelectedClient(null);
    setIsNew(false);
    setSaveError("");
    setSaveSuccess(false);
    setDeleteConfirm(false);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    setSaveError("");
    try {
      const clientId = selectedClient?.id || "new";
      const ext = file.name.split(".").pop() || "png";
      const path = `logos/client-${clientId}-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("logos")
        .upload(path, file, { upsert: true });
      if (uploadError) {
        setSaveError(`Logo upload failed: ${uploadError.message}`);
        setUploadingLogo(false);
        return;
      }
      const { data: urlData } = supabase.storage.from("logos").getPublicUrl(path);
      updateForm("logo_url", urlData.publicUrl);
    } catch {
      setSaveError("Logo upload failed");
    } finally {
      setUploadingLogo(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemoveLogo = () => {
    updateForm("logo_url", "");
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError("");
    setSaveSuccess(false);
    if (!form.name.trim()) {
      setSaveError("Client name is required");
      setSaving(false);
      return;
    }
    const payload = {
      name: form.name.trim(),
      contact_name: form.contact_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      address: form.address.trim(),
      city: form.city.trim(),
      state: form.state.trim(),
      zip: form.zip.trim(),
      country: form.country.trim(),
      logo_url: form.logo_url,
      payment_terms: form.payment_terms,
      currency: form.currency,
      default_hourly_rate: form.default_hourly_rate ? parseFloat(form.default_hourly_rate) : null,
      tax_id: form.tax_id.trim(),
      notes: form.notes.trim(),
      active: form.active,
    };
    try {
      if (isNew) {
        const res = await fetch("/api/clients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const d = await res.json();
          setSaveError(d.error || "Failed to create client");
          setSaving(false);
          return;
        }
        const d = await res.json();
        await fetchClients();
        openClient(d.client);
      } else if (selectedClient) {
        const res = await fetch("/api/clients", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: selectedClient.id, ...payload }),
        });
        if (!res.ok) {
          const d = await res.json();
          setSaveError(d.error || "Failed to update client");
          setSaving(false);
          return;
        }
        await fetchClients();
        setSelectedClient({ ...selectedClient, ...payload, payment_terms: payload.payment_terms as Client["payment_terms"], default_hourly_rate: payload.default_hourly_rate });
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch {
      setSaveError("Network error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedClient) return;
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch(`/api/clients?id=${selectedClient.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json();
        setSaveError(d.error || "Failed to delete");
        setSaving(false);
        return;
      }
      await fetchClients();
      backToList();
    } catch {
      setSaveError("Network error");
    } finally {
      setSaving(false);
    }
  };

  const getLinkedAccounts = (clientId: number) => {
    return mappings
      .filter((m) => m.client_id === clientId && m.accounts)
      .map((m) => m.accounts!);
  };

  if (loading) {
    return <div className="h-48 animate-pulse rounded-xl border border-sand bg-white" />;
  }

  /* ── Detail / Edit View ───────────────── */
  if (selectedClient || isNew) {
    const initials = form.name
      ? form.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
      : "?";

    return (
      <>
        <div className="mb-5 flex items-center gap-3">
          <button
            onClick={backToList}
            className="inline-flex items-center gap-1.5 rounded-lg border border-sand px-3 py-1.5 text-[12px] font-medium text-bark transition-all hover:border-terracotta hover:text-terracotta cursor-pointer"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back to Clients
          </button>
          <h3 className="text-sm font-bold text-espresso">
            {isNew ? "New Client" : `Edit: ${selectedClient?.name}`}
          </h3>
        </div>

        {saveError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-600">
            {saveError}
          </div>
        )}
        {saveSuccess && (
          <div className="mb-4 rounded-lg border border-sage bg-sage-soft px-4 py-2 text-xs text-sage">
            Client saved successfully
          </div>
        )}

        <div className="rounded-xl border border-sand bg-white p-6">
          {/* Logo */}
          <div className="mb-6 flex items-center gap-5">
            <div className="relative">
              {form.logo_url ? (
                <img
                  src={form.logo_url}
                  alt={form.name || "Client logo"}
                  className="h-20 w-20 rounded-xl border border-sand object-cover"
                />
              ) : (
                <div
                  className="flex h-20 w-20 items-center justify-center rounded-xl border-2 border-dashed border-sand text-xl font-bold text-bark"
                  style={{ backgroundColor: form.name ? getAvatarColor(form.name) + "22" : "#f5f0eb" }}
                >
                  {initials}
                </div>
              )}
              {uploadingLogo && (
                <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/80">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-terracotta border-t-transparent" />
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingLogo}
                className="rounded-lg border border-sand px-4 py-1.5 text-[12px] font-medium text-bark transition-all hover:border-terracotta hover:text-terracotta cursor-pointer disabled:opacity-50"
              >
                {uploadingLogo ? "Uploading..." : form.logo_url ? "Change Logo" : "Upload Logo"}
              </button>
              {form.logo_url && (
                <button
                  onClick={handleRemoveLogo}
                  className="rounded-lg px-4 py-1.5 text-[12px] text-stone transition-colors hover:text-red-500 cursor-pointer"
                >
                  Remove Logo
                </button>
              )}
            </div>
          </div>

          {/* Form fields */}
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">
                Client Name <span className="text-terracotta">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => updateForm("name", e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                placeholder="Company or individual name"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Contact Person</label>
              <input
                type="text"
                value={form.contact_name}
                onChange={(e) => updateForm("contact_name", e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                placeholder="Primary contact name"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => updateForm("email", e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                placeholder="email@example.com"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Phone</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => updateForm("phone", e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                placeholder="+1 (555) 123-4567"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Address</label>
              <input
                type="text"
                value={form.address}
                onChange={(e) => updateForm("address", e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                placeholder="Street address"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">City</label>
              <input
                type="text"
                value={form.city}
                onChange={(e) => updateForm("city", e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                placeholder="City"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">State / Province</label>
              <input
                type="text"
                value={form.state}
                onChange={(e) => updateForm("state", e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                placeholder="State"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">ZIP / Postal Code</label>
              <input
                type="text"
                value={form.zip}
                onChange={(e) => updateForm("zip", e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                placeholder="12345"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Country</label>
              <input
                type="text"
                value={form.country}
                onChange={(e) => updateForm("country", e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                placeholder="Country"
              />
            </div>

            <div className="sm:col-span-2 border-t border-parchment my-1" />

            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Payment Terms</label>
              <select
                value={form.payment_terms}
                onChange={(e) => updateForm("payment_terms", e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta bg-white cursor-pointer"
              >
                {PAYMENT_TERMS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Currency</label>
              <input
                type="text"
                value={form.currency}
                onChange={(e) => updateForm("currency", e.target.value.toUpperCase())}
                className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                placeholder="USD"
                maxLength={3}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Default Hourly Rate</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-stone">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.default_hourly_rate}
                  onChange={(e) => updateForm("default_hourly_rate", e.target.value)}
                  className="w-full rounded-lg border border-sand pl-7 pr-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                  placeholder="0.00"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Tax ID</label>
              <input
                type="text"
                value={form.tax_id}
                onChange={(e) => updateForm("tax_id", e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                placeholder="EIN / VAT / Tax number"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => updateForm("notes", e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta resize-none"
                placeholder="Internal notes about this client..."
              />
            </div>
            <div className="sm:col-span-2 flex items-center gap-3">
              <button
                type="button"
                onClick={() => updateForm("active", !form.active)}
                className={`relative h-6 w-11 rounded-full transition-colors cursor-pointer ${form.active ? "bg-sage" : "bg-stone/30"}`}
              >
                <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${form.active ? "translate-x-5" : "translate-x-0"}`} />
              </button>
              <span className="text-[13px] font-medium text-espresso">{form.active ? "Active" : "Inactive"}</span>
            </div>
          </div>

          {/* Linked Accounts (read-only, existing clients only) */}
          {selectedClient && (
            <div className="mt-6 border-t border-parchment pt-4">
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-bark">Linked Accounts</h4>
              <div className="flex flex-wrap items-center gap-1.5">
                {getLinkedAccounts(selectedClient.id).map((a) => (
                  <span key={a.id} className="inline-flex items-center rounded-full bg-amber-soft px-2.5 py-1 text-[11px] font-medium text-amber">{a.name}</span>
                ))}
                {getLinkedAccounts(selectedClient.id).length === 0 && (
                  <span className="text-[11px] text-stone">No linked accounts. Link accounts from the Accounts tab.</span>
                )}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="mt-6 flex items-center gap-3 border-t border-parchment pt-5">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-terracotta px-6 py-2 text-[13px] font-semibold text-white transition-all hover:bg-[#a85840] cursor-pointer disabled:opacity-50"
            >
              {saving ? "Saving..." : isNew ? "Create Client" : "Save Changes"}
            </button>
            <button
              onClick={backToList}
              className="rounded-lg border border-sand px-5 py-2 text-[13px] font-medium text-bark transition-all hover:border-terracotta hover:text-terracotta cursor-pointer"
            >
              Cancel
            </button>
            {selectedClient && !isNew && (
              <div className="ml-auto">
                {deleteConfirm ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-red-500">Delete this client?</span>
                    <button
                      onClick={handleDelete}
                      disabled={saving}
                      className="rounded-lg bg-red-500 px-4 py-1.5 text-[12px] font-semibold text-white transition-all hover:bg-red-600 cursor-pointer disabled:opacity-50"
                    >
                      Yes, Delete
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(false)}
                      className="rounded-lg border border-sand px-4 py-1.5 text-[12px] font-medium text-bark transition-all hover:border-terracotta cursor-pointer"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirm(true)}
                    className="rounded-lg border border-red-200 px-4 py-1.5 text-[12px] font-medium text-red-400 transition-all hover:border-red-400 hover:text-red-500 cursor-pointer"
                  >
                    Delete Client
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  /* ── Card Grid (List View) ────────────── */
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[13px] text-bark">{clients.length} clients</span>
        <button
          onClick={openNewClient}
          className="rounded-lg bg-terracotta px-4 py-2 text-[13px] font-semibold text-white transition-all hover:bg-[#a85840] cursor-pointer"
        >
          + Add Client
        </button>
      </div>

      {clients.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-sand bg-white py-16">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-parchment">
            <svg className="h-6 w-6 text-bark" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
            </svg>
          </div>
          <p className="text-[13px] font-medium text-espresso">No clients yet</p>
          <p className="mt-1 text-[12px] text-stone">Add your first client to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {clients.map((client) => {
            const linked = getLinkedAccounts(client.id);
            const initials = getInitials(client.name);
            return (
              <button
                key={client.id}
                onClick={() => openClient(client)}
                className="group cursor-pointer rounded-xl border border-sand bg-white p-5 text-left transition-all hover:border-terracotta/40 hover:shadow-sm"
              >
                <div className="flex items-start gap-4">
                  {client.logo_url ? (
                    <img src={client.logo_url} alt={client.name} className="h-12 w-12 rounded-lg border border-sand object-cover" />
                  ) : (
                    <div
                      className="flex h-12 w-12 items-center justify-center rounded-lg text-sm font-bold text-white"
                      style={{ backgroundColor: getAvatarColor(client.name) }}
                    >
                      {initials}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="truncate text-[14px] font-bold text-espresso group-hover:text-terracotta transition-colors">{client.name}</h4>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${client.active ? "bg-sage-soft text-sage" : "bg-parchment text-stone"}`}>
                        {client.active ? "Active" : "Inactive"}
                      </span>
                    </div>
                    {client.contact_name && (
                      <p className="mt-0.5 truncate text-[12px] text-bark">{client.contact_name}</p>
                    )}
                    {client.email && (
                      <p className="truncate text-[11px] text-stone">{client.email}</p>
                    )}
                    {linked.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {linked.slice(0, 3).map((a) => (
                          <span key={a.id} className="inline-flex rounded-full bg-amber-soft px-2 py-0.5 text-[9px] font-medium text-amber">{a.name}</span>
                        ))}
                        {linked.length > 3 && (
                          <span className="inline-flex rounded-full bg-parchment px-2 py-0.5 text-[9px] font-medium text-stone">+{linked.length - 3} more</span>
                        )}
                      </div>
                    )}
                  </div>
                  <svg className="h-4 w-4 shrink-0 text-stone transition-colors group-hover:text-terracotta mt-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ── Organization Tab ──────────────────────────────────────── */

function OrganizationTab() {
  const supabase = createClient();
  const [settings, setSettings] = useState<OrganizationSettings | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Form state
  const [orgName, setOrgName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [address, setAddress] = useState("");
  const [timezone, setTimezone] = useState("");
  const [billingEmail, setBillingEmail] = useState("");

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("organization_settings")
        .select("*")
        .limit(1)
        .maybeSingle();

      if (data) {
        const s = data as OrganizationSettings;
        setSettings(s);
        setOrgName(s.org_name || "");
        setLogoUrl(s.logo_url || "");
        setAddress(s.address || "");
        setTimezone(s.timezone || "America/New_York");
        setBillingEmail(s.billing_email || "");
      }
      setLoadingSettings(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaveError("");
    setSaveSuccess(false);

    const updatePayload = {
      org_name: orgName || "MinuteFlow",
      logo_url: logoUrl || null,
      address: address || null,
      timezone: timezone || "America/New_York",
      billing_email: billingEmail || null,
      updated_at: new Date().toISOString(),
    };

    if (settings) {
      const { error } = await supabase
        .from("organization_settings")
        .update(updatePayload)
        .eq("id", settings.id);

      if (error) {
        setSaveError(error.message);
      } else {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } else {
      const { error } = await supabase
        .from("organization_settings")
        .insert(updatePayload);

      if (error) {
        setSaveError(error.message);
      } else {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    }

    setSaving(false);
  };

  if (loadingSettings) {
    return (
      <div className="rounded-xl border border-sand bg-white p-6">
        <div className="h-48 animate-pulse rounded-lg bg-parchment" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-sand bg-white p-6">
      {saveSuccess && (
        <div className="mb-4 rounded-lg bg-sage-soft border border-sage px-4 py-2.5 text-xs text-sage font-medium">
          Organization settings saved successfully!
        </div>
      )}
      {saveError && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-xs text-red-600">
          {saveError}
        </div>
      )}

      <div className="space-y-5 max-w-lg">
        <div>
          <label className="block text-[11px] font-semibold text-walnut mb-1.5 tracking-wide">
            Organization Name
          </label>
          <input
            type="text"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            className="w-full rounded-lg border border-sand px-3.5 py-2.5 text-[13px] text-espresso outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)]"
            placeholder="Your Organization"
          />
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-walnut mb-1.5 tracking-wide">
            Logo URL
          </label>
          <input
            type="url"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            className="w-full rounded-lg border border-sand px-3.5 py-2.5 text-[13px] text-espresso outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)]"
            placeholder="https://example.com/logo.png"
          />
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-walnut mb-1.5 tracking-wide">
            Address
          </label>
          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-sand px-3.5 py-2.5 text-[13px] text-espresso outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)] resize-none"
            placeholder="123 Main St, City, State"
          />
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-walnut mb-1.5 tracking-wide">
            Timezone
          </label>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full rounded-lg border border-sand px-3.5 py-2.5 text-[13px] text-espresso outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)]"
          >
            <option value="America/New_York">Eastern Time (ET)</option>
            <option value="America/Chicago">Central Time (CT)</option>
            <option value="America/Denver">Mountain Time (MT)</option>
            <option value="America/Los_Angeles">Pacific Time (PT)</option>
            <option value="Asia/Manila">Philippine Time (PHT)</option>
            <option value="UTC">UTC</option>
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-walnut mb-1.5 tracking-wide">
            Billing Email
          </label>
          <input
            type="email"
            value={billingEmail}
            onChange={(e) => setBillingEmail(e.target.value)}
            className="w-full rounded-lg border border-sand px-3.5 py-2.5 text-[13px] text-espresso outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)]"
            placeholder="billing@example.com"
          />
        </div>

        <div className="pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-terracotta px-6 py-2.5 text-[13px] font-semibold text-white transition-all hover:bg-[#a85840] disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Corrections Tab ───────────────────────────────────────── */

function CorrectionsTab({
  correctionRequests,
  profileMap,
  logMap,
  reviewNotes,
  setReviewNotes,
  handleApproveCorrection,
  handleDenyCorrection,
}: {
  correctionRequests: TimeCorrectionRequest[];
  profileMap: Map<string, Profile>;
  logMap: Map<number, TimeLog>;
  reviewNotes: Record<number, string>;
  setReviewNotes: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  handleApproveCorrection: (req: TimeCorrectionRequest) => void;
  handleDenyCorrection: (req: TimeCorrectionRequest) => void;
}) {
  if (correctionRequests.length === 0) {
    return (
      <div className="rounded-xl border border-sand bg-white px-5 py-12 text-center">
        <p className="text-sm text-bark">No pending correction requests.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-sand bg-white">
      <div className="flex items-center justify-between border-b border-parchment px-5 py-4">
        <h2 className="text-sm font-bold text-espresso">
          Pending Correction Requests
        </h2>
        <span className="rounded-full bg-terracotta-soft px-2.5 py-[2px] text-[11px] font-semibold text-terracotta">
          {correctionRequests.length}
        </span>
      </div>
      <div className="divide-y divide-parchment">
        {correctionRequests.map((req) => {
          const reqProfile = profileMap.get(req.requested_by);
          const reqLog = logMap.get(req.log_id);
          const changes = req.requested_changes as Record<string, string>;

          return (
            <div key={req.id} className="px-5 py-4">
              <div className="flex items-start gap-3 mb-3">
                {reqProfile && (
                  <div
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ backgroundColor: getAvatarColor(reqProfile.id) }}
                  >
                    {getInitials(reqProfile.full_name)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-espresso">
                    {reqProfile?.full_name || "Unknown"}{" "}
                    <span className="font-normal text-bark">
                      requested a correction
                    </span>
                  </div>
                  {reqLog && (
                    <div className="mt-0.5 text-[11px] text-stone">
                      Task: {reqLog.task_name} &middot;{" "}
                      {new Date(reqLog.start_time).toLocaleDateString()}
                    </div>
                  )}
                  <div className="mt-1 text-xs text-espresso">
                    <strong>Reason:</strong> {req.reason}
                  </div>
                  {/* Original task details */}
                  {reqLog && (
                    <div className="mt-2 rounded-lg bg-cream/50 px-3 py-2 border border-sand/40">
                      <div className="text-[10px] font-semibold text-bark mb-1">
                        Original Entry:
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] text-espresso">
                        <div><span className="font-medium">Task:</span> {reqLog.task_name}</div>
                        <div><span className="font-medium">Category:</span> {reqLog.category}</div>
                        <div><span className="font-medium">Account:</span> {reqLog.account || "—"}</div>
                        <div><span className="font-medium">Client:</span> {reqLog.client_name || "—"}</div>
                        <div><span className="font-medium">Project:</span> {reqLog.project || "—"}</div>
                        <div><span className="font-medium">Billable:</span> {reqLog.billable ? "Yes" : "No"}</div>
                        <div><span className="font-medium">Start:</span> {new Date(reqLog.start_time).toLocaleString()}</div>
                        <div><span className="font-medium">End:</span> {reqLog.end_time ? new Date(reqLog.end_time).toLocaleString() : "—"}</div>
                        {reqLog.client_memo && (
                          <div className="col-span-2"><span className="font-medium">Client Memo:</span> {reqLog.client_memo}</div>
                        )}
                        {reqLog.internal_memo && (
                          <div className="col-span-2"><span className="font-medium">Internal Memo:</span> {reqLog.internal_memo}</div>
                        )}
                      </div>
                    </div>
                  )}
                  {/* Requested changes with before/after comparison */}
                  <div className="mt-2 rounded-lg bg-parchment px-3 py-2">
                    <div className="text-[10px] font-semibold text-bark mb-1">
                      Requested Changes:
                    </div>
                    {Object.entries(changes).map(([field, value]) => {
                      const originalValue = reqLog ? (reqLog as unknown as Record<string, unknown>)[field] : undefined;
                      return (
                        <div key={field} className="text-[11px] text-espresso mb-0.5">
                          <span className="font-medium">{field}:</span>{" "}
                          {originalValue !== undefined && (
                            <span className="line-through text-stone mr-1">{String(originalValue) || "(empty)"}</span>
                          )}
                          <span className="text-terracotta font-medium">{value || "(empty)"}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <span className="text-[10px] text-stone shrink-0">
                  {new Date(req.created_at).toLocaleDateString()}
                </span>
              </div>
              {/* Review notes + actions */}
              <div className="ml-10 flex items-end gap-2">
                <input
                  type="text"
                  value={reviewNotes[req.id] || ""}
                  onChange={(e) =>
                    setReviewNotes((prev) => ({
                      ...prev,
                      [req.id]: e.target.value,
                    }))
                  }
                  placeholder="Review notes (optional)..."
                  className="flex-1 rounded-lg border border-sand px-3 py-1.5 text-xs text-espresso outline-none transition-colors focus:border-terracotta"
                />
                <button
                  onClick={() => handleApproveCorrection(req)}
                  className="rounded-lg bg-sage px-3 py-1.5 text-[11px] font-semibold text-white transition-all hover:bg-[#5a7a5a]"
                >
                  Approve
                </button>
                <button
                  onClick={() => handleDenyCorrection(req)}
                  className="rounded-lg border border-sand px-3 py-1.5 text-[11px] font-semibold text-bark transition-all hover:border-terracotta hover:text-terracotta"
                >
                  Deny
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Break Corrections Section ─────────────────────────────── */

function BreakCorrectionsSection({
  breakCorrectionRequests,
  profileMap,
  breakReviewNotes,
  setBreakReviewNotes,
  breakCustomMs,
  setBreakCustomMs,
  handleApproveBreakCorrection,
  handleDenyBreakCorrection,
}: {
  breakCorrectionRequests: BreakCorrectionRequest[];
  profileMap: Map<string, Profile>;
  breakReviewNotes: Record<number, string>;
  setBreakReviewNotes: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  breakCustomMs: Record<number, string>;
  setBreakCustomMs: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  handleApproveBreakCorrection: (req: BreakCorrectionRequest) => void;
  handleDenyBreakCorrection: (req: BreakCorrectionRequest) => void;
}) {
  if (breakCorrectionRequests.length === 0) {
    return (
      <div className="rounded-xl border border-sand bg-white px-5 py-12 text-center">
        <p className="text-sm text-bark">No pending break correction requests.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-sand bg-white">
      <div className="flex items-center justify-between border-b border-parchment px-5 py-4">
        <h2 className="text-sm font-bold text-espresso">
          Break Overage Reviews
        </h2>
        <span className="rounded-full bg-terracotta-soft px-2.5 py-[2px] text-[11px] font-semibold text-terracotta">
          {breakCorrectionRequests.length}
        </span>
      </div>
      <div className="divide-y divide-parchment">
        {breakCorrectionRequests.map((req) => {
          const reqProfile = profileMap.get(req.user_id);
          const shiftHrs = (req.shift_duration_ms / 3600000).toFixed(1);

          return (
            <div key={req.id} className="px-5 py-4">
              <div className="flex items-start gap-3 mb-3">
                {reqProfile && (
                  <div
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ backgroundColor: getAvatarColor(reqProfile.id) }}
                  >
                    {getInitials(reqProfile.full_name)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-espresso">
                    {reqProfile?.full_name || "Unknown"}{" "}
                    <span className="font-normal text-bark">
                      exceeded break allowance
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-stone">
                    {new Date(req.session_date).toLocaleDateString()} &middot; {shiftHrs}h shift
                  </div>

                  {/* Break details */}
                  <div className="mt-2 rounded-lg bg-parchment px-3 py-2">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-espresso">
                      <div>
                        <span className="font-medium">Total Break:</span>{" "}
                        {formatDuration(req.total_break_ms)}
                      </div>
                      <div>
                        <span className="font-medium">Allowed:</span>{" "}
                        {formatDuration(req.allowed_break_ms)}
                      </div>
                      <div className="col-span-2">
                        <span className="font-medium text-terracotta">Excess:</span>{" "}
                        <span className="text-terracotta font-semibold">
                          {formatDuration(req.excess_break_ms)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                <span className="text-[10px] text-stone shrink-0">
                  {new Date(req.created_at || "").toLocaleDateString()}
                </span>
              </div>
              {/* Custom billable amount + review notes + actions */}
              <div className="ml-10 space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-bark whitespace-nowrap">
                    Custom billable (min):
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={breakCustomMs[req.id] || ""}
                    onChange={(e) =>
                      setBreakCustomMs((prev) => ({
                        ...prev,
                        [req.id]: e.target.value,
                      }))
                    }
                    placeholder={String(Math.round(req.allowed_break_ms / 60000))}
                    className="w-20 rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none transition-colors focus:border-terracotta"
                  />
                  <span className="text-[10px] text-stone">
                    (leave blank to keep {Math.round(req.allowed_break_ms / 60000)} min)
                  </span>
                </div>
                <div className="flex items-end gap-2">
                  <input
                    type="text"
                    value={breakReviewNotes[req.id] || ""}
                    onChange={(e) =>
                      setBreakReviewNotes((prev) => ({
                        ...prev,
                        [req.id]: e.target.value,
                      }))
                    }
                    placeholder="Review notes (optional)..."
                    className="flex-1 rounded-lg border border-sand px-3 py-1.5 text-xs text-espresso outline-none transition-colors focus:border-terracotta"
                  />
                  <button
                    onClick={() => handleApproveBreakCorrection(req)}
                    className="rounded-lg bg-sage px-3 py-1.5 text-[11px] font-semibold text-white transition-all hover:bg-[#5a7a5a]"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleDenyBreakCorrection(req)}
                    className="rounded-lg border border-sand px-3 py-1.5 text-[11px] font-semibold text-bark transition-all hover:border-terracotta hover:text-terracotta"
                  >
                    Deny
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Sorting Review Tab ────────────────────────────────────── */

function SortingReviewTab({
  sortingReviews,
  profileMap,
  logMap,
  currentUserId,
  fetchData,
}: {
  sortingReviews: SortingReview[];
  profileMap: Map<string, Profile>;
  logMap: Map<number, TimeLog>;
  currentUserId: string | null;
  fetchData: () => void;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editAccount, setEditAccount] = useState("");
  const [editClient, setEditClient] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const handleBillInternal = async (review: SortingReview) => {
    if (!currentUserId) return;
    const supabase = createClient();
    await supabase
      .from("sorting_review")
      .update({
        status: "approved",
        bill_to: "internal",
        reviewed_by: currentUserId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", review.id);
    fetchData();
  };

  const handleBillClient = async (review: SortingReview) => {
    setEditingId(review.id);
    setEditAccount(review.original_account || "");
    setEditClient(review.original_client || "");
    setEditNotes("");
  };

  const handleSaveReassign = async () => {
    if (!currentUserId || !editingId) return;
    const supabase = createClient();
    await supabase
      .from("sorting_review")
      .update({
        status: "reassigned",
        bill_to: "client",
        final_account: editAccount || null,
        final_client: editClient || null,
        notes: editNotes || null,
        reviewed_by: currentUserId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", editingId);
    setEditingId(null);
    fetchData();
  };

  const handleApproveAsIs = async (review: SortingReview) => {
    if (!currentUserId) return;
    const supabase = createClient();
    await supabase
      .from("sorting_review")
      .update({
        status: "approved",
        bill_to: "internal",
        final_account: review.original_account,
        final_client: review.original_client,
        reviewed_by: currentUserId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", review.id);
    fetchData();
  };

  if (sortingReviews.length === 0) {
    return (
      <div className="rounded-xl border border-sand bg-white px-5 py-12 text-center">
        <p className="text-sm text-bark">No pending sorting entries to review.</p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-xl border border-sand bg-white">
        <div className="flex items-center justify-between border-b border-parchment px-5 py-4">
          <h2 className="text-sm font-bold text-espresso">
            Pending Sorting Review
          </h2>
          <span className="rounded-full bg-amber-soft px-2.5 py-[2px] text-[11px] font-semibold text-amber">
            {sortingReviews.length}
          </span>
        </div>
        <div className="divide-y divide-parchment">
          {sortingReviews.map((review) => {
            const log = logMap.get(review.log_id);
            const vaProfile = log ? profileMap.get(log.user_id) : null;

            return (
              <div key={review.id} className="px-5 py-4">
                <div className="flex items-start gap-3 mb-3">
                  {vaProfile && (
                    <div
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                      style={{ backgroundColor: getAvatarColor(vaProfile.id) }}
                    >
                      {getInitials(vaProfile.full_name)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-espresso">
                      {vaProfile?.full_name || "Unknown VA"}
                    </div>
                    {log && (
                      <>
                        <div className="mt-0.5 text-[11px] text-bark">
                          Task: <strong>{log.task_name}</strong>
                          {log.account && <> &middot; Account: {log.account}</>}
                          {log.client_name && <> &middot; Client: {log.client_name}</>}
                        </div>
                        <div className="mt-0.5 text-[10px] text-stone">
                          {new Date(log.start_time).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}{" "}
                          &middot;{" "}
                          {log.duration_ms > 0
                            ? formatDuration(log.duration_ms)
                            : "In progress"}
                        </div>
                      </>
                    )}
                  </div>
                  <span className="rounded-full bg-amber-soft px-2 py-0.5 text-[10px] font-semibold text-amber">
                    Sorting
                  </span>
                </div>

                {editingId === review.id ? (
                  <div className="ml-10 rounded-lg bg-parchment p-3">
                    <p className="text-[11px] font-semibold text-walnut mb-2">
                      Reassign billing — edit account/client:
                    </p>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <input
                        value={editAccount}
                        onChange={(e) => setEditAccount(e.target.value)}
                        placeholder="Account"
                        className="rounded-lg border border-sand px-3 py-1.5 text-xs text-espresso outline-none focus:border-terracotta"
                      />
                      <input
                        value={editClient}
                        onChange={(e) => setEditClient(e.target.value)}
                        placeholder="Client"
                        className="rounded-lg border border-sand px-3 py-1.5 text-xs text-espresso outline-none focus:border-terracotta"
                      />
                    </div>
                    <input
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      placeholder="Notes (optional)"
                      className="w-full rounded-lg border border-sand px-3 py-1.5 text-xs text-espresso outline-none focus:border-terracotta mb-2"
                    />
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => setEditingId(null)}
                        className="rounded-lg border border-sand px-3 py-1.5 text-[11px] font-semibold text-bark transition-all hover:border-terracotta hover:text-terracotta"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveReassign}
                        className="rounded-lg bg-terracotta px-3 py-1.5 text-[11px] font-semibold text-white transition-all hover:bg-[#a85840]"
                      >
                        Save & Bill Client
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="ml-10 flex items-center gap-2">
                    <button
                      onClick={() => handleBillInternal(review)}
                      className="rounded-lg bg-walnut px-3 py-1.5 text-[11px] font-semibold text-white transition-all hover:bg-[#4a3a2e]"
                    >
                      Bill to Toni
                    </button>
                    <button
                      onClick={() => handleBillClient(review)}
                      className="rounded-lg bg-slate-blue px-3 py-1.5 text-[11px] font-semibold text-white transition-all hover:bg-[#4a5568]"
                    >
                      Bill to Client
                    </button>
                    <button
                      onClick={() => handleApproveAsIs(review)}
                      className="rounded-lg bg-sage px-3 py-1.5 text-[11px] font-semibold text-white transition-all hover:bg-[#5a7a5a]"
                    >
                      Approve as-is
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

/* ── Change Password Tab ───────────────────────────────────── */

function ChangePasswordTab() {
  const supabase = createClient();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const handleChangePassword = async () => {
    setPasswordError("");
    setPasswordSuccess(false);

    if (newPassword.length < 6) {
      setPasswordError("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }

    setChangingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setChangingPassword(false);

    if (error) {
      setPasswordError(error.message);
      return;
    }

    setPasswordSuccess(true);
    setNewPassword("");
    setConfirmPassword("");
  };

  return (
    <div className="rounded-xl border border-sand bg-white p-6">
      <div className="max-w-sm">
        {passwordSuccess && (
          <div className="mb-4 rounded-lg bg-sage-soft border border-sage px-4 py-2.5 text-xs text-sage font-medium">
            Password updated successfully!
          </div>
        )}
        {passwordError && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-xs text-red-600">
            {passwordError}
          </div>
        )}

        <div className="mb-4">
          <label className="block text-[11px] font-semibold text-walnut mb-1.5 tracking-wide">
            New Password
          </label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Min. 6 characters"
            className="w-full rounded-lg border border-sand px-3.5 py-2.5 text-[13px] text-espresso outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)]"
          />
        </div>
        <div className="mb-4">
          <label className="block text-[11px] font-semibold text-walnut mb-1.5 tracking-wide">
            Confirm Password
          </label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Repeat new password"
            className="w-full rounded-lg border border-sand px-3.5 py-2.5 text-[13px] text-espresso outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)]"
          />
        </div>
        <button
          onClick={handleChangePassword}
          disabled={changingPassword || !newPassword || !confirmPassword}
          className="rounded-lg bg-terracotta px-6 py-2.5 text-[13px] font-semibold text-white transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {changingPassword ? "Updating..." : "Update Password"}
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   SHARED COMPONENTS (unchanged from original)
   ══════════════════════════════════════════════════════════════ */

/* ── Stat Card ───────────────────────────────────────────── */

function StatCard({
  value,
  label,
  sub,
  color,
}: {
  value: string | number;
  label: string;
  sub: string;
  color: "sage" | "terracotta" | "amber" | "slate-blue" | "walnut";
}) {
  const colorClass = {
    sage: "text-sage",
    terracotta: "text-terracotta",
    amber: "text-amber",
    "slate-blue": "text-slate-blue",
    walnut: "text-walnut",
  }[color];

  return (
    <div className="rounded-xl border border-sand bg-white px-5 py-4">
      <div className={`font-serif text-[28px] font-bold ${colorClass}`}>{value}</div>
      <div className="mt-1 text-[11px] font-semibold text-bark">{label}</div>
      {sub && <div className="mt-0.5 text-[10px] text-stone">{sub}</div>}
    </div>
  );
}

/* ── Team Member Card ────────────────────────────────────── */

function TeamMemberCard({
  member,
  screenshotUrl,
  onCaptureNow,
  onMessage,
  onForceClockOut,
}: {
  member: {
    profile: Profile;
    session: Session | null;
    status: "live" | "break" | "off";
    currentTask: string;
    hasExtension: boolean;
    latestScreenshot: TaskScreenshot | null;
    todayScreenshots: number;
    todayHoursMs: number;
    todayTasks: number;
    wizardTimeMs?: number;
  };
  screenshotUrl: string | null;
  onCaptureNow: () => void;
  onMessage: () => void;
  onForceClockOut?: () => void;
}) {
  const { profile, status, currentTask, hasExtension, latestScreenshot, todayScreenshots, todayHoursMs, todayTasks, wizardTimeMs } = member;
  const avatarColor = getAvatarColor(profile.id);
  const isOffline = status === "off";

  const statusConfig = {
    live: { label: "Live", bg: "bg-sage-soft", text: "text-sage", dot: "bg-sage" },
    break: { label: "Break", bg: "bg-amber-soft", text: "text-amber", dot: "bg-amber" },
    off: { label: "Offline", bg: "bg-parchment", text: "text-stone", dot: "bg-stone" },
  }[status];

  return (
    <div
      className={`overflow-hidden rounded-xl border border-sand bg-white transition-all hover:shadow-md ${
        isOffline ? "opacity-60" : ""
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-parchment px-4 py-3">
        <div className="relative">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
            style={{ backgroundColor: avatarColor }}
          >
            {getInitials(profile.full_name)}
          </div>
          <div
            className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${statusConfig.dot} ${
              status === "live" ? "animate-breathe" : ""
            }`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-bold text-espresso">
              {profile.full_name}
            </span>
            <span
              className={`shrink-0 rounded-full px-2 py-[2px] text-[9px] font-semibold ${statusConfig.bg} ${statusConfig.text}`}
            >
              {statusConfig.label}
            </span>
          </div>
          <div className="truncate text-[11px] text-bark">
            {currentTask}
          </div>
        </div>
      </div>

      {/* Latest screenshot preview */}
      <div className="relative aspect-video w-full overflow-hidden bg-parchment">
        {screenshotUrl ? (
          <img
            src={screenshotUrl}
            alt={`Latest screenshot from ${profile.full_name}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-stone">
            <svg className="h-6 w-6 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8m-4-4v4" />
            </svg>
            <span className="text-[10px]">
              {isOffline ? "No screenshots today" : "No captures yet"}
            </span>
          </div>
        )}
        {latestScreenshot && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/50 px-2 py-0.5 text-[9px] font-semibold text-white">
            {getTimeAgo(new Date(latestScreenshot.created_at))}
          </span>
        )}
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-3 border-b border-parchment px-4 py-2">
        <div className="flex items-center gap-1 text-[10px] text-bark">
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span className="font-semibold text-sage">{formatDuration(todayHoursMs)}</span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-bark">
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
          </svg>
          <span>{todayTasks} tasks</span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-bark">
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          <span>{todayScreenshots} ss</span>
        </div>
        {wizardTimeMs != null && wizardTimeMs > 0 && (
          <div className="flex items-center gap-1 text-[10px]">
            <svg className="h-3 w-3 text-walnut" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
            </svg>
            <span className="font-semibold text-walnut">{formatDuration(wizardTimeMs)}</span>
          </div>
        )}
        {hasExtension && (
          <span className="ml-auto rounded bg-sage-soft px-1.5 py-0.5 text-[9px] font-semibold text-sage">
            Extension
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-1.5 p-2.5">
        {!isOffline ? (
          <>
            <button
              onClick={onCaptureNow}
              className="flex-1 rounded-md bg-terracotta py-1.5 text-center text-[11px] font-semibold text-white transition-all hover:bg-[#a85840]"
            >
              Capture Now
            </button>
            <button
              onClick={onMessage}
              className="flex-1 rounded-md border border-sand bg-white py-1.5 text-center text-[11px] font-semibold text-walnut transition-all hover:border-terracotta hover:text-terracotta"
            >
              Message
            </button>
            {onForceClockOut && (
              <button
                onClick={onForceClockOut}
                className="w-full rounded-md border border-terracotta/30 bg-terracotta-soft py-1.5 text-center text-[11px] font-semibold text-terracotta transition-all hover:bg-terracotta hover:text-white"
              >
                Force Clock Out
              </button>
            )}
          </>
        ) : (
          <button
            onClick={onMessage}
            className="flex-1 rounded-md border border-sand bg-white py-1.5 text-center text-[11px] font-semibold text-walnut transition-all hover:border-terracotta hover:text-terracotta"
          >
            Message
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Screenshot Lightbox ─────────────────────────────────── */

function ScreenshotLightbox({
  screenshot,
  url,
  profile,
  log,
  onClose,
  onPrev,
  onNext,
}: {
  screenshot: TaskScreenshot;
  url: string | null;
  profile: Profile | null;
  log: TimeLog | null;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onPrev();
      if (e.key === "ArrowRight") onNext();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, onPrev, onNext]);

  const badge = screenshotTypeBadge(screenshot.screenshot_type);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90vh] max-w-[90vw] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-parchment px-5 py-3">
          <div className="flex items-center gap-3">
            {profile && (
              <>
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                  style={{ backgroundColor: getAvatarColor(profile.id) }}
                >
                  {getInitials(profile.full_name)}
                </div>
                <div>
                  <div className="text-[13px] font-bold text-espresso">{profile.full_name}</div>
                  {log && (
                    <div className="text-[11px] text-bark">{log.task_name}</div>
                  )}
                </div>
              </>
            )}
            <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${badge.bg} ${badge.text}`}>
              {screenshotTypeLabel(screenshot.screenshot_type)}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-stone">
              {formatDateShort(screenshot.created_at)} at {formatTimeShort(screenshot.created_at)}
            </span>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full text-bark transition-colors hover:bg-parchment hover:text-espresso"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Image */}
        <div className="flex-1 overflow-auto bg-espresso p-2">
          {url ? (
            <img
              src={url}
              alt="Screenshot full view"
              className="mx-auto max-h-[75vh] rounded object-contain"
            />
          ) : (
            <div className="flex h-96 items-center justify-center text-sm text-stone">
              Loading image...
            </div>
          )}
        </div>

        {/* Navigation arrows */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          className="absolute left-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-espresso shadow-lg transition-all hover:bg-white"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-espresso shadow-lg transition-all hover:bg-white"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        {/* Footer with details */}
        {log && (
          <div className="flex items-center gap-4 border-t border-parchment px-5 py-3 text-[11px] text-bark">
            <span>
              <strong className="text-espresso">Task:</strong> {log.task_name}
            </span>
            {log.account && (
              <span>
                <strong className="text-espresso">Account:</strong> {log.account}
              </span>
            )}
            {log.client_name && (
              <span>
                <strong className="text-espresso">Client:</strong> {log.client_name}
              </span>
            )}
            <span>
              <strong className="text-espresso">Category:</strong> {log.category}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   INVOICES TAB
   ══════════════════════════════════════════════════════════════ */

type InvoiceView = "list" | "create" | "create-manual" | "detail";

interface LineItemDraft {
  log_id: number | null;
  description: string;
  va_name: string;
  account_name: string;
  category: string;
  project: string;
  client_memo: string;
  quantity: number; // hours
  unit_price: number; // rate
  amount: number;
  service_date: string;
}

function InvoicesTab({ profiles }: { profiles: Profile[] }) {
  const [view, setView] = useState<InvoiceView>("list");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [orgSettings, setOrgSettings] = useState<OrganizationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"all" | Invoice["status"]>("all");

  // Create invoice state
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [taxRate, setTaxRate] = useState(0);
  const [invoiceNotes, setInvoiceNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Manual invoice state
  const [manualDescription, setManualDescription] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [manualIssueDate, setManualIssueDate] = useState("");
  const [manualDueDate, setManualDueDate] = useState("");

  // Detail view state
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [selectedLineItems, setSelectedLineItems] = useState<InvoiceLineItem[]>([]);
  const [invoicePayments, setInvoicePayments] = useState<InvoicePayment[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sendSuccess, setSendSuccess] = useState("");

  // Record payment state
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split("T")[0]);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentRef, setPaymentRef] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);

  const supabase = createClient();

  /* ── Fetch invoices + clients ─────────────────────────────── */

  const fetchInvoices = useCallback(async () => {
    const sb = createClient();
    const [invRes, clientsRes, orgRes] = await Promise.all([
      sb.from("invoices").select("*").order("created_at", { ascending: false }),
      sb.from("clients").select("*").eq("active", true).order("name"),
      sb.from("organization_settings").select("*").limit(1).single(),
    ]);
    setInvoices((invRes.data ?? []) as Invoice[]);
    setClients((clientsRes.data ?? []) as Client[]);
    if (orgRes.data) setOrgSettings(orgRes.data as OrganizationSettings);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  /* ── Computed ──────────────────────────────────────────────── */

  const filteredInvoices = useMemo(() => {
    if (statusFilter === "all") return invoices;
    return invoices.filter((inv) => inv.status === statusFilter);
  }, [invoices, statusFilter]);

  const summaryStats = useMemo(() => {
    let totalInvoiced = 0;
    let outstanding = 0;
    let paid = 0;
    let overdue = 0;
    invoices.forEach((inv) => {
      totalInvoiced += Number(inv.total);
      if (inv.status === "sent") outstanding += Number(inv.total);
      if (inv.status === "partially_paid") outstanding += Number(inv.total) - Number(inv.amount_paid || 0);
      if (inv.status === "paid") paid += Number(inv.total);
      if (inv.status === "overdue") overdue += Number(inv.total) - Number(inv.amount_paid || 0);
    });
    return { totalInvoiced, outstanding, paid, overdue };
  }, [invoices]);

  const selectedClient = useMemo(() => {
    return clients.find((c) => c.id === selectedClientId) ?? null;
  }, [clients, selectedClientId]);

  const subtotal = useMemo(() => {
    return lineItems.reduce((sum, li) => sum + li.amount, 0);
  }, [lineItems]);

  const taxAmount = useMemo(() => {
    return subtotal * (taxRate / 100);
  }, [subtotal, taxRate]);

  const total = useMemo(() => {
    return subtotal + taxAmount;
  }, [subtotal, taxAmount]);

  /* ── Generate next invoice number ─────────────────────────── */

  const generateInvoiceNumber = useCallback(() => {
    const year = new Date().getFullYear();
    const existingThisYear = invoices.filter((inv) =>
      inv.invoice_number.startsWith(`MF-${year}-`)
    );
    const maxNum = existingThisYear.reduce((max, inv) => {
      const parts = inv.invoice_number.split("-");
      const num = parseInt(parts[2] || "0", 10);
      return num > max ? num : max;
    }, 0);
    return `MF-${year}-${String(maxNum + 1).padStart(3, "0")}`;
  }, [invoices]);

  /* ── Fetch billable logs for selected client + date range ── */

  const fetchBillableLogs = async () => {
    if (!selectedClientId || !dateFrom || !dateTo) return;
    setLoadingLogs(true);

    const client = clients.find((c) => c.id === selectedClientId);
    if (!client) {
      setLoadingLogs(false);
      return;
    }

    // Get all log_ids already on invoices (to exclude them)
    const { data: existingItems } = await supabase
      .from("invoice_line_items")
      .select("log_id")
      .not("log_id", "is", null);

    const usedLogIds = new Set((existingItems ?? []).map((item: { log_id: number | null }) => item.log_id));

    // Fetch billable time_logs for this client in range
    const { data: logs } = await supabase
      .from("time_logs")
      .select("*")
      .eq("client_name", client.name)
      .eq("billable", true)
      .gte("start_time", new Date(dateFrom).toISOString())
      .lte("start_time", new Date(dateTo + "T23:59:59").toISOString())
      .order("start_time", { ascending: true });

    const availableLogs = ((logs ?? []) as TimeLog[]).filter((l) => !usedLogIds.has(l.id));

    // Group by VA
    const byVa = new Map<string, TimeLog[]>();
    availableLogs.forEach((log) => {
      const vaName = log.full_name || log.username;
      if (!byVa.has(vaName)) byVa.set(vaName, []);
      byVa.get(vaName)!.push(log);
    });

    const items: LineItemDraft[] = [];
    byVa.forEach((vaLogs, vaName) => {
      // Find profile to get pay_rate
      const profile = profiles.find(
        (p) => p.full_name === vaName || p.username === vaName
      );
      const rate = client.default_hourly_rate ?? profile?.pay_rate ?? 0;

      vaLogs.forEach((log) => {
        const hours = log.duration_ms / 3600000;
        items.push({
          log_id: log.id,
          description: log.task_name,
          va_name: vaName,
          account_name: log.account || "",
          category: log.category,
          project: log.project || "",
          client_memo: log.client_memo || "",
          quantity: Math.round(hours * 100) / 100,
          unit_price: rate,
          amount: Math.round(hours * rate * 100) / 100,
          service_date: new Date(log.start_time).toISOString().split("T")[0],
        });
      });
    });

    setLineItems(items);
    setLoadingLogs(false);
  };

  /* ── Save invoice ─────────────────────────────────────────── */

  const handleSaveInvoice = async (sendNow: boolean) => {
    if (!selectedClient || lineItems.length === 0) return;
    setSaving(true);

    const invoiceNumber = generateInvoiceNumber();
    const paymentTerms = selectedClient.payment_terms || "net_30";
    const issueDate = new Date().toISOString().split("T")[0];

    // Calculate due date from payment terms
    let dueDays = 30;
    if (paymentTerms === "due_on_receipt") dueDays = 0;
    else if (paymentTerms === "net_15") dueDays = 15;
    else if (paymentTerms === "net_45") dueDays = 45;
    else if (paymentTerms === "net_60") dueDays = 60;

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + dueDays);

    const invoiceData = {
      invoice_number: invoiceNumber,
      client_id: selectedClient.id,
      status: sendNow ? "sent" : "draft",
      from_name: orgSettings?.org_name || "MinuteFlow",
      from_address: orgSettings?.address || null,
      from_email: orgSettings?.billing_email || null,
      from_logo_url: orgSettings?.logo_url || null,
      to_name: selectedClient.name,
      to_contact: selectedClient.contact_name,
      to_email: selectedClient.email,
      to_address: [selectedClient.address, selectedClient.city, selectedClient.state, selectedClient.zip, selectedClient.country].filter(Boolean).join(", ") || null,
      to_logo_url: selectedClient.logo_url,
      issue_date: issueDate,
      due_date: dueDate.toISOString().split("T")[0],
      subtotal,
      tax_rate: taxRate,
      tax_amount: taxAmount,
      total,
      currency: selectedClient.currency || "USD",
      notes: invoiceNotes || null,
      payment_terms: paymentTerms,
      sent_at: sendNow ? new Date().toISOString() : null,
    };

    const { data: newInvoice, error } = await supabase
      .from("invoices")
      .insert(invoiceData)
      .select()
      .single();

    if (error || !newInvoice) {
      setSaving(false);
      return;
    }

    // Insert line items
    const lineItemsData = lineItems.map((li, idx) => ({
      invoice_id: newInvoice.id,
      log_id: li.log_id,
      description: li.description,
      va_name: li.va_name,
      account_name: li.account_name || null,
      category: li.category || null,
      project: li.project || null,
      client_memo: li.client_memo || null,
      quantity: li.quantity,
      unit_price: li.unit_price,
      amount: li.amount,
      service_date: li.service_date || null,
      sort_order: idx,
    }));

    await supabase.from("invoice_line_items").insert(lineItemsData);

    // If sending now, also fire email
    if (sendNow && selectedClient.email) {
      try {
        await fetch("/api/invoices/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invoice_id: newInvoice.id }),
        });
      } catch {
        // Email send failed, but invoice is saved
      }
    }

    setSaving(false);
    setView("list");
    setSelectedClientId(null);
    setDateFrom("");
    setDateTo("");
    setLineItems([]);
    setTaxRate(0);
    setInvoiceNotes("");
    fetchInvoices();
  };

  /* ── Save manual (past) invoice ──────────────────────────── */

  const handleSaveManualInvoice = async () => {
    if (!selectedClient || !manualAmount || !manualDescription) return;
    setSaving(true);

    const invoiceNumber = generateInvoiceNumber();
    const amt = parseFloat(manualAmount) || 0;

    const invoiceData = {
      invoice_number: invoiceNumber,
      client_id: selectedClient.id,
      status: "sent" as const,
      from_name: orgSettings?.org_name || "MinuteFlow",
      from_address: orgSettings?.address || null,
      from_email: orgSettings?.billing_email || null,
      from_logo_url: orgSettings?.logo_url || null,
      to_name: selectedClient.name,
      to_contact: selectedClient.contact_name,
      to_email: selectedClient.email,
      to_address: [selectedClient.address, selectedClient.city, selectedClient.state, selectedClient.zip, selectedClient.country].filter(Boolean).join(", ") || null,
      to_logo_url: selectedClient.logo_url,
      issue_date: manualIssueDate || new Date().toISOString().split("T")[0],
      due_date: manualDueDate || null,
      subtotal: amt,
      tax_rate: taxRate,
      tax_amount: Math.round(amt * (taxRate / 100) * 100) / 100,
      total: Math.round((amt + amt * (taxRate / 100)) * 100) / 100,
      amount_paid: 0,
      currency: selectedClient.currency || "USD",
      notes: invoiceNotes || null,
      payment_terms: selectedClient.payment_terms || "net_30",
      is_manual: true,
    };

    const { data: newInvoice, error } = await supabase
      .from("invoices")
      .insert(invoiceData)
      .select()
      .single();

    if (error || !newInvoice) {
      setSaving(false);
      return;
    }

    // Insert a single line item for the manual invoice
    await supabase.from("invoice_line_items").insert({
      invoice_id: newInvoice.id,
      log_id: null,
      description: manualDescription,
      va_name: null,
      account_name: null,
      category: null,
      quantity: 1,
      unit_price: amt,
      amount: amt,
      service_date: manualIssueDate || new Date().toISOString().split("T")[0],
      sort_order: 0,
    });

    setSaving(false);
    setView("list");
    setSelectedClientId(null);
    setManualDescription("");
    setManualAmount("");
    setManualIssueDate("");
    setManualDueDate("");
    setTaxRate(0);
    setInvoiceNotes("");
    fetchInvoices();
  };

  /* ── Record payment against invoice ────────────────────────── */

  const handleRecordPayment = async () => {
    if (!selectedInvoice || !paymentAmount) return;
    setSavingPayment(true);

    const amt = parseFloat(paymentAmount) || 0;
    if (amt <= 0) {
      setSavingPayment(false);
      return;
    }

    // Insert payment record
    const { error } = await supabase.from("invoice_payments").insert({
      invoice_id: selectedInvoice.id,
      amount: amt,
      payment_date: paymentDate,
      payment_method: paymentMethod || null,
      reference_number: paymentRef || null,
      notes: paymentNotes || null,
    });

    if (error) {
      setSavingPayment(false);
      return;
    }

    // Calculate new total paid
    const newAmountPaid = Number(selectedInvoice.amount_paid || 0) + amt;
    const invoiceTotal = Number(selectedInvoice.total);

    // Determine new status
    let newStatus: Invoice["status"] = selectedInvoice.status;
    if (newAmountPaid >= invoiceTotal) {
      newStatus = "paid";
    } else if (newAmountPaid > 0) {
      newStatus = "partially_paid";
    }

    // Update invoice
    await supabase
      .from("invoices")
      .update({
        amount_paid: newAmountPaid,
        status: newStatus,
        ...(newStatus === "paid" ? { paid_date: new Date().toISOString().split("T")[0] } : {}),
      })
      .eq("id", selectedInvoice.id);

    // Update local state
    setSelectedInvoice((prev) =>
      prev ? { ...prev, amount_paid: newAmountPaid, status: newStatus, ...(newStatus === "paid" ? { paid_date: new Date().toISOString().split("T")[0] } : {}) } : null
    );

    // Refresh payments list
    const { data: payments } = await supabase
      .from("invoice_payments")
      .select("*")
      .eq("invoice_id", selectedInvoice.id)
      .order("payment_date", { ascending: false });
    setInvoicePayments((payments ?? []) as InvoicePayment[]);

    // Reset form
    setPaymentAmount("");
    setPaymentDate(new Date().toISOString().split("T")[0]);
    setPaymentMethod("");
    setPaymentRef("");
    setPaymentNotes("");
    setShowPaymentForm(false);
    setSavingPayment(false);
    fetchInvoices();
  };

  /* ── View invoice detail ──────────────────────────────────── */

  const openInvoiceDetail = async (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setSendError("");
    setSendSuccess("");
    setShowPaymentForm(false);

    const [lineItemsRes, paymentsRes] = await Promise.all([
      supabase
        .from("invoice_line_items")
        .select("*")
        .eq("invoice_id", invoice.id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("invoice_payments")
        .select("*")
        .eq("invoice_id", invoice.id)
        .order("payment_date", { ascending: false }),
    ]);

    setSelectedLineItems((lineItemsRes.data ?? []) as InvoiceLineItem[]);
    setInvoicePayments((paymentsRes.data ?? []) as InvoicePayment[]);
    setView("detail");
  };

  /* ── Send invoice email ───────────────────────────────────── */

  const handleSendInvoice = async (invoice: Invoice) => {
    setSending(true);
    setSendError("");
    setSendSuccess("");

    try {
      const res = await fetch("/api/invoices/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_id: invoice.id }),
      });

      if (!res.ok) {
        const data = await res.json();
        setSendError(data.error || "Failed to send invoice");
      } else {
        setSendSuccess("Invoice sent successfully!");
        // Update local state
        setSelectedInvoice((prev) =>
          prev ? { ...prev, status: "sent" as const, sent_at: new Date().toISOString() } : null
        );
        fetchInvoices();
      }
    } catch {
      setSendError("Failed to send invoice");
    }

    setSending(false);
  };

  /* ── Mark as paid ─────────────────────────────────────────── */

  const handleMarkPaid = async (invoice: Invoice) => {
    const invoiceTotal = Number(invoice.total);
    await supabase
      .from("invoices")
      .update({
        status: "paid",
        paid_date: new Date().toISOString().split("T")[0],
        amount_paid: invoiceTotal,
      })
      .eq("id", invoice.id);

    // If amount remaining, insert a balancing payment record
    const remaining = invoiceTotal - Number(invoice.amount_paid || 0);
    if (remaining > 0) {
      await supabase.from("invoice_payments").insert({
        invoice_id: invoice.id,
        amount: remaining,
        payment_date: new Date().toISOString().split("T")[0],
        payment_method: null,
        reference_number: null,
        notes: "Marked as fully paid",
      });
    }

    setSelectedInvoice((prev) =>
      prev ? { ...prev, status: "paid" as const, paid_date: new Date().toISOString().split("T")[0], amount_paid: invoiceTotal } : null
    );
    fetchInvoices();
  };

  /* ── Helpers ──────────────────────────────────────────────── */

  const formatCurrency = (amount: number, currency = "USD") => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amount);
  };

  const statusBadge = (status: Invoice["status"]) => {
    const styles: Record<Invoice["status"], { bg: string; text: string }> = {
      draft: { bg: "bg-parchment", text: "text-bark" },
      sent: { bg: "bg-slate-blue-soft", text: "text-slate-blue" },
      paid: { bg: "bg-sage-soft", text: "text-sage" },
      partially_paid: { bg: "bg-amber-soft", text: "text-amber" },
      overdue: { bg: "bg-red-50", text: "text-red-600" },
      cancelled: { bg: "bg-stone/10", text: "text-stone" },
    };
    const s = styles[status] || styles.draft;
    return `${s.bg} ${s.text}`;
  };

  const statusLabel = (status: Invoice["status"]) => {
    if (status === "partially_paid") return "Partial";
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  const paymentTermsLabel = (terms: string | null) => {
    const labels: Record<string, string> = {
      due_on_receipt: "Due on Receipt",
      net_15: "Net 15",
      net_30: "Net 30",
      net_45: "Net 45",
      net_60: "Net 60",
    };
    return labels[terms || ""] || terms || "Net 30";
  };

  /* ── Loading state ────────────────────────────────────────── */

  if (loading) {
    return <div className="h-48 animate-pulse rounded-xl border border-sand bg-white" />;
  }

  /* ── CREATE VIEW ──────────────────────────────────────────── */

  if (view === "create") {
    return (
      <>
        <div className="mb-4 flex items-center justify-between">
          <button
            onClick={() => { setView("list"); setLineItems([]); setSelectedClientId(null); }}
            className="flex items-center gap-1.5 text-[13px] font-medium text-bark transition-colors hover:text-terracotta cursor-pointer"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back to Invoices
          </button>
        </div>

        <div className="rounded-xl border border-sand bg-white p-6">
          <h3 className="mb-6 font-serif text-lg font-bold text-espresso">Generate New Invoice</h3>

          {/* Step 1: Select Client */}
          <div className="mb-6">
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-bark">
              Step 1: Select Client
            </label>
            <select
              value={selectedClientId ?? ""}
              onChange={(e) => {
                setSelectedClientId(e.target.value ? Number(e.target.value) : null);
                setLineItems([]);
              }}
              className="w-full max-w-xs rounded-lg border border-sand bg-parchment px-3 py-2.5 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta cursor-pointer"
            >
              <option value="">Choose a client...</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Step 2: Date Range */}
          {selectedClientId && (
            <div className="mb-6">
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-bark">
                Step 2: Select Date Range
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="rounded-lg border border-sand bg-parchment px-3 py-2.5 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                />
                <span className="text-[12px] text-bark">to</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="rounded-lg border border-sand bg-parchment px-3 py-2.5 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                />
                <button
                  onClick={fetchBillableLogs}
                  disabled={!dateFrom || !dateTo}
                  className="rounded-lg bg-terracotta px-4 py-2.5 text-[13px] font-semibold text-white transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {loadingLogs ? "Loading..." : "Fetch Time Logs"}
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Preview Line Items */}
          {lineItems.length > 0 && (
            <div className="mb-6">
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-bark">
                Step 3: Review Line Items
              </label>

              <div className="rounded-lg border border-sand overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[12px]">
                    <thead>
                      <tr className="border-b border-parchment bg-parchment/30 text-[10px] font-semibold uppercase tracking-wider text-bark">
                        <th className="px-3 py-2.5">VA</th>
                        <th className="px-3 py-2.5">Description</th>
                        <th className="px-3 py-2.5">Date</th>
                        <th className="px-3 py-2.5 text-right">Hours</th>
                        <th className="px-3 py-2.5 text-right">Rate</th>
                        <th className="px-3 py-2.5 text-right">Amount</th>
                        <th className="px-3 py-2.5 text-center">Remove</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-parchment">
                      {lineItems.map((li, idx) => (
                        <tr key={idx} className="hover:bg-parchment/20 transition-colors">
                          <td className="px-3 py-2.5 font-medium text-espresso">{li.va_name}</td>
                          <td className="px-3 py-2.5 text-bark max-w-[200px] truncate">{li.description}</td>
                          <td className="px-3 py-2.5 text-bark">{li.service_date}</td>
                          <td className="px-3 py-2.5 text-right">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={li.quantity}
                              onChange={(e) => {
                                const newItems = [...lineItems];
                                const qty = parseFloat(e.target.value) || 0;
                                newItems[idx] = {
                                  ...newItems[idx],
                                  quantity: qty,
                                  amount: Math.round(qty * newItems[idx].unit_price * 100) / 100,
                                };
                                setLineItems(newItems);
                              }}
                              className="w-16 rounded border border-sand px-1.5 py-1 text-right text-[11px] outline-none focus:border-terracotta"
                            />
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={li.unit_price}
                              onChange={(e) => {
                                const newItems = [...lineItems];
                                const price = parseFloat(e.target.value) || 0;
                                newItems[idx] = {
                                  ...newItems[idx],
                                  unit_price: price,
                                  amount: Math.round(newItems[idx].quantity * price * 100) / 100,
                                };
                                setLineItems(newItems);
                              }}
                              className="w-20 rounded border border-sand px-1.5 py-1 text-right text-[11px] outline-none focus:border-terracotta"
                            />
                          </td>
                          <td className="px-3 py-2.5 text-right font-medium text-espresso">
                            {formatCurrency(li.amount)}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <button
                              onClick={() => {
                                setLineItems(lineItems.filter((_, i) => i !== idx));
                              }}
                              className="inline-flex h-6 w-6 items-center justify-center rounded text-stone transition-colors hover:bg-red-50 hover:text-red-500 cursor-pointer"
                            >
                              &times;
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Totals */}
              <div className="mt-4 flex justify-end">
                <div className="w-72 space-y-2 rounded-lg border border-sand bg-parchment/30 p-4">
                  <div className="flex justify-between text-[12px]">
                    <span className="text-bark">Subtotal</span>
                    <span className="font-medium text-espresso">{formatCurrency(subtotal)}</span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-bark">Tax Rate (%)</span>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      value={taxRate}
                      onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)}
                      className="w-16 rounded border border-sand px-1.5 py-1 text-right text-[11px] outline-none focus:border-terracotta"
                    />
                  </div>
                  <div className="flex justify-between text-[12px]">
                    <span className="text-bark">Tax</span>
                    <span className="text-espresso">{formatCurrency(taxAmount)}</span>
                  </div>
                  <div className="flex justify-between border-t border-sand pt-2 text-[13px]">
                    <span className="font-bold text-espresso">Total</span>
                    <span className="font-bold text-terracotta">{formatCurrency(total)}</span>
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div className="mt-4">
                <label className="mb-1 block text-[11px] font-semibold text-bark">Notes</label>
                <textarea
                  value={invoiceNotes}
                  onChange={(e) => setInvoiceNotes(e.target.value)}
                  placeholder="Payment instructions, thank you note, etc."
                  className="w-full rounded-lg border border-sand bg-parchment px-3 py-2.5 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta placeholder:text-stone resize-none"
                  rows={3}
                />
              </div>

              {/* Actions */}
              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={() => handleSaveInvoice(false)}
                  disabled={saving}
                  className="rounded-lg border border-sand px-5 py-2.5 text-[13px] font-semibold text-bark transition-all hover:border-terracotta hover:text-terracotta disabled:opacity-50 cursor-pointer"
                >
                  {saving ? "Saving..." : "Save as Draft"}
                </button>
                <button
                  onClick={() => handleSaveInvoice(true)}
                  disabled={saving || !selectedClient?.email}
                  title={!selectedClient?.email ? "Client has no email address" : ""}
                  className="rounded-lg bg-terracotta px-5 py-2.5 text-[13px] font-semibold text-white transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {saving ? "Sending..." : "Send Invoice"}
                </button>
              </div>
            </div>
          )}

          {/* Empty state after fetching with no results */}
          {selectedClientId && dateFrom && dateTo && lineItems.length === 0 && !loadingLogs && (
            <div className="rounded-lg border border-dashed border-sand bg-parchment/30 px-6 py-10 text-center">
              <p className="text-[13px] text-bark">
                No uninvoiced billable time logs found for this client in the selected date range.
              </p>
            </div>
          )}
        </div>
      </>
    );
  }

  /* ── CREATE MANUAL (PAST) INVOICE VIEW ───────────────────── */

  if (view === "create-manual") {
    return (
      <>
        <div className="mb-4 flex items-center justify-between">
          <button
            onClick={() => { setView("list"); setSelectedClientId(null); setManualDescription(""); setManualAmount(""); setManualIssueDate(""); setManualDueDate(""); setTaxRate(0); setInvoiceNotes(""); }}
            className="flex items-center gap-1.5 text-[13px] font-medium text-bark transition-colors hover:text-terracotta cursor-pointer"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back to Invoices
          </button>
        </div>

        <div className="rounded-xl border border-sand bg-white p-6">
          <h3 className="mb-1 font-serif text-lg font-bold text-espresso">Add Past / Unpaid Invoice</h3>
          <p className="mb-6 text-[12px] text-bark">Record a previous invoice that is still outstanding. You can track partial payments against it.</p>

          {/* Client */}
          <div className="mb-5">
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-bark">Client</label>
            <select
              value={selectedClientId ?? ""}
              onChange={(e) => setSelectedClientId(e.target.value ? Number(e.target.value) : null)}
              className="w-full max-w-xs rounded-lg border border-sand bg-parchment px-3 py-2.5 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta cursor-pointer"
            >
              <option value="">Choose a client...</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {selectedClientId && (
            <>
              {/* Description */}
              <div className="mb-5">
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-bark">Description</label>
                <input
                  type="text"
                  value={manualDescription}
                  onChange={(e) => setManualDescription(e.target.value)}
                  placeholder="e.g. Invoice for February 2026 VA services"
                  className="w-full rounded-lg border border-sand bg-parchment px-3 py-2.5 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta placeholder:text-stone"
                />
              </div>

              {/* Amount */}
              <div className="mb-5">
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-bark">Invoice Amount ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={manualAmount}
                  onChange={(e) => setManualAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-48 rounded-lg border border-sand bg-parchment px-3 py-2.5 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta placeholder:text-stone"
                />
              </div>

              {/* Dates */}
              <div className="mb-5 flex items-end gap-4">
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-bark">Issue Date</label>
                  <input
                    type="date"
                    value={manualIssueDate}
                    onChange={(e) => setManualIssueDate(e.target.value)}
                    className="rounded-lg border border-sand bg-parchment px-3 py-2.5 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-bark">Due Date</label>
                  <input
                    type="date"
                    value={manualDueDate}
                    onChange={(e) => setManualDueDate(e.target.value)}
                    className="rounded-lg border border-sand bg-parchment px-3 py-2.5 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                  />
                </div>
              </div>

              {/* Tax */}
              <div className="mb-5">
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-bark">Tax Rate (%)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={taxRate}
                  onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)}
                  className="w-24 rounded-lg border border-sand bg-parchment px-3 py-2.5 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                />
              </div>

              {/* Notes */}
              <div className="mb-5">
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-bark">Notes</label>
                <textarea
                  value={invoiceNotes}
                  onChange={(e) => setInvoiceNotes(e.target.value)}
                  placeholder="Optional notes about this invoice..."
                  className="w-full rounded-lg border border-sand bg-parchment px-3 py-2.5 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta placeholder:text-stone resize-none"
                  rows={3}
                />
              </div>

              {/* Summary */}
              {manualAmount && parseFloat(manualAmount) > 0 && (
                <div className="mb-6 flex justify-end">
                  <div className="w-72 space-y-2 rounded-lg border border-sand bg-parchment/30 p-4">
                    <div className="flex justify-between text-[12px]">
                      <span className="text-bark">Subtotal</span>
                      <span className="font-medium text-espresso">{formatCurrency(parseFloat(manualAmount) || 0)}</span>
                    </div>
                    {taxRate > 0 && (
                      <div className="flex justify-between text-[12px]">
                        <span className="text-bark">Tax ({taxRate}%)</span>
                        <span className="text-espresso">{formatCurrency((parseFloat(manualAmount) || 0) * taxRate / 100)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-sand pt-2 text-[13px]">
                      <span className="font-bold text-espresso">Total</span>
                      <span className="font-bold text-terracotta">{formatCurrency((parseFloat(manualAmount) || 0) * (1 + taxRate / 100))}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Save */}
              <div className="flex justify-end">
                <button
                  onClick={handleSaveManualInvoice}
                  disabled={saving || !manualDescription || !manualAmount || parseFloat(manualAmount) <= 0}
                  className="rounded-lg bg-terracotta px-5 py-2.5 text-[13px] font-semibold text-white transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {saving ? "Saving..." : "Save Invoice"}
                </button>
              </div>
            </>
          )}
        </div>
      </>
    );
  }

  /* ── DETAIL VIEW ──────────────────────────────────────────── */

  if (view === "detail" && selectedInvoice) {
    const inv = selectedInvoice;
    return (
      <>
        <div className="mb-4 flex items-center justify-between">
          <button
            onClick={() => { setView("list"); setSelectedInvoice(null); }}
            className="flex items-center gap-1.5 text-[13px] font-medium text-bark transition-colors hover:text-terracotta cursor-pointer"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back to Invoices
          </button>
          <div className="flex items-center gap-2">
            {inv.status !== "paid" && inv.status !== "cancelled" && (
              <button
                onClick={() => setShowPaymentForm(true)}
                className="rounded-lg bg-amber px-4 py-2 text-[13px] font-semibold text-white transition-all hover:bg-amber/80 cursor-pointer"
              >
                Record Payment
              </button>
            )}
            {(inv.status === "draft" || inv.status === "sent") && inv.to_email && (
              <button
                onClick={() => handleSendInvoice(inv)}
                disabled={sending}
                className="rounded-lg bg-slate-blue px-4 py-2 text-[13px] font-semibold text-white transition-all hover:bg-slate-blue/80 disabled:opacity-50 cursor-pointer"
              >
                {sending ? "Sending..." : inv.status === "sent" ? "Resend Email" : "Send via Email"}
              </button>
            )}
            {inv.status !== "paid" && inv.status !== "cancelled" && (
              <button
                onClick={() => handleMarkPaid(inv)}
                className="rounded-lg bg-sage px-4 py-2 text-[13px] font-semibold text-white transition-all hover:bg-sage/80 cursor-pointer"
              >
                Mark as Fully Paid
              </button>
            )}
            <button
              onClick={() => window.print()}
              className="rounded-lg border border-sand px-4 py-2 text-[13px] font-semibold text-bark transition-all hover:border-terracotta hover:text-terracotta cursor-pointer"
            >
              Print / Download
            </button>
          </div>
        </div>

        {sendError && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-[12px] text-red-600">
            {sendError}
          </div>
        )}
        {sendSuccess && (
          <div className="mb-4 rounded-lg bg-sage-soft border border-sage/30 px-4 py-2.5 text-[12px] text-sage">
            {sendSuccess}
          </div>
        )}

        {/* Invoice Preview */}
        <div className="rounded-xl border border-sand bg-white print:border-none print:shadow-none" id="invoice-preview">
          <div className="p-8">
            {/* Header */}
            <div className="mb-8 flex items-start justify-between">
              <div>
                {inv.from_logo_url && (
                  <img src={inv.from_logo_url} alt="" className="mb-3 h-12 w-auto" />
                )}
                <h2 className="font-serif text-2xl font-bold text-espresso">{inv.from_name}</h2>
                {inv.from_address && (
                  <p className="mt-1 text-[12px] text-bark whitespace-pre-line">{inv.from_address}</p>
                )}
                {inv.from_email && (
                  <p className="mt-0.5 text-[12px] text-bark">{inv.from_email}</p>
                )}
              </div>
              <div className="text-right">
                <h1 className="font-serif text-3xl font-bold text-terracotta">INVOICE</h1>
                <p className="mt-1 text-[13px] font-semibold text-espresso">{inv.invoice_number}</p>
                <div className="mt-2 space-y-0.5 text-[11px] text-bark">
                  <p>
                    <span className="font-semibold text-espresso">Issue Date:</span>{" "}
                    {new Date(inv.issue_date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  </p>
                  {inv.due_date && (
                    <p>
                      <span className="font-semibold text-espresso">Due Date:</span>{" "}
                      {new Date(inv.due_date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                    </p>
                  )}
                  {inv.payment_terms && (
                    <p>
                      <span className="font-semibold text-espresso">Terms:</span>{" "}
                      {paymentTermsLabel(inv.payment_terms)}
                    </p>
                  )}
                </div>
                <div className="mt-3">
                  <span className={`inline-block rounded-full px-3 py-1 text-[11px] font-bold uppercase ${statusBadge(inv.status)}`}>
                    {statusLabel(inv.status)}
                  </span>
                </div>
              </div>
            </div>

            {/* Bill To */}
            <div className="mb-8 rounded-lg bg-parchment/50 p-4">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-bark">Bill To</p>
              <p className="text-[14px] font-bold text-espresso">{inv.to_name}</p>
              {inv.to_contact && <p className="text-[12px] text-bark">{inv.to_contact}</p>}
              {inv.to_email && <p className="text-[12px] text-bark">{inv.to_email}</p>}
              {inv.to_address && <p className="mt-1 text-[12px] text-bark whitespace-pre-line">{inv.to_address}</p>}
            </div>

            {/* Detailed Report — Line Items Table */}
            <div className="mb-6 rounded-lg border border-sand overflow-hidden">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="border-b border-sand bg-parchment/30 text-[10px] font-semibold uppercase tracking-wider text-bark">
                    <th className="px-4 py-3">Task Name</th>
                    <th className="px-3 py-3">Project</th>
                    <th className="px-3 py-3 text-right">Minutes</th>
                    <th className="px-4 py-3">Client Memo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-parchment">
                  {selectedLineItems.map((li) => (
                    <tr key={li.id} className="hover:bg-parchment/20 transition-colors">
                      <td className="px-4 py-3 text-espresso">{li.description}</td>
                      <td className="px-3 py-3 text-bark">{li.project || li.account_name || "-"}</td>
                      <td className="px-3 py-3 text-right text-bark">{Math.round(Number(li.quantity) * 60)}</td>
                      <td className="px-4 py-3 text-bark text-[11px] max-w-[250px]">{li.client_memo || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="flex justify-end">
              <div className="w-72 space-y-2">
                <div className="flex justify-between text-[12px]">
                  <span className="text-bark">Subtotal</span>
                  <span className="font-medium text-espresso">{formatCurrency(Number(inv.subtotal))}</span>
                </div>
                {Number(inv.tax_rate) > 0 && (
                  <div className="flex justify-between text-[12px]">
                    <span className="text-bark">Tax ({Number(inv.tax_rate)}%)</span>
                    <span className="text-espresso">{formatCurrency(Number(inv.tax_amount))}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-sand pt-2 text-[14px]">
                  <span className="font-bold text-espresso">Total</span>
                  <span className="font-bold text-terracotta">{formatCurrency(Number(inv.total), inv.currency)}</span>
                </div>
                {Number(inv.amount_paid || 0) > 0 && (
                  <div className="flex justify-between text-[12px]">
                    <span className="text-sage font-semibold">Amount Paid</span>
                    <span className="text-sage font-semibold">{formatCurrency(Number(inv.amount_paid))}</span>
                  </div>
                )}
                {inv.status !== "paid" && Number(inv.amount_paid || 0) > 0 && (
                  <div className="flex justify-between text-[12px]">
                    <span className="font-semibold text-terracotta">Balance Due</span>
                    <span className="font-semibold text-terracotta">{formatCurrency(Number(inv.total) - Number(inv.amount_paid || 0))}</span>
                  </div>
                )}
                {inv.status === "paid" && inv.paid_date && (
                  <div className="flex justify-between text-[12px]">
                    <span className="text-sage font-semibold">Paid on</span>
                    <span className="text-sage font-semibold">
                      {new Date(inv.paid_date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Notes */}
            {inv.notes && (
              <div className="mt-8 rounded-lg bg-parchment/30 p-4">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-bark">Notes</p>
                <p className="text-[12px] text-bark whitespace-pre-line">{inv.notes}</p>
              </div>
            )}
          </div>
        </div>

        {/* Record Payment Form */}
        {showPaymentForm && inv.status !== "paid" && (
          <div className="mt-4 rounded-xl border border-amber/30 bg-amber-soft/30 p-5">
            <h4 className="mb-4 font-serif text-[15px] font-bold text-espresso">Record Payment</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Amount ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={Number(inv.total) - Number(inv.amount_paid || 0)}
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  placeholder={`Max: ${formatCurrency(Number(inv.total) - Number(inv.amount_paid || 0))}`}
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2.5 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta placeholder:text-stone"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Payment Date</label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2.5 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Payment Method</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2.5 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta cursor-pointer"
                >
                  <option value="">Select...</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="check">Check</option>
                  <option value="cash">Cash</option>
                  <option value="paypal">PayPal</option>
                  <option value="credit_card">Credit Card</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Reference #</label>
                <input
                  type="text"
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  placeholder="Check #, transaction ID, etc."
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2.5 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta placeholder:text-stone"
                />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Notes</label>
                <input
                  type="text"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  placeholder="Optional payment notes..."
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2.5 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta placeholder:text-stone"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setShowPaymentForm(false)}
                className="rounded-lg border border-sand px-4 py-2 text-[13px] font-semibold text-bark transition-all hover:border-terracotta hover:text-terracotta cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleRecordPayment}
                disabled={savingPayment || !paymentAmount || parseFloat(paymentAmount) <= 0}
                className="rounded-lg bg-terracotta px-5 py-2 text-[13px] font-semibold text-white transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {savingPayment ? "Saving..." : "Save Payment"}
              </button>
            </div>
          </div>
        )}

        {/* Payment History */}
        {invoicePayments.length > 0 && (
          <div className="mt-4 rounded-xl border border-sand bg-white p-5">
            <h4 className="mb-3 font-serif text-[15px] font-bold text-espresso">Payment History</h4>
            <div className="rounded-lg border border-sand overflow-hidden">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="border-b border-sand bg-parchment/30 text-[10px] font-semibold uppercase tracking-wider text-bark">
                    <th className="px-4 py-2.5">Date</th>
                    <th className="px-3 py-2.5 text-right">Amount</th>
                    <th className="px-3 py-2.5">Method</th>
                    <th className="px-3 py-2.5">Reference</th>
                    <th className="px-3 py-2.5">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-parchment">
                  {invoicePayments.map((pmt) => (
                    <tr key={pmt.id} className="hover:bg-parchment/20 transition-colors">
                      <td className="px-4 py-2.5 text-espresso">
                        {new Date(pmt.payment_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold text-sage">{formatCurrency(Number(pmt.amount))}</td>
                      <td className="px-3 py-2.5 text-bark capitalize">{pmt.payment_method?.replace("_", " ") || "-"}</td>
                      <td className="px-3 py-2.5 text-bark">{pmt.reference_number || "-"}</td>
                      <td className="px-3 py-2.5 text-bark text-[11px]">{pmt.notes || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </>
    );
  }

  /* ── LIST VIEW (default) ──────────────────────────────────── */

  return (
    <>
      {/* Summary Stats */}
      <div className="mb-6 grid grid-cols-4 gap-4">
        <StatCard value={formatCurrency(summaryStats.totalInvoiced)} label="Total Invoiced" sub={`${invoices.length} invoices`} color="terracotta" />
        <StatCard value={formatCurrency(summaryStats.outstanding)} label="Outstanding" sub="unpaid sent invoices" color="slate-blue" />
        <StatCard value={formatCurrency(summaryStats.paid)} label="Paid" sub="total collected" color="sage" />
        <StatCard value={formatCurrency(summaryStats.overdue)} label="Overdue" sub="past due date" color="amber" />
      </div>

      {/* Filter + New buttons */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {(["all", "draft", "sent", "partially_paid", "paid", "overdue", "cancelled"] as const).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all cursor-pointer ${
                statusFilter === status
                  ? "bg-terracotta text-white"
                  : "bg-parchment text-bark hover:bg-sand"
              }`}
            >
              {status === "all" ? "All" : statusLabel(status)}
              {status === "all" ? null : (
                <span className="ml-1 opacity-60">
                  ({invoices.filter((inv) => inv.status === status).length})
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView("create-manual")}
            className="rounded-lg border border-terracotta px-4 py-2 text-[13px] font-semibold text-terracotta transition-all hover:bg-terracotta hover:text-white cursor-pointer"
          >
            + Past Invoice
          </button>
          <button
            onClick={() => setView("create")}
            className="rounded-lg bg-terracotta px-4 py-2 text-[13px] font-semibold text-white transition-all hover:bg-[#a85840] hover:-translate-y-px cursor-pointer"
          >
            + New Invoice
          </button>
        </div>
      </div>

      {/* Invoice Table */}
      <div className="rounded-xl border border-sand bg-white overflow-hidden">
        {filteredInvoices.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <svg className="mx-auto h-10 w-10 text-sand" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <p className="mt-3 text-[13px] text-bark">
              {statusFilter === "all" ? "No invoices yet. Create your first invoice!" : `No ${statusFilter} invoices.`}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-b border-parchment bg-parchment/30 text-[10px] font-semibold uppercase tracking-wider text-bark">
                  <th className="px-4 py-3">Invoice #</th>
                  <th className="px-3 py-3">Client</th>
                  <th className="px-3 py-3">Issue Date</th>
                  <th className="px-3 py-3">Due Date</th>
                  <th className="px-3 py-3 text-right">Total</th>
                  <th className="px-3 py-3 text-right">Balance</th>
                  <th className="px-3 py-3 text-center">Status</th>
                  <th className="px-3 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-parchment">
                {filteredInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-parchment/20 transition-colors">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openInvoiceDetail(inv)}
                        className="font-semibold text-espresso hover:text-terracotta transition-colors cursor-pointer"
                      >
                        {inv.invoice_number}
                      </button>
                    </td>
                    <td className="px-3 py-3 text-bark">{inv.to_name}</td>
                    <td className="px-3 py-3 text-bark">
                      {new Date(inv.issue_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </td>
                    <td className="px-3 py-3 text-bark">
                      {inv.due_date
                        ? new Date(inv.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                        : "-"}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-espresso">
                      {formatCurrency(Number(inv.total), inv.currency)}
                    </td>
                    <td className="px-3 py-3 text-right text-bark">
                      {inv.status === "paid"
                        ? <span className="text-sage font-semibold">{formatCurrency(0)}</span>
                        : Number(inv.amount_paid || 0) > 0
                          ? <span className="text-terracotta font-semibold">{formatCurrency(Number(inv.total) - Number(inv.amount_paid || 0))}</span>
                          : formatCurrency(Number(inv.total))}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${statusBadge(inv.status)}`}>
                        {statusLabel(inv.status)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => openInvoiceDetail(inv)}
                          title="View"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-sand text-bark transition-all hover:border-terracotta hover:text-terracotta cursor-pointer"
                        >
                          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        </button>
                        {(inv.status === "draft" || inv.status === "sent") && inv.to_email && (
                          <button
                            onClick={() => handleSendInvoice(inv)}
                            title={inv.status === "sent" ? "Resend" : "Send"}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-sand text-bark transition-all hover:border-slate-blue hover:text-slate-blue cursor-pointer"
                          >
                            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <line x1="22" y1="2" x2="11" y2="13" />
                              <polygon points="22 2 15 22 11 13 2 9 22 2" />
                            </svg>
                          </button>
                        )}
                        {inv.status !== "paid" && inv.status !== "cancelled" && (
                          <button
                            onClick={() => handleMarkPaid(inv)}
                            title="Mark Paid"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-sand text-bark transition-all hover:border-sage hover:text-sage cursor-pointer"
                          >
                            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
