"use client";

import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  VA_POSITION_OPTIONS,
  type Profile,
  type Session,
  type TimeLog,
  type TaskScreenshot,
  type ExtensionHeartbeat,
  type ExtensionUploadStatus,
  type TimeCorrectionRequest,
  type BreakCorrectionRequest,
  type OrganizationSettings,
  type SortingReview,
  type TeamAssignment,
  type Client,
  type Invoice,
  type InvoiceLineItem,
  type InvoicePayment,
  type PaymentScheduleItem,
  type PaymentTemplate,
} from "@/types/database";
import {
  formatDuration,
  formatDateLocalTZ,
  getInitials,
  getAvatarColor,
  getTodayBoundsInTimezone,
  getTimezoneAbbr,
} from "@/lib/utils";
import ProjectsTasksTab from "@/components/ProjectsTasksTab";
import FinancialSummaryTab from "@/components/FinancialSummaryTab";
import CaptureAlertsTab from "@/components/CaptureAlertsTab";
import PaystubTab from "@/components/PaystubTab";
import VaResourcesAdminTab from "@/components/VaResourcesAdminTab";
import VaFeedbackAdminTab from "@/components/VaFeedbackAdminTab";
import VaReviewsAdminTab from "@/components/VaReviewsAdminTab";
import VaTokensAdminTab from "@/components/VaTokensAdminTab";
import VaBroadcastsAdminTab from "@/components/VaBroadcastsAdminTab";
import EmailStatusTab from "@/components/EmailStatusTab";
import TaskAssignmentsAdminTab from "@/components/TaskAssignmentsAdminTab";

/* ── Constants ───────────────────────────────────────────── */

const DEFAULT_PAYMENT_INFO = `Checks Payable to: \nMarie Toni Colina OR\nColina Productions LLC\n---\nZelle 470.430.1625\n---\nVenmo and Cashapp\nAvailable upon request`;

/* ── Helpers ─────────────────────────────────────────────── */

function getTimeAgo(date: Date, tz?: string): string {
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", ...(tz ? { timeZone: tz } : {}) });
}

function formatDateShort(iso: string, timezone?: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(timezone ? { timeZone: timezone } : {}),
  });
}

function formatTimeShort(iso: string, timezone?: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    ...(timezone ? { timeZone: timezone } : {}),
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

type AdminTab = "overview" | "screenshots" | "team" | "task_assignments" | "organization" | "corrections" | "sorting" | "password" | "accounts" | "clients" | "invoices" | "paystubs" | "projects" | "financial" | "alerts" | "va_resources" | "va_feedback" | "va_reviews" | "va_tokens" | "va_broadcasts" | "email_log";

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
    id: "task_assignments",
    label: "Task Assignments",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
        <rect x="9" y="3" width="6" height="4" rx="1" />
        <path d="M9 12l2 2 4-4" />
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
    id: "projects",
    label: "Projects & Tasks",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
        <line x1="12" y1="11" x2="12" y2="17" />
        <line x1="9" y1="14" x2="15" y2="14" />
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
    id: "paystubs",
    label: "Paystubs",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <line x1="2" y1="10" x2="22" y2="10" />
        <line x1="6" y1="15" x2="10" y2="15" />
        <line x1="14" y1="15" x2="18" y2="15" />
      </svg>
    ),
  },
  {
    id: "financial",
    label: "Financial",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
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
    id: "alerts",
    label: "Capture Alerts",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
  },
  {
    id: "va_resources",
    label: "VA Resources",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
  },
  {
    id: "va_feedback",
    label: "VA Feedback",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </svg>
    ),
  },
  {
    id: "va_reviews",
    label: "Reviews",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
  },
  {
    id: "va_tokens",
    label: "Tokens & Ratings",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
    ),
  },
  {
    id: "va_broadcasts",
    label: "Broadcasts",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
  },
  {
    id: "email_log",
    label: "Email Log",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <polyline points="22,6 12,13 2,6" />
        <line x1="8" y1="12" x2="16" y2="12" />
        <line x1="8" y1="16" x2="12" y2="16" />
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

/* ── Sidebar Groups ──────────────────────────────────────── */

type SidebarGroup = {
  id: string;
  label?: string;
  tabs: { id: AdminTab; label: string; icon: React.ReactNode }[];
};

const ADMIN_SIDEBAR_GROUPS: SidebarGroup[] = [
  {
    id: "pinned",
    tabs: SIDEBAR_TABS.filter((t) => (["overview"] as AdminTab[]).includes(t.id)),
  },
  {
    id: "activity",
    label: "Activity",
    tabs: SIDEBAR_TABS.filter((t) => (["screenshots", "alerts", "corrections"] as AdminTab[]).includes(t.id)),
  },
  {
    id: "billing",
    label: "Clients & Billing",
    tabs: SIDEBAR_TABS.filter((t) => (["accounts", "projects", "clients", "invoices", "financial"] as AdminTab[]).includes(t.id)),
  },
  {
    id: "settings",
    label: "Settings",
    tabs: SIDEBAR_TABS.filter((t) => (["organization", "password"] as AdminTab[]).includes(t.id)),
  },
];

const TEAM_SIDEBAR_GROUPS: SidebarGroup[] = [
  {
    id: "team",
    label: "Team",
    tabs: SIDEBAR_TABS.filter((t) => (["team", "task_assignments", "va_resources", "va_reviews", "va_tokens", "va_broadcasts", "va_feedback", "paystubs", "email_log"] as AdminTab[]).includes(t.id)),
  },
];

// Combined for auto-expand logic
const SIDEBAR_GROUPS: SidebarGroup[] = [...ADMIN_SIDEBAR_GROUPS, ...TEAM_SIDEBAR_GROUPS];

// Tab IDs that belong to the TEAM section
const TEAM_TAB_IDS: AdminTab[] = ["team", "task_assignments", "va_resources", "va_reviews", "va_tokens", "va_broadcasts", "va_feedback", "paystubs", "email_log"];

/* ── Main Admin Page ─────────────────────────────────────── */

export default function AdminPage() {
  const supabase = createClient();

  // Active tab + sidebar section (admin | team)
  const [activeTab, setActiveTab] = useState<AdminTab>("overview");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [sidebarSection, setSidebarSection] = useState<"admin" | "team">("admin");

  // Switch section and navigate to the section's default tab
  const handleSectionSwitch = (section: "admin" | "team") => {
    setSidebarSection(section);
    if (section === "team") {
      setActiveTab("team");
    } else {
      setActiveTab("overview");
    }
  };

  // Data state
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [allScreenshots, setAllScreenshots] = useState<TaskScreenshot[]>([]);
  const [allLogs, setAllLogs] = useState<TimeLog[]>([]);
  const [heartbeats, setHeartbeats] = useState<ExtensionHeartbeat[]>([]);
  const [extensionUploadStatus, setExtensionUploadStatus] = useState<ExtensionUploadStatus[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Screenshot viewer state
  const [selectedScreenshot, setSelectedScreenshot] = useState<TaskScreenshot | null>(null);
  const [screenshotUrls, setScreenshotUrls] = useState<Record<number, string>>({});
  const [screenshotFilter, setScreenshotFilter] = useState<string>("all");
  const [screenshotDateFilter, setScreenshotDateFilter] = useState<string>("today");
  const [screenshotCustomStart, setScreenshotCustomStart] = useState<string>("");
  const [screenshotCustomEnd, setScreenshotCustomEnd] = useState<string>("");
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

  // Manual entry approvals
  const [pendingManualEntries, setPendingManualEntries] = useState<TimeLog[]>([]);
  const [manualReviewNotes, setManualReviewNotes] = useState<Record<number, string>>({});

  // Sorting review
  const [sortingReviews, setSortingReviews] = useState<SortingReview[]>([]);
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});

  // Org timezone
  const [orgTimezone, setOrgTimezone] = useState<string>("UTC");

  // Clock
  const [clock, setClock] = useState("");

  useEffect(() => {
    function updateClock() {
      const now = new Date();
      const tz = orgTimezone || "UTC";
      setClock(
        now.toLocaleTimeString("en-US", {
          timeZone: tz,
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        }) + " " + getTimezoneAbbr(tz)
      );
    }
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, [orgTimezone]);

  // Auto-expand the group containing the active tab + sync sidebar section
  useEffect(() => {
    const group = SIDEBAR_GROUPS.find((g) => g.label && g.tabs.some((t) => t.id === activeTab));
    if (group) {
      setExpandedGroups((prev) => {
        if (prev.has(group.id)) return prev;
        return new Set([...prev, group.id]);
      });
    }
    // Sync sidebar section to match the active tab
    setSidebarSection(TEAM_TAB_IDS.includes(activeTab) ? "team" : "admin");
  }, [activeTab]);

  /* ── Data Fetching ──────────────────────────────────────── */

  const fetchData = useCallback(async () => {
    const today = getTodayBoundsInTimezone(orgTimezone).start;
    const supabase = createClient();

    let screenshotDateStart = today;
    let screenshotDateEnd: string | null = null;
    if (screenshotDateFilter === "week") {
      screenshotDateStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    } else if (screenshotDateFilter === "month") {
      screenshotDateStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    } else if (screenshotDateFilter === "all-time") {
      screenshotDateStart = "2020-01-01T00:00:00.000Z";
    } else if (screenshotDateFilter === "custom") {
      if (screenshotCustomStart) {
        screenshotDateStart = new Date(screenshotCustomStart + "T00:00:00").toISOString();
      }
      if (screenshotCustomEnd) {
        screenshotDateEnd = new Date(screenshotCustomEnd + "T23:59:59.999").toISOString();
      }
    }

    const [
      profilesRes,
      sessionsRes,
      todayLogsRes,
      screenshotsRes,
      allLogsRes,
      heartbeatsRes,
      uploadStatusRes,
      authRes,
      correctionsRes,
      sortingRes,
      breakCorrectionsRes,
      manualEntriesRes,
      orgSettingsRes,
    ] = await Promise.all([
      supabase.from("profiles").select("*"),
      supabase.from("sessions").select("*"),
      supabase.from("time_logs").select("*").eq("session_date", new Date().toLocaleDateString("en-CA", { timeZone: orgTimezone })),
      (() => {
        let q = supabase
          .from("task_screenshots")
          .select("*")
          .gte("created_at", screenshotDateStart);
        if (screenshotDateEnd) q = q.lte("created_at", screenshotDateEnd);
        if (screenshotFilter !== "all") q = q.eq("user_id", screenshotFilter);
        return q.order("created_at", { ascending: false }).limit(500);
      })(),
      supabase
        .from("time_logs")
        .select("*")
        .order("start_time", { ascending: false })
        .limit(500),
      supabase.from("extension_heartbeats").select("*"),
      supabase.from("extension_upload_status").select("*"),
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
      supabase
        .from("time_logs")
        .select("*")
        .eq("is_manual", true)
        .eq("manual_status", "pending")
        .order("created_at", { ascending: false }),
      supabase.from("organization_settings").select("timezone").limit(1).single(),
    ]);

    setProfiles((profilesRes.data ?? []) as Profile[]);
    setSessions((sessionsRes.data ?? []) as Session[]);
    setLogs((todayLogsRes.data ?? []) as TimeLog[]);
    setAllScreenshots((screenshotsRes.data ?? []) as TaskScreenshot[]);
    setAllLogs((allLogsRes.data ?? []) as TimeLog[]);
    setHeartbeats((heartbeatsRes.data ?? []) as ExtensionHeartbeat[]);
    setExtensionUploadStatus((uploadStatusRes.data ?? []) as ExtensionUploadStatus[]);
    setCorrectionRequests((correctionsRes.data ?? []) as TimeCorrectionRequest[]);
    setSortingReviews((sortingRes.data ?? []) as SortingReview[]);
    setBreakCorrectionRequests((breakCorrectionsRes.data ?? []) as BreakCorrectionRequest[]);
    setPendingManualEntries((manualEntriesRes.data ?? []) as TimeLog[]);
    if (orgSettingsRes.data?.timezone) setOrgTimezone(orgSettingsRes.data.timezone);

    if (authRes.data?.user) {
      setCurrentUserId(authRes.data.user.id);
    }

    setLoading(false);
  }, [screenshotDateFilter, screenshotCustomStart, screenshotCustomEnd, orgTimezone, screenshotFilter]);

  useEffect(() => {
    fetchData();

    const supabase = createClient();
    const channel = supabase
      .channel("admin-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "sessions" }, () => fetchData())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "time_logs" }, () => fetchData())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "task_screenshots" }, () => fetchData())
      .subscribe();

    return () => {
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

      // Screenshots already synced to Drive — use public Drive URL (no Supabase hit)
      const driveReady = missing.filter((s) => s.drive_file_id);
      driveReady.forEach((ss) => {
        newUrls[ss.id] = `/api/drive-image?id=${ss.drive_file_id}`;
      });

      // Screenshots not yet synced — fall back to Supabase signed URL
      const needSigned = missing.filter((s) => !s.drive_file_id);
      for (let i = 0; i < needSigned.length; i += 10) {
        const batch = needSigned.slice(i, i + 10);
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
        (s) => s.user_id === profile.id && formatDateLocalTZ(new Date(s.created_at), orgTimezone) === formatDateLocalTZ(new Date(), orgTimezone)
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
      .reduce((sum, l) => sum + (l.duration_ms || 0), 0);
    const todayScreenshots = allScreenshots.filter(
      (s) => formatDateLocalTZ(new Date(s.created_at), orgTimezone) === formatDateLocalTZ(new Date(), orgTimezone)
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
        timeZone: orgTimezone,
      });
      if (!groups[dateKey]) groups[dateKey] = {};
      const userId = ss.user_id;
      if (!groups[dateKey][userId]) groups[dateKey][userId] = [];
      groups[dateKey][userId].push(ss);
    });
    return groups;
  }, [filteredScreenshots, orgTimezone]);

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
          time: getTimeAgo(new Date(l.start_time), orgTimezone),
          timestamp: new Date(l.start_time).getTime(),
        });
      } else if (l.end_time) {
        events.push({
          id: `end-${l.id}`,
          type: "task-end",
          text: `completed "${l.task_name}"${l.account ? ` for ${l.account}` : ""}`,
          userName: name,
          time: getTimeAgo(new Date(l.end_time), orgTimezone),
          timestamp: new Date(l.end_time).getTime(),
        });
      } else {
        events.push({
          id: `start-${l.id}`,
          type: "task-start",
          text: `started "${l.task_name}"${l.account ? ` for ${l.account}` : ""}`,
          userName: name,
          time: getTimeAgo(new Date(l.start_time), orgTimezone),
          timestamp: new Date(l.start_time).getTime(),
        });
      }
    });

    allScreenshots
      .filter((s) => formatDateLocalTZ(new Date(s.created_at), orgTimezone) === formatDateLocalTZ(new Date(), orgTimezone))
      .forEach((ss) => {
        const profile = profileMap.get(ss.user_id);
        const name = profile?.full_name.split(" ")[0] || "Unknown";
        const typeLabel = ss.screenshot_type ? ` (${screenshotTypeLabel(ss.screenshot_type)})` : "";
        events.push({
          id: `ss-${ss.id}`,
          type: "screenshot",
          text: `screenshot captured${typeLabel}`,
          userName: name,
          time: getTimeAgo(new Date(ss.created_at), orgTimezone),
          timestamp: new Date(ss.created_at).getTime(),
        });
      });

    return events.sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
  }, [logs, allScreenshots, profileMap, orgTimezone]);

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

  const handleApproveCorrection = async (request: TimeCorrectionRequest, overrideChanges?: Record<string, string>): Promise<string | null> => {
    if (!currentUserId) return "Not authenticated.";
    const supabase = createClient();

    const changes = overrideChanges ?? (request.requested_changes as Record<string, string>);
    const updatePayload: Record<string, unknown> = {};
    const auditRecords: { log_id: number; edited_by: string; field_name: string; old_value: string | null; new_value: string | null }[] = [];

    const { data: currentLog } = await supabase
      .from("time_logs")
      .select("*")
      .eq("id", request.log_id)
      .single();

    if (currentLog) {
      // Convert datetime-local values (no tz info) to proper UTC ISO strings before storing.
      // Without this, Postgres treats them as UTC and times end up 4 hours off for EDT users.
      const toUtcIso = (val: string) => (val ? new Date(val).toISOString() : null);

      Object.entries(changes).forEach(([field, newValue]) => {
        const isTimeField = field === "start_time" || field === "end_time";
        const valueToStore = isTimeField && newValue ? toUtcIso(newValue) : (newValue || null);
        updatePayload[field] = valueToStore;
        auditRecords.push({
          log_id: request.log_id,
          edited_by: currentUserId,
          field_name: field,
          old_value: (currentLog as Record<string, unknown>)[field] != null ? String((currentLog as Record<string, unknown>)[field]) : null,
          new_value: valueToStore,
        });
      });

      if (changes.start_time || changes.end_time) {
        const startTime = changes.start_time ? new Date(changes.start_time).toISOString() : currentLog.start_time;
        const endTime = changes.end_time ? new Date(changes.end_time).toISOString() : currentLog.end_time;
        if (startTime && endTime) {
          // Guard: end_time must be after start_time
          if (new Date(endTime).getTime() <= new Date(startTime).getTime()) {
            return "The requested end time is before or equal to the task's start time. Please edit the date/time above before approving.";
          }
          updatePayload.duration_ms = Math.max(0, new Date(endTime).getTime() - new Date(startTime).getTime());
        }
      }

      await supabase.from("time_logs").update(updatePayload).eq("id", request.log_id);

      if (auditRecords.length > 0) {
        await supabase.from("time_log_edits").insert(auditRecords);
      }

      // Auto-cascade: if end_time changed, update the next task's start_time to match
      if (changes.end_time) {
        const newEndIso = updatePayload.end_time as string;
        const { data: nextTask } = await supabase
          .from("time_logs")
          .select("id, start_time, end_time, duration_ms")
          .eq("user_id", currentLog.user_id)
          .gt("start_time", currentLog.start_time)
          .is("deleted_at", null)
          .order("start_time", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (nextTask) {
          const newEndMs = new Date(newEndIso).getTime();
          const nextEndMs = nextTask.end_time ? new Date(nextTask.end_time).getTime() : null;
          // Only cascade if it won't shrink the next task to zero/negative duration
          if (!nextEndMs || newEndMs < nextEndMs) {
            await supabase
              .from("time_logs")
              .update({
                start_time: newEndIso,
                ...(nextEndMs ? { duration_ms: nextEndMs - newEndMs } : {}),
              })
              .eq("id", nextTask.id);
          }
        }
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
    return null;
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

  /* ── Manual Entry Approval Handlers ─────────────────────── */

  const handleApproveManualEntry = async (entry: TimeLog) => {
    if (!currentUserId) return;
    const supabase = createClient();

    await supabase
      .from("time_logs")
      .update({
        manual_status: "approved",
      })
      .eq("id", entry.id);

    fetchData();
  };

  const handleDenyManualEntry = async (entry: TimeLog) => {
    if (!currentUserId) return;
    const supabase = createClient();

    await supabase
      .from("time_logs")
      .update({
        manual_status: "denied",
      })
      .eq("id", entry.id);

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
        <div className="px-4 py-4 border-b border-white/10">
          <h2 className="text-sm font-bold text-white tracking-wide">Admin Panel</h2>
          <p className="mt-0.5 text-[10px] text-white/50">{clock}</p>
          {/* Admin / Team section switcher */}
          <div className="mt-3 flex rounded-lg bg-black/25 p-0.5">
            <button
              onClick={() => handleSectionSwitch("admin")}
              className={`flex-1 rounded-md py-1.5 text-[11px] font-semibold tracking-wide transition-all ${
                sidebarSection === "admin"
                  ? "bg-terracotta text-white shadow-sm"
                  : "text-white/50 hover:text-white/80"
              }`}
            >
              ADMIN
            </button>
            <button
              onClick={() => handleSectionSwitch("team")}
              className={`flex-1 rounded-md py-1.5 text-[11px] font-semibold tracking-wide transition-all ${
                sidebarSection === "team"
                  ? "bg-terracotta text-white shadow-sm"
                  : "text-white/50 hover:text-white/80"
              }`}
            >
              TEAM
            </button>
          </div>
        </div>
        <nav className="flex-1 py-2 px-2 overflow-y-auto">
          {(sidebarSection === "admin" ? ADMIN_SIDEBAR_GROUPS : TEAM_SIDEBAR_GROUPS).map((group) => {
            if (!group.label) {
              // Pinned tabs (Overview) — no group header
              return group.tabs.map((tab) => {
                const isActive = activeTab === tab.id;
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
                  </button>
                );
              });
            }

            const isExpanded = expandedGroups.has(group.id);
            const hasActiveTab = group.tabs.some((t) => t.id === activeTab);
            const activityBadge =
              group.id === "activity"
                ? correctionRequests.length + breakCorrectionRequests.length + pendingManualEntries.length + sortingReviews.length
                : 0;

            return (
              <div key={group.id} className="mt-2">
                <button
                  onClick={() =>
                    setExpandedGroups((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.id)) next.delete(group.id);
                      else next.add(group.id);
                      return next;
                    })
                  }
                  className={`w-full flex items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider transition-all cursor-pointer ${
                    hasActiveTab && !isExpanded
                      ? "text-terracotta hover:bg-white/10"
                      : "text-white/40 hover:text-white/70 hover:bg-white/5"
                  }`}
                >
                  <span className="flex-1">{group.label}</span>
                  {activityBadge > 0 && !isExpanded && (
                    <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-terracotta px-1 text-[9px] font-bold text-white">
                      {activityBadge}
                    </span>
                  )}
                  <svg
                    className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {isExpanded && (
                  <div className="mt-0.5 space-y-0.5">
                    {group.tabs.map((tab) => {
                      const isActive = activeTab === tab.id;
                      const hasBadge =
                        (tab.id === "corrections" &&
                          correctionRequests.length + breakCorrectionRequests.length + pendingManualEntries.length > 0) ||
                        (tab.id === "sorting" && sortingReviews.length > 0);
                      const badgeCount =
                        tab.id === "corrections"
                          ? correctionRequests.length + breakCorrectionRequests.length + pendingManualEntries.length
                          : tab.id === "sorting"
                          ? sortingReviews.length
                          : 0;
                      return (
                        <button
                          key={tab.id}
                          onClick={() => setActiveTab(tab.id)}
                          className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 pl-4 text-left text-[13px] font-medium transition-all cursor-pointer ${
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
                  </div>
                )}
              </div>
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
                {activeTab === "projects" && "Manage projects and tasks under each account"}
                {activeTab === "accounts" && "Manage accounts and link them to clients"}
                {activeTab === "clients" && "Manage clients"}
                {activeTab === "invoices" && "Generate and manage client invoices"}
                {activeTab === "paystubs" && "Calculate and send paystubs to your VAs"}
                {activeTab === "organization" && "Edit organization settings"}
                {activeTab === "corrections" && "Review pending corrections and manual time entry requests"}
                {activeTab === "sorting" && "Review sorting task entries and assign billing"}
                {activeTab === "password" && "Update your admin password"}
                {activeTab === "alerts" && "Track screen capture drops and VA responses"}
                {activeTab === "va_resources" && "Manage onboarding, SOPs, coaching, and job postings for VAs"}
                {activeTab === "va_feedback" && "Review feedback submitted by your team"}
                {activeTab === "va_reviews" && "Create and publish performance reviews"}
                {activeTab === "va_tokens" && "Award tokens and track daily ratings"}
                {activeTab === "va_broadcasts" && "Send broadcasts, memos, and announcements to your team"}
                {activeTab === "email_log" && "Track opens and clicks for all outgoing emails"}
                {activeTab === "task_assignments" && "Assign tasks to VAs and track their progress"}
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
              onRefresh={fetchData}
              orgTimezone={orgTimezone}
              extensionUploadStatus={extensionUploadStatus}
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
              screenshotCustomStart={screenshotCustomStart}
              setScreenshotCustomStart={setScreenshotCustomStart}
              screenshotCustomEnd={screenshotCustomEnd}
              setScreenshotCustomEnd={setScreenshotCustomEnd}
              screenshotUrls={screenshotUrls}
              loadingUrls={loadingUrls}
              setSelectedScreenshot={setSelectedScreenshot}
              orgTimezone={orgTimezone}
            />
          )}

          {activeTab === "team" && (
            <TeamManagementTab
              profiles={profiles}
              fetchData={fetchData}
              orgTimezone={orgTimezone}
            />
          )}

          {activeTab === "task_assignments" && (
            <TaskAssignmentsAdminTab profiles={profiles} orgTimezone={orgTimezone} />
          )}

          {activeTab === "projects" && (
            <ProjectsTasksTab />
          )}

          {activeTab === "accounts" && (
            <AccountsTab />
          )}

          {activeTab === "clients" && (
            <ClientsTab />
          )}

          {activeTab === "invoices" && (
            <InvoicesTab profiles={profiles} orgTimezone={orgTimezone} />
          )}

          {activeTab === "paystubs" && (
            <PaystubTab profiles={profiles} orgTimezone={orgTimezone} />
          )}

          {activeTab === "financial" && (
            <FinancialSummaryTab timezone={orgTimezone} />
          )}

          {activeTab === "alerts" && (
            <CaptureAlertsTab orgTimezone={orgTimezone} />
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
                orgTimezone={orgTimezone}
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
                orgTimezone={orgTimezone}
              />
              <ManualEntriesSection
                pendingManualEntries={pendingManualEntries}
                profileMap={profileMap}
                manualReviewNotes={manualReviewNotes}
                setManualReviewNotes={setManualReviewNotes}
                handleApproveManualEntry={handleApproveManualEntry}
                handleDenyManualEntry={handleDenyManualEntry}
                orgTimezone={orgTimezone}
              />
            </div>
          )}

          {activeTab === "va_resources" && (
            <VaResourcesAdminTab />
          )}
          {activeTab === "va_feedback" && (
            <VaFeedbackAdminTab />
          )}
          {activeTab === "va_reviews" && (
            <VaReviewsAdminTab />
          )}
          {activeTab === "va_tokens" && (
            <VaTokensAdminTab />
          )}
          {activeTab === "va_broadcasts" && (
            <VaBroadcastsAdminTab />
          )}
          {activeTab === "email_log" && (
            <EmailStatusTab />
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
          timezone={orgTimezone}
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
  onRefresh,
  orgTimezone,
  extensionUploadStatus,
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
  onRefresh: () => void;
  orgTimezone: string;
  extensionUploadStatus: ExtensionUploadStatus[];
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
          <button onClick={() => onRefresh()} className="rounded-md bg-sand px-3 py-1 text-[11px] font-medium text-espresso hover:bg-parchment transition-colors">↻ Refresh</button>
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
              timezone={orgTimezone}
            />
          ))}
        </div>
      </div>

      {/* Extension Upload Status */}
      {extensionUploadStatus.length > 0 && (
        <div className="mb-6 rounded-xl border border-sand bg-white">
          <div className="flex items-center justify-between border-b border-parchment px-5 py-4">
            <h2 className="text-sm font-bold text-espresso">Screenshot Upload Status</h2>
            <span className="text-[11px] text-bark">Updated every 30s by the extension</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-parchment bg-parchment/40">
                  <th className="px-5 py-2.5 text-left font-semibold text-bark">VA</th>
                  <th className="px-5 py-2.5 text-left font-semibold text-bark">Version</th>
                  <th className="px-5 py-2.5 text-right font-semibold text-bark">Uploaded Today</th>
                  <th className="px-5 py-2.5 text-right font-semibold text-bark">Pending Upload</th>
                  <th className="px-5 py-2.5 text-right font-semibold text-bark">Failures</th>
                  <th className="px-5 py-2.5 text-right font-semibold text-bark">Last Reported</th>
                </tr>
              </thead>
              <tbody>
                {extensionUploadStatus.map((row) => {
                  const profile = profiles.find((p) => p.id === row.user_id);
                  if (!profile) return null;
                  const isStale = new Date(row.last_reported_at).getTime() < Date.now() - 5 * 60 * 1000;
                  const hasPending = row.queued_count > 0;
                  const hasFailures = row.consecutive_failures >= 3;
                  return (
                    <tr key={row.user_id} className="border-b border-parchment last:border-b-0 hover:bg-parchment/20">
                      <td className="px-5 py-3 font-medium text-espresso">{profile.full_name || profile.username}</td>
                      <td className="px-5 py-3 text-left">
                        {row.extension_version ? (
                          <span className="inline-flex items-center rounded-full bg-sage-soft px-2 py-0.5 text-[10px] font-semibold text-sage">
                            v{row.extension_version}
                          </span>
                        ) : (
                          <span className="text-bark">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right text-espresso">{row.uploaded_today}</td>
                      <td className="px-5 py-3 text-right">
                        {hasPending ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-soft px-2 py-0.5 text-[10px] font-semibold text-amber">
                            {row.queued_count} pending
                          </span>
                        ) : (
                          <span className="text-sage">0</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {hasFailures ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-terracotta-soft px-2 py-0.5 text-[10px] font-semibold text-terracotta">
                            {row.consecutive_failures} failures
                          </span>
                        ) : (
                          <span className="text-sage">{row.consecutive_failures}</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right text-bark">
                        {isStale ? (
                          <span className="text-terracotta">{getTimeAgo(new Date(row.last_reported_at))}</span>
                        ) : (
                          getTimeAgo(new Date(row.last_reported_at))
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
  screenshotCustomStart,
  setScreenshotCustomStart,
  screenshotCustomEnd,
  setScreenshotCustomEnd,
  screenshotUrls,
  loadingUrls,
  setSelectedScreenshot,
  orgTimezone,
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
  screenshotCustomStart: string;
  setScreenshotCustomStart: (v: string) => void;
  screenshotCustomEnd: string;
  setScreenshotCustomEnd: (v: string) => void;
  screenshotUrls: Record<number, string>;
  loadingUrls: boolean;
  setSelectedScreenshot: (ss: TaskScreenshot) => void;
  orgTimezone: string;
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
            {profiles.filter((p) => p.is_active !== false).map((p) => (
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
            <option value="custom">Custom Range</option>
          </select>
          {screenshotDateFilter === "custom" && (
            <>
              <input
                type="date"
                value={screenshotCustomStart}
                onChange={(e) => setScreenshotCustomStart(e.target.value)}
                className="rounded-lg border border-sand bg-white px-2 py-1.5 text-xs text-espresso outline-none transition-colors focus:border-terracotta"
              />
              <span className="text-[11px] text-bark">to</span>
              <input
                type="date"
                value={screenshotCustomEnd}
                onChange={(e) => setScreenshotCustomEnd(e.target.value)}
                className="rounded-lg border border-sand bg-white px-2 py-1.5 text-xs text-espresso outline-none transition-colors focus:border-terracotta"
              />
            </>
          )}
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
                                {formatTimeShort(ss.created_at, orgTimezone)}
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
  orgTimezone,
}: {
  profiles: Profile[];
  fetchData: () => void;
  orgTimezone: string;
}) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState("");
  const [addSuccess, setAddSuccess] = useState("");

  // Column filter state (col -> selected values; absent key = all shown)
  const [colFilters, setColFilters] = useState<Record<string, string[]>>({});
  const [joinedStart, setJoinedStart] = useState("");
  const [joinedEnd, setJoinedEnd] = useState("");
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [dropPos, setDropPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const colFilterDropRef = useRef<HTMLDivElement>(null);

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

  // Send reset link state
  const [sendingResetLinkFor, setSendingResetLinkFor] = useState<string | null>(null);
  const [resetLinkMsg, setResetLinkMsg] = useState<{ userId: string; text: string; isError: boolean } | null>(null);

  // Delete VA state
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // Invite VA state
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteEmploymentType, setInviteEmploymentType] = useState("");
  const [inviteRequiresExtension, setInviteRequiresExtension] = useState(false);
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ success?: boolean; message?: string; error?: string } | null>(null);

  const handleInvite = useCallback(async () => {
    if (!inviteEmail.trim()) return;
    setInviteSending(true);
    setInviteResult(null);
    try {
      const res = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          employment_type: inviteEmploymentType || undefined,
          requires_extension: inviteRequiresExtension,
          message: inviteMessage.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setInviteResult({ success: true, message: data.message || `Invite sent to ${inviteEmail}` });
        setInviteEmail("");
        setInviteEmploymentType("");
        setInviteRequiresExtension(false);
        setInviteMessage("");
      } else {
        setInviteResult({ error: data.error || "Failed to send invite." });
      }
    } catch {
      setInviteResult({ error: "Unable to connect. Please try again." });
    }
    setInviteSending(false);
  }, [inviteEmail, inviteEmploymentType, inviteRequiresExtension, inviteMessage]);

  // VA category assignments (read-only summary)
  const [vaCatAssignments, setVaCatAssignments] = useState<Array<{ va_id: string; task_categories: { category_name: string } | null }>>([]);
  useEffect(() => {
    fetch("/api/va-category-assignments")
      .then((r) => r.json())
      .then((d) => setVaCatAssignments(d.assignments ?? []))
      .catch(() => {});
  }, []);
  // Email map: user_id -> email
  const [emailMap, setEmailMap] = useState<Record<string, string>>({});
  useEffect(() => {
    fetch("/api/user-emails")
      .then((r) => r.json())
      .then((d) => setEmailMap(d.emails ?? {}))
      .catch(() => {});
  }, []);

  // Expandable row state
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Unique values per column for filter dropdowns
  const uniqueValues = useMemo(() => {
    const u = (arr: (string | null | undefined)[], numeric = false): string[] => {
      const vals = [...new Set(arr.map((v) => (!v ? "—" : String(v))))];
      if (numeric) {
        return vals.sort((a, b) => {
          const na = parseFloat(a.replace(/[^0-9.]/g, ""));
          const nb = parseFloat(b.replace(/[^0-9.]/g, ""));
          return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb;
        });
      }
      return vals.sort((a, b) => a.localeCompare(b));
    };
    const catNames = vaCatAssignments
      .filter((a) => a.task_categories?.category_name)
      .map((a) => a.task_categories!.category_name);
    return {
      name: u(profiles.map((p) => p.full_name)),
      status: ["Active", "Inactive"],
      username: u(profiles.map((p) => p.username)),
      role: u(profiles.map((p) => p.role)),
      department: u(profiles.map((p) => p.department)),
      position: u(profiles.map((p) => p.position)),
      payRate: u(profiles.map((p) => `$${(p.pay_rate || 0).toFixed(2)}`), true),
      rateType: u(profiles.map((p) => p.pay_rate_type || "hourly")),
      assignments: u([...new Set(catNames)]),
      availTasks: ["On", "Off", "—"],
    };
  }, [profiles, vaCatAssignments]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!openFilter) return;
    const handler = (e: MouseEvent) => {
      if (colFilterDropRef.current && !colFilterDropRef.current.contains(e.target as Node)) {
        setOpenFilter(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openFilter]);

  const openDropdown = useCallback((col: string, e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (openFilter === col) { setOpenFilter(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    setDropPos({ x: rect.left, y: rect.bottom + 4 });
    setOpenFilter(col);
  }, [openFilter]);

  const toggleColFilter = useCallback((col: string, val: string, allVals: string[]) => {
    setColFilters((prev) => {
      const current = prev[col] ?? allVals;
      if (current.includes(val)) {
        return { ...prev, [col]: current.filter((v) => v !== val) };
      } else {
        const next = [...current, val];
        if (next.length >= allVals.length) {
          const n = { ...prev }; delete n[col]; return n;
        }
        return { ...prev, [col]: next };
      }
    });
  }, []);

  const selectAllCol = useCallback((col: string) => {
    setColFilters((prev) => { const n = { ...prev }; delete n[col]; return n; });
  }, []);

  const unselectAllCol = useCallback((col: string) => {
    setColFilters((prev) => ({ ...prev, [col]: [] }));
  }, []);

  const activeFilterCount = useMemo(() => {
    let count = Object.keys(colFilters).length;
    if (joinedStart || joinedEnd) count++;
    return count;
  }, [colFilters, joinedStart, joinedEnd]);

  const clearAllFilters = useCallback(() => {
    setColFilters({});
    setJoinedStart("");
    setJoinedEnd("");
  }, []);

  const getCategoryBadges = (userId: string) => {
    return vaCatAssignments
      .filter((a) => a.va_id === userId && a.task_categories)
      .map((a) => a.task_categories!.category_name);
  };

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

  // Payment accounts modal state
  const [paymentAccountsTarget, setPaymentAccountsTarget] = useState<Profile | null>(null);
  const [paymentAccountsForm, setPaymentAccountsForm] = useState<Record<string, Record<string, string>>>({});
  const [savingPaymentAccounts, setSavingPaymentAccounts] = useState(false);

  const openPaymentAccountsModal = (profile: Profile) => {
    setPaymentAccountsTarget(profile);
    setPaymentAccountsForm((profile.payment_accounts as Record<string, Record<string, string>>) ?? {});
  };

  const savePaymentAccounts = async () => {
    if (!paymentAccountsTarget) return;
    setSavingPaymentAccounts(true);
    try {
      await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: paymentAccountsTarget.id, payment_accounts: paymentAccountsForm }),
      });
      fetchData();
      setPaymentAccountsTarget(null);
    } catch { /* silently fail */ }
    setSavingPaymentAccounts(false);
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

  const handleSendResetLink = async (p: Profile) => {
    const email = emailMap[p.id];
    if (!email) {
      setResetLinkMsg({ userId: p.id, text: "No email found for this user.", isError: true });
      return;
    }
    setSendingResetLinkFor(p.id);
    setResetLinkMsg(null);
    try {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send_reset_link", email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResetLinkMsg({ userId: p.id, text: data.error || "Failed to send reset link.", isError: true });
      } else {
        setResetLinkMsg({ userId: p.id, text: `Reset link sent to ${email}`, isError: false });
        setTimeout(() => setResetLinkMsg(null), 5000);
      }
    } catch {
      setResetLinkMsg({ userId: p.id, text: "Network error.", isError: true });
    } finally {
      setSendingResetLinkFor(null);
    }
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

  // Filtered profiles — per-column Excel-style filters
  const filteredProfiles = useMemo(() => profiles.filter((p) => {
    const check = (col: string, val: string): boolean => {
      if (!(col in colFilters)) return true;
      if (colFilters[col].length === 0) return false;
      return colFilters[col].includes(val);
    };
    if (!check("status", p.is_active !== false ? "Active" : "Inactive")) return false;
    if (!check("name", p.full_name || "—")) return false;
    if (!check("username", p.username || "—")) return false;
    if (!check("role", p.role || "va")) return false;
    if (!check("department", p.department || "—")) return false;
    if (!check("position", p.position || "—")) return false;
    if (!check("payRate", `$${(p.pay_rate || 0).toFixed(2)}`)) return false;
    if (!check("rateType", p.pay_rate_type || "hourly")) return false;
    if ("assignments" in colFilters) {
      if (colFilters.assignments.length === 0) return false;
      const cats = getCategoryBadges(p.id);
      const catStrs = cats.length === 0 ? ["—"] : cats;
      if (!catStrs.some((c) => colFilters.assignments.includes(c))) return false;
    }
    if ("availTasks" in colFilters) {
      const val = p.role === "va" ? (p.can_see_available_tasks ? "On" : "Off") : "—";
      if (!check("availTasks", val)) return false;
    }
    if (joinedStart) {
      if (new Date(p.created_at) < new Date(joinedStart + "T00:00:00")) return false;
    }
    if (joinedEnd) {
      if (new Date(p.created_at) > new Date(joinedEnd + "T23:59:59.999")) return false;
    }
    return true;
  }), [profiles, colFilters, joinedStart, joinedEnd, vaCatAssignments]);

  return (
    <>
      {/* Header with Add + Invite buttons */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[13px] text-bark">
            {filteredProfiles.length} of {profiles.length} team members
          </span>
          {activeFilterCount > 0 && (
            <button
              onClick={clearAllFilters}
              className="flex items-center gap-1.5 rounded-lg bg-terracotta-soft border border-terracotta/30 px-2.5 py-1 text-[11px] font-semibold text-terracotta hover:bg-terracotta/20 transition-colors cursor-pointer"
            >
              <span>{activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""} active</span>
              <span className="text-[10px]">&times;</span>
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setInviteOpen(true); setInviteResult(null); setInviteEmail(""); }}
            className="rounded-lg border border-terracotta px-4 py-2 text-[13px] font-semibold text-terracotta transition-all hover:bg-terracotta/10"
          >
            + Invite VA
          </button>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="rounded-lg bg-terracotta px-4 py-2 text-[13px] font-semibold text-white transition-all hover:bg-[#a85840]"
          >
            {showAddForm ? "Cancel" : "+ Add VA"}
          </button>
        </div>
      </div>

      {/* Invite VA Modal */}
      {inviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl border border-sand bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-serif text-lg font-bold text-espresso">Invite VA</h2>
              <button
                onClick={() => setInviteOpen(false)}
                className="rounded-lg px-2 py-1 text-[13px] text-bark hover:text-espresso cursor-pointer"
              >
                ✕
              </button>
            </div>

            {inviteResult?.success ? (
              <div className="text-center py-4">
                <div className="text-4xl mb-3">✅</div>
                <p className="text-sm font-semibold text-sage">{inviteResult.message}</p>
                <p className="mt-2 text-[12px] text-bark">The invite link expires in 72 hours.</p>
                <button
                  onClick={() => { setInviteResult(null); setInviteEmail(""); }}
                  className="mt-4 w-full rounded-lg bg-parchment border border-sand px-4 py-2 text-[13px] font-semibold text-walnut hover:bg-sand cursor-pointer"
                >
                  Invite Another
                </button>
              </div>
            ) : (
              <>
                <p className="mb-4 text-[13px] text-bark">
                  Enter the VA&apos;s email address. They&apos;ll receive a link to create their account. The link expires in 72 hours.
                </p>

                {inviteResult?.error && (
                  <div className="mb-3 rounded-md bg-terracotta-soft px-3 py-2 text-sm text-terracotta">
                    {inviteResult.error}
                  </div>
                )}

                <div className="space-y-3 mb-4">
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !inviteSending && handleInvite()}
                    placeholder="va@example.com"
                    className="w-full rounded-lg border border-sand bg-cream/50 px-3 py-2.5 text-sm text-ink placeholder:text-stone focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta"
                    autoFocus
                  />

                  <div>
                    <label className="mb-1 block text-[12px] font-semibold text-walnut">Employment Type</label>
                    <select
                      value={inviteEmploymentType}
                      onChange={(e) => setInviteEmploymentType(e.target.value)}
                      className="w-full rounded-lg border border-sand bg-cream/50 px-3 py-2.5 text-sm text-ink focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta cursor-pointer"
                    >
                      <option value="">— Select type —</option>
                      <option value="full_time">Full Time</option>
                      <option value="part_time">Part Time</option>
                      <option value="hourly">Hourly</option>
                      <option value="per_task">Per Task</option>
                    </select>
                  </div>

                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={inviteRequiresExtension}
                      onChange={(e) => setInviteRequiresExtension(e.target.checked)}
                      className="h-4 w-4 rounded border-sand accent-terracotta cursor-pointer"
                    />
                    <span className="text-[13px] text-espresso">Send extension installation instructions</span>
                  </label>
                  {inviteRequiresExtension && (
                    <p className="text-[11px] text-bark ml-6 -mt-1">
                      The email will include steps to install the Chrome screen capture extension. They&apos;ll also see a setup popup on first login.
                    </p>
                  )}

                  <div>
                    <label className="mb-1 block text-[12px] font-semibold text-walnut">Personal Message <span className="font-normal text-stone">(optional)</span></label>
                    <textarea
                      value={inviteMessage}
                      onChange={(e) => setInviteMessage(e.target.value)}
                      placeholder="Add a short note to include in the invite email…"
                      rows={3}
                      className="w-full rounded-lg border border-sand bg-cream/50 px-3 py-2.5 text-sm text-ink placeholder:text-stone focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta resize-none"
                    />
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setInviteOpen(false)}
                    className="flex-1 rounded-lg border border-sand bg-parchment px-4 py-2 text-[13px] font-semibold text-walnut hover:bg-sand cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleInvite}
                    disabled={inviteSending || !inviteEmail.trim()}
                    className="flex-1 rounded-lg bg-terracotta px-4 py-2 text-[13px] font-semibold text-white hover:bg-terracotta/90 disabled:opacity-50 cursor-pointer transition-colors"
                  >
                    {inviteSending ? "Sending…" : "Send Invite"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

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
              <select
                value={newPosition}
                onChange={(e) => setNewPosition(e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta"
              >
                <option value="">Select position...</option>
                {VA_POSITION_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
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
              <tr className="border-b border-parchment bg-parchment/30">
                {([
                  { col: "name", label: "Name", cls: "px-4 py-2.5" },
                  { col: "status", label: "Status", cls: "px-3 py-2.5 text-center" },
                  { col: "username", label: "Username", cls: "px-3 py-2.5" },
                  { col: "role", label: "Role", cls: "px-3 py-2.5" },
                  { col: "department", label: "Department", cls: "px-3 py-2.5" },
                  { col: "position", label: "Position", cls: "px-3 py-2.5" },
                  { col: "payRate", label: "Pay Rate", cls: "px-3 py-2.5 text-right" },
                  { col: "rateType", label: "Rate Type", cls: "px-3 py-2.5" },
                  { col: "assignments", label: "Assignments", cls: "px-3 py-2.5" },
                  { col: "availTasks", label: "Avail. Tasks", cls: "px-3 py-2.5 text-center" },
                  { col: "joined", label: "Joined", cls: "px-3 py-2.5" },
                ] as { col: string; label: string; cls: string }[]).map(({ col, label, cls }) => {
                  const isActive = col in colFilters || (col === "joined" && (!!joinedStart || !!joinedEnd));
                  return (
                    <th key={col} className={cls}>
                      <button
                        onClick={(e) => openDropdown(col, e)}
                        className={`flex items-center gap-1 group cursor-pointer transition-colors ${isActive ? "text-terracotta" : "text-bark hover:text-espresso"}`}
                      >
                        <span className="uppercase tracking-wider text-[10px] font-semibold whitespace-nowrap">{label}</span>
                        <svg className={`h-2.5 w-2.5 shrink-0 transition-transform ${openFilter === col ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="currentColor">
                          <path d="M7 10l5 5 5-5H7z" />
                        </svg>
                        {isActive && <span className="w-1.5 h-1.5 rounded-full bg-terracotta shrink-0" />}
                      </button>
                    </th>
                  );
                })}
                <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-bark">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-parchment">
              {filteredProfiles.length === 0 && (
                <tr>
                  <td colSpan={12} className="py-10 text-center text-[13px] text-bark">
                    No team members match your filters.
                  </td>
                </tr>
              )}
              {filteredProfiles.map((p) => (
                <React.Fragment key={p.id}>
                <tr className="hover:bg-parchment/20 transition-colors cursor-pointer" onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <svg className={`h-3 w-3 text-bark shrink-0 transition-transform ${expandedId === p.id ? "rotate-90" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 18l6-6-6-6" />
                      </svg>
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
                        <select
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="rounded border border-terracotta px-1.5 py-0.5 text-[11px] outline-none"
                          autoFocus
                        >
                          <option value="">None</option>
                          {VA_POSITION_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
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
                  {/* Category Assignments */}
                  <td className="px-3 py-3">
                    {(() => {
                      const cats = getCategoryBadges(p.id);
                      if (cats.length === 0) return <span className="text-[10px] text-stone">&mdash;</span>;
                      return (
                        <div className="flex flex-wrap gap-0.5">
                          {cats.map((c, i) => (
                            <span key={i} className="inline-block bg-parchment text-bark px-1.5 py-0.5 rounded-full text-[9px] font-semibold">
                              {c}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </td>
                  {/* Available Tasks toggle */}
                  <td className="px-3 py-3 text-center">
                    {p.role === "va" ? (
                      <button
                        onClick={async () => {
                          const newVal = !p.can_see_available_tasks;
                          try {
                            const res = await fetch("/api/users", {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ user_id: p.id, can_see_available_tasks: newVal }),
                            });
                            if (res.ok) fetchData();
                          } catch { /* silent */ }
                        }}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-all cursor-pointer ${
                          p.can_see_available_tasks
                            ? "bg-sage-soft text-sage hover:bg-sage/20"
                            : "bg-parchment text-stone hover:bg-sand"
                        }`}
                        title={p.can_see_available_tasks ? "Click to hide Available Tasks" : "Click to show Available Tasks"}
                      >
                        <span className={`inline-block h-1.5 w-1.5 rounded-full ${p.can_see_available_tasks ? "bg-sage" : "bg-stone"}`} />
                        {p.can_see_available_tasks ? "On" : "Off"}
                      </button>
                    ) : (
                      <span className="text-[10px] text-stone">&mdash;</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-[11px] text-stone whitespace-nowrap">
                    {new Date(p.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: orgTimezone })}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <div className="flex flex-col items-center gap-1">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => {
                          setResetPasswordTarget(p);
                          setResetPasswordValue("");
                          setResetPasswordError("");
                          setResetPasswordSuccess("");
                        }}
                        title="Set Password (manual)"
                        className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-sand text-bark transition-all hover:border-terracotta hover:text-terracotta cursor-pointer"
                      >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0110 0v4" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleSendResetLink(p)}
                        disabled={sendingResetLinkFor === p.id}
                        title="Send Password Reset Email"
                        className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-sand text-bark transition-all hover:border-blue-400 hover:text-blue-500 cursor-pointer disabled:opacity-50"
                      >
                        {sendingResetLinkFor === p.id ? (
                          <div className="h-3 w-3 rounded-full border-2 border-sand border-t-bark animate-spin" />
                        ) : (
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                            <polyline points="22,6 12,13 2,6" />
                          </svg>
                        )}
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
                    {resetLinkMsg?.userId === p.id && (
                      <span className={`text-[10px] font-medium ${resetLinkMsg.isError ? "text-red-500" : "text-green-600"}`}>
                        {resetLinkMsg.text}
                      </span>
                    )}
                    </div>
                  </td>
                </tr>
                {expandedId === p.id && (
                  <tr className="bg-parchment/10">
                    <td colSpan={12} className="px-6 py-4">
                      <div className="grid grid-cols-3 gap-6 text-[12px]">
                        <div>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-bark">Email</span>
                          <p className="mt-0.5 text-espresso font-medium">{emailMap[p.id] || "—"}</p>
                        </div>
                        <div>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-bark">Username</span>
                          <p className="mt-0.5 text-espresso font-medium">{p.username}</p>
                        </div>
                        <div>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-bark">Department</span>
                          <p className="mt-0.5 text-espresso font-medium">{p.department || "—"}</p>
                        </div>
                        <div>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-bark">Position</span>
                          <p className="mt-0.5 text-espresso font-medium">{p.position || "—"}</p>
                        </div>
                        <div>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-bark">Pay Rate</span>
                          <p className="mt-0.5 text-espresso font-medium">${(p.pay_rate || 0).toFixed(2)} / {p.pay_rate_type || "hourly"}</p>
                        </div>
                        <div>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-bark">Role</span>
                          <p className="mt-0.5 text-espresso font-medium capitalize">{p.role}</p>
                        </div>
                        <div>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-bark">Joined</span>
                          <p className="mt-0.5 text-espresso font-medium">{new Date(p.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: orgTimezone })}</p>
                        </div>
                        <div>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-bark">Status</span>
                          <p className="mt-0.5 text-espresso font-medium">{p.is_active !== false ? "Active" : "Inactive"}</p>
                        </div>
                        <div>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-bark">Available Tasks</span>
                          <p className="mt-0.5 text-espresso font-medium">{p.can_see_available_tasks ? "Enabled" : "Disabled"}</p>
                        </div>
                        <div>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-bark">Employment Type</span>
                          <p className="mt-0.5 text-espresso font-medium capitalize">{p.employment_type ? p.employment_type.replace(/_/g, " ") : "—"}</p>
                        </div>
                        <div>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-bark">Extension Required</span>
                          <div className="mt-0.5 flex items-center gap-2">
                            <p className="text-espresso font-medium">{p.requires_extension ? "Yes" : "No"}</p>
                            <button
                              onClick={async () => {
                                const newVal = !p.requires_extension;
                                const payload: Record<string, unknown> = {
                                  user_id: p.id,
                                  requires_extension: newVal,
                                };
                                if (newVal) payload.extension_popup_shown = false;
                                await fetch("/api/users", {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify(payload),
                                });
                                fetchData();
                              }}
                              className="text-[11px] text-terracotta hover:underline font-medium cursor-pointer"
                            >
                              {p.requires_extension ? "Remove" : "Require"}
                            </button>
                          </div>
                        </div>
                      </div>
                      {/* Payment Accounts */}
                      <div className="mt-4 pt-4 border-t border-sand/50">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-bark">Payment Accounts</span>
                          <button
                            onClick={() => openPaymentAccountsModal(p)}
                            className="text-[11px] text-terracotta hover:underline font-medium"
                          >
                            Edit
                          </button>
                        </div>
                        {p.payment_accounts && Object.keys(p.payment_accounts).length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {Object.entries(p.payment_accounts as Record<string, Record<string, string>>).map(([method, details]) => (
                              <div key={method} className="text-[11px] bg-parchment border border-sand rounded-lg px-2 py-1">
                                <span className="font-semibold capitalize">{method.replace(/_/g, " ")}</span>
                                {" · "}
                                {Object.values(details).filter(Boolean).join(" · ")}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[11px] text-bark/40 italic">No payment accounts set. Click Edit to add.</p>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
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

      {/* ── Payment Accounts Modal ─────────────────────────────── */}
      {paymentAccountsTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={() => setPaymentAccountsTarget(null)}
        >
          <div
            className="w-full max-w-lg rounded-xl bg-white shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-linen bg-parchment flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-espresso">Payment Accounts</h3>
                <p className="text-[11px] text-bark mt-0.5">{paymentAccountsTarget.full_name}</p>
              </div>
              <button
                onClick={() => setPaymentAccountsTarget(null)}
                className="text-bark/40 hover:text-bark text-lg leading-none"
              >✕</button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
              <p className="text-[12px] text-bark/60">
                Enter the payment account details for each method. These will automatically appear on the VA&apos;s paystub when that method is used.
              </p>

              {/* GCash */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-bark/50">GCash</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-bark/60 mb-1">Phone Number</label>
                    <input
                      type="text"
                      placeholder="09XXXXXXXXX"
                      value={paymentAccountsForm.gcash?.number ?? ""}
                      onChange={(e) => setPaymentAccountsForm((f) => ({ ...f, gcash: { ...f.gcash, number: e.target.value } }))}
                      className="w-full border border-linen rounded-lg px-3 py-1.5 text-sm text-bark bg-white focus:outline-none focus:ring-2 focus:ring-terracotta/30"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-bark/60 mb-1">Account Name</label>
                    <input
                      type="text"
                      placeholder="Full name"
                      value={paymentAccountsForm.gcash?.name ?? ""}
                      onChange={(e) => setPaymentAccountsForm((f) => ({ ...f, gcash: { ...f.gcash, name: e.target.value } }))}
                      className="w-full border border-linen rounded-lg px-3 py-1.5 text-sm text-bark bg-white focus:outline-none focus:ring-2 focus:ring-terracotta/30"
                    />
                  </div>
                </div>
              </div>

              {/* Bank Deposit */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-bark/50">Bank Deposit / Bank Transfer</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-bark/60 mb-1">Bank Name</label>
                    <input
                      type="text"
                      placeholder="e.g. BDO, BPI"
                      value={paymentAccountsForm.bank_deposit?.bank_name ?? ""}
                      onChange={(e) => setPaymentAccountsForm((f) => ({
                        ...f,
                        bank_deposit: { ...f.bank_deposit, bank_name: e.target.value },
                        bank_transfer: { ...f.bank_transfer, bank_name: e.target.value },
                      }))}
                      className="w-full border border-linen rounded-lg px-3 py-1.5 text-sm text-bark bg-white focus:outline-none focus:ring-2 focus:ring-terracotta/30"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-bark/60 mb-1">Account Number</label>
                    <input
                      type="text"
                      placeholder="XXXXXXXXXXXX"
                      value={paymentAccountsForm.bank_deposit?.account_number ?? ""}
                      onChange={(e) => setPaymentAccountsForm((f) => ({
                        ...f,
                        bank_deposit: { ...f.bank_deposit, account_number: e.target.value },
                        bank_transfer: { ...f.bank_transfer, account_number: e.target.value },
                      }))}
                      className="w-full border border-linen rounded-lg px-3 py-1.5 text-sm text-bark bg-white focus:outline-none focus:ring-2 focus:ring-terracotta/30"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] text-bark/60 mb-1">Account Name</label>
                  <input
                    type="text"
                    placeholder="Full name on bank account"
                    value={paymentAccountsForm.bank_deposit?.account_name ?? ""}
                    onChange={(e) => setPaymentAccountsForm((f) => ({
                      ...f,
                      bank_deposit: { ...f.bank_deposit, account_name: e.target.value },
                      bank_transfer: { ...f.bank_transfer, account_name: e.target.value },
                    }))}
                    className="w-full border border-linen rounded-lg px-3 py-1.5 text-sm text-bark bg-white focus:outline-none focus:ring-2 focus:ring-terracotta/30"
                  />
                </div>
              </div>

              {/* PayPal */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-bark/50">PayPal</div>
                <div>
                  <label className="block text-[11px] text-bark/60 mb-1">Email</label>
                  <input
                    type="email"
                    placeholder="paypal@email.com"
                    value={paymentAccountsForm.paypal?.email ?? ""}
                    onChange={(e) => setPaymentAccountsForm((f) => ({ ...f, paypal: { ...f.paypal, email: e.target.value } }))}
                    className="w-full border border-linen rounded-lg px-3 py-1.5 text-sm text-bark bg-white focus:outline-none focus:ring-2 focus:ring-terracotta/30"
                  />
                </div>
              </div>

              {/* Remittance */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-bark/50">Remittance</div>
                <div>
                  <label className="block text-[11px] text-bark/60 mb-1">Details</label>
                  <input
                    type="text"
                    placeholder="e.g. Western Union · Full Name"
                    value={paymentAccountsForm.remittance?.details ?? ""}
                    onChange={(e) => setPaymentAccountsForm((f) => ({ ...f, remittance: { ...f.remittance, details: e.target.value } }))}
                    className="w-full border border-linen rounded-lg px-3 py-1.5 text-sm text-bark bg-white focus:outline-none focus:ring-2 focus:ring-terracotta/30"
                  />
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-linen flex justify-end gap-2">
              <button
                onClick={() => setPaymentAccountsTarget(null)}
                className="rounded-lg border border-sand px-4 py-2 text-[12px] font-medium text-bark hover:border-terracotta hover:text-terracotta cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={savePaymentAccounts}
                disabled={savingPaymentAccounts}
                className="rounded-lg bg-terracotta px-4 py-2 text-[12px] font-semibold text-white hover:bg-terracotta/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {savingPaymentAccounts ? "Saving..." : "Save Payment Accounts"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Column Filter Dropdown ────────────────────────────── */}
      {openFilter && (
        <div
          ref={colFilterDropRef}
          style={{
            position: "fixed",
            left: Math.min(dropPos.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 230),
            top: Math.min(dropPos.y, (typeof window !== "undefined" ? window.innerHeight : 800) - 340),
            zIndex: 9999,
          }}
          className="w-56 rounded-xl border border-sand bg-white shadow-xl overflow-hidden"
        >
          {openFilter === "joined" ? (
            <div className="p-3">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-bark">Date Range</span>
                <button
                  onClick={() => { setJoinedStart(""); setJoinedEnd(""); }}
                  className="text-[10px] text-terracotta hover:underline cursor-pointer"
                >
                  Clear
                </button>
              </div>
              <div className="space-y-2">
                <div>
                  <label className="text-[10px] text-stone block mb-1">From</label>
                  <input
                    type="date"
                    value={joinedStart}
                    onChange={(e) => setJoinedStart(e.target.value)}
                    className="w-full rounded-lg border border-sand bg-white px-2 py-1.5 text-[12px] text-espresso focus:border-terracotta focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-stone block mb-1">To</label>
                  <input
                    type="date"
                    value={joinedEnd}
                    onChange={(e) => setJoinedEnd(e.target.value)}
                    className="w-full rounded-lg border border-sand bg-white px-2 py-1.5 text-[12px] text-espresso focus:border-terracotta focus:outline-none"
                  />
                </div>
              </div>
              <button
                onClick={() => setOpenFilter(null)}
                className="mt-3 w-full rounded-lg bg-terracotta text-white text-[11px] font-semibold py-1.5 hover:bg-terracotta/80 cursor-pointer"
              >
                Apply
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center border-b border-parchment px-2 py-2 gap-1">
                <button
                  onClick={() => selectAllCol(openFilter)}
                  className="flex-1 rounded px-2 py-1 text-[11px] font-semibold text-sage hover:bg-parchment cursor-pointer transition-colors"
                >
                  Select All
                </button>
                <span className="text-stone text-[10px]">|</span>
                <button
                  onClick={() => unselectAllCol(openFilter)}
                  className="flex-1 rounded px-2 py-1 text-[11px] font-semibold text-bark hover:bg-parchment cursor-pointer transition-colors"
                >
                  Unselect All
                </button>
              </div>
              <div className="max-h-60 overflow-y-auto py-1">
                {(uniqueValues[openFilter as keyof typeof uniqueValues] ?? []).map((val) => {
                  const allVals = uniqueValues[openFilter as keyof typeof uniqueValues] ?? [];
                  const selected = !(openFilter in colFilters) || colFilters[openFilter].includes(val);
                  return (
                    <label
                      key={val}
                      className="flex items-center gap-2 px-3 py-1.5 hover:bg-parchment/50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleColFilter(openFilter, val, allVals)}
                        className="rounded border-sand accent-terracotta cursor-pointer h-3.5 w-3.5 shrink-0"
                      />
                      <span className="text-[12px] text-espresso truncate">{val}</span>
                    </label>
                  );
                })}
              </div>
            </>
          )}
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
  billing_rate: number | null;
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
  const [editingRateId, setEditingRateId] = useState<number | null>(null);
  const [editRate, setEditRate] = useState("");
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

  const handleSaveRate = async (id: number) => {
    const rate = editRate.trim() === "" ? null : parseFloat(editRate);
    if (rate !== null && isNaN(rate)) return;
    await fetch("/api/accounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, billing_rate: rate }),
    });
    setEditingRateId(null);
    setEditRate("");
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
                <th className="px-3 py-3">Billing Rate</th>
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
                      {editingRateId === acc.id ? (
                        <div className="flex items-center gap-1">
                          <span className="text-[11px] text-bark">$</span>
                          <input
                            value={editRate}
                            onChange={(e) => setEditRate(e.target.value)}
                            className="w-20 rounded border border-terracotta px-1.5 py-0.5 text-[11px] outline-none"
                            placeholder="0.00"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveRate(acc.id);
                              if (e.key === "Escape") setEditingRateId(null);
                            }}
                          />
                          <span className="text-[10px] text-bark">/hr</span>
                          <button onClick={() => handleSaveRate(acc.id)} className="text-sage text-sm font-bold">OK</button>
                          <button onClick={() => setEditingRateId(null)} className="text-bark hover:text-terracotta text-sm">&times;</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingRateId(acc.id); setEditRate(acc.billing_rate != null ? String(acc.billing_rate) : ""); }}
                          className="cursor-pointer text-[12px] font-medium transition-colors hover:text-terracotta"
                        >
                          {acc.billing_rate != null ? (
                            <span className="text-espresso">${Number(acc.billing_rate).toFixed(2)}/hr</span>
                          ) : (
                            <span className="text-bark/50 italic">Set rate</span>
                          )}
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
  const [uploadingOrgLogo, setUploadingOrgLogo] = useState(false);
  const orgLogoFileRef = useRef<HTMLInputElement>(null);

  // Square credentials state
  const [squareAppId, setSquareAppId] = useState("");
  const [squareAccessToken, setSquareAccessToken] = useState("");
  const [squareLocationId, setSquareLocationId] = useState("");
  const [squareEnvironment, setSquareEnvironment] = useState("production");
  const [savingSquare, setSavingSquare] = useState(false);
  const [squareSaveSuccess, setSquareSaveSuccess] = useState(false);
  const [squareSaveError, setSquareSaveError] = useState("");

  // Payment templates state
  const [orgTemplates, setOrgTemplates] = useState<PaymentTemplate[]>([]);
  const [newTplName, setNewTplName] = useState("");
  const [newTplItems, setNewTplItems] = useState<Array<{label: string; amount_type: "percentage" | "fixed"; value: string}>>([{ label: "", amount_type: "fixed", value: "" }]);
  const [savingTpl, setSavingTpl] = useState(false);
  const [editingTpl, setEditingTpl] = useState<PaymentTemplate | null>(null);
  const [editTplName, setEditTplName] = useState("");
  const [editTplItems, setEditTplItems] = useState<Array<{label: string; amount_type: "percentage" | "fixed"; value: string}>>([]);
  const [tplError, setTplError] = useState("");

  // Form state
  const [orgName, setOrgName] = useState("");
  const [registeredBusinessName, setRegisteredBusinessName] = useState("");
  const [dba, setDba] = useState("");
  const [taxId, setTaxId] = useState("");
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
        setRegisteredBusinessName(s.registered_business_name || "");
        setDba(s.dba || "");
        setTaxId(s.tax_id || "");
        setLogoUrl(s.logo_url || "");
        setAddress(s.address || "");
        setTimezone(s.timezone || "UTC");
        setBillingEmail(s.billing_email || "");
      }
      setLoadingSettings(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load Square settings + payment templates
  useEffect(() => {
    async function loadPaymentSettings() {
      const [sqRes, tplRes] = await Promise.all([
        fetch("/api/square-settings"),
        fetch("/api/payment-templates"),
      ]);
      const sqData = await sqRes.json();
      if (sqData.settings) {
        setSquareAppId(sqData.settings.application_id || "");
        setSquareLocationId(sqData.settings.location_id || "");
        setSquareEnvironment(sqData.settings.environment || "production");
        // access_token is never returned from GET — placeholder only
      }
      const tplData = await tplRes.json();
      if (tplData.templates) setOrgTemplates(tplData.templates as PaymentTemplate[]);
    }
    loadPaymentSettings();
  }, []);

  const handleOrgLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingOrgLogo(true);
    setSaveError("");
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `org/logo-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("logos")
        .upload(path, file, { upsert: true });
      if (uploadError) {
        setSaveError(`Logo upload failed: ${uploadError.message}`);
        setUploadingOrgLogo(false);
        return;
      }
      const { data: urlData } = supabase.storage.from("logos").getPublicUrl(path);
      setLogoUrl(urlData.publicUrl);
    } catch {
      setSaveError("Logo upload failed");
    } finally {
      setUploadingOrgLogo(false);
      if (orgLogoFileRef.current) orgLogoFileRef.current.value = "";
    }
  };

  const handleSaveSquare = async () => {
    if (!squareAppId.trim() || !squareAccessToken.trim() || !squareLocationId.trim()) {
      setSquareSaveError("All three fields (Application ID, Access Token, Location ID) are required.");
      return;
    }
    setSavingSquare(true);
    setSquareSaveError("");
    setSquareSaveSuccess(false);
    const res = await fetch("/api/square-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        application_id: squareAppId.trim(),
        access_token: squareAccessToken.trim(),
        location_id: squareLocationId.trim(),
        environment: squareEnvironment,
      }),
    });
    const data = await res.json();
    setSavingSquare(false);
    if (!res.ok || !data.success) {
      setSquareSaveError(data.error || "Failed to save Square settings.");
    } else {
      setSquareSaveSuccess(true);
      setSquareAccessToken(""); // clear for security
      setTimeout(() => setSquareSaveSuccess(false), 3000);
    }
  };

  const handleSaveTemplate = async () => {
    setTplError("");
    const validItems = newTplItems.filter(i => i.label.trim() && i.value.trim() && parseFloat(i.value) > 0);
    if (!newTplName.trim()) { setTplError("Template name is required."); return; }
    if (validItems.length === 0) { setTplError("Add at least one installment."); return; }
    setSavingTpl(true);
    const res = await fetch("/api/payment-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newTplName.trim(),
        items: validItems.map(i => ({ label: i.label.trim(), amount_type: i.amount_type, value: parseFloat(i.value) })),
      }),
    });
    const data = await res.json();
    setSavingTpl(false);
    if (!res.ok || !data.template) {
      setTplError(data.error || "Failed to save template.");
    } else {
      setOrgTemplates(prev => [...prev, data.template as PaymentTemplate]);
      setNewTplName("");
      setNewTplItems([{ label: "", amount_type: "fixed", value: "" }]);
    }
  };

  const handleUpdateTemplate = async () => {
    if (!editingTpl) return;
    setTplError("");
    const validItems = editTplItems.filter(i => i.label.trim() && i.value.trim() && parseFloat(i.value) > 0);
    if (!editTplName.trim()) { setTplError("Template name is required."); return; }
    if (validItems.length === 0) { setTplError("Add at least one installment."); return; }
    setSavingTpl(true);
    const res = await fetch("/api/payment-templates", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: editingTpl.id,
        name: editTplName.trim(),
        items: validItems.map(i => ({ label: i.label.trim(), amount_type: i.amount_type, value: parseFloat(i.value) })),
      }),
    });
    const data = await res.json();
    setSavingTpl(false);
    if (!res.ok || !data.template) {
      setTplError(data.error || "Failed to update template.");
    } else {
      setOrgTemplates(prev => prev.map(t => t.id === editingTpl.id ? data.template as PaymentTemplate : t));
      setEditingTpl(null);
    }
  };

  const handleDeleteTemplate = async (id: number) => {
    const res = await fetch(`/api/payment-templates?id=${id}`, { method: "DELETE" });
    if (res.ok) setOrgTemplates(prev => prev.filter(t => t.id !== id));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError("");
    setSaveSuccess(false);

    const updatePayload = {
      org_name: orgName || "MinuteFlow",
      registered_business_name: registeredBusinessName || null,
      dba: dba || null,
      tax_id: taxId || null,
      logo_url: logoUrl || null,
      address: address || null,
      timezone: timezone || "UTC",
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
            Registered Business Name
          </label>
          <input
            type="text"
            value={registeredBusinessName}
            onChange={(e) => setRegisteredBusinessName(e.target.value)}
            className="w-full rounded-lg border border-sand px-3.5 py-2.5 text-[13px] text-espresso outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)]"
            placeholder="Legal registered name of the business"
          />
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-walnut mb-1.5 tracking-wide">
            Doing Business As (DBA)
          </label>
          <input
            type="text"
            value={dba}
            onChange={(e) => setDba(e.target.value)}
            className="w-full rounded-lg border border-sand px-3.5 py-2.5 text-[13px] text-espresso outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)]"
            placeholder="Trade name / DBA"
          />
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-walnut mb-1.5 tracking-wide">
            Organization Logo
          </label>
          {logoUrl ? (
            <div className="flex items-center gap-3 mb-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoUrl} alt="Org logo" className="h-12 w-auto max-w-[120px] rounded border border-sand object-contain" />
              <button
                type="button"
                onClick={() => setLogoUrl("")}
                className="text-[11px] text-red-500 hover:underline"
              >
                Remove
              </button>
            </div>
          ) : null}
          <input
            ref={orgLogoFileRef}
            type="file"
            accept="image/*"
            onChange={handleOrgLogoUpload}
            className="hidden"
            id="org-logo-upload"
          />
          <label
            htmlFor="org-logo-upload"
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-sand px-4 py-2 text-[13px] font-medium text-bark transition-all hover:border-terracotta hover:text-terracotta"
          >
            {uploadingOrgLogo ? (
              <>
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                  <path d="M12 2a10 10 0 0 1 10 10" />
                </svg>
                Uploading...
              </>
            ) : (
              <>
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                {logoUrl ? "Replace Logo" : "Upload Logo"}
              </>
            )}
          </label>
          <p className="mt-1 text-[10px] text-stone">PNG, JPG, SVG. Shows on invoices.</p>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-walnut mb-1.5 tracking-wide">
            Tax ID / EIN
          </label>
          <input
            type="text"
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
            className="w-full rounded-lg border border-sand px-3.5 py-2.5 text-[13px] text-espresso outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)]"
            placeholder="12-3456789"
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

      {/* ── Square Payment Settings ─────────────────────────── */}
      <div className="mt-8 pt-8 border-t border-sand">
        <h2 className="text-[14px] font-bold text-espresso mb-1">Square Payment Settings</h2>
        <p className="text-[12px] text-bark mb-5">Connect your Square account to accept card payments on invoices. Get credentials at <a href="https://developer.squareup.com" target="_blank" rel="noopener noreferrer" className="text-terracotta hover:underline">developer.squareup.com</a> → Applications → Credentials.</p>

        {squareSaveSuccess && (
          <div className="mb-4 rounded-lg bg-sage-soft border border-sage px-4 py-2.5 text-xs text-sage font-medium">Square credentials saved!</div>
        )}
        {squareSaveError && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-xs text-red-600">{squareSaveError}</div>
        )}

        <div className="space-y-4 max-w-lg">
          <div>
            <label className="block text-[11px] font-semibold text-walnut mb-1.5 tracking-wide">Application ID</label>
            <input type="text" value={squareAppId} onChange={(e) => setSquareAppId(e.target.value)}
              placeholder="sq0idp-..."
              className="w-full rounded-lg border border-sand px-3.5 py-2.5 text-[13px] text-espresso outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)] font-mono" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-walnut mb-1.5 tracking-wide">Access Token</label>
            <input type="password" value={squareAccessToken} onChange={(e) => setSquareAccessToken(e.target.value)}
              placeholder="Enter new token to update (leave blank to keep current)"
              className="w-full rounded-lg border border-sand px-3.5 py-2.5 text-[13px] text-espresso outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)] font-mono" />
            <p className="mt-1 text-[10px] text-stone">Token is write-only — enter a value to update it.</p>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-walnut mb-1.5 tracking-wide">Location ID</label>
            <input type="text" value={squareLocationId} onChange={(e) => setSquareLocationId(e.target.value)}
              placeholder="L..."
              className="w-full rounded-lg border border-sand px-3.5 py-2.5 text-[13px] text-espresso outline-none transition-all focus:border-terracotta focus:shadow-[0_0_0_3px_rgba(194,105,79,0.08)] font-mono" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-walnut mb-1.5 tracking-wide">Environment</label>
            <select value={squareEnvironment} onChange={(e) => setSquareEnvironment(e.target.value)}
              className="w-full rounded-lg border border-sand px-3.5 py-2.5 text-[13px] text-espresso outline-none transition-all focus:border-terracotta">
              <option value="production">Production (Live)</option>
              <option value="sandbox">Sandbox (Testing)</option>
            </select>
          </div>
          <div className="pt-1">
            <button onClick={handleSaveSquare} disabled={savingSquare}
              className="rounded-lg bg-terracotta px-6 py-2.5 text-[13px] font-semibold text-white transition-all hover:bg-[#a85840] disabled:opacity-50">
              {savingSquare ? "Saving..." : "Save Square Settings"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Payment Templates ──────────────────────────────────── */}
      <div className="mt-8 pt-8 border-t border-sand">
        <h2 className="text-[14px] font-bold text-espresso mb-1">Payment Split Templates</h2>
        <p className="text-[12px] text-bark mb-5">Create reusable split plans (e.g. "50/50") that you can apply to any invoice.</p>

        {tplError && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-xs text-red-600">{tplError}</div>
        )}

        {/* Existing templates */}
        {orgTemplates.length > 0 && (
          <div className="space-y-3 mb-6">
            {orgTemplates.map((tpl) => (
              <div key={tpl.id} className="rounded-lg border border-sand bg-parchment/40 px-4 py-3">
                {editingTpl?.id === tpl.id ? (
                  <div className="space-y-3">
                    <input type="text" value={editTplName} onChange={(e) => setEditTplName(e.target.value)}
                      placeholder="Template name"
                      className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta" />
                    {editTplItems.map((item, idx) => (
                      <div key={idx} className="flex gap-2 items-center">
                        <input type="text" value={item.label} onChange={(e) => setEditTplItems(prev => prev.map((it, i) => i === idx ? {...it, label: e.target.value} : it))}
                          placeholder="Label (e.g. Deposit)"
                          className="flex-1 rounded-lg border border-sand bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-terracotta" />
                        <select value={item.amount_type} onChange={(e) => setEditTplItems(prev => prev.map((it, i) => i === idx ? {...it, amount_type: e.target.value as "percentage"|"fixed"} : it))}
                          className="rounded-lg border border-sand bg-white px-2 py-1.5 text-[12px] outline-none focus:border-terracotta">
                          <option value="percentage">%</option>
                          <option value="fixed">$</option>
                        </select>
                        <input type="number" value={item.value} onChange={(e) => setEditTplItems(prev => prev.map((it, i) => i === idx ? {...it, value: e.target.value} : it))}
                          placeholder="Value" min="0"
                          className="w-24 rounded-lg border border-sand bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-terracotta" />
                        {editTplItems.length > 1 && (
                          <button onClick={() => setEditTplItems(prev => prev.filter((_, i) => i !== idx))}
                            className="text-red-400 hover:text-red-600 text-[11px] font-bold">✕</button>
                        )}
                      </div>
                    ))}
                    <button onClick={() => setEditTplItems(prev => [...prev, { label: "", amount_type: "fixed", value: "" }])}
                      className="text-[11px] text-terracotta hover:underline">+ Add installment</button>
                    <div className="flex gap-2">
                      <button onClick={handleUpdateTemplate} disabled={savingTpl}
                        className="rounded-lg bg-terracotta px-4 py-1.5 text-[12px] font-semibold text-white hover:bg-[#a85840] disabled:opacity-50">
                        {savingTpl ? "Saving..." : "Save"}
                      </button>
                      <button onClick={() => { setEditingTpl(null); setTplError(""); }}
                        className="rounded-lg border border-sand px-4 py-1.5 text-[12px] font-medium text-bark hover:border-bark">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[13px] font-semibold text-espresso mb-1">{tpl.name}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {tpl.items.map((item, i) => (
                          <span key={i} className="rounded-full bg-parchment border border-sand px-2.5 py-0.5 text-[11px] text-bark">
                            {item.label}: {item.amount_type === "percentage" ? `${item.value}%` : `$${item.value}`}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => {
                        setEditingTpl(tpl);
                        setEditTplName(tpl.name);
                        setEditTplItems(tpl.items.map(i => ({ label: i.label, amount_type: i.amount_type, value: String(i.value) })));
                        setTplError("");
                      }} className="text-[11px] text-terracotta hover:underline">Edit</button>
                      <button onClick={() => handleDeleteTemplate(tpl.id)} className="text-[11px] text-red-400 hover:text-red-600 hover:underline">Delete</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* New template form */}
        {!editingTpl && (
          <div className="rounded-lg border border-dashed border-sand bg-parchment/20 px-4 py-4 space-y-3 max-w-lg">
            <div className="text-[11px] font-semibold text-walnut tracking-wide mb-1">New Template</div>
            <input type="text" value={newTplName} onChange={(e) => setNewTplName(e.target.value)}
              placeholder="Template name (e.g. 50/50 Split)"
              className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta" />
            {newTplItems.map((item, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <input type="text" value={item.label} onChange={(e) => setNewTplItems(prev => prev.map((it, i) => i === idx ? {...it, label: e.target.value} : it))}
                  placeholder="Label (e.g. Deposit)"
                  className="flex-1 rounded-lg border border-sand bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-terracotta" />
                <select value={item.amount_type} onChange={(e) => setNewTplItems(prev => prev.map((it, i) => i === idx ? {...it, amount_type: e.target.value as "percentage"|"fixed"} : it))}
                  className="rounded-lg border border-sand bg-white px-2 py-1.5 text-[12px] outline-none focus:border-terracotta">
                  <option value="percentage">%</option>
                  <option value="fixed">$</option>
                </select>
                <input type="number" value={item.value} onChange={(e) => setNewTplItems(prev => prev.map((it, i) => i === idx ? {...it, value: e.target.value} : it))}
                  placeholder="Value" min="0"
                  className="w-24 rounded-lg border border-sand bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-terracotta" />
                {newTplItems.length > 1 && (
                  <button onClick={() => setNewTplItems(prev => prev.filter((_, i) => i !== idx))}
                    className="text-red-400 hover:text-red-600 text-[11px] font-bold">✕</button>
                )}
              </div>
            ))}
            <button onClick={() => setNewTplItems(prev => [...prev, { label: "", amount_type: "fixed", value: "" }])}
              className="text-[11px] text-terracotta hover:underline">+ Add installment</button>
            <div>
              <button onClick={handleSaveTemplate} disabled={savingTpl}
                className="rounded-lg bg-terracotta px-5 py-2 text-[12px] font-semibold text-white hover:bg-[#a85840] disabled:opacity-50">
                {savingTpl ? "Saving..." : "Save Template"}
              </button>
            </div>
          </div>
        )}
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
  orgTimezone,
}: {
  correctionRequests: TimeCorrectionRequest[];
  profileMap: Map<string, Profile>;
  logMap: Map<number, TimeLog>;
  reviewNotes: Record<number, string>;
  setReviewNotes: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  handleApproveCorrection: (req: TimeCorrectionRequest, overrideChanges?: Record<string, string>) => Promise<string | null>;
  handleDenyCorrection: (req: TimeCorrectionRequest) => void;
  orgTimezone: string;
}) {
  const [editedChanges, setEditedChanges] = React.useState<Record<number, Record<string, string>>>({});
  const [correctionErrors, setCorrectionErrors] = React.useState<Record<number, string>>({});

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
                      {new Date(reqLog.start_time).toLocaleDateString("en-US", { timeZone: orgTimezone })}
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
                        <div><span className="font-medium">Start:</span> {new Date(reqLog.start_time).toLocaleString("en-US", { timeZone: orgTimezone })}</div>
                        <div><span className="font-medium">End:</span> {reqLog.end_time ? new Date(reqLog.end_time).toLocaleString("en-US", { timeZone: orgTimezone }) : "—"}</div>
                        {reqLog.client_memo && (
                          <div className="col-span-2"><span className="font-medium">Client Memo:</span> {reqLog.client_memo}</div>
                        )}
                        {reqLog.internal_memo && (
                          <div className="col-span-2"><span className="font-medium">Internal Memo:</span> {reqLog.internal_memo}</div>
                        )}
                      </div>
                    </div>
                  )}
                  {/* Requested changes with before/after comparison — time fields are editable */}
                  <div className="mt-2 rounded-lg bg-parchment px-3 py-2">
                    <div className="text-[10px] font-semibold text-bark mb-1">
                      Requested Changes: <span className="font-normal text-stone">(edit time fields if the date looks wrong)</span>
                    </div>
                    {Object.entries(changes).map(([field, value]) => {
                      const originalValue = reqLog ? (reqLog as unknown as Record<string, unknown>)[field] : undefined;
                      const isTimeField = field === "start_time" || field === "end_time";
                      const editedVal = editedChanges[req.id]?.[field] ?? value;
                      return (
                        <div key={field} className="text-[11px] text-espresso mb-1">
                          <span className="font-medium">{field}:</span>{" "}
                          {originalValue !== undefined && (
                            <span className="line-through text-stone mr-1">{String(originalValue) || "(empty)"}</span>
                          )}
                          {isTimeField ? (
                            <input
                              type="datetime-local"
                              value={editedVal || ""}
                              onChange={(e) => setEditedChanges(prev => ({
                                ...prev,
                                [req.id]: { ...(prev[req.id] || {}), [field]: e.target.value }
                              }))}
                              className="rounded border border-terracotta px-1.5 py-0.5 text-[11px] text-terracotta font-medium outline-none focus:ring-1 focus:ring-terracotta bg-white"
                            />
                          ) : (
                            <span className="text-terracotta font-medium">{value || "(empty)"}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <span className="text-[10px] text-stone shrink-0">
                  {new Date(req.created_at).toLocaleDateString("en-US", { timeZone: orgTimezone })}
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
                  onClick={async () => {
                    const reqChanges = req.requested_changes as Record<string, string>;
                    const overrides: Record<string, string> = {};
                    Object.entries(reqChanges).forEach(([field, val]) => {
                      overrides[field] = editedChanges[req.id]?.[field] ?? val;
                    });
                    const err = await handleApproveCorrection(req, overrides);
                    if (err) {
                      setCorrectionErrors(prev => ({ ...prev, [req.id]: err }));
                    } else {
                      setCorrectionErrors(prev => { const n = { ...prev }; delete n[req.id]; return n; });
                    }
                  }}
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
              {correctionErrors[req.id] && (
                <div className="ml-10 mt-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[11px] text-red-600">
                  ⚠️ {correctionErrors[req.id]}
                </div>
              )}
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
  orgTimezone,
}: {
  breakCorrectionRequests: BreakCorrectionRequest[];
  profileMap: Map<string, Profile>;
  breakReviewNotes: Record<number, string>;
  setBreakReviewNotes: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  breakCustomMs: Record<number, string>;
  setBreakCustomMs: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  handleApproveBreakCorrection: (req: BreakCorrectionRequest) => void;
  handleDenyBreakCorrection: (req: BreakCorrectionRequest) => void;
  orgTimezone: string;
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
                    {new Date(req.session_date).toLocaleDateString("en-US", { timeZone: orgTimezone })} &middot; {shiftHrs}h shift
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
                  {new Date(req.created_at || "").toLocaleDateString("en-US", { timeZone: orgTimezone })}
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

/* ── Manual Entries Approval Section ──────────────────────── */

function ManualEntriesSection({
  pendingManualEntries,
  profileMap,
  manualReviewNotes,
  setManualReviewNotes,
  handleApproveManualEntry,
  handleDenyManualEntry,
  orgTimezone,
}: {
  pendingManualEntries: TimeLog[];
  profileMap: Map<string, Profile>;
  manualReviewNotes: Record<number, string>;
  setManualReviewNotes: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  handleApproveManualEntry: (entry: TimeLog) => void;
  handleDenyManualEntry: (entry: TimeLog) => void;
  orgTimezone: string;
}) {
  if (pendingManualEntries.length === 0) {
    return (
      <div className="rounded-xl border border-sand bg-white px-5 py-12 text-center">
        <p className="text-sm text-bark">No pending manual time entries.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-sand bg-white">
      <div className="flex items-center justify-between border-b border-parchment px-5 py-4">
        <h2 className="text-sm font-bold text-espresso">
          Pending Manual Time Entries
        </h2>
        <span className="rounded-full bg-slate-blue-soft px-2.5 py-[2px] text-[11px] font-semibold text-slate-blue">
          {pendingManualEntries.length}
        </span>
      </div>
      <div className="divide-y divide-parchment">
        {pendingManualEntries.map((entry) => {
          const entryProfile = profileMap.get(entry.user_id);
          const startDate = new Date(entry.start_time);
          const endDate = entry.end_time ? new Date(entry.end_time) : null;
          const durationMin = entry.duration_ms ? Math.round(entry.duration_ms / 60000) : 0;
          const durationHr = Math.floor(durationMin / 60);
          const durationRemMin = durationMin % 60;
          const durationStr = durationHr > 0 ? `${durationHr}h ${durationRemMin}m` : `${durationRemMin}m`;

          return (
            <div key={entry.id} className="px-5 py-4">
              <div className="flex items-start gap-3 mb-3">
                {entryProfile && (
                  <div
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ backgroundColor: getAvatarColor(entryProfile.id) }}
                  >
                    {getInitials(entryProfile.full_name)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-espresso">
                    {entryProfile?.full_name || entry.full_name || "Unknown"}{" "}
                    <span className="font-normal text-bark">
                      submitted a manual time entry
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-stone">
                    Submitted {startDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: orgTimezone })}
                  </div>

                  {/* Entry details */}
                  <div className="mt-2 rounded-lg bg-cream/50 px-3 py-2 border border-sand/40">
                    <div className="text-[10px] font-semibold text-bark mb-1">
                      Entry Details:
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] text-espresso">
                      <div><span className="font-medium">Task:</span> {entry.task_name}</div>
                      <div><span className="font-medium">Category:</span> {entry.category}</div>
                      <div><span className="font-medium">Account:</span> {entry.account || "—"}</div>
                      <div><span className="font-medium">Client:</span> {entry.client_name || "—"}</div>
                      <div><span className="font-medium">Project:</span> {entry.project || "—"}</div>
                      <div><span className="font-medium">Billable:</span> {entry.billable ? "Yes" : "No"}</div>
                      <div>
                        <span className="font-medium">Start:</span>{" "}
                        {startDate.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: orgTimezone })}
                      </div>
                      <div>
                        <span className="font-medium">End:</span>{" "}
                        {endDate ? endDate.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: orgTimezone }) : "—"}
                      </div>
                      <div>
                        <span className="font-medium">Duration:</span>{" "}
                        <span className="text-terracotta font-semibold">{durationStr}</span>
                      </div>
                      <div><span className="font-medium">Progress:</span> {entry.progress || "—"}</div>
                      {entry.client_memo && (
                        <div className="col-span-2"><span className="font-medium">Client Memo:</span> {entry.client_memo}</div>
                      )}
                      {entry.internal_memo && (
                        <div className="col-span-2"><span className="font-medium">Internal Memo:</span> {entry.internal_memo}</div>
                      )}
                    </div>
                  </div>
                </div>
                <span className="text-[10px] text-stone shrink-0">
                  {startDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: orgTimezone })}
                </span>
              </div>
              {/* Review notes + actions */}
              <div className="ml-10 flex items-end gap-2">
                <input
                  type="text"
                  value={manualReviewNotes[entry.id] || ""}
                  onChange={(e) =>
                    setManualReviewNotes((prev) => ({
                      ...prev,
                      [entry.id]: e.target.value,
                    }))
                  }
                  placeholder="Review notes (optional)..."
                  className="flex-1 rounded-lg border border-sand px-3 py-1.5 text-xs text-espresso outline-none transition-colors focus:border-terracotta"
                />
                <button
                  onClick={() => handleApproveManualEntry(entry)}
                  className="rounded-lg bg-sage px-3 py-1.5 text-[11px] font-semibold text-white transition-all hover:bg-[#5a7a5a]"
                >
                  Approve
                </button>
                <button
                  onClick={() => handleDenyManualEntry(entry)}
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

/* ── Sorting Review Tab ────────────────────────────────────── */

function SortingReviewTab({
  sortingReviews,
  profileMap,
  logMap,
  currentUserId,
  fetchData,
  orgTimezone,
}: {
  sortingReviews: SortingReview[];
  profileMap: Map<string, Profile>;
  logMap: Map<number, TimeLog>;
  currentUserId: string | null;
  fetchData: () => void;
  orgTimezone: string;
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
                            timeZone: orgTimezone,
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
  timezone,
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
  timezone: string;
}) {
  const [isCapturing, setIsCapturing] = useState(false);

  // Clear "Requesting…" state when a new screenshot arrives for this member
  const prevScreenshotIdRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    const newId = member.latestScreenshot?.id;
    if (prevScreenshotIdRef.current !== undefined && newId !== prevScreenshotIdRef.current) {
      setIsCapturing(false);
    }
    prevScreenshotIdRef.current = newId;
  }, [member.latestScreenshot?.id]);

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
            {getTimeAgo(new Date(latestScreenshot.created_at), timezone)}
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
              onClick={() => {
                setIsCapturing(true);
                onCaptureNow();
                // Fallback: auto-clear after 20s in case capture fails silently
                setTimeout(() => setIsCapturing(false), 20000);
              }}
              disabled={isCapturing}
              className="flex-1 rounded-md bg-terracotta py-1.5 text-center text-[11px] font-semibold text-white transition-all hover:bg-[#a85840] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isCapturing ? "Requesting…" : "Capture Now"}
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
  timezone,
  onClose,
  onPrev,
  onNext,
}: {
  screenshot: TaskScreenshot;
  url: string | null;
  profile: Profile | null;
  log: TimeLog | null;
  timezone: string;
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
              {formatDateShort(screenshot.created_at, timezone)} at {formatTimeShort(screenshot.created_at, timezone)}
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
  start_time: string;
}

function InvoicesTab({ profiles, orgTimezone }: { profiles: Profile[]; orgTimezone: string }) {
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

  // Generate-by mode
  const [generateBy, setGenerateBy] = useState<"client" | "account">("client");
  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [accountList, setAccountList] = useState<string[]>([]);
  const [accountToClientMap, setAccountToClientMap] = useState<Record<string, number>>({});
  const [accountRateMap, setAccountRateMap] = useState<Record<string, number | null>>({});

  // Manual total / adjustment
  const [invoiceTotal, setInvoiceTotal] = useState("");
  const [adjustmentAmount, setAdjustmentAmount] = useState("0");

  // New invoice fields
  const [serviceType, setServiceType] = useState("");
  const [paymentLink, setPaymentLink] = useState("");
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [fromName, setFromName] = useState("");
  const [fromPhone, setFromPhone] = useState("");

  // Step 3 filters (Excel-style multi-select)
  const [filterVAValues, setFilterVAValues] = useState<Set<string>>(new Set<string>());
  const [filterTaskValues, setFilterTaskValues] = useState<Set<string>>(new Set<string>());
  const [filterDelivValues, setFilterDelivValues] = useState<Set<string>>(new Set<string>());
  const [filterMemoValues, setFilterMemoValues] = useState<Set<string>>(new Set<string>());
  const [openFilterPanel, setOpenFilterPanel] = useState<string | null>(null);
  const [filterPanelSearch, setFilterPanelSearch] = useState("");
  // Inline cell custom-edit mode (combo dropdown → text input switch)
  const [customEditCell, setCustomEditCell] = useState<{ idx: number; field: "desc" | "project" } | null>(null);

  // Undo stack for line item removals (up to 20)
  const [undoStack, setUndoStack] = useState<LineItemDraft[][]>([]);

  // Invoice summary — hours & rate fields
  const [hoursNotBilled, setHoursNotBilled] = useState("");
  const [hoursNotBilledLabel, setHoursNotBilledLabel] = useState("Volunteer");
  const [rateAmount, setRateAmount] = useState("");
  const [previousBalance, setPreviousBalance] = useState("");
  const [previousBalanceNote, setPreviousBalanceNote] = useState("");

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
  const [sendingReminder, setSendingReminder] = useState<number | null>(null);
  const [reminderSuccess, setReminderSuccess] = useState("");

  // Record payment state
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split("T")[0]);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentRef, setPaymentRef] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState("");

  // Edit invoice state
  const [editingInvoice, setEditingInvoice] = useState(false);
  const [editSubtotal, setEditSubtotal] = useState("");
  const [editAdjustment, setEditAdjustment] = useState("0");
  const [editPaymentLink, setEditPaymentLink] = useState("");
  const [editFromName, setEditFromName] = useState("");
  const [editFromPhone, setEditFromPhone] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editReminderEnabled, setEditReminderEnabled] = useState(false);
  const [editAccountName, setEditAccountName] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Send-to override (for test sends) — supports comma-separated multiple addresses
  const [sendToEmail, setSendToEmail] = useState("");
  const [sendCcEmail, setSendCcEmail] = useState("");

  // Holding cell for items removed from create view
  const [removedLineItems, setRemovedLineItems] = useState<LineItemDraft[]>([]);

  // Edit mode line items (editable copy of selectedLineItems)
  const [editLineItemsState, setEditLineItemsState] = useState<InvoiceLineItem[]>([]);
  const [removedEditItems, setRemovedEditItems] = useState<InvoiceLineItem[]>([]);
  const [editUndoStack, setEditUndoStack] = useState<InvoiceLineItem[][]>([]);
  const [editFilterVAValues, setEditFilterVAValues] = useState<Set<string>>(new Set<string>());
  const [editFilterTaskValues, setEditFilterTaskValues] = useState<Set<string>>(new Set<string>());
  const [editFilterDelivValues, setEditFilterDelivValues] = useState<Set<string>>(new Set<string>());
  const [editFilterMemoValues, setEditFilterMemoValues] = useState<Set<string>>(new Set<string>());
  const [editOpenFilterPanel, setEditOpenFilterPanel] = useState<string | null>(null);
  const [editFilterSearch, setEditFilterSearch] = useState("");
  const [editCustomCell, setEditCustomCell] = useState<{ idx: number; field: "desc" | "project" } | null>(null);

  // All project_tags from DB (for Deliverables dropdown)
  const [allProjectTags, setAllProjectTags] = useState<string[]>([]);

  // Reimbursable expense items to add to this invoice
  const [expenseItems, setExpenseItems] = useState<Array<{
    expense_id: number;
    description: string;
    amount: number;
    account: string | null;
    expense_date: string;
    excluded: boolean;
    notes: string | null;
  }>>([]);
  const [openBuilderNoteId, setOpenBuilderNoteId] = useState<number | null>(null);
  const [openDetailNoteId, setOpenDetailNoteId] = useState<number | null>(null);

  // Tracks settled status for expense line items in detail view
  const [expenseSettledMap, setExpenseSettledMap] = useState<Record<number, boolean>>({});

  // "Uncheck All" sentinel booleans for Step 3 filters
  const [filterVANone, setFilterVANone] = useState(false);
  const [filterTaskNone, setFilterTaskNone] = useState(false);
  const [filterDelivNone, setFilterDelivNone] = useState(false);
  const [filterMemoNone, setFilterMemoNone] = useState(false);
  const [editFilterVANone, setEditFilterVANone] = useState(false);
  const [editFilterTaskNone, setEditFilterTaskNone] = useState(false);
  const [editFilterDelivNone, setEditFilterDelivNone] = useState(false);
  const [editFilterMemoNone, setEditFilterMemoNone] = useState(false);

  // Holding cell reassignment overrides (per-index maps)
  const [removedItemOverrides, setRemovedItemOverrides] = useState<Map<number, { account: string; client: string }>>(new Map());
  const [removedEditOverrides, setRemovedEditOverrides] = useState<Map<number, { account: string; client: string }>>(new Map());

  // Payment info + reply-to for create flow
  const [paymentInfo, setPaymentInfo] = useState(DEFAULT_PAYMENT_INFO);
  const [replyToEmail, setReplyToEmail] = useState("");

  // Payment info + reply-to for edit flow
  const [editPaymentInfo, setEditPaymentInfo] = useState("");
  const [editReplyToEmail, setEditReplyToEmail] = useState("");
  const [editPreviousBalance, setEditPreviousBalance] = useState("");
  const [editPreviousBalanceNote, setEditPreviousBalanceNote] = useState("");

  // Bill To info — generate form (pre-filled from client, editable)
  const [billingEmail, setBillingEmail] = useState("");
  const [billingPhone, setBillingPhone] = useState("");
  const [billingAddress, setBillingAddress] = useState("");

  // Bill To info — edit panel
  const [editToName, setEditToName] = useState("");
  const [editToEmail, setEditToEmail] = useState("");
  const [editToPhone, setEditToPhone] = useState("");
  const [editToAddress, setEditToAddress] = useState("");

  // Custom invoice type state
  const [invoiceType, setInvoiceType] = useState<"timelog" | "custom">("timelog");
  const [customItems, setCustomItems] = useState<Array<{ id: string; description: string; amount: string }>>([{ id: "ci-1", description: "", amount: "" }]);

  // Square payment schedule — create flow
  const [invoiceTemplates, setInvoiceTemplates] = useState<PaymentTemplate[]>([]);
  const [createAllowCustomAmount, setCreateAllowCustomAmount] = useState(true);
  const [createTemplateId, setCreateTemplateId] = useState<number | null>(null);
  const [createSchedule, setCreateSchedule] = useState<PaymentScheduleItem[]>([]);

  // Square payment schedule — edit flow
  const [editAllowCustomAmount, setEditAllowCustomAmount] = useState(true);
  const [editTemplateId, setEditTemplateId] = useState<number | null>(null);
  const [editSchedule, setEditSchedule] = useState<PaymentScheduleItem[]>([]);

  const supabase = createClient();

  /* ── Fetch invoices + clients ─────────────────────────────── */

  const fetchInvoices = useCallback(async () => {
    const sb = createClient();
    const [invRes, clientsRes, orgRes, accRes, tagsRes] = await Promise.all([
      sb.from("invoices").select("*").order("created_at", { ascending: false }),
      sb.from("clients").select("*").eq("active", true).order("name"),
      sb.from("organization_settings").select("*").limit(1).single(),
      fetch("/api/accounts"),
      sb.from("project_tags").select("project_name").eq("is_active", true).order("sort_order"),
    ]);
    setInvoices((invRes.data ?? []) as Invoice[]);
    setClients((clientsRes.data ?? []) as Client[]);
    if (orgRes.data) {
      setOrgSettings(orgRes.data as OrganizationSettings);
      // Default sender name to org owner (admin user's full name), not the business name
      const { data: { user } } = await sb.auth.getUser();
      const { data: adminProfile } = user
        ? await sb.from("profiles").select("full_name").eq("id", user.id).single()
        : { data: null };
      setFromName(adminProfile?.full_name || orgRes.data.registered_business_name || orgRes.data.org_name || "");
      // Auto-populate reply-to email from org billing email
      if (orgRes.data.billing_email) {
        setReplyToEmail(orgRes.data.billing_email);
      }
    }
    const tagNames: string[] = (tagsRes.data ?? []).map((t: { project_name: string }) => t.project_name).filter(Boolean);
    setAllProjectTags(tagNames);
    const accData = await accRes.json();
    const names: string[] = (accData.accounts ?? [])
      .filter((a: { active: boolean }) => a.active !== false)
      .map((a: { name: string }) => a.name)
      .sort();
    setAccountList(names);

    // Build account name → client_id map from mappings
    const acMap: Record<string, number> = {};
    const rateMap: Record<string, number | null> = {};
    const allAccounts: { id: number; name: string; billing_rate?: number | null }[] = accData.accounts ?? [];
    for (const m of accData.mappings ?? []) {
      const acc = allAccounts.find((a) => a.id === m.account_id);
      if (acc && m.client_id) acMap[acc.name] = m.client_id;
    }
    for (const acc of allAccounts) {
      rateMap[acc.name] = acc.billing_rate ?? null;
    }
    setAccountToClientMap(acMap);
    setAccountRateMap(rateMap);

    setLoading(false);

    // Load payment templates for Square split payment UI
    try {
      const tplRes = await fetch("/api/payment-templates");
      if (tplRes.ok) {
        const tplData = await tplRes.json();
        setInvoiceTemplates((tplData.templates ?? []) as PaymentTemplate[]);
      }
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  /* ── Computed ──────────────────────────────────────────────── */

  const filteredInvoices = useMemo(() => {
    if (statusFilter === "all") return invoices.filter((inv) => inv.status !== "trash");
    return invoices.filter((inv) => inv.status === statusFilter);
  }, [invoices, statusFilter]);

  const summaryStats = useMemo(() => {
    let totalInvoiced = 0;
    let outstanding = 0;
    let paid = 0;
    let overdue = 0;
    invoices.forEach((inv) => {
      if (inv.status === "trash") return; // trash excluded from all totals
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

  // Auto-populate Bill To when account is selected and has a mapped client
  useEffect(() => {
    if (generateBy === "account" && selectedAccount && accountToClientMap[selectedAccount]) {
      setSelectedClientId(accountToClientMap[selectedAccount]);
    }
  }, [selectedAccount, accountToClientMap, generateBy]);

  // Auto-populate rate from account's billing_rate when account is selected
  useEffect(() => {
    if (generateBy === "account" && selectedAccount && accountRateMap[selectedAccount] != null) {
      setRateAmount(String(accountRateMap[selectedAccount]));
    }
  }, [selectedAccount, accountRateMap, generateBy]);

  // Pre-fill billing contact info when client is selected
  useEffect(() => {
    const client = clients.find((c) => c.id === selectedClientId);
    if (client) {
      setBillingEmail(client.email || "");
      setBillingPhone(client.phone || "");
      setBillingAddress([client.address, client.city, client.state, client.zip, client.country].filter(Boolean).join(", ") || "");
    } else {
      setBillingEmail("");
      setBillingPhone("");
      setBillingAddress("");
    }
  }, [selectedClientId, clients]);

  // Auto-calculate invoice total from client default_hourly_rate × total hours
  useEffect(() => {
    if (lineItems.length > 0 && selectedClient?.default_hourly_rate) {
      const totalHrs = lineItems.reduce((sum, li) => sum + li.quantity, 0);
      const autoTotal = Math.round(totalHrs * selectedClient.default_hourly_rate * 100) / 100;
      setInvoiceTotal(String(autoTotal));
      if (!rateAmount) setRateAmount(String(selectedClient.default_hourly_rate));
    }
  }, [lineItems, selectedClient]); // eslint-disable-line react-hooks/exhaustive-deps

  // Unique option lists for Step 3 filter panels
  const filterVAOptions = useMemo(() => [...new Set(lineItems.map(li => li.va_name || "").filter(Boolean))].sort(), [lineItems]);
  const filterTaskOptions = useMemo(() => [...new Set(lineItems.map(li => li.description).filter(Boolean))].sort(), [lineItems]);
  const filterDelivOptions = useMemo(() => [...new Set(lineItems.map(li => li.project || "").filter(Boolean))].sort(), [lineItems]);
  const filterMemoOptions = useMemo(() => [...new Set(lineItems.map(li => li.client_memo || "").filter(Boolean))].sort(), [lineItems]);

  // Options for inline combo dropdowns
  const taskDescOptions = useMemo(() => [...new Set(lineItems.map(li => li.description))].sort(), [lineItems]);
  const getDelivOptions = useCallback((taskDesc: string) => {
    const fromLineItems = [...new Set(lineItems.filter(li => li.description === taskDesc).map(li => li.project || "").filter(Boolean))];
    return [...new Set([...allProjectTags, ...fromLineItems])].sort();
  }, [lineItems, allProjectTags]);

  // Filtered line items for Step 3 display
  const filteredLineItems = useMemo(() => {
    return lineItems.filter((li) => {
      const vaOk = filterVANone ? false : (filterVAValues.size === 0 || filterVAValues.has(li.va_name || ""));
      const taskOk = filterTaskNone ? false : (filterTaskValues.size === 0 || filterTaskValues.has(li.description));
      const delivOk = filterDelivNone ? false : (filterDelivValues.size === 0 || filterDelivValues.has(li.project || ""));
      const memoOk = filterMemoNone ? false : (filterMemoValues.size === 0 || filterMemoValues.has(li.client_memo || ""));
      return vaOk && taskOk && delivOk && memoOk;
    });
  }, [lineItems, filterVAValues, filterTaskValues, filterDelivValues, filterMemoValues, filterVANone, filterTaskNone, filterDelivNone, filterMemoNone]);

  // Edit mode filter options
  const editFilterVAOptions = useMemo(() => [...new Set(editLineItemsState.map(li => li.va_name || "").filter(Boolean))].sort(), [editLineItemsState]);
  const editFilterTaskOptions = useMemo(() => [...new Set(editLineItemsState.map(li => li.description).filter(Boolean))].sort(), [editLineItemsState]);
  const editFilterDelivOptions = useMemo(() => [...new Set(editLineItemsState.map(li => li.project || "").filter(Boolean))].sort(), [editLineItemsState]);
  const editFilterMemoOptions = useMemo(() => [...new Set(editLineItemsState.map(li => li.client_memo || "").filter(Boolean))].sort(), [editLineItemsState]);

  const filteredEditLineItems = useMemo(() => {
    return editLineItemsState.filter((li) => {
      const vaOk = editFilterVANone ? false : (editFilterVAValues.size === 0 || editFilterVAValues.has(li.va_name || ""));
      const taskOk = editFilterTaskNone ? false : (editFilterTaskValues.size === 0 || editFilterTaskValues.has(li.description));
      const delivOk = editFilterDelivNone ? false : (editFilterDelivValues.size === 0 || editFilterDelivValues.has(li.project || ""));
      const memoOk = editFilterMemoNone ? false : (editFilterMemoValues.size === 0 || editFilterMemoValues.has(li.client_memo || ""));
      return vaOk && taskOk && delivOk && memoOk;
    });
  }, [editLineItemsState, editFilterVAValues, editFilterTaskValues, editFilterDelivValues, editFilterMemoValues, editFilterVANone, editFilterTaskNone, editFilterDelivNone, editFilterMemoNone]);

  const editTaskDescOptions = useMemo(() => [...new Set(editLineItemsState.map(li => li.description))].sort(), [editLineItemsState]);
  const getEditDelivOptions = useCallback((taskDesc: string) => {
    const fromEditItems = [...new Set(editLineItemsState.filter(li => li.description === taskDesc).map(li => li.project || "").filter(Boolean))];
    return [...new Set([...allProjectTags, ...fromEditItems])].sort();
  }, [editLineItemsState, allProjectTags]);

  const subtotal = useMemo(() => {
    return lineItems.reduce((sum, li) => sum + li.amount, 0);
  }, [lineItems]);

  const taxAmount = useMemo(() => {
    return subtotal * (taxRate / 100);
  }, [subtotal, taxRate]);

  const total = useMemo(() => {
    return subtotal + taxAmount;
  }, [subtotal, taxAmount]);

  /* ── Inline line item editor ──────────────────────────────── */

  const updateLineItem = (logId: number | null, idx: number, updates: Partial<LineItemDraft>) => {
    setLineItems((prev) =>
      prev.map((li, i) => (i === idx ? { ...li, ...updates } : li))
    );
  };

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

  /* ── Fetch billable logs for selected filter + date range ── */

  const fetchBillableLogs = async () => {
    if (generateBy === "client" && !selectedClientId) return;
    if (generateBy === "account" && !selectedAccount) return;
    if (!dateFrom || !dateTo) return;
    setLoadingLogs(true);

    // Only exclude log_ids from invoices that are sent/paid (not drafts/trash - those can be re-used)
    const { data: activeInvoices } = await supabase
      .from("invoices")
      .select("id")
      .in("status", ["sent", "paid", "partially_paid", "overdue", "ready_to_send"]);
    const activeInvoiceIds = new Set((activeInvoices ?? []).map((inv: { id: number }) => inv.id));

    const { data: existingItems } = await supabase
      .from("invoice_line_items")
      .select("log_id, invoice_id")
      .not("log_id", "is", null);

    const usedLogIds = new Set(
      (existingItems ?? [])
        .filter((item: { log_id: number | null; invoice_id: number }) => activeInvoiceIds.has(item.invoice_id))
        .map((item: { log_id: number | null; invoice_id: number }) => item.log_id)
    );

    // Build query based on generateBy mode
    let query = supabase
      .from("time_logs")
      .select("*")
      .eq("billable", true)
      .gte("start_time", new Date(dateFrom).toISOString())
      .lte("start_time", new Date(dateTo + "T23:59:59").toISOString())
      .order("start_time", { ascending: true });

    if (generateBy === "client") {
      const client = clients.find((c) => c.id === selectedClientId);
      if (!client) { setLoadingLogs(false); return; }
      query = query.eq("client_name", client.name);
    } else {
      query = query.eq("account", selectedAccount);
    }

    const { data: logs } = await query;
    const availableLogs = ((logs ?? []) as TimeLog[]).filter((l) => !usedLogIds.has(l.id));

    const items: LineItemDraft[] = availableLogs.map((log) => {
      const hours = log.duration_ms / 3600000;
      return {
        log_id: log.id,
        description: log.task_name,
        va_name: log.username,
        account_name: log.account || "",
        category: log.category,
        project: log.project || "",
        client_memo: log.client_memo || "",
        quantity: Math.round(hours * 100) / 100,
        unit_price: 0,
        amount: 0,
        service_date: new Date(log.start_time).toISOString().split("T")[0],
        start_time: log.start_time,
      };
    });

    setLineItems(items);

    // Fetch reimbursable unsettled expenses for this account/client
    let expQuery = supabase
      .from("financial_expenses")
      .select("id, description, amount, account, expense_date, notes")
      .eq("is_reimbursable", true)
      .eq("reimbursed", false);

    if (generateBy === "account") {
      expQuery = expQuery.eq("account", selectedAccount);
    } else {
      // Find all accounts linked to this client
      const linkedAccounts = Object.keys(accountToClientMap).filter(
        (acc) => accountToClientMap[acc] === selectedClientId
      );
      if (linkedAccounts.length > 0) {
        expQuery = expQuery.in("account", linkedAccounts);
      } else {
        setExpenseItems([]);
        setLoadingLogs(false);
        return;
      }
    }

    const { data: expData } = await expQuery;
    setExpenseItems(
      (expData ?? []).map((e: { id: number; description: string; amount: number; account: string | null; expense_date: string; notes: string | null }) => ({
        expense_id: e.id,
        description: e.description,
        amount: Number(e.amount),
        account: e.account,
        expense_date: e.expense_date,
        excluded: false,
        notes: e.notes || null,
      }))
    );

    setLoadingLogs(false);
  };

  /* ── Save invoice ─────────────────────────────────────────── */

  const handleSaveInvoice = async (sendNow: boolean) => {
    if (invoiceType === "timelog" && lineItems.length === 0) return;
    if (invoiceType === "custom" && !customItems.some(i => i.description && parseFloat(i.amount) > 0)) return;
    setSaving(true);

    const invoiceNumber = generateInvoiceNumber();
    const issueDate = new Date().toISOString().split("T")[0];
    const timeTotal = parseFloat(invoiceTotal) || 0;
    const expenseTotal = expenseItems.filter(e => !e.excluded).reduce((s, e) => s + e.amount, 0);
    const manualTotal = timeTotal + expenseTotal;
    const adjustment = parseFloat(adjustmentAmount) || 0;
    const finalTotal = manualTotal - adjustment;

    // Determine billing target (client or account)
    const billingClient = clients.find((c) => c.id === selectedClientId);
    const toName = billingClient?.name || selectedAccount || "Client";
    const toContact = billingClient?.contact_name || null;

    const invoiceData = {
      invoice_number: invoiceNumber,
      client_id: billingClient?.id || null,
      account_name: generateBy === "account" ? selectedAccount : (billingClient ? null : null),
      status: sendNow ? "sent" as const : "draft" as const,
      from_name: fromName || orgSettings?.registered_business_name || orgSettings?.org_name || "Toni Colina",
      from_phone: fromPhone || null,
      from_address: orgSettings?.address || null,
      from_email: replyToEmail || orgSettings?.billing_email || null,
      from_logo_url: orgSettings?.logo_url || null,
      to_name: toName,
      to_contact: toContact,
      to_email: billingEmail || null,
      to_phone: billingPhone || null,
      to_address: billingAddress || null,
      service_type: serviceType || null,
      issue_date: issueDate,
      due_date: null,
      subtotal: manualTotal,
      tax_rate: 0,
      tax_amount: 0,
      total: finalTotal,
      adjustment_amount: adjustment,
      currency: billingClient?.currency || "USD",
      notes: invoiceNotes || null,
      payment_link: paymentLink || null,
      payment_info: paymentInfo || null,
      reminder_enabled: reminderEnabled,
      payment_terms: null,
      sent_at: sendNow ? new Date().toISOString() : null,
      rate_amount: rateAmount ? parseFloat(rateAmount) : null,
      hours_not_billed: hoursNotBilled ? parseFloat(hoursNotBilled) : null,
      hours_not_billed_label: hoursNotBilled && hoursNotBilledLabel ? hoursNotBilledLabel : null,
      previous_balance: previousBalance ? parseFloat(previousBalance) : null,
      previous_balance_note: previousBalanceNote || null,
      invoice_type: invoiceType,
      custom_line_items: invoiceType === "custom" ? JSON.stringify(customItems.filter(i => i.description).map(i => ({ description: i.description, amount: parseFloat(i.amount) || 0 }))) : null,
      share_token: crypto.randomUUID(),
      period_start: dateFrom || null,
      period_end: dateTo || null,
      allow_custom_amount: createAllowCustomAmount,
      payment_schedule: createSchedule.length > 0 ? createSchedule : null,
      payment_template_id: createTemplateId,
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

    // Only insert time log line items for timelog invoices
    if (invoiceType === "timelog") {
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
        unit_price: 0,
        amount: 0,
        service_date: li.service_date || null,
        start_time: li.start_time || null,
        sort_order: idx,
      }));

      await supabase.from("invoice_line_items").insert(lineItemsData);

      // Apply On Hold overrides to time_logs (reassign account/client for removed items)
      for (const [idx, override] of removedItemOverrides.entries()) {
        const li = removedLineItems[idx];
        if (li?.log_id && (override.account || override.client)) {
          const updateFields: Record<string, string> = {};
          if (override.account) updateFields.account = override.account;
          if (override.client) updateFields.client_name = override.client;
          await supabase.from("time_logs").update(updateFields).eq("id", li.log_id);
        }
      }
    }

    // Insert expense line items (non-excluded only)
    const includedExpenses = expenseItems.filter(e => !e.excluded);
    if (includedExpenses.length > 0) {
      const sortOffset = lineItems.length;
      const expenseLineItemsData = includedExpenses.map((exp, idx) => ({
        invoice_id: newInvoice.id,
        log_id: null,
        expense_id: exp.expense_id,
        description: exp.description,
        va_name: null,
        account_name: exp.account || null,
        category: "expense",
        project: null,
        client_memo: exp.notes || null,
        quantity: 1,
        unit_price: exp.amount,
        amount: exp.amount,
        service_date: exp.expense_date || null,
        start_time: null,
        sort_order: sortOffset + idx,
      }));
      await supabase.from("invoice_line_items").insert(expenseLineItemsData);
    }

    // If sending now, fire email
    if (sendNow && billingEmail) {
      try {
        await fetch("/api/invoices/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invoice_id: newInvoice.id }),
        });
      } catch {
        // Email failed but invoice saved
      }
    }

    setSaving(false);

    // Reset create form
    setSelectedClientId(null);
    setSelectedAccount("");
    setDateFrom("");
    setDateTo("");
    setLineItems([]);
    setUndoStack([]);
    setInvoiceTotal("");
    setAdjustmentAmount("0");
    setServiceType("");
    setPaymentLink("");
    setReminderEnabled(false);
    setInvoiceNotes("");
    setHoursNotBilled("");
    setHoursNotBilledLabel("Volunteer");
    setRateAmount("");
    setPreviousBalance("");
    setFilterVAValues(new Set<string>());
    setFilterTaskValues(new Set<string>());
    setFilterDelivValues(new Set<string>());
    setFilterMemoValues(new Set<string>());
    setOpenFilterPanel(null);
    setFilterPanelSearch("");
    setCustomEditCell(null);
    setRemovedLineItems([]);
    setRemovedItemOverrides(new Map());
    setInvoiceType("timelog");
    setCustomItems([{ id: "ci-1", description: "", amount: "" }]);
    setExpenseItems([]);

    await fetchInvoices();

    if (!sendNow) {
      // Navigate to detail view so Toni can preview the invoice
      await openInvoiceDetail(newInvoice as unknown as Invoice);
    } else {
      setView("list");
    }
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
      from_email: replyToEmail || orgSettings?.billing_email || null,
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
      payment_info: paymentInfo || null,
      payment_terms: selectedClient.payment_terms || "net_30",
      is_manual: true,
      share_token: crypto.randomUUID(),
      allow_custom_amount: createAllowCustomAmount,
      payment_schedule: createSchedule.length > 0 ? createSchedule : null,
      payment_template_id: createTemplateId,
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
      setPaymentError(error.message || "Failed to save payment. Please try again.");
      setSavingPayment(false);
      return;
    }
    setPaymentError("");

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

    // Sync to financial_payments
    await supabase.from("financial_payments").insert({
      account: selectedInvoice.account_name || null,
      client_name: selectedInvoice.to_name || null,
      amount: amt,
      payment_date: paymentDate,
      payment_method: paymentMethod || null,
      confirmation_number: paymentRef || null,
      notes: `Invoice #${selectedInvoice.invoice_number}${paymentNotes ? ` — ${paymentNotes}` : ""}`,
    });

    // Refresh payments list
    const { data: payments } = await supabase
      .from("invoice_payments")
      .select("*")
      .eq("invoice_id", selectedInvoice.id)
      .order("payment_date", { ascending: false });
    setInvoicePayments((payments ?? []) as InvoicePayment[]);

    // Send receipt email to client (fire-and-forget)
    if (selectedInvoice.to_email) {
      fetch("/api/invoices/send-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: selectedInvoice.id,
          amountPaid: amt,
          newAmountPaid,
          newStatus,
        }),
      }).catch(() => {/* non-fatal */});
    }

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
    setEditingInvoice(false);

    // Init edit fields
    setEditSubtotal(String(invoice.subtotal ?? ""));
    setEditAdjustment(String(invoice.adjustment_amount ?? "0"));
    setEditPaymentLink(invoice.payment_link ?? "");
    setEditPaymentInfo(invoice.payment_info ?? DEFAULT_PAYMENT_INFO);
    setEditFromName(invoice.from_name ?? "");
    setEditFromPhone(invoice.from_phone ?? "");
    setEditReplyToEmail(invoice.from_email ?? "");
    setEditNotes(invoice.notes ?? "");
    setEditDueDate(invoice.due_date ?? "");
    setEditReminderEnabled(invoice.reminder_enabled ?? false);
    setEditAccountName(invoice.account_name ?? "");
    const clientEmail = invoice.to_email || clients.find((c) => c.id === invoice.client_id)?.email || "";
    setSendToEmail(clientEmail);
    setRateAmount(invoice.rate_amount != null ? String(invoice.rate_amount) : "");
    setHoursNotBilled(invoice.hours_not_billed != null ? String(invoice.hours_not_billed) : "");
    setHoursNotBilledLabel(invoice.hours_not_billed_label || "Volunteer");
    setEditPreviousBalance(invoice.previous_balance != null ? String(invoice.previous_balance) : "");
    setEditPreviousBalanceNote(invoice.previous_balance_note ?? "");
    setEditAllowCustomAmount(invoice.allow_custom_amount ?? true);
    setEditTemplateId(invoice.payment_template_id ?? null);
    setEditSchedule((invoice.payment_schedule ?? []) as PaymentScheduleItem[]);

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

    const items = (lineItemsRes.data ?? []) as InvoiceLineItem[];
    setSelectedLineItems(items);
    setEditLineItemsState(items);

    // Fetch settled status for any expense line items
    const expIds = items.filter((li) => li.expense_id).map((li) => li.expense_id as number);
    if (expIds.length > 0) {
      const { data: expData } = await supabase
        .from("financial_expenses")
        .select("id, reimbursed")
        .in("id", expIds);
      setExpenseSettledMap(
        Object.fromEntries((expData ?? []).map((e: { id: number; reimbursed: boolean }) => [e.id, e.reimbursed]))
      );
    } else {
      setExpenseSettledMap({});
    }
    setRemovedEditItems([]);
    setEditUndoStack([]);
    setEditFilterVAValues(new Set<string>());
    setEditFilterTaskValues(new Set<string>());
    setEditFilterDelivValues(new Set<string>());
    setEditFilterMemoValues(new Set<string>());
    setEditOpenFilterPanel(null);
    setEditFilterSearch("");
    setEditCustomCell(null);
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
        body: JSON.stringify({
          invoice_id: invoice.id,
          ...(sendToEmail && sendToEmail !== invoice.to_email ? { override_email: sendToEmail } : {}),
          ...(sendCcEmail.trim() ? { cc_emails: sendCcEmail } : {}),
        }),
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

  /* ── Send reminder email ──────────────────────────────────── */

  const handleSendReminder = async (invoice: Invoice) => {
    if (!invoice.to_email) return;
    setSendingReminder(invoice.id);
    setReminderSuccess("");
    setSendError("");

    try {
      const res = await fetch("/api/invoices/remind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_id: invoice.id }),
      });

      if (!res.ok) {
        const data = await res.json();
        setSendError(data.error || "Failed to send reminder");
      } else {
        setReminderSuccess("Reminder sent!");
        setTimeout(() => setReminderSuccess(""), 3000);
      }
    } catch {
      setSendError("Failed to send reminder");
    }

    setSendingReminder(null);
  };

  /* ── Mark as Ready to Send ────────────────────────────────── */
  const handleMarkReadyToSend = async (invoice: Invoice) => {
    await supabase
      .from("invoices")
      .update({ status: "ready_to_send" as Invoice["status"] })
      .eq("id", invoice.id);
    setSelectedInvoice((prev) => prev ? { ...prev, status: "ready_to_send" as Invoice["status"] } : null);
    fetchInvoices();
  };

  const handleRevertToDraft = async (invoice: Invoice) => {
    await supabase
      .from("invoices")
      .update({ status: "draft" as Invoice["status"] })
      .eq("id", invoice.id);
    setSelectedInvoice((prev) => prev ? { ...prev, status: "draft" as Invoice["status"] } : null);
    fetchInvoices();
  };

  /* ── Toggle reminder directly (no Edit form needed) ─────── */

  const handleToggleReminderDirect = async (inv: Invoice) => {
    const newValue = !inv.reminder_enabled;
    await supabase.from("invoices").update({ reminder_enabled: newValue }).eq("id", inv.id);
    const updated = { ...inv, reminder_enabled: newValue };
    setSelectedInvoice(updated);
    setInvoices((prev) => prev.map((i) => (i.id === inv.id ? updated : i)));
  };

  /* ── Update invoice fields ────────────────────────────────── */

  const handleUpdateInvoice = async () => {
    if (!selectedInvoice) return;
    setSavingEdit(true);

    const subtotal = parseFloat(editSubtotal) || Number(selectedInvoice.subtotal);
    const adjustment = parseFloat(editAdjustment) || 0;
    const total = subtotal - adjustment;

    const updateData: Record<string, unknown> = {
      subtotal,
      adjustment_amount: adjustment,
      total,
      payment_link: editPaymentLink || null,
      payment_info: editPaymentInfo || null,
      from_name: editFromName || selectedInvoice.from_name,
      from_email: editReplyToEmail || selectedInvoice.from_email || null,
      from_phone: editFromPhone || null,
      notes: editNotes || null,
      reminder_enabled: editReminderEnabled,
      account_name: editAccountName || null,
      rate_amount: rateAmount ? parseFloat(rateAmount) : null,
      hours_not_billed: hoursNotBilled ? parseFloat(hoursNotBilled) : null,
      hours_not_billed_label: hoursNotBilled && hoursNotBilledLabel ? hoursNotBilledLabel : null,
      previous_balance: editPreviousBalance ? parseFloat(editPreviousBalance) : null,
      previous_balance_note: editPreviousBalanceNote || null,
      service_type: serviceType || null,
      to_name: editToName || selectedInvoice.to_name,
      to_email: editToEmail || null,
      to_phone: editToPhone || null,
      to_address: editToAddress || null,
      allow_custom_amount: editAllowCustomAmount,
      payment_schedule: editSchedule.length > 0 ? editSchedule : null,
      payment_template_id: editTemplateId,
    };
    if (editDueDate) updateData.due_date = editDueDate;

    await supabase.from("invoices").update(updateData).eq("id", selectedInvoice.id);

    // Save line item changes
    for (const li of editLineItemsState) {
      await supabase.from("invoice_line_items").update({
        description: li.description,
        project: li.project,
        client_memo: li.client_memo,
        va_name: li.va_name,
      }).eq("id", li.id);
    }
    // Remove line items that were deleted
    for (const li of removedEditItems) {
      await supabase.from("invoice_line_items").delete().eq("id", li.id);
    }
    // Apply On Hold overrides to time_logs (reassign account/client for removed items)
    for (const [idx, override] of removedEditOverrides.entries()) {
      const li = removedEditItems[idx];
      if (li?.log_id && (override.account || override.client)) {
        const updateFields: Record<string, string> = {};
        if (override.account) updateFields.account = override.account;
        if (override.client) updateFields.client_name = override.client;
        await supabase.from("time_logs").update(updateFields).eq("id", li.log_id);
      }
    }
    // Refresh selectedLineItems
    const { data: refreshedItems } = await supabase
      .from("invoice_line_items")
      .select("*")
      .eq("invoice_id", selectedInvoice.id)
      .order("sort_order", { ascending: true });
    const refreshed = (refreshedItems ?? []) as InvoiceLineItem[];
    setSelectedLineItems(refreshed);
    setEditLineItemsState(refreshed);
    setRemovedEditItems([]);
    setRemovedEditOverrides(new Map());

    setSelectedInvoice((prev) =>
      prev
        ? {
            ...prev,
            subtotal,
            adjustment_amount: adjustment,
            total,
            payment_link: editPaymentLink || null,
            from_name: editFromName || prev.from_name,
            notes: editNotes || null,
            due_date: editDueDate || prev.due_date,
            account_name: editAccountName || null,
            rate_amount: rateAmount ? parseFloat(rateAmount) : null,
            hours_not_billed: hoursNotBilled ? parseFloat(hoursNotBilled) : null,
            hours_not_billed_label: hoursNotBilled && hoursNotBilledLabel ? hoursNotBilledLabel : null,
            previous_balance: editPreviousBalance ? parseFloat(editPreviousBalance) : null,
            previous_balance_note: editPreviousBalanceNote || null,
            service_type: serviceType || null,
            to_name: editToName || prev.to_name,
            to_email: editToEmail || null,
            to_phone: editToPhone || null,
            to_address: editToAddress || null,
          }
        : null
    );

    setEditingInvoice(false);
    setSavingEdit(false);
    fetchInvoices();
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

      // Sync to financial_payments
      await supabase.from("financial_payments").insert({
        account: invoice.account_name || null,
        client_name: invoice.to_name || null,
        amount: remaining,
        payment_date: new Date().toISOString().split("T")[0],
        payment_method: null,
        confirmation_number: null,
        notes: `Invoice #${invoice.invoice_number} — Marked as fully paid`,
      });
    }

    setSelectedInvoice((prev) =>
      prev ? { ...prev, status: "paid" as const, paid_date: new Date().toISOString().split("T")[0], amount_paid: invoiceTotal } : null
    );
    fetchInvoices();
  };

  /* ── Mark as unpaid (reverse paid status) ────────────────── */

  const handleMarkUnpaid = async (invoice: Invoice) => {
    await supabase
      .from("invoices")
      .update({
        status: "sent" as const,
        paid_date: null,
        amount_paid: 0,
      })
      .eq("id", invoice.id);
    setSelectedInvoice((prev) =>
      prev ? { ...prev, status: "sent" as const, paid_date: null, amount_paid: 0 } : null
    );
    fetchInvoices();
  };

  /* ── Trash invoice (soft delete) ─────────────────────────── */

  const handleTrashInvoice = async (invoice: Invoice) => {
    await supabase
      .from("invoices")
      .update({ status: "trash" as const })
      .eq("id", invoice.id);
    fetchInvoices();
  };

  const handleRestoreInvoice = async (invoice: Invoice) => {
    await supabase
      .from("invoices")
      .update({ status: "draft" as const })
      .eq("id", invoice.id);
    fetchInvoices();
    setStatusFilter("draft");
  };

  const handlePermanentDelete = async (invoice: Invoice) => {
    if (!confirm(`Permanently delete invoice ${invoice.invoice_number}? This cannot be undone.`)) return;
    await supabase.from("invoice_line_items").delete().eq("invoice_id", invoice.id);
    await supabase.from("invoice_payments").delete().eq("invoice_id", invoice.id);
    await supabase.from("invoices").delete().eq("id", invoice.id);
    fetchInvoices();
  };

  /* ── Save draft early (no line items required) ────────────── */

  const handleSaveDraft = async () => {
    if (!selectedClientId && !selectedAccount) return;
    setSaving(true);

    const invoiceNumber = generateInvoiceNumber();
    const issueDate = new Date().toISOString().split("T")[0];
    const manualTotal = parseFloat(invoiceTotal) || 0;
    const adjustment = parseFloat(adjustmentAmount) || 0;
    const finalTotal = manualTotal - adjustment;

    const billingClient = clients.find((c) => c.id === selectedClientId);
    const toName = billingClient?.name || selectedAccount || "Client";

    const invoiceData = {
      invoice_number: invoiceNumber,
      client_id: billingClient?.id || null,
      account_name: generateBy === "account" ? selectedAccount : null,
      status: "draft" as const,
      from_name: fromName || orgSettings?.registered_business_name || orgSettings?.org_name || "MinuteFlow",
      from_phone: fromPhone || null,
      from_address: orgSettings?.address || null,
      from_email: replyToEmail || orgSettings?.billing_email || null,
      from_logo_url: orgSettings?.logo_url || null,
      to_name: toName,
      to_contact: billingClient?.contact_name || null,
      to_email: billingClient?.email || null,
      to_phone: billingClient?.phone || null,
      to_address: billingClient
        ? [billingClient.address, billingClient.city, billingClient.state, billingClient.zip, billingClient.country].filter(Boolean).join(", ") || null
        : null,
      service_type: serviceType || null,
      issue_date: issueDate,
      due_date: null,
      subtotal: manualTotal,
      tax_rate: 0,
      tax_amount: 0,
      total: finalTotal,
      adjustment_amount: adjustment,
      currency: billingClient?.currency || "USD",
      notes: invoiceNotes || null,
      payment_link: paymentLink || null,
      payment_info: paymentInfo || null,
      reminder_enabled: reminderEnabled,
      payment_terms: null,
      sent_at: null,
      rate_amount: rateAmount ? parseFloat(rateAmount) : null,
      hours_not_billed: hoursNotBilled ? parseFloat(hoursNotBilled) : null,
      hours_not_billed_label: hoursNotBilled && hoursNotBilledLabel ? hoursNotBilledLabel : null,
      previous_balance: previousBalance ? parseFloat(previousBalance) : null,
      previous_balance_note: previousBalanceNote || null,
      share_token: crypto.randomUUID(),
      period_start: dateFrom || null,
      period_end: dateTo || null,
      allow_custom_amount: createAllowCustomAmount,
      payment_schedule: createSchedule.length > 0 ? createSchedule : null,
      payment_template_id: createTemplateId,
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

    // Save line items if any exist
    if (lineItems.length > 0) {
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
        unit_price: 0,
        amount: 0,
        service_date: li.service_date || null,
        sort_order: idx,
      }));
      await supabase.from("invoice_line_items").insert(lineItemsData);
    }

    setRemovedLineItems([]);
    setSaving(false);
    await fetchInvoices();
    await openInvoiceDetail(newInvoice as unknown as Invoice);
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
      trash: { bg: "bg-red-50", text: "text-red-400" },
      ready_to_send: { bg: "bg-amber-soft", text: "text-amber" },
    };
    const s = styles[status] || styles.draft;
    return `${s.bg} ${s.text}`;
  };

  const statusLabel = (status: Invoice["status"]) => {
    if (status === "partially_paid") return "Partial";
    if (status === "trash") return "Trash";
    if (status === "ready_to_send") return "Ready to Send";
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
    const canFetch = dateFrom && dateTo && (
      (generateBy === "client" && selectedClientId) ||
      (generateBy === "account" && selectedAccount)
    );
    const manualTotalNum = parseFloat(invoiceTotal) || 0;
    const adjustmentNum = parseFloat(adjustmentAmount) || 0;
    const finalTotal = manualTotalNum - adjustmentNum;
    const totalHours = lineItems.reduce((sum, li) => sum + li.quantity, 0);
    const filteredHours = filteredLineItems.reduce((sum, li) => sum + li.quantity, 0);
    const isFiltered = filteredLineItems.length !== lineItems.length;

    return (
      <>
        <div className="mb-4 flex items-center justify-between">
          <button
            onClick={() => { setView("list"); setLineItems([]); setSelectedClientId(null); setSelectedAccount(""); setInvoiceTotal(""); setAdjustmentAmount("0"); }}
            className="flex items-center gap-1.5 text-[13px] font-medium text-bark transition-colors hover:text-terracotta cursor-pointer"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back to Invoices
          </button>
          {(selectedClientId || selectedAccount) && (
            <button
              onClick={handleSaveDraft}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg border border-sand px-3.5 py-2 text-[13px] font-semibold text-bark transition-all hover:border-terracotta hover:text-terracotta disabled:opacity-50 cursor-pointer"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
              {saving ? "Saving..." : "Save Draft"}
            </button>
          )}
        </div>

        <div className="rounded-xl border border-sand bg-white p-6">
          <h3 className="mb-4 font-serif text-lg font-bold text-espresso">Generate New Invoice</h3>

          {/* Invoice Type Toggle */}
          <div className="mb-6 flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-bark mr-2">Type:</span>
            <button onClick={() => { setInvoiceType("timelog"); setExpenseItems([]); }} className={`rounded-lg px-4 py-2 text-[13px] font-semibold transition-all cursor-pointer ${invoiceType === "timelog" ? "bg-terracotta text-white" : "border border-sand text-bark hover:border-terracotta hover:text-terracotta"}`}>Time Log Based</button>
            <button onClick={() => { setInvoiceType("custom"); setExpenseItems([]); setSelectedClientId(null); setBillingEmail(""); setBillingPhone(""); setBillingAddress(""); }} className={`rounded-lg px-4 py-2 text-[13px] font-semibold transition-all cursor-pointer ${invoiceType === "custom" ? "bg-terracotta text-white" : "border border-sand text-bark hover:border-terracotta hover:text-terracotta"}`}>Custom Invoice</button>
          </div>

          {/* Step 1: Filter By — timelog only */}
          {invoiceType === "timelog" && (<>

          {/* Step 1: Filter By */}
          <div className="mb-6">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-bark">
              Step 1: Filter Time Logs By
            </label>
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => { setGenerateBy("client"); setSelectedAccount(""); setLineItems([]); }}
                className={`rounded-lg px-4 py-2 text-[13px] font-semibold transition-all cursor-pointer ${generateBy === "client" ? "bg-terracotta text-white" : "border border-sand text-bark hover:border-terracotta hover:text-terracotta"}`}
              >
                By Client
              </button>
              <button
                onClick={() => { setGenerateBy("account"); setSelectedClientId(null); setLineItems([]); }}
                className={`rounded-lg px-4 py-2 text-[13px] font-semibold transition-all cursor-pointer ${generateBy === "account" ? "bg-terracotta text-white" : "border border-sand text-bark hover:border-terracotta hover:text-terracotta"}`}
              >
                By Account
              </button>
            </div>

            {generateBy === "client" ? (
              <select
                value={selectedClientId ?? ""}
                onChange={(e) => { setSelectedClientId(e.target.value ? Number(e.target.value) : null); setLineItems([]); }}
                className="w-full max-w-xs rounded-lg border border-sand bg-parchment px-3 py-2.5 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta cursor-pointer"
              >
                <option value="">Choose a client...</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            ) : (
              <div className="flex flex-wrap gap-4">
                <select
                  value={selectedAccount}
                  onChange={(e) => { setSelectedAccount(e.target.value); setLineItems([]); }}
                  className="w-full max-w-xs rounded-lg border border-sand bg-parchment px-3 py-2.5 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta cursor-pointer"
                >
                  <option value="">Choose an account...</option>
                  {accountList.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-bark">Bill To (optional)</label>
                  <select
                    value={selectedClientId ?? ""}
                    onChange={(e) => setSelectedClientId(e.target.value ? Number(e.target.value) : null)}
                    className="w-full max-w-xs rounded-lg border border-sand bg-parchment px-3 py-2.5 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta cursor-pointer"
                  >
                    <option value="">Choose billing client...</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Step 2: Date Range */}
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
                disabled={!canFetch}
                className="rounded-lg bg-terracotta px-4 py-2.5 text-[13px] font-semibold text-white transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {loadingLogs ? "Loading..." : "Fetch Time Logs"}
              </button>
            </div>
          </div>
          </>)}

          {/* Custom Invoice: Bill To selector */}
          {invoiceType === "custom" && (
            <div className="mb-6">
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-bark">Bill To (Client)</label>
              <select value={selectedClientId ?? ""} onChange={(e) => { setSelectedClientId(e.target.value ? Number(e.target.value) : null); setExpenseItems([]); }} className="w-full max-w-xs rounded-lg border border-sand bg-parchment px-3 py-2.5 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta cursor-pointer">
                <option value="">Choose a client...</option>
                {clients.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </select>
            </div>
          )}

          {/* Bill To Contact Info — shown when a client is selected */}
          {selectedClientId && (
            <div className="mb-6 rounded-lg border border-sand bg-parchment/40 p-4">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-bark">Bill To Info</div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-medium text-bark/70">Client Email</label>
                  <input
                    type="email"
                    value={billingEmail}
                    onChange={(e) => setBillingEmail(e.target.value)}
                    placeholder="client@email.com"
                    className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[12px] text-espresso outline-none transition-colors focus:border-terracotta placeholder:text-stone"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-medium text-bark/70">Client Phone</label>
                  <input
                    type="text"
                    value={billingPhone}
                    onChange={(e) => setBillingPhone(e.target.value)}
                    placeholder="+1 (555) 000-0000"
                    className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[12px] text-espresso outline-none transition-colors focus:border-terracotta placeholder:text-stone"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-medium text-bark/70">Client Address</label>
                  <input
                    type="text"
                    value={billingAddress}
                    onChange={(e) => setBillingAddress(e.target.value)}
                    placeholder="123 Main St, City, State"
                    className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[12px] text-espresso outline-none transition-colors focus:border-terracotta placeholder:text-stone"
                  />
                </div>
              </div>
              <p className="mt-2 text-[10px] text-bark/50">These appear on the BILL TO section of the invoice. To save permanently, update the client record in the Clients tab.</p>
            </div>
          )}

          {/* Info Fields + Invoice Summary — always visible */}
          <div className="mt-5 grid grid-cols-2 gap-6">
            <div className="space-y-4">
              {/* Type of Services */}
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Type of Services</label>
                <input
                  type="text"
                  value={serviceType}
                  onChange={(e) => setServiceType(e.target.value)}
                  placeholder="e.g. Virtual Assistant Services"
                  className="w-full rounded-lg border border-sand bg-parchment px-3 py-2.5 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta placeholder:text-stone"
                />
              </div>
              {/* Sender info */}
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Sender Name</label>
                <input
                  type="text"
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                  placeholder="e.g. Toni Colina"
                  className="w-full rounded-lg border border-sand bg-parchment px-3 py-2.5 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta placeholder:text-stone"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Sender Phone</label>
                <input
                  type="text"
                  value={fromPhone}
                  onChange={(e) => setFromPhone(e.target.value)}
                  placeholder="e.g. +1 (555) 000-0000"
                  className="w-full rounded-lg border border-sand bg-parchment px-3 py-2.5 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta placeholder:text-stone"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Payment Link</label>
                <input
                  type="url"
                  value={paymentLink}
                  onChange={(e) => setPaymentLink(e.target.value)}
                  placeholder="https://..."
                  className="w-full rounded-lg border border-sand bg-parchment px-3 py-2.5 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta placeholder:text-stone"
                />
                {paymentLink && (
                  <p className="mt-1 text-[11px] text-bark/60">Note: A card processing fee (3%) applies to card payments.</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Payment Method Info</label>
                <textarea
                  value={paymentInfo}
                  onChange={(e) => setPaymentInfo(e.target.value)}
                  placeholder="e.g. Zelle: yourname@email.com&#10;PayPal: @yourhandle&#10;Bank Transfer: Account #1234"
                  className="w-full rounded-lg border border-sand bg-parchment px-3 py-2.5 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta placeholder:text-stone resize-none"
                  rows={3}
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Reply-To Email</label>
                <input
                  type="email"
                  value={replyToEmail}
                  onChange={(e) => setReplyToEmail(e.target.value)}
                  placeholder="replies@youremail.com"
                  className="w-full rounded-lg border border-sand bg-parchment px-3 py-2.5 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta placeholder:text-stone"
                />
                <p className="mt-1 text-[11px] text-bark/60">If different from your main email. Replies to this invoice will go here.</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setReminderEnabled(!reminderEnabled)}
                  className={`relative h-6 w-11 rounded-full transition-colors cursor-pointer overflow-hidden ${reminderEnabled ? "bg-terracotta" : "bg-clay"}`}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${reminderEnabled ? "translate-x-5" : "translate-x-0.5"}`} />
                </button>
                <span className="text-[13px] text-bark">Daily reminder email (includes payment link)</span>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Notes</label>
                <textarea
                  value={invoiceNotes}
                  onChange={(e) => setInvoiceNotes(e.target.value)}
                  placeholder="Payment instructions, Zelle info, etc."
                  className="w-full rounded-lg border border-sand bg-parchment px-3 py-2.5 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta placeholder:text-stone resize-none"
                  rows={3}
                />
              </div>
              {/* ── Split Payment Schedule ──────────────────────── */}
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Split Payment Schedule</label>
                <p className="mb-3 text-[11px] text-bark/60">Set up installment amounts and due dates. Clients will see a &ldquo;Split Payment Option&rdquo; button on their invoice. Leave empty to skip.</p>
                {/* Template picker */}
                {invoiceTemplates.length > 0 && (
                  <div className="mb-3">
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-bark/70">Apply Template</label>
                    <select
                      value={createTemplateId ?? ""}
                      onChange={(e) => {
                        const id = e.target.value ? Number(e.target.value) : null;
                        setCreateTemplateId(id);
                        const tpl = invoiceTemplates.find(t => t.id === id);
                        setCreateSchedule(tpl ? tpl.items.map(i => ({ ...i })) : []);
                      }}
                      className="w-full rounded-lg border border-sand bg-parchment px-3 py-2.5 text-[13px] text-espresso outline-none focus:border-terracotta"
                    >
                      <option value="">— No template —</option>
                      {invoiceTemplates.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {/* Schedule items */}
                {createSchedule.length > 0 && (
                  <div className="mb-3 space-y-2">
                    {createSchedule.map((item, idx) => (
                      <div key={idx} className="flex gap-2 items-center">
                        <span className="text-[11px] text-bark/60 whitespace-nowrap w-16 shrink-0">Inst. {idx + 1}</span>
                        <span className="text-[12px] text-bark shrink-0">$</span>
                        <input
                          type="number"
                          value={item.value}
                          onChange={(e) => setCreateSchedule(prev => prev.map((s, i) => i === idx ? { ...s, value: parseFloat(e.target.value) || 0, label: `Installment ${i + 1}`, amount_type: 'fixed' as const } : s))}
                          placeholder="300.00"
                          className="w-24 rounded-lg border border-sand bg-parchment px-3 py-2 text-[12px] text-espresso outline-none focus:border-terracotta"
                        />
                        <span className="text-[11px] text-bark/60 shrink-0">Due:</span>
                        <input
                          type="date"
                          value={(item as PaymentScheduleItem & { due_date?: string }).due_date || ''}
                          onChange={(e) => setCreateSchedule(prev => prev.map((s, i) => i === idx ? { ...s, due_date: e.target.value } : s))}
                          className="flex-1 rounded-lg border border-sand bg-parchment px-3 py-2 text-[12px] text-espresso outline-none focus:border-terracotta"
                        />
                        <button onClick={() => setCreateSchedule(prev => prev.filter((_, i) => i !== idx))} className="text-bark/40 hover:text-terracotta text-[16px] leading-none">×</button>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setCreateSchedule(prev => [...prev, { label: `Installment ${prev.length + 1}`, amount_type: 'fixed' as const, value: 0, due_date: '' } as PaymentScheduleItem & { due_date?: string }])}
                  className="text-[11px] font-semibold text-terracotta hover:underline"
                >
                  + Add Installment
                </button>
                {/* Allow custom amount toggle */}
                <div className="flex items-center gap-3 mt-3">
                  <button
                    type="button"
                    onClick={() => setCreateAllowCustomAmount(v => !v)}
                    className={`relative h-6 w-11 rounded-full transition-colors cursor-pointer overflow-hidden ${createAllowCustomAmount ? "bg-terracotta" : "bg-clay"}`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${createAllowCustomAmount ? "translate-x-5" : "translate-x-0.5"}`} />
                  </button>
                  <span className="text-[13px] text-bark">Allow client to enter custom amount</span>
                </div>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-bark">Invoice Summary</label>
              <div className="rounded-lg border border-sand bg-parchment/30 p-5 space-y-3">
                {/* Rate + hours — timelog only */}
                {invoiceType === "timelog" && (<>
                {/* Rate */}
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-bark">Rate ($/hr)</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={rateAmount}
                    onChange={(e) => {
                      const v = e.target.value;
                      setRateAmount(v);
                      const rate = parseFloat(v) || 0;
                      if (rate > 0) {
                        const gross = lineItems.reduce((s, li) => s + li.quantity, 0);
                        const notBilled = parseFloat(hoursNotBilled) || 0;
                        setInvoiceTotal((gross * rate).toFixed(2));
                        setAdjustmentAmount((notBilled * rate).toFixed(2));
                      }
                    }}
                    placeholder="e.g. 25.00"
                    className="w-28 rounded border border-sand px-2 py-1.5 text-right text-[12px] text-espresso outline-none focus:border-terracotta bg-white"
                  />
                </div>
                {/* Gross Hours */}
                <div className="flex justify-between text-[12px]">
                  <span className="text-bark">Gross Hours</span>
                  <span className="font-medium text-espresso">{totalHours.toFixed(2)} hrs</span>
                </div>
                {/* Hours Not Billed */}
                <div className="flex items-center justify-between gap-2 text-[12px]">
                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-bark whitespace-nowrap">Hours Not Billed</span>
                    <input
                      type="text"
                      value={hoursNotBilledLabel}
                      onChange={(e) => setHoursNotBilledLabel(e.target.value)}
                      placeholder="Label (e.g. Volunteer)"
                      className="flex-1 rounded border border-sand px-2 py-1.5 text-[11px] text-espresso outline-none focus:border-terracotta bg-white placeholder:text-stone"
                    />
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={hoursNotBilled}
                    onChange={(e) => {
                      const v = e.target.value;
                      setHoursNotBilled(v);
                      const rate = parseFloat(rateAmount) || 0;
                      if (rate > 0) {
                        const gross = lineItems.reduce((s, li) => s + li.quantity, 0);
                        const notBilled = parseFloat(v) || 0;
                        setInvoiceTotal((gross * rate).toFixed(2));
                        setAdjustmentAmount((notBilled * rate).toFixed(2));
                      }
                    }}
                    placeholder="0.00"
                    className="w-24 rounded border border-sand px-2 py-1.5 text-right text-[12px] text-espresso outline-none focus:border-terracotta bg-white"
                  />
                </div>
                {/* Total Hours Billed */}
                <div className="flex justify-between text-[12px]">
                  <span className="text-bark">Total Hours Billed</span>
                  <span className="font-medium text-espresso">
                    {(totalHours - (parseFloat(hoursNotBilled) || 0)).toFixed(2)} hrs
                  </span>
                </div>
                {/* Invoice Amount */}
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-bark">Invoice Amount ($)</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={invoiceTotal}
                    onChange={(e) => setInvoiceTotal(e.target.value)}
                    placeholder="0.00"
                    className="w-28 rounded border border-sand px-2 py-1.5 text-right text-[12px] font-semibold text-espresso outline-none focus:border-terracotta bg-white"
                  />
                </div>
                </>)}
                {/* Custom type: Subtotal from line items */}
                {invoiceType === "custom" && (
                  <div className="flex justify-between text-[12px]">
                    <span className="text-bark">Subtotal</span>
                    <span className="font-medium text-espresso">{formatCurrency(customItems.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0))}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-bark">Savings ($)</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={adjustmentAmount}
                    onChange={(e) => setAdjustmentAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-28 rounded border border-sand px-2 py-1.5 text-right text-[12px] text-espresso outline-none focus:border-terracotta bg-white"
                  />
                </div>
                <div className="flex justify-between border-t border-sand pt-2 text-[14px]">
                  <span className="font-bold text-espresso">Final Invoice Amount</span>
                  <span className="font-bold text-terracotta">{formatCurrency(finalTotal)}</span>
                </div>
                {/* Previous Balance */}
                <div className="flex items-center justify-between text-[12px] mt-2">
                  <span className="text-bark">Previous Balance ($)</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={previousBalance}
                    onChange={(e) => setPreviousBalance(e.target.value)}
                    placeholder="0.00"
                    className="w-28 rounded border border-sand px-2 py-1.5 text-right text-[12px] text-espresso outline-none focus:border-terracotta bg-white"
                  />
                </div>
                {parseFloat(previousBalance) > 0 && (
                  <div className="mt-1 text-[11px] text-bark">
                    <input
                      type="text"
                      value={previousBalanceNote}
                      onChange={(e) => setPreviousBalanceNote(e.target.value)}
                      placeholder="Note for client (e.g. Balance carried over from Invoice #12)"
                      className="w-full rounded border border-sand px-2 py-1.5 text-[11px] text-espresso outline-none focus:border-terracotta bg-white"
                    />
                  </div>
                )}
                {parseFloat(previousBalance) > 0 && (
                  <div className="flex justify-between border-t border-sand pt-2 text-[13px]">
                    <span className="font-bold text-espresso">Current Balance Due</span>
                    <span className="font-bold text-terracotta">{formatCurrency(finalTotal + (parseFloat(previousBalance) || 0))}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Step 3: Review Time Logs — timelog only */}
          {invoiceType === "timelog" && lineItems.length > 0 && (
            <div className="mb-6">
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-bark">
                  Step 3: Review Time Logs ({isFiltered ? `${filteredLineItems.length} of ` : ""}{lineItems.length} entries · {isFiltered ? `${filteredHours.toFixed(2)} of ` : ""}{totalHours.toFixed(2)} hrs · {isFiltered ? `${Math.round(filteredHours * 60)} of ` : ""}{Math.round(totalHours * 60)} min)
                </label>
                {undoStack.length > 0 && (
                  <button
                    onClick={() => {
                      const prev = undoStack[undoStack.length - 1];
                      setUndoStack((s) => s.slice(0, -1));
                      setLineItems(prev);
                    }}
                    className="flex items-center gap-1 rounded-lg border border-sand px-3 py-1.5 text-[11px] font-semibold text-bark transition-all hover:border-terracotta hover:text-terracotta cursor-pointer"
                  >
                    ↩ Undo {undoStack.length > 1 ? `(${undoStack.length})` : ""}
                  </button>
                )}
              </div>

              {/* Filter bar – Excel-style checkbox dropdowns */}
              <div className="relative mb-2">
                {openFilterPanel && (
                  <div className="fixed inset-0 z-40" onClick={() => setOpenFilterPanel(null)} />
                )}
                <div className="grid grid-cols-4 gap-2 rounded-lg border border-sand bg-parchment/30 p-2">
                  {(
                    [
                      { key: "va", label: "VA", values: filterVAValues, setValues: setFilterVAValues, options: filterVAOptions, none: filterVANone, setNone: setFilterVANone },
                      { key: "task", label: "Task", values: filterTaskValues, setValues: setFilterTaskValues, options: filterTaskOptions, none: filterTaskNone, setNone: setFilterTaskNone },
                      { key: "deliv", label: "Deliverables", values: filterDelivValues, setValues: setFilterDelivValues, options: filterDelivOptions, none: filterDelivNone, setNone: setFilterDelivNone },
                      { key: "memo", label: "Memo", values: filterMemoValues, setValues: setFilterMemoValues, options: filterMemoOptions, none: filterMemoNone, setNone: setFilterMemoNone },
                    ] as { key: string; label: string; values: Set<string>; setValues: (v: Set<string>) => void; options: string[]; none: boolean; setNone: (v: boolean) => void }[]
                  ).map(({ key, label, values, setValues, options, none, setNone }) => {
                    const isOpen = openFilterPanel === key;
                    const searchedOpts = filterPanelSearch && isOpen
                      ? options.filter(o => o.toLowerCase().includes(filterPanelSearch.toLowerCase()))
                      : options;
                    const activeCount = none ? -1 : values.size;
                    return (
                      <div key={key} className="relative z-50">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenFilterPanel(isOpen ? null : key);
                            setFilterPanelSearch("");
                          }}
                          className={`flex w-full items-center justify-between gap-1 rounded border px-2 py-1.5 text-[11px] cursor-pointer transition-colors ${
                            none || activeCount > 0
                              ? "border-terracotta bg-terracotta/10 font-semibold text-terracotta"
                              : "border-sand bg-white text-bark hover:border-terracotta"
                          }`}
                        >
                          <span>🔽 {label}{none ? " (none)" : activeCount > 0 ? ` (${activeCount})` : ""}</span>
                          <svg className="h-3 w-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </button>
                        {isOpen && (
                          <div
                            className="absolute left-0 z-50 mt-1 w-56 rounded-lg border border-sand bg-white shadow-xl"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="border-b border-sand p-2">
                              <input
                                autoFocus
                                type="text"
                                placeholder="Search..."
                                value={filterPanelSearch}
                                onChange={(e) => setFilterPanelSearch(e.target.value)}
                                className="w-full rounded border border-sand px-2 py-1 text-[11px] outline-none focus:border-terracotta"
                              />
                            </div>
                            <div className="max-h-48 overflow-y-auto p-1">
                              <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-parchment/30">
                                <input
                                  type="checkbox"
                                  checked={!none && values.size === 0}
                                  onChange={() => { setValues(new Set<string>()); setNone(false); }}
                                  className="accent-terracotta"
                                />
                                <span className="text-[11px] font-semibold text-espresso">(Select All)</span>
                              </label>
                              <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-parchment/30">
                                <input
                                  type="checkbox"
                                  checked={none}
                                  onChange={() => { setNone(true); setValues(new Set<string>()); }}
                                  className="accent-terracotta"
                                />
                                <span className="text-[11px] font-semibold text-stone">(Uncheck All)</span>
                              </label>
                              {searchedOpts.map((opt) => (
                                <label key={opt} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-parchment/30">
                                  <input
                                    type="checkbox"
                                    checked={!none && (values.size === 0 || values.has(opt))}
                                    onChange={() => {
                                      setNone(false);
                                      if (none) {
                                        // Was in "none" mode → selecting one item
                                        setValues(new Set<string>([opt]));
                                      } else if (values.size === 0) {
                                        // All selected → uncheck this one item
                                        const next = new Set<string>(options.filter(o => o !== opt));
                                        setValues(next);
                                      } else {
                                        const next = new Set<string>(values);
                                        if (next.has(opt)) {
                                          next.delete(opt);
                                          setValues(next.size === 0 ? new Set<string>() : next);
                                        } else {
                                          next.add(opt);
                                          setValues(next.size === options.length ? new Set<string>() : next);
                                        }
                                      }
                                    }}
                                    className="accent-terracotta"
                                  />
                                  <span className="text-[11px] text-bark truncate">{opt || "(blank)"}</span>
                                </label>
                              ))}
                              {searchedOpts.length === 0 && (
                                <p className="px-2 py-2 text-[11px] text-stone">No matches</p>
                              )}
                            </div>
                            <div className="flex justify-end gap-3 border-t border-sand p-2">
                              <button
                                type="button"
                                onClick={() => { setValues(new Set<string>()); setNone(false); setOpenFilterPanel(null); }}
                                className="cursor-pointer text-[11px] text-bark hover:text-terracotta"
                              >
                                Clear
                              </button>
                              <button
                                type="button"
                                onClick={() => setOpenFilterPanel(null)}
                                className="cursor-pointer text-[11px] font-semibold text-terracotta"
                              >
                                Done
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-lg border border-sand overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[12px]">
                    <thead>
                      <tr className="border-b border-parchment bg-parchment/30 text-[10px] font-semibold uppercase tracking-wider text-bark">
                        <th className="px-3 py-2.5">Date</th>
                        <th className="px-3 py-2.5">Time</th>
                        <th className="px-3 py-2.5">VA</th>
                        <th className="px-3 py-2.5">Deliverables / Objectives</th>
                        <th className="px-3 py-2.5">Task Description</th>
                        <th className="px-3 py-2.5 text-right">Minutes</th>
                        <th className="px-3 py-2.5">Memo</th>
                        <th className="px-3 py-2.5 text-center">Remove</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-parchment">
                      {filteredLineItems.map((li) => {
                        const realIdx = lineItems.indexOf(li);
                        return (
                          <tr key={realIdx} className="hover:bg-parchment/20 transition-colors">
                            <td className="px-3 py-2 text-bark text-[11px] whitespace-nowrap">{li.service_date ? new Date(li.service_date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: orgTimezone }) : "—"}</td>
                            <td className="px-3 py-2 text-bark text-[11px] whitespace-nowrap">{li.start_time ? new Date(li.start_time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: orgTimezone }) : "—"}</td>
                            <td className="px-3 py-2 font-medium text-espresso text-[11px] whitespace-nowrap">{li.va_name}</td>
                            {/* Deliverables / Objectives — first; options linked to this row's task description */}
                            <td className="px-3 py-2 max-w-[220px]">
                              {customEditCell?.idx === realIdx && customEditCell?.field === "project" ? (
                                <input
                                  autoFocus
                                  value={li.project || ""}
                                  onChange={(e) => updateLineItem(li.log_id, realIdx, { project: e.target.value })}
                                  onBlur={() => setCustomEditCell(null)}
                                  placeholder="Enter custom..."
                                  className="w-full bg-transparent border-b border-terracotta text-[12px] text-bark outline-none placeholder:text-stone"
                                />
                              ) : (
                                <select
                                  title={li.project || ""}
                                  value={li.project || ""}
                                  onChange={(e) => {
                                    if (e.target.value === "__custom__") {
                                      setCustomEditCell({ idx: realIdx, field: "project" });
                                    } else {
                                      updateLineItem(li.log_id, realIdx, { project: e.target.value });
                                    }
                                  }}
                                  className="w-full bg-transparent border-b border-transparent text-[12px] text-bark outline-none focus:border-terracotta hover:border-sand transition-colors cursor-pointer"
                                >
                                  {li.project && !getDelivOptions(li.description).includes(li.project) && (
                                    <option value={li.project}>{li.project}</option>
                                  )}
                                  {getDelivOptions(li.description).length === 0 && !li.project && (
                                    <option value="" disabled>—</option>
                                  )}
                                  {getDelivOptions(li.description).map((opt) => (
                                    <option key={opt} value={opt}>{opt}</option>
                                  ))}
                                  <option value="__custom__">✏️ Custom label...</option>
                                </select>
                              )}
                            </td>
                            {/* Task Description — second; options are all unique descriptions in line items */}
                            <td className="px-3 py-2 max-w-[220px]">
                              {customEditCell?.idx === realIdx && customEditCell?.field === "desc" ? (
                                <input
                                  autoFocus
                                  value={li.description}
                                  onChange={(e) => updateLineItem(li.log_id, realIdx, { description: e.target.value })}
                                  onBlur={() => setCustomEditCell(null)}
                                  placeholder="Enter custom..."
                                  className="w-full bg-transparent border-b border-terracotta text-[12px] text-bark outline-none placeholder:text-stone"
                                />
                              ) : (
                                <select
                                  title={li.description}
                                  value={li.description}
                                  onChange={(e) => {
                                    if (e.target.value === "__custom__") {
                                      setCustomEditCell({ idx: realIdx, field: "desc" });
                                    } else {
                                      updateLineItem(li.log_id, realIdx, { description: e.target.value });
                                    }
                                  }}
                                  className="w-full bg-transparent border-b border-transparent text-[12px] text-bark outline-none focus:border-terracotta hover:border-sand transition-colors cursor-pointer"
                                >
                                  {taskDescOptions.map((opt) => (
                                    <option key={opt} value={opt}>{opt}</option>
                                  ))}
                                  <option value="__custom__">✏️ Custom label...</option>
                                </select>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right text-bark whitespace-nowrap">{Math.round(li.quantity * 60)}</td>
                            <td className="px-3 py-2 max-w-[180px]">
                              <textarea
                                value={li.client_memo || ""}
                                onChange={(e) => updateLineItem(li.log_id, realIdx, { client_memo: e.target.value })}
                                onInput={(e) => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; }}
                                placeholder="—"
                                rows={1}
                                className="w-full bg-transparent border-b border-transparent text-[12px] text-bark outline-none focus:border-terracotta hover:border-sand transition-colors placeholder:text-stone resize-none overflow-hidden whitespace-pre-wrap break-words"
                              />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <button
                                onClick={() => {
                                  const removed = lineItems[realIdx];
                                  setUndoStack((prev) => [...prev.slice(-19), lineItems]);
                                  setLineItems(lineItems.filter((_, i) => i !== realIdx));
                                  setRemovedLineItems((prev) => [...prev, removed]);
                                }}
                                title="Move to holding area (not deleted from log)"
                                className="inline-flex h-6 w-6 items-center justify-center rounded text-stone transition-colors hover:bg-amber-soft hover:text-amber cursor-pointer"
                              >
                                &times;
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

            {/* Reimbursable Expenses — Auto-added */}
            {expenseItems.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-200 overflow-hidden">
                <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700">
                    Reimbursable Expenses — Auto-added ({expenseItems.filter(e => !e.excluded).length} of {expenseItems.length} included)
                  </p>
                </div>
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-amber-100 bg-amber-50/50 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                      <th className="px-4 py-2.5">Include</th>
                      <th className="px-4 py-2.5">Date</th>
                      <th className="px-3 py-2.5">Description</th>
                      <th className="px-3 py-2.5">Account</th>
                      <th className="px-3 py-2.5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100">
                    {expenseItems.map((exp) => (
                      <tr key={exp.expense_id} className={`hover:bg-amber-50/50 transition-colors${exp.excluded ? " line-through opacity-50" : ""}`}>
                        <td className="px-4 py-2.5 text-center">
                          <input
                            type="checkbox"
                            checked={!exp.excluded}
                            onChange={() => setExpenseItems(prev => prev.map(e => e.expense_id === exp.expense_id ? { ...e, excluded: !e.excluded } : e))}
                            className="cursor-pointer"
                          />
                        </td>
                        <td className="px-4 py-2.5 text-bark text-[11px]">{exp.expense_date}</td>
                        <td className="px-3 py-2.5 text-espresso font-medium">
                          <span className="flex items-center gap-1">
                            {exp.description}
                            {exp.notes && (
                              <span className="relative inline-block flex-shrink-0">
                                <button
                                  onClick={() => setOpenBuilderNoteId(openBuilderNoteId === exp.expense_id ? null : exp.expense_id)}
                                  className="w-4 h-4 rounded-full bg-amber-200 text-amber-800 text-[9px] font-bold inline-flex items-center justify-center hover:bg-amber-300 cursor-pointer leading-none"
                                >?</button>
                                {openBuilderNoteId === exp.expense_id && (
                                  <div className="absolute z-20 left-5 top-0 bg-white border border-amber-200 rounded-lg shadow-lg p-2.5 text-[11px] text-bark w-52 whitespace-pre-wrap">
                                    {exp.notes}
                                  </div>
                                )}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-bark">{exp.account || "—"}</td>
                        <td className="px-3 py-2.5 text-right font-medium text-espresso">${exp.amount.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-amber-200 bg-amber-50">
                      <td colSpan={4} className="px-4 py-2 text-[11px] font-semibold text-amber-700 text-right">
                        Expense Total
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-amber-700 text-[11px]">
                        ${expenseItems.filter(e => !e.excluded).reduce((s, e) => s + e.amount, 0).toFixed(2)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

              {/* Removed Items Holding Cell */}
              {removedLineItems.length > 0 && (
                <div className="mt-3 rounded-lg border border-amber/30 bg-amber-soft/20 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-amber">
                      On Hold ({removedLineItems.length}) — removed from invoice, NOT deleted from time log
                    </p>
                    <button
                      onClick={() => setRemovedLineItems([])}
                      className="text-[10px] text-stone hover:text-red-500 cursor-pointer transition-colors"
                    >
                      Clear all
                    </button>
                  </div>
                  <div className="space-y-1">
                    {removedLineItems.map((li, idx) => (
                      <div key={idx} className="flex items-start justify-between rounded bg-white/60 px-3 py-1.5 text-[11px] gap-2">
                        <span className="text-bark break-words min-w-0 flex-1">
                          {li.service_date ? new Date(li.service_date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: orgTimezone }) + " · " : ""}{li.va_name} · {li.description} · {Math.round(li.quantity * 60)} min
                        </span>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <select
                            value={removedItemOverrides.get(idx)?.account ?? ""}
                            onChange={(e) => { const acc = e.target.value; const clientId = accountToClientMap[acc]; const clientName = clientId ? (clients.find(c => c.id === clientId)?.name ?? "") : ""; setRemovedItemOverrides(prev => { const next = new Map(prev); next.set(idx, { account: acc, client: clientName }); return next; }); }}
                            className="text-[11px] rounded border border-sand bg-white px-1 py-0.5 text-bark outline-none focus:border-terracotta cursor-pointer"
                          >
                            <option value="">Account...</option>
                            {accountList.map(a => <option key={a} value={a}>{a}</option>)}
                          </select>
                          <select
                            value={removedItemOverrides.get(idx)?.client ?? ""}
                            onChange={(e) => setRemovedItemOverrides(prev => { const next = new Map(prev); next.set(idx, { ...(prev.get(idx) ?? { account: "", client: "" }), client: e.target.value }); return next; })}
                            className="text-[11px] rounded border border-sand bg-white px-1 py-0.5 text-bark outline-none focus:border-terracotta cursor-pointer"
                          >
                            <option value="">Client...</option>
                            {clients.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                          </select>
                          <button
                            onClick={() => {
                              setLineItems((prev) => [...prev, li]);
                              setRemovedLineItems((prev) => prev.filter((_, i) => i !== idx));
                              setRemovedItemOverrides(prev => { const next = new Map(prev); next.delete(idx); return next; });
                            }}
                            className="text-[11px] font-semibold text-terracotta hover:underline cursor-pointer whitespace-nowrap"
                          >
                            ↩ Restore
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          )}

          {/* Custom: Manual Line Items */}
          {invoiceType === "custom" && (
            <div className="mb-6">
              <div className="mb-2 flex items-center justify-between">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-bark">Line Items</label>
                <button type="button" onClick={() => setCustomItems(prev => [...prev, { id: `ci-${Date.now()}`, description: "", amount: "" }])} className="flex items-center gap-1 rounded-lg border border-sand px-3 py-1.5 text-[11px] font-semibold text-bark transition-all hover:border-terracotta hover:text-terracotta cursor-pointer">+ Add Item</button>
              </div>
              <div className="rounded-lg border border-sand overflow-hidden">
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-parchment bg-parchment/30 text-[10px] font-semibold uppercase tracking-wider text-bark">
                      <th className="px-3 py-2.5">Description</th>
                      <th className="px-3 py-2.5 text-right w-32">Amount ($)</th>
                      <th className="px-3 py-2.5 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-parchment">
                    {customItems.map((item, idx) => (
                      <tr key={item.id} className="hover:bg-parchment/20 transition-colors">
                        <td className="px-3 py-2">
                          <input type="text" value={item.description} onChange={(e) => setCustomItems(prev => prev.map((ci, i) => i === idx ? { ...ci, description: e.target.value } : ci))} placeholder="e.g. Social Media Management — May 2025" className="w-full bg-transparent text-[12px] text-espresso outline-none placeholder:text-stone border-b border-transparent hover:border-sand focus:border-terracotta transition-colors" />
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" step="0.01" min="0" value={item.amount} onChange={(e) => { const updated = customItems.map((ci, i) => i === idx ? { ...ci, amount: e.target.value } : ci); setCustomItems(updated); setInvoiceTotal(updated.reduce((s, ci) => s + (parseFloat(ci.amount) || 0), 0).toFixed(2)); }} placeholder="0.00" className="w-full bg-transparent text-right text-[12px] text-espresso outline-none placeholder:text-stone border-b border-transparent hover:border-sand focus:border-terracotta transition-colors" />
                        </td>
                        <td className="px-3 py-2 text-center">
                          {customItems.length > 1 && (
                            <button type="button" onClick={() => { const updated = customItems.filter((_, i) => i !== idx); setCustomItems(updated); setInvoiceTotal(updated.reduce((s, ci) => s + (parseFloat(ci.amount) || 0), 0).toFixed(2)); }} className="inline-flex h-6 w-6 items-center justify-center rounded text-stone transition-colors hover:bg-amber-soft hover:text-amber cursor-pointer">&times;</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Actions — always visible */}
          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={() => handleSaveInvoice(false)}
              disabled={saving || !invoiceTotal || parseFloat(invoiceTotal) <= 0}
              className="rounded-lg border border-sand px-5 py-2.5 text-[13px] font-semibold text-bark transition-all hover:border-terracotta hover:text-terracotta disabled:opacity-50 cursor-pointer"
            >
              {saving ? "Saving..." : "Save & Preview"}
            </button>
            <button
              onClick={() => handleSaveInvoice(true)}
              disabled={saving || !invoiceTotal || parseFloat(invoiceTotal) <= 0 || !selectedClient?.email}
              title={!selectedClient?.email ? "Select a billing client with an email to send" : ""}
              className="rounded-lg bg-terracotta px-5 py-2.5 text-[13px] font-semibold text-white transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {saving ? "Sending..." : "Send Invoice"}
            </button>
          </div>

          {/* Empty state after fetching with no results — timelog only */}
          {invoiceType === "timelog" && canFetch && dateFrom && dateTo && lineItems.length === 0 && !loadingLogs && (
            <div className="rounded-lg border border-dashed border-sand bg-parchment/30 px-6 py-10 text-center">
              <p className="text-[13px] text-bark">
                No uninvoiced billable time logs found for the selected filter and date range.
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
            <button
              onClick={() => {
                // Pre-populate generate form with this invoice's client/account
                if (inv.client_id) {
                  setGenerateBy("client");
                  setSelectedClientId(inv.client_id);
                  setSelectedAccount("");
                } else if (inv.account_name) {
                  setGenerateBy("account");
                  setSelectedAccount(inv.account_name);
                  setSelectedClientId(null);
                }
                setServiceType(inv.service_type ?? "");
                setLineItems([]);
                setInvoiceTotal("");
                setAdjustmentAmount("0");
                setSelectedInvoice(null);
                setEditingInvoice(false);
                setView("create");
              }}
              className="rounded-lg border border-terracotta px-4 py-2 text-[13px] font-semibold text-terracotta transition-all hover:bg-terracotta hover:text-white cursor-pointer"
            >
              + New Invoice
            </button>
            <button
              onClick={() => {
                setEditingInvoice(!editingInvoice);
                if (!editingInvoice) {
                  setEditSubtotal(String(inv.subtotal ?? ""));
                  setEditAdjustment(String(inv.adjustment_amount ?? "0"));
                  setEditPaymentLink(inv.payment_link ?? "");
                  setEditPaymentInfo(inv.payment_info ?? DEFAULT_PAYMENT_INFO);
                  setEditFromName(inv.from_name ?? "");
                  setEditFromPhone(inv.from_phone ?? "");
                  setEditReplyToEmail(inv.from_email ?? "");
                  setEditNotes(inv.notes ?? "");
                  setEditDueDate(inv.due_date ?? "");
                  setEditReminderEnabled(inv.reminder_enabled ?? false);
                  setEditAccountName(inv.account_name ?? "");
                  setRateAmount(inv.rate_amount != null ? String(inv.rate_amount) : "");
                  setHoursNotBilled(inv.hours_not_billed != null ? String(inv.hours_not_billed) : "");
                  setHoursNotBilledLabel(inv.hours_not_billed_label || "Volunteer");
                  setEditPreviousBalance(inv.previous_balance != null ? String(inv.previous_balance) : "");
                  setEditPreviousBalanceNote(inv.previous_balance_note ?? "");
                  setServiceType(inv.service_type ?? "");
                  setEditToName(inv.to_name ?? "");
                  setEditToEmail(inv.to_email ?? "");
                  setEditToPhone(inv.to_phone ?? "");
                  setEditToAddress(inv.to_address ?? "");
                }
              }}
              className={`rounded-lg px-4 py-2 text-[13px] font-semibold transition-all cursor-pointer ${editingInvoice ? "bg-terracotta text-white" : "border border-sand text-bark hover:border-terracotta hover:text-terracotta"}`}
            >
              {editingInvoice ? "✕ Cancel Edit" : "✏️ Edit Invoice"}
            </button>
            {inv.share_token && (
              <a
                href={`https://minuteflow.click/invoice/view/${inv.share_token}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-sand px-4 py-2 text-[13px] font-semibold text-bark transition-all hover:border-terracotta hover:text-terracotta cursor-pointer"
              >
                👁 Preview
              </a>
            )}
            {inv.share_token && inv.issue_date && inv.invoice_number && (() => {
              const MONTH_NAMES = ["january","february","march","april","may","june","july","august","september","october","november","december"];
              const d = new Date(inv.issue_date + "T12:00:00Z");
              const monthSlug = MONTH_NAMES[d.getUTCMonth()] + d.getUTCFullYear();
              const clientSlug = (inv.account_name || inv.to_name || "client").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
              const numSlug = inv.invoice_number.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
              const customUrl = `https://minuteflow.click/invoice/view/${monthSlug}/${clientSlug}/${numSlug}`;
              return (
                <button
                  onClick={() => { navigator.clipboard.writeText(customUrl); }}
                  title={customUrl}
                  className="rounded-lg border border-sand px-4 py-2 text-[13px] font-semibold text-bark transition-all hover:border-terracotta hover:text-terracotta cursor-pointer"
                >
                  🔗 Copy Link
                </button>
              );
            })()}
            {inv.status === "draft" && (
              <button
                onClick={() => handleMarkReadyToSend(inv)}
                className="rounded-lg bg-amber px-4 py-2 text-[13px] font-semibold text-white transition-all hover:bg-amber/80 cursor-pointer"
              >
                Mark Ready to Send
              </button>
            )}
            {inv.status === "ready_to_send" && (
              <button
                onClick={() => handleRevertToDraft(inv)}
                className="rounded-lg border border-amber px-4 py-2 text-[13px] font-semibold text-amber transition-all hover:bg-amber hover:text-white cursor-pointer"
              >
                Revert to Draft
              </button>
            )}
            {inv.status !== "paid" && inv.status !== "cancelled" && (
              <button
                onClick={() => { setShowPaymentForm(true); setPaymentError(""); }}
                className="rounded-lg bg-amber px-4 py-2 text-[13px] font-semibold text-white transition-all hover:bg-amber/80 cursor-pointer"
              >
                Record Payment
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
            {inv.status === "paid" && (
              <button
                onClick={() => handleMarkUnpaid(inv)}
                className="rounded-lg border border-clay px-4 py-2 text-[13px] font-semibold text-bark transition-all hover:border-terracotta hover:text-terracotta cursor-pointer"
              >
                Mark as Unpaid
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

        {/* Daily Reminder Toggle — standalone row, outside actions bar */}
        {inv.status !== "paid" && inv.status !== "cancelled" && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-sand bg-white px-4 py-2.5">
            <button
              onClick={() => handleToggleReminderDirect(inv)}
              className={`relative h-5 w-9 rounded-full transition-colors cursor-pointer overflow-hidden flex-shrink-0 ${inv.reminder_enabled ? "bg-terracotta" : "bg-clay"}`}
              title={inv.reminder_enabled ? "Daily reminders ON — click to turn off" : "Daily reminders OFF — click to turn on"}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${inv.reminder_enabled ? "translate-x-4" : "translate-x-0.5"}`} />
            </button>
            <span className="text-[13px] text-bark">Daily reminder email</span>
            <span className="text-[12px] text-stone">{inv.reminder_enabled ? "— ON (sends payment reminder each day)" : "— OFF"}</span>
          </div>
        )}

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
        {reminderSuccess && (
          <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 text-[12px] text-amber-700">
            {reminderSuccess}
          </div>
        )}

        {/* Send Email Panel */}
        {(inv.status === "draft" || inv.status === "sent" || inv.status === "ready_to_send") && (
          <div className="mb-4 rounded-xl border border-sand bg-white p-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-bark">Send Invoice Email</p>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="w-7 shrink-0 text-right text-[11px] font-semibold text-stone">To</span>
                <input
                  type="text"
                  value={sendToEmail}
                  onChange={(e) => setSendToEmail(e.target.value)}
                  placeholder="email1@example.com, email2@example.com"
                  className="flex-1 rounded-lg border border-sand bg-parchment px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta placeholder:text-stone"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-7 shrink-0 text-right text-[11px] font-semibold text-stone">CC</span>
                <input
                  type="text"
                  value={sendCcEmail}
                  onChange={(e) => setSendCcEmail(e.target.value)}
                  placeholder="cc1@example.com, cc2@example.com (optional)"
                  className="flex-1 rounded-lg border border-sand bg-parchment px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta placeholder:text-stone"
                />
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => handleSendInvoice(inv)}
                  disabled={sending || !sendToEmail}
                  className="rounded-lg bg-slate-blue px-5 py-2 text-[13px] font-semibold text-white transition-all hover:bg-slate-blue/80 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
                >
                  {sending ? "Sending..." : inv.status === "sent" ? "Resend Email" : "Send via Email"}
                </button>
              </div>
            </div>
            <p className="mt-1.5 text-[11px] text-stone">
              {inv.to_email ? `Default: ${inv.to_email} — separate multiple addresses with commas` : "No client email on file — type any address above"}
            </p>
          </div>
        )}

        {/* Reminder Panel */}
        {(inv.status === "sent" || inv.status === "overdue" || inv.status === "partially_paid") && inv.to_email && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-amber-700">Send Gentle Reminder</p>
            <p className="mb-3 text-[12px] text-amber-600">Sends a reminder to <span className="font-semibold">{inv.to_email}</span> with subject &ldquo;Gentle Reminder: Invoice {inv.invoice_number}&rdquo;</p>
            <button
              onClick={() => handleSendReminder(inv)}
              disabled={sendingReminder === inv.id}
              className="rounded-lg bg-amber-500 px-5 py-2 text-[13px] font-semibold text-white transition-all hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {sendingReminder === inv.id ? "Sending..." : "Send Reminder"}
            </button>
          </div>
        )}

        {/* Edit Panel */}
        {editingInvoice && (
          <div className="mb-4 rounded-xl border border-terracotta/30 bg-white p-5">
            <h4 className="mb-4 font-serif text-[15px] font-bold text-espresso">Edit Invoice</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Hourly Rate ($)</label>
                <input type="number" step="0.01" min="0" value={rateAmount}
                  onChange={(e) => {
                    const v = e.target.value;
                    setRateAmount(v);
                    const rate = parseFloat(v) || 0;
                    if (rate > 0) {
                      const gross = editLineItemsState.reduce((s, li) => s + Number(li.quantity), 0);
                      const notBilled = parseFloat(hoursNotBilled) || 0;
                      setEditSubtotal((gross * rate).toFixed(2));
                      setEditAdjustment((notBilled * rate).toFixed(2));
                    }
                  }}
                  placeholder="e.g. 25.00"
                  className="w-full rounded-lg border border-sand bg-parchment px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta placeholder:text-stone" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Hours Not Billed</label>
                <div className="flex gap-2">
                  <input type="text" value={hoursNotBilledLabel} onChange={(e) => setHoursNotBilledLabel(e.target.value)}
                    placeholder="Label (e.g. Volunteer)"
                    className="flex-1 rounded-lg border border-sand bg-parchment px-3 py-2 text-[12px] text-espresso outline-none focus:border-terracotta placeholder:text-stone" />
                  <input type="number" step="0.01" min="0" value={hoursNotBilled}
                    onChange={(e) => {
                      const v = e.target.value;
                      setHoursNotBilled(v);
                      const rate = parseFloat(rateAmount) || 0;
                      if (rate > 0) {
                        const gross = editLineItemsState.reduce((s, li) => s + Number(li.quantity), 0);
                        const notBilled = parseFloat(v) || 0;
                        setEditSubtotal((gross * rate).toFixed(2));
                        setEditAdjustment((notBilled * rate).toFixed(2));
                      }
                    }}
                    placeholder="0.00"
                    className="w-24 rounded-lg border border-sand bg-parchment px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta placeholder:text-stone" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Invoice Amount ($)</label>
                <input type="number" step="0.01" min="0" value={editSubtotal} onChange={(e) => setEditSubtotal(e.target.value)}
                  className="w-full rounded-lg border border-sand bg-parchment px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Savings ($)</label>
                <input type="number" step="0.01" min="0" value={editAdjustment} onChange={(e) => setEditAdjustment(e.target.value)}
                  className="w-full rounded-lg border border-sand bg-parchment px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Final Amount</label>
                <div className="rounded-lg border border-sand bg-parchment/50 px-3 py-2 text-[14px] font-bold text-terracotta">
                  {formatCurrency((parseFloat(editSubtotal) || 0) - (parseFloat(editAdjustment) || 0))}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Previous Balance ($)</label>
                <input type="number" step="0.01" min="0" value={editPreviousBalance}
                  onChange={(e) => setEditPreviousBalance(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-sand bg-parchment px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta placeholder:text-stone" />
                {parseFloat(editPreviousBalance) > 0 && (
                  <input
                    type="text"
                    value={editPreviousBalanceNote}
                    onChange={(e) => setEditPreviousBalanceNote(e.target.value)}
                    placeholder="Note for client (e.g. Balance carried over from Invoice #12)"
                    className="mt-1.5 w-full rounded-lg border border-sand bg-parchment px-3 py-2 text-[12px] text-espresso outline-none focus:border-terracotta placeholder:text-stone"
                  />
                )}
              </div>
              {parseFloat(editPreviousBalance) > 0 && (
                <div className="col-span-2">
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Current Balance Due</label>
                  <div className="rounded-lg border border-terracotta bg-[#fff8f5] px-3 py-2 text-[16px] font-bold text-terracotta">
                    {formatCurrency((parseFloat(editSubtotal) || 0) - (parseFloat(editAdjustment) || 0) + (parseFloat(editPreviousBalance) || 0))}
                  </div>
                </div>
              )}
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Due Date</label>
                <input type="date" value={editDueDate} onChange={(e) => setEditDueDate(e.target.value)}
                  className="w-full rounded-lg border border-sand bg-parchment px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Account Name</label>
                <input type="text" value={editAccountName} onChange={(e) => setEditAccountName(e.target.value)}
                  placeholder="e.g. TAT Foundation"
                  className="w-full rounded-lg border border-sand bg-parchment px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta placeholder:text-stone" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Sender Name</label>
                <input type="text" value={editFromName} onChange={(e) => setEditFromName(e.target.value)}
                  className="w-full rounded-lg border border-sand bg-parchment px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Sender Phone</label>
                <input type="text" value={editFromPhone} onChange={(e) => setEditFromPhone(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  className="w-full rounded-lg border border-sand bg-parchment px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta placeholder:text-stone" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Payment Link</label>
                <input type="url" value={editPaymentLink} onChange={(e) => setEditPaymentLink(e.target.value)}
                  placeholder="https://..."
                  className="w-full rounded-lg border border-sand bg-parchment px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta placeholder:text-stone" />
                {editPaymentLink && (
                  <p className="mt-1 text-[11px] text-bark/60">Note: A card processing fee (3%) applies to card payments.</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Payment Method Info</label>
                <textarea value={editPaymentInfo} onChange={(e) => setEditPaymentInfo(e.target.value)}
                  placeholder="e.g. Zelle: yourname@email.com&#10;PayPal: @yourhandle&#10;Bank Transfer: Account #1234"
                  className="w-full rounded-lg border border-sand bg-parchment px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta placeholder:text-stone resize-none"
                  rows={3} />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Reply-To Email</label>
                <input type="email" value={editReplyToEmail} onChange={(e) => setEditReplyToEmail(e.target.value)}
                  placeholder="replies@youremail.com"
                  className="w-full rounded-lg border border-sand bg-parchment px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta placeholder:text-stone" />
                <p className="mt-1 text-[11px] text-bark/60">Replies to this invoice will go here.</p>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Type of Services</label>
                <input type="text" value={serviceType} onChange={(e) => setServiceType(e.target.value)}
                  placeholder="e.g. Virtual Assistant Services"
                  className="w-full rounded-lg border border-sand bg-parchment px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta placeholder:text-stone" />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Notes</label>
                <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Payment instructions, Zelle info, etc."
                  className="w-full rounded-lg border border-sand bg-parchment px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta placeholder:text-stone resize-none"
                  rows={3} />
              </div>
              {/* ── Split Payment Schedule (edit) ──────────────── */}
              <div className="col-span-2">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-bark">Split Payment Schedule</label>
                <p className="mb-3 text-[11px] text-bark/60">Set up installment amounts and due dates. Clients will see a &ldquo;Split Payment Option&rdquo; button on their invoice. Leave empty to skip.</p>
                {invoiceTemplates.length > 0 && (
                  <div className="mb-3">
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-bark/70">Apply Template</label>
                    <select
                      value={editTemplateId ?? ""}
                      onChange={(e) => {
                        const id = e.target.value ? Number(e.target.value) : null;
                        setEditTemplateId(id);
                        const tpl = invoiceTemplates.find(t => t.id === id);
                        setEditSchedule(tpl ? tpl.items.map(i => ({ ...i })) : []);
                      }}
                      className="w-full rounded-lg border border-sand bg-parchment px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta"
                    >
                      <option value="">— No template —</option>
                      {invoiceTemplates.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {editSchedule.length > 0 && (
                  <div className="mb-3 space-y-2">
                    {editSchedule.map((item, idx) => (
                      <div key={idx} className="flex gap-2 items-center">
                        <span className="text-[11px] text-bark/60 whitespace-nowrap w-16 shrink-0">Inst. {idx + 1}</span>
                        <span className="text-[12px] text-bark shrink-0">$</span>
                        <input
                          type="number"
                          value={item.value}
                          onChange={(e) => setEditSchedule(prev => prev.map((s, i) => i === idx ? { ...s, value: parseFloat(e.target.value) || 0, label: `Installment ${i + 1}`, amount_type: 'fixed' as const } : s))}
                          placeholder="300.00"
                          className="w-24 rounded-lg border border-sand bg-parchment px-3 py-2 text-[12px] text-espresso outline-none focus:border-terracotta"
                        />
                        <span className="text-[11px] text-bark/60 shrink-0">Due:</span>
                        <input
                          type="date"
                          value={(item as PaymentScheduleItem & { due_date?: string }).due_date || ''}
                          onChange={(e) => setEditSchedule(prev => prev.map((s, i) => i === idx ? { ...s, due_date: e.target.value } : s))}
                          className="flex-1 rounded-lg border border-sand bg-parchment px-3 py-2 text-[12px] text-espresso outline-none focus:border-terracotta"
                        />
                        <button type="button" onClick={() => setEditSchedule(prev => prev.filter((_, i) => i !== idx))} className="text-bark/40 hover:text-terracotta text-[16px] leading-none">×</button>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setEditSchedule(prev => [...prev, { label: `Installment ${prev.length + 1}`, amount_type: 'fixed' as const, value: 0, due_date: '' } as PaymentScheduleItem & { due_date?: string }])}
                  className="text-[11px] font-semibold text-terracotta hover:underline"
                >
                  + Add Installment
                </button>
                <div className="flex items-center gap-3 mt-3">
                  <button
                    type="button"
                    onClick={() => setEditAllowCustomAmount(v => !v)}
                    className={`relative h-6 w-11 rounded-full transition-colors cursor-pointer overflow-hidden ${editAllowCustomAmount ? "bg-terracotta" : "bg-clay"}`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${editAllowCustomAmount ? "translate-x-5" : "translate-x-0.5"}`} />
                  </button>
                  <span className="text-[13px] text-bark">Allow client to enter custom amount</span>
                </div>
              </div>
              {/* Bill To section */}
              <div className="col-span-2 pt-2 border-t border-sand">
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-bark">Bill To Info</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[10px] font-medium text-bark/70">Client Name</label>
                    <input type="text" value={editToName} onChange={(e) => setEditToName(e.target.value)}
                      placeholder="Client name"
                      className="w-full rounded-lg border border-sand bg-parchment px-3 py-2 text-[12px] text-espresso outline-none focus:border-terracotta placeholder:text-stone" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-medium text-bark/70">Client Email</label>
                    <input type="email" value={editToEmail} onChange={(e) => setEditToEmail(e.target.value)}
                      placeholder="client@email.com"
                      className="w-full rounded-lg border border-sand bg-parchment px-3 py-2 text-[12px] text-espresso outline-none focus:border-terracotta placeholder:text-stone" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-medium text-bark/70">Client Phone</label>
                    <input type="text" value={editToPhone} onChange={(e) => setEditToPhone(e.target.value)}
                      placeholder="+1 (555) 000-0000"
                      className="w-full rounded-lg border border-sand bg-parchment px-3 py-2 text-[12px] text-espresso outline-none focus:border-terracotta placeholder:text-stone" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-medium text-bark/70">Client Address</label>
                    <input type="text" value={editToAddress} onChange={(e) => setEditToAddress(e.target.value)}
                      placeholder="123 Main St, City, State"
                      className="w-full rounded-lg border border-sand bg-parchment px-3 py-2 text-[12px] text-espresso outline-none focus:border-terracotta placeholder:text-stone" />
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-3">
              <button onClick={() => setEditingInvoice(false)}
                className="rounded-lg border border-sand px-4 py-2 text-[13px] font-semibold text-bark transition-all hover:border-terracotta hover:text-terracotta cursor-pointer">
                Cancel
              </button>
              <button onClick={handleUpdateInvoice} disabled={savingEdit}
                className="rounded-lg bg-terracotta px-5 py-2 text-[13px] font-semibold text-white transition-all hover:bg-[#a85840] disabled:opacity-50 cursor-pointer">
                {savingEdit ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        )}

        {/* Edit Line Items (shown when editing) */}
        {editingInvoice && (
          <div className="mb-4 rounded-xl border border-sand bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="font-serif text-[14px] font-bold text-espresso">
                Edit Time Entries ({editLineItemsState.length} entries · {editLineItemsState.reduce((s, li) => s + Number(li.quantity), 0).toFixed(2)} hrs)
              </h4>
              {editUndoStack.length > 0 && (
                <button
                  onClick={() => {
                    const prev = editUndoStack[editUndoStack.length - 1];
                    setEditUndoStack((s) => s.slice(0, -1));
                    setEditLineItemsState(prev);
                  }}
                  className="flex items-center gap-1 rounded-lg border border-sand px-3 py-1.5 text-[11px] font-semibold text-bark transition-all hover:border-terracotta hover:text-terracotta cursor-pointer"
                >
                  ↩ Undo {editUndoStack.length > 1 ? `(${editUndoStack.length})` : ""}
                </button>
              )}
            </div>

            {/* Edit Filter Bar */}
            <div className="relative mb-2">
              {editOpenFilterPanel && (
                <div className="fixed inset-0 z-40" onClick={() => setEditOpenFilterPanel(null)} />
              )}
              <div className="grid grid-cols-4 gap-2 rounded-lg border border-sand bg-parchment/30 p-2">
                {(
                  [
                    { key: "va", label: "VA", values: editFilterVAValues, setValues: setEditFilterVAValues, options: editFilterVAOptions, none: editFilterVANone, setNone: setEditFilterVANone },
                    { key: "task", label: "Task", values: editFilterTaskValues, setValues: setEditFilterTaskValues, options: editFilterTaskOptions, none: editFilterTaskNone, setNone: setEditFilterTaskNone },
                    { key: "deliv", label: "Deliverables", values: editFilterDelivValues, setValues: setEditFilterDelivValues, options: editFilterDelivOptions, none: editFilterDelivNone, setNone: setEditFilterDelivNone },
                    { key: "memo", label: "Memo", values: editFilterMemoValues, setValues: setEditFilterMemoValues, options: editFilterMemoOptions, none: editFilterMemoNone, setNone: setEditFilterMemoNone },
                  ] as { key: string; label: string; values: Set<string>; setValues: (v: Set<string>) => void; options: string[]; none: boolean; setNone: (v: boolean) => void }[]
                ).map(({ key, label, values, setValues, options, none, setNone }) => {
                  const isOpen = editOpenFilterPanel === key;
                  const searched = editFilterSearch && isOpen ? options.filter(o => o.toLowerCase().includes(editFilterSearch.toLowerCase())) : options;
                  const activeCount = none ? -1 : values.size;
                  return (
                    <div key={key} className="relative z-50">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setEditOpenFilterPanel(isOpen ? null : key); setEditFilterSearch(""); }}
                        className={`flex w-full items-center justify-between gap-1 rounded border px-2 py-1.5 text-[11px] cursor-pointer transition-colors ${none || activeCount > 0 ? "border-terracotta bg-terracotta/10 font-semibold text-terracotta" : "border-sand bg-white text-bark hover:border-terracotta"}`}
                      >
                        <span>🔽 {label}{none ? " (none)" : activeCount > 0 ? ` (${activeCount})` : ""}</span>
                      </button>
                      {isOpen && (
                        <div className="absolute left-0 z-50 mt-1 w-56 rounded-lg border border-sand bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
                          <div className="border-b border-sand p-2">
                            <input autoFocus type="text" placeholder="Search..." value={editFilterSearch} onChange={(e) => setEditFilterSearch(e.target.value)}
                              className="w-full rounded border border-sand px-2 py-1 text-[11px] outline-none focus:border-terracotta" />
                          </div>
                          <div className="max-h-48 overflow-y-auto p-1">
                            <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-parchment/30">
                              <input type="checkbox" checked={!none && values.size === 0} onChange={() => { setValues(new Set<string>()); setNone(false); }} className="accent-terracotta" />
                              <span className="text-[11px] font-semibold text-espresso">(Select All)</span>
                            </label>
                            <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-parchment/30">
                              <input type="checkbox" checked={none} onChange={() => { setNone(true); setValues(new Set<string>()); }} className="accent-terracotta" />
                              <span className="text-[11px] font-semibold text-stone">(Uncheck All)</span>
                            </label>
                            {searched.map((opt) => (
                              <label key={opt} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-parchment/30">
                                <input type="checkbox" checked={!none && (values.size === 0 || values.has(opt))}
                                  onChange={() => {
                                    setNone(false);
                                    if (none) { setValues(new Set<string>([opt])); }
                                    else if (values.size === 0) { setValues(new Set<string>(options.filter(o => o !== opt))); }
                                    else {
                                      const next = new Set<string>(values);
                                      if (next.has(opt)) { next.delete(opt); setValues(next.size === 0 ? new Set<string>() : next); }
                                      else { next.add(opt); setValues(next.size === options.length ? new Set<string>() : next); }
                                    }
                                  }}
                                  className="accent-terracotta" />
                                <span className="text-[11px] text-bark truncate">{opt || "(blank)"}</span>
                              </label>
                            ))}
                          </div>
                          <div className="flex justify-end gap-3 border-t border-sand p-2">
                            <button type="button" onClick={() => { setValues(new Set<string>()); setNone(false); setEditOpenFilterPanel(null); }} className="cursor-pointer text-[11px] text-bark hover:text-terracotta">Clear</button>
                            <button type="button" onClick={() => setEditOpenFilterPanel(null)} className="cursor-pointer text-[11px] font-semibold text-terracotta">Done</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Editable Line Items Table */}
            <div className="rounded-lg border border-sand overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-parchment bg-parchment/30 text-[10px] font-semibold uppercase tracking-wider text-bark">
                      <th className="px-3 py-2.5">Date</th>
                      <th className="px-3 py-2.5">Time</th>
                      <th className="px-3 py-2.5">VA</th>
                      <th className="px-3 py-2.5">Deliverables</th>
                      <th className="px-3 py-2.5">Task Description</th>
                      <th className="px-3 py-2.5 text-right">Min</th>
                      <th className="px-3 py-2.5">Memo</th>
                      <th className="px-3 py-2.5 text-center">Remove</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-parchment">
                    {filteredEditLineItems.map((li) => {
                      const realIdx = editLineItemsState.indexOf(li);
                      return (
                        <tr key={li.id} className="hover:bg-parchment/20 transition-colors">
                          <td className="px-3 py-2 text-bark text-[11px] whitespace-nowrap">
                            {li.service_date ? new Date(li.service_date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: orgTimezone }) : "—"}
                          </td>
                          <td className="px-3 py-2 text-bark text-[11px] whitespace-nowrap">
                            {li.start_time ? new Date(li.start_time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: orgTimezone }) : "—"}
                          </td>
                          <td className="px-3 py-2 font-medium text-espresso text-[11px] whitespace-nowrap">{li.va_name || "—"}</td>
                          <td className="px-3 py-2 max-w-[220px]">
                            {editCustomCell?.idx === realIdx && editCustomCell?.field === "project" ? (
                              <input autoFocus value={li.project || ""} onChange={(e) => setEditLineItemsState(prev => prev.map((x, i) => i === realIdx ? {...x, project: e.target.value} : x))}
                                onBlur={() => setEditCustomCell(null)} placeholder="Custom..."
                                className="w-full bg-transparent border-b border-terracotta text-[12px] text-bark outline-none" />
                            ) : (
                              <select title={li.project || ""} value={li.project || ""}
                                onChange={(e) => {
                                  if (e.target.value === "__custom__") { setEditCustomCell({ idx: realIdx, field: "project" }); }
                                  else { setEditLineItemsState(prev => prev.map((x, i) => i === realIdx ? {...x, project: e.target.value} : x)); }
                                }}
                                className="w-full bg-transparent border-b border-transparent text-[12px] text-bark outline-none focus:border-terracotta hover:border-sand transition-colors cursor-pointer">
                                {getEditDelivOptions(li.description).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                {li.project && !getEditDelivOptions(li.description).includes(li.project) && <option value={li.project}>{li.project}</option>}
                                <option value="__custom__">✏️ Custom...</option>
                              </select>
                            )}
                          </td>
                          <td className="px-3 py-2 max-w-[220px]">
                            {editCustomCell?.idx === realIdx && editCustomCell?.field === "desc" ? (
                              <input autoFocus value={li.description} onChange={(e) => setEditLineItemsState(prev => prev.map((x, i) => i === realIdx ? {...x, description: e.target.value} : x))}
                                onBlur={() => setEditCustomCell(null)} placeholder="Custom..."
                                className="w-full bg-transparent border-b border-terracotta text-[12px] text-bark outline-none" />
                            ) : (
                              <select title={li.description} value={li.description}
                                onChange={(e) => {
                                  if (e.target.value === "__custom__") { setEditCustomCell({ idx: realIdx, field: "desc" }); }
                                  else { setEditLineItemsState(prev => prev.map((x, i) => i === realIdx ? {...x, description: e.target.value} : x)); }
                                }}
                                className="w-full bg-transparent border-b border-transparent text-[12px] text-bark outline-none focus:border-terracotta hover:border-sand transition-colors cursor-pointer">
                                {editTaskDescOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                <option value="__custom__">✏️ Custom...</option>
                              </select>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-bark whitespace-nowrap">{Math.round(Number(li.quantity) * 60)}</td>
                          <td className="px-3 py-2 max-w-[180px]">
                            <textarea value={li.client_memo || ""}
                              onChange={(e) => setEditLineItemsState(prev => prev.map((x, i) => i === realIdx ? {...x, client_memo: e.target.value} : x))}
                              onInput={(e) => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; }}
                              placeholder="—"
                              rows={1}
                              className="w-full bg-transparent border-b border-transparent text-[12px] text-bark outline-none focus:border-terracotta hover:border-sand transition-colors placeholder:text-stone resize-none overflow-hidden whitespace-pre-wrap break-words" />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button
                              onClick={() => {
                                setEditUndoStack((prev) => [...prev.slice(-19), editLineItemsState]);
                                setRemovedEditItems((prev) => [...prev, li]);
                                setEditLineItemsState((prev) => prev.filter((_, i) => i !== realIdx));
                              }}
                              title="Move to holding area"
                              className="inline-flex h-6 w-6 items-center justify-center rounded text-stone transition-colors hover:bg-amber-soft hover:text-amber cursor-pointer"
                            >
                              &times;
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Removed Edit Items Holding Cell */}
            {removedEditItems.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber/30 bg-amber-soft/20 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-amber">
                    On Hold ({removedEditItems.length}) — will be removed from invoice on save. NOT deleted from time log.
                  </p>
                  <button
                    onClick={() => {
                      setEditLineItemsState(prev => [...prev, ...removedEditItems]);
                      setRemovedEditItems([]);
                    }}
                    className="text-[10px] text-bark hover:text-terracotta cursor-pointer transition-colors"
                  >
                    Restore all
                  </button>
                </div>
                <div className="space-y-1">
                  {removedEditItems.map((li, idx) => (
                    <div key={li.id} className="flex items-start justify-between rounded bg-white/60 px-3 py-1.5 text-[11px] gap-2">
                      <span className="text-bark break-words min-w-0 flex-1">
                        {li.service_date ? new Date(li.service_date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: orgTimezone }) + " · " : ""}{li.va_name} · {li.description} · {Math.round(Number(li.quantity) * 60)} min
                      </span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <select
                          value={removedEditOverrides.get(idx)?.account ?? ""}
                          onChange={(e) => { const acc = e.target.value; const clientId = accountToClientMap[acc]; const clientName = clientId ? (clients.find(c => c.id === clientId)?.name ?? "") : ""; setRemovedEditOverrides(prev => { const next = new Map(prev); next.set(idx, { account: acc, client: clientName }); return next; }); }}
                          className="text-[11px] rounded border border-sand bg-white px-1 py-0.5 text-bark outline-none focus:border-terracotta cursor-pointer"
                        >
                          <option value="">Account...</option>
                          {accountList.map(a => <option key={a} value={a}>{a}</option>)}
                        </select>
                        <select
                          value={removedEditOverrides.get(idx)?.client ?? ""}
                          onChange={(e) => setRemovedEditOverrides(prev => { const next = new Map(prev); next.set(idx, { ...(prev.get(idx) ?? { account: "", client: "" }), client: e.target.value }); return next; })}
                          className="text-[11px] rounded border border-sand bg-white px-1 py-0.5 text-bark outline-none focus:border-terracotta cursor-pointer"
                        >
                          <option value="">Client...</option>
                          {clients.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                        </select>
                        <button
                          onClick={() => {
                            setEditLineItemsState((prev) => [...prev, li]);
                            setRemovedEditItems((prev) => prev.filter((_, i) => i !== idx));
                            setRemovedEditOverrides(prev => { const next = new Map(prev); next.delete(idx); return next; });
                          }}
                          className="text-[11px] font-semibold text-terracotta hover:underline cursor-pointer whitespace-nowrap"
                        >
                          ↩ Restore
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Record Payment Form */}
        {showPaymentForm && inv.status !== "paid" && (
          <div className="mb-4 rounded-xl border border-amber/30 bg-amber-soft/30 p-5">
            <h4 className="mb-4 font-serif text-[15px] font-bold text-espresso">Record Payment</h4>
            {paymentError && (
              <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-[12px] text-red-600">{paymentError}</div>
            )}
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
                onClick={() => { setShowPaymentForm(false); setPaymentError(""); }}
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
          <div className="mb-4 rounded-xl border border-sand bg-white p-5">
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
                        {new Date(pmt.payment_date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: orgTimezone })}
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

        {/* Invoice Preview */}
        <div className="rounded-xl border border-sand overflow-hidden print:border-none print:shadow-none" id="invoice-preview">
          {/* Yellow Header — 3 columns */}
          <div className="bg-[#f5c842] px-6 py-6">
            <div className="grid grid-cols-3">
              {/* Col 1: Client Info */}
              <div className="flex flex-col pr-5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#5a4000] mb-1">BILL TO:</div>
                {inv.account_name && (
                  <div className="text-[18px] font-extrabold text-[#2d1a00] leading-tight mb-0.5">{inv.account_name}</div>
                )}
                <div className={`font-extrabold text-[#2d1a00] leading-tight mb-1 ${inv.account_name ? "text-[13px]" : "text-[18px]"}`}>{inv.to_name}</div>
                {inv.to_contact && <div className="text-[11px] text-[#5a4000]">{inv.to_contact}</div>}
                {inv.to_email && <div className="text-[11px] text-[#5a4000]">{inv.to_email}</div>}
                {inv.to_phone && <div className="text-[11px] text-[#5a4000]">{inv.to_phone}</div>}
                {inv.to_address && <div className="text-[10px] text-[#5a4000] mt-0.5">{inv.to_address}</div>}
                <div className="mt-3">
                  {(() => {
                    const prevBal = Number(inv.previous_balance || 0);
                    const currentBal = Number(inv.total) + prevBal;
                    return (
                      <>
                        <div className="text-[9px] font-semibold uppercase tracking-wide text-[#5a4000]">
                          {prevBal > 0 ? "Balance Due" : "Invoice Amount"}
                        </div>
                        <div className="text-[24px] font-extrabold text-[#2d1a00]">
                          {formatCurrency(prevBal > 0 ? currentBal : Number(inv.total), inv.currency)}
                        </div>
                        <div className="mt-2">
                          <div className="text-[9px] font-bold uppercase tracking-wider text-[#5a4000]">Invoice Date</div>
                          <div className="text-[13px] font-semibold text-[#2d1a00] mt-1">
                            {inv.period_start && inv.period_end
                              ? `${new Date(inv.period_start + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: orgTimezone })} – ${new Date(inv.period_end + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: orgTimezone })}`
                              : new Date(inv.issue_date + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: orgTimezone })
                            }
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
              {/* Col 2: Invoice From */}
              <div className="flex flex-col border-x border-[#c9a820] px-5">
                <div className="text-[9px] font-bold uppercase tracking-widest text-[#5a4000] mb-1">INVOICE FROM:</div>
                <div className="text-[14px] font-bold text-[#2d1a00]">{inv.from_name}</div>
                {orgSettings?.registered_business_name && (
                  <div className="text-[11px] text-[#5a4000] mt-0.5">{orgSettings.registered_business_name}</div>
                )}
                {orgSettings?.dba && (
                  <div className="text-[10px] text-[#5a4000] mt-0.5">DBA: {orgSettings.dba}</div>
                )}
                {inv.from_phone && <div className="text-[11px] text-[#5a4000] mt-0.5">{inv.from_phone}</div>}
                {inv.from_email && <div className="text-[11px] text-[#5a4000] mt-0.5">{inv.from_email}</div>}
                {inv.service_type && <div className="text-[11px] font-semibold text-[#5a4000] mt-1">{inv.service_type}</div>}
                <div className="mt-3">
                  <div className="text-[11px] font-bold text-[#2d1a00]">#{inv.invoice_number}</div>
                  {inv.due_date && (
                    <div className="text-[10px] text-[#5a4000] mt-0.5">
                      Due: {new Date(inv.due_date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: orgTimezone })}
                    </div>
                  )}
                  <div className="mt-1">
                    <span className={`inline-block rounded-full px-3 py-0.5 text-[10px] font-bold uppercase ${statusBadge(inv.status)}`}>
                      {statusLabel(inv.status)}
                    </span>
                  </div>
                </div>
              </div>
              {/* Col 3: Payment Methods */}
              <div className="flex flex-col items-end text-right pl-5">
                <div className="text-[9px] font-bold uppercase tracking-widest text-[#5a4000] mb-2">HOW TO PAY</div>
                {inv.payment_info && (
                  <div className="text-[11px] text-[#5a4000] whitespace-pre-line mb-2">{inv.payment_info}</div>
                )}
                {inv.payment_link && (
                  <div className="mt-1">
                    <a href={inv.payment_link} target="_blank" rel="noopener noreferrer"
                      className="inline-block bg-[#2d1a00] text-[#f5c842] text-[12px] font-bold px-4 py-1.5 rounded-md hover:opacity-90 transition-opacity">
                      Pay Online
                    </a>
                    <div className="text-[10px] text-[#5a4000] mt-1">Card processing fee applies</div>
                  </div>
                )}
                {!inv.payment_link && !inv.payment_info && (
                  <div className="text-[11px] text-[#7a6040] italic">Contact us for payment options</div>
                )}
              </div>
            </div>
          </div>
          <div className="bg-white p-8">

            {/* Invoice Summary Box — responsive grid, only filled fields */}
            <div className="mb-6 rounded-lg border border-sand bg-parchment/30 p-5">
              {(() => {
                const grossHours = selectedLineItems.filter((li) => !li.expense_id).reduce((s, li) => s + Number(li.quantity), 0);
                const notBilled = Number(inv.hours_not_billed || 0);
                const billedHours = grossHours - notBilled;
                const hasAdj = Number(inv.adjustment_amount || 0) > 0;
                const prevBal = Number(inv.previous_balance || 0);
                const currentBal = Number(inv.total) + prevBal;
                const reimbTotal = selectedLineItems.filter((li) => li.expense_id).reduce((s, li) => s + Number(li.amount), 0);

                type BItem = { label: string; value: string; accent?: boolean; tooltip?: string };

                // Hours items — only non-empty values
                const hoursItems: BItem[] = [];
                if (invoiceType !== "custom") {
                  if (inv.rate_amount != null) {
                    hoursItems.push({ label: "Rate per hr", value: `${formatCurrency(Number(inv.rate_amount))}/hr` });
                  }
                  if (notBilled > 0) {
                    hoursItems.push({ label: "Gross Hours", value: grossHours.toFixed(2) });
                    hoursItems.push({ label: inv.hours_not_billed_label || "Unbilled Hours", value: `${notBilled.toFixed(2)} hrs` });
                  }
                  hoursItems.push({ label: "Hours Billed", value: billedHours.toFixed(2) });
                }

                // Money items — only non-empty values
                const moneyItems: BItem[] = [
                  { label: "Total Hours Amount", value: formatCurrency(Number(inv.subtotal) - reimbTotal, inv.currency) },
                  ...(reimbTotal > 0 ? [{ label: "Reimbursable Expenses", value: formatCurrency(reimbTotal, inv.currency) }] : []),
                  ...(hasAdj ? [
                    { label: "Savings", value: `− ${formatCurrency(Number(inv.adjustment_amount))}` },
                    { label: "Current Month's Amount", value: formatCurrency(Number(inv.total), inv.currency), accent: true },
                  ] : []),
                  ...(prevBal > 0 ? [{ label: "Previous Balance", value: formatCurrency(prevBal, inv.currency), tooltip: inv.previous_balance_note || "Balance carried over from a previous invoice" }] : []),
                ];

                const renderGrid = (items: BItem[]) => (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-3">
                    {items.map(({ label, value, accent, tooltip }) => (
                      <div key={label} className="rounded-lg border border-sand bg-parchment/50 p-2.5 text-center">
                        <p className="text-[9px] font-semibold uppercase tracking-wider text-bark flex items-center justify-center gap-1">
                          {label}
                          {tooltip && (
                            <span
                              className="w-3.5 h-3.5 rounded-full bg-amber-200 text-amber-800 text-[8px] font-bold inline-flex items-center justify-center leading-none cursor-help"
                              title={tooltip}
                            >?</span>
                          )}
                        </p>
                        <p className={`mt-1 text-[16px] font-bold ${accent ? "text-terracotta" : "text-espresso"}`}>{value}</p>
                      </div>
                    ))}
                  </div>
                );

                return (
                  <>
                    {hoursItems.length > 0 && renderGrid(hoursItems)}
                    {renderGrid(moneyItems)}
                    <div className="rounded-lg border-2 border-terracotta bg-[#fff8f5] p-3 text-center">
                      <p className="text-[9px] font-semibold uppercase tracking-wider text-bark">Final Balance Due</p>
                      <p className="mt-1 text-[22px] font-extrabold text-terracotta">{formatCurrency(currentBal, inv.currency)}</p>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Reimbursable Expenses Section */}
            {selectedLineItems.some((li) => li.expense_id) && (
              <div className="mb-6 rounded-lg border border-amber-200 overflow-hidden">
                <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700">Reimbursable Expenses</p>
                </div>
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-amber-100 bg-amber-50/50 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                      <th className="px-4 py-3">Date</th>
                      <th className="px-3 py-3">Description</th>
                      <th className="px-3 py-3">Account</th>
                      <th className="px-3 py-3 text-right">Amount</th>
                      <th className="px-4 py-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-50">
                    {selectedLineItems.filter((li) => li.expense_id).map((li) => {
                      const isSettled = expenseSettledMap[li.expense_id as number] ?? false;
                      return (
                        <tr key={li.id} className="hover:bg-amber-50/50 transition-colors">
                          <td className="px-4 py-3 text-bark text-[11px]">{li.service_date || "—"}</td>
                          <td className="px-3 py-3 text-espresso font-medium">
                            <span className="flex items-center gap-1">
                              {li.description}
                              {li.client_memo && (
                                <span className="relative inline-block flex-shrink-0">
                                  <button
                                    onClick={() => setOpenDetailNoteId(openDetailNoteId === li.id ? null : li.id)}
                                    className="w-4 h-4 rounded-full bg-amber-200 text-amber-800 text-[9px] font-bold inline-flex items-center justify-center hover:bg-amber-300 cursor-pointer leading-none"
                                  >?</button>
                                  {openDetailNoteId === li.id && (
                                    <div className="absolute z-20 left-5 top-0 bg-white border border-amber-200 rounded-lg shadow-lg p-2.5 text-[11px] text-bark w-52 whitespace-pre-wrap">
                                      {li.client_memo}
                                    </div>
                                  )}
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-bark">{li.account_name || "—"}</td>
                          <td className="px-3 py-3 text-right font-medium text-espresso">${Number(li.amount).toFixed(2)}</td>
                          <td className="px-4 py-3 text-center">
                            {isSettled ? (
                              <button
                                onClick={async () => {
                                  await supabase
                                    .from("financial_expenses")
                                    .update({ reimbursed: false })
                                    .eq("id", li.expense_id as number);
                                  setExpenseSettledMap((prev) => ({ ...prev, [li.expense_id as number]: false }));
                                }}
                                className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold bg-sage-soft text-sage hover:bg-red-100 hover:text-red-600 cursor-pointer transition-colors"
                              >
                                Mark Unsettled
                              </button>
                            ) : (
                              <button
                                onClick={async () => {
                                  await supabase
                                    .from("financial_expenses")
                                    .update({ reimbursed: true })
                                    .eq("id", li.expense_id as number);
                                  setExpenseSettledMap((prev) => ({ ...prev, [li.expense_id as number]: true }));
                                }}
                                className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold bg-parchment text-bark hover:bg-amber-100 hover:text-amber-700 cursor-pointer transition-colors"
                              >
                                Mark Settled
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Task Summary + Project Summary */}
            {selectedLineItems.length > 0 && (() => {
              // Group by task name
              const taskMap: Record<string, number> = {};
              selectedLineItems.forEach((li) => {
                const key = li.description || "Unknown";
                taskMap[key] = (taskMap[key] || 0) + Number(li.quantity);
              });
              const taskSummary = Object.entries(taskMap).sort((a, b) => b[1] - a[1]);

              // Group by project
              const projMap: Record<string, number> = {};
              selectedLineItems.forEach((li) => {
                const key = li.project || li.account_name || "Unassigned";
                projMap[key] = (projMap[key] || 0) + Number(li.quantity);
              });
              const projSummary = Object.entries(projMap).sort((a, b) => b[1] - a[1]);

              const fmtH = (h: number) => {
                const hrs = Math.floor(h);
                const mins = Math.round((h - hrs) * 60);
                return mins > 0 ? `${hrs} hrs ${mins} mins` : `${hrs} hrs`;
              };

              return (
                <div className="mb-6 grid grid-cols-2 gap-4">
                  <div className="rounded-lg bg-espresso p-4">
                    <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-amber">Top Task Summary</p>
                    <div className="space-y-2">
                      {taskSummary.map(([task, hrs]) => (
                        <div key={task} className="flex items-center justify-between">
                          <span className="text-[12px] text-parchment/80 truncate max-w-[65%]">{task}</span>
                          <span className="text-[12px] font-semibold text-white">{fmtH(hrs)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg bg-espresso p-4">
                    <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-amber">Top Deliverables / Objectives</p>
                    <div className="space-y-2">
                      {projSummary.map(([proj, hrs]) => (
                        <div key={proj} className="flex items-center justify-between">
                          <span className="text-[12px] text-parchment/80 truncate max-w-[65%]">{proj}</span>
                          <span className="text-[12px] font-semibold text-white">{fmtH(hrs)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Time Allocation Table */}
            <div className="mb-6 rounded-lg border border-sand overflow-hidden">
              <div className="px-4 py-2.5 bg-parchment/30 border-b border-sand">
                <p className="text-[10px] font-bold uppercase tracking-widest text-bark">Detailed Time Allocation</p>
              </div>
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="border-b border-sand bg-parchment/20 text-[10px] font-semibold uppercase tracking-wider text-bark">
                    <th className="px-4 py-3 text-right">Time in Minutes</th>
                    <th className="px-3 py-3">Task Description</th>
                    <th className="px-3 py-3">Deliverables / Objectives</th>
                    <th className="px-4 py-3">Memo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-parchment">
                  {selectedLineItems.filter((li) => !li.expense_id).map((li) => (
                    <tr key={li.id} className="hover:bg-parchment/20 transition-colors">
                      <td className="px-4 py-3 text-right font-medium text-espresso">{Math.round(Number(li.quantity) * 60)}</td>
                      <td className="px-3 py-3 text-bark">{li.description}</td>
                      <td className="px-3 py-3 text-bark">{li.project || li.account_name || "-"}</td>
                      <td className="px-4 py-3 text-bark text-[11px] max-w-[250px]">{li.client_memo || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="flex justify-end">
              <div className="w-72 space-y-2">
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
                      {new Date(inv.paid_date + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: orgTimezone })}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Notes + Payment Link */}
            {(inv.notes || inv.payment_link) && (
              <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {inv.notes && (
                  <div className="rounded-lg bg-parchment/30 p-4">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-bark">Notes</p>
                    <p className="text-[12px] text-bark whitespace-pre-line">{inv.notes}</p>
                  </div>
                )}
                {inv.payment_link && (
                  <div className="rounded-lg bg-parchment/30 p-4">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-bark">Payment Link</p>
                    <a href={inv.payment_link} target="_blank" rel="noopener noreferrer" className="text-[12px] text-terracotta hover:underline break-all">
                      {inv.payment_link}
                    </a>
                    {inv.reminder_enabled && (
                      <p className="mt-2 text-[11px] text-bark">🔔 Daily reminder emails active</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

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
          {(["all", "draft", "ready_to_send", "sent", "partially_paid", "paid", "overdue", "cancelled", "trash"] as const).map((status) => (
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
                      {new Date(inv.issue_date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: orgTimezone })}
                    </td>
                    <td className="px-3 py-3 text-bark">
                      {inv.due_date
                        ? new Date(inv.due_date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: orgTimezone })
                        : "-"}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-espresso">
                      {formatCurrency(Number(inv.total), inv.currency)}
                    </td>
                    <td className="px-3 py-3 text-right text-bark">
                      {inv.status === "paid"
                        ? <span className="text-sage font-semibold">{formatCurrency(0)}</span>
                        : Number(inv.amount_paid || 0) > 0
                          ? <span className="text-terracotta font-semibold">{formatCurrency(Number(inv.total) + Number(inv.previous_balance || 0) - Number(inv.amount_paid || 0))}</span>
                          : formatCurrency(Number(inv.total) + Number(inv.previous_balance || 0))}
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
                        {(inv.status === "sent" || inv.status === "overdue" || inv.status === "partially_paid") && inv.to_email && (
                          <button
                            onClick={() => handleSendReminder(inv)}
                            disabled={sendingReminder === inv.id}
                            title="Send Gentle Reminder"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-sand text-bark transition-all hover:border-amber-500 hover:text-amber-500 disabled:opacity-50 cursor-pointer"
                          >
                            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                            </svg>
                          </button>
                        )}
                        {inv.status !== "paid" && inv.status !== "cancelled" && inv.status !== "trash" && (
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
                        {inv.status === "trash" ? (
                          <>
                            <button
                              onClick={() => handleRestoreInvoice(inv)}
                              title="Restore from Trash"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-sand text-bark transition-all hover:border-terracotta hover:text-terracotta cursor-pointer"
                            >
                              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="1 4 1 10 7 10" />
                                <path d="M3.51 15a9 9 0 1 0 .49-3.5" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handlePermanentDelete(inv)}
                              title="Permanently Delete"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-sand text-bark transition-all hover:border-red-500 hover:text-red-500 cursor-pointer"
                            >
                              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                                <path d="M10 11v6M14 11v6" />
                                <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          </>
                        ) : (inv.status === "draft" || inv.status === "sent") && (
                          <button
                            onClick={() => handleTrashInvoice(inv)}
                            title="Move to Trash"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-sand text-bark transition-all hover:border-red-400 hover:text-red-400 cursor-pointer"
                          >
                            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                              <path d="M10 11v6M14 11v6" />
                              <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
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
