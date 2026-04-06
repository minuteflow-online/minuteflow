"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TimeLog, TaskScreenshot, Profile } from "@/types/database";
import EditTimeLogModal from "./EditTimeLogModal";
import CorrectionRequestModal from "./CorrectionRequestModal";
import ScreenshotLightbox from "./ScreenshotLightbox";

interface ActivityLogProps {
  logs: TimeLog[];
  screenshots: Record<number, TaskScreenshot[]>;
  onAddScreenshot: (logId: number) => void;
  role?: string;
  currentUserId?: string;
  profiles?: Profile[];
  onRefresh?: () => void;
  timezone?: string;
  onResumeTask?: (log: TimeLog) => void;
  onUpdateProgress?: (logId: number, progress: string) => void;
}

const AVATAR_COLORS: Record<string, string> = {};
const COLOR_POOL = [
  "var(--color-terracotta)",
  "var(--color-sage)",
  "var(--color-clay-rose)",
  "var(--color-slate-blue)",
  "var(--color-walnut)",
  "var(--color-stone)",
  "var(--color-amber)",
];

function getUserColor(username: string): string {
  if (!AVATAR_COLORS[username]) {
    const idx = Object.keys(AVATAR_COLORS).length % COLOR_POOL.length;
    AVATAR_COLORS[username] = COLOR_POOL[idx];
  }
  return AVATAR_COLORS[username];
}

function getCategoryTag(category: string): { bg: string; text: string } {
  switch (category.toLowerCase()) {
    case "task":
      return { bg: "bg-terracotta-soft", text: "text-terracotta" };
    case "break":
      return { bg: "bg-amber-soft", text: "text-amber" };
    case "message":
      return { bg: "bg-slate-blue-soft", text: "text-slate-blue" };
    case "meeting":
      return { bg: "bg-clay-rose-soft", text: "text-clay-rose" };
    case "personal":
      return { bg: "bg-parchment", text: "text-walnut" };
    case "sorting":
    case "sorting tasks":
      return { bg: "bg-amber-soft", text: "text-amber" };
    case "collaboration":
      return { bg: "bg-terracotta-soft", text: "text-terracotta" };
    case "clock out":
      return { bg: "bg-stone/10", text: "text-stone" };
    default:
      return { bg: "bg-parchment", text: "text-walnut" };
  }
}

function formatDuration(ms: number, billingType?: string): string {
  if (billingType === "fixed") return "Fixed";
  if (ms <= 0) return "0:00";
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const seconds = Math.floor((ms % 60000) / 1000);
  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatHoursMinutes(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  return `${minutes}m`;
}

function formatTime(iso: string, timezone?: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    timeZone: timezone || "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDate(iso: string, timezone?: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    timeZone: timezone || "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getDurationClass(log: TimeLog): string {
  if (!log.billable) {
    if (log.category.toLowerCase() === "break") return "text-amber";
    return "text-walnut";
  }
  return "text-sage";
}

/* ── Pencil Icon SVG ──────────────────────────────────── */

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

export default function ActivityLog({
  logs,
  screenshots,
  onAddScreenshot,
  role = "va",
  currentUserId = "",
  profiles = [],
  onRefresh,
  timezone,
  onResumeTask,
  onUpdateProgress,
}: ActivityLogProps) {
  const isAdminOrManager = role === "admin" || role === "manager";
  const [search, setSearch] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(""); // "in_progress" | "completed" | "on_hold" | ""
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);

  // Edit/create modal
  const [editingLog, setEditingLog] = useState<TimeLog | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Correction request modal
  const [correctionLog, setCorrectionLog] = useState<TimeLog | null>(null);

  // Memo popup
  const [memoPopup, setMemoPopup] = useState<number | null>(null);

  // Inline memo editing
  const [editingMemoLogId, setEditingMemoLogId] = useState<number | null>(null);
  const [editClientMemo, setEditClientMemo] = useState("");
  const [editInternalMemo, setEditInternalMemo] = useState("");
  const [savingMemo, setSavingMemo] = useState(false);
  const supabaseClient = createClient();

  const startEditMemo = useCallback((log: TimeLog, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingMemoLogId(log.id);
    setEditClientMemo(log.client_memo || "");
    setEditInternalMemo(log.internal_memo || "");
  }, []);

  const cancelEditMemo = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingMemoLogId(null);
  }, []);

  const saveMemo = useCallback(async (logId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSavingMemo(true);
    await supabaseClient.from("time_logs").update({
      client_memo: editClientMemo || null,
      internal_memo: editInternalMemo || null,
    }).eq("id", logId);
    setSavingMemo(false);
    setEditingMemoLogId(null);
    if (onRefresh) onRefresh();
  }, [supabaseClient, editClientMemo, editInternalMemo, onRefresh]);

  // Expanded row (shows full text for long fields + memos)
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // Progress dropdown (clickable status labels)
  const [progressDropdown, setProgressDropdown] = useState<number | null>(null);

  // Close progress dropdown on click outside
  useEffect(() => {
    if (!progressDropdown) return;
    const handleClick = () => setProgressDropdown(null);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [progressDropdown]);

  // Screenshot signed URLs + lightbox
  const [signedUrls, setSignedUrls] = useState<Record<number, string>>({});
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Edited log IDs (for "edited" indicator)
  const [editedLogIds, setEditedLogIds] = useState<Set<number>>(new Set());

  // Load edited log IDs on mount
  useEffect(() => {
    async function loadEditedIds() {
      const supabase = createClient();
      const { data } = await supabase
        .from("time_log_edits")
        .select("log_id");
      if (data) {
        const ids = new Set(data.map((d: { log_id: number }) => d.log_id));
        setEditedLogIds(ids);
      }
    }
    loadEditedIds();
  }, [logs]);

  // Generate signed URLs for screenshots visible in the table (all users)
  const allVisibleScreenshots = useMemo(() => {
    const all: TaskScreenshot[] = [];
    Object.values(screenshots).forEach((arr) => all.push(...arr));
    // VAs only see their own screenshots
    if (!isAdminOrManager) {
      return all.filter((s) => s.user_id === currentUserId);
    }
    return all;
  }, [screenshots, isAdminOrManager, currentUserId]);

  const loadSignedUrls = useCallback(async () => {
    if (allVisibleScreenshots.length === 0) return;
    const supabase = createClient();
    const missing = allVisibleScreenshots.filter((s) => !signedUrls[s.id]);
    if (missing.length === 0) return;

    const newUrls: Record<number, string> = { ...signedUrls };
    // Batch of 20 at a time
    for (let i = 0; i < missing.length; i += 20) {
      const batch = missing.slice(i, i + 20);
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
    setSignedUrls(newUrls);
  }, [allVisibleScreenshots, signedUrls]);

  useEffect(() => {
    loadSignedUrls();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allVisibleScreenshots.length]);

  // Derive unique users from log entries
  const uniqueUsers = useMemo(() => {
    const map = new Map<string, { username: string; count: number }>();
    logs.forEach((log) => {
      const entry = map.get(log.username);
      if (entry) {
        entry.count++;
      } else {
        map.set(log.username, { username: log.username, count: 1 });
      }
    });
    return Array.from(map.values());
  }, [logs]);

  // Static category list (always show all options in filter)
  const ALL_CATEGORIES = ["Task", "Communication", "Meeting", "Planning", "Collaboration", "Personal", "Break"];
  const uniqueCategories = ALL_CATEGORIES;

  const uniqueAccounts = useMemo(() => {
    return [...new Set(logs.map((l) => l.account).filter(Boolean))] as string[];
  }, [logs]);

  // Today's date string for filtering
  const todayStr = useMemo(() => {
    const tz = timezone || "America/New_York";
    return new Date().toLocaleDateString("en-CA", { timeZone: tz }); // "YYYY-MM-DD"
  }, [timezone]);

  // Separate today's logs, past in-progress logs, and past on-hold logs
  const { todayLogs: allTodayLogs, pastInProgressLogs, pastOnHoldLogs } = useMemo(() => {
    const tz = timezone || "America/New_York";
    const today: TimeLog[] = [];
    const pastIP: TimeLog[] = [];
    const pastOH: TimeLog[] = [];

    logs.forEach((log) => {
      const logDate = new Date(log.start_time).toLocaleDateString("en-CA", { timeZone: tz });
      if (logDate === todayStr) {
        today.push(log);
      } else if (log.progress === "in_progress") {
        pastIP.push(log);
      } else if (log.progress === "on_hold") {
        pastOH.push(log);
      }
    });

    return { todayLogs: today, pastInProgressLogs: pastIP, pastOnHoldLogs: pastOH };
  }, [logs, todayStr, timezone]);

  // Apply filters + sort (live entries first, then by most recent)
  const filteredLogs = useMemo(() => {
    const filtered = allTodayLogs.filter((log) => {
      if (selectedUsers.size > 0 && !selectedUsers.has(log.username)) return false;
      if (search) {
        const q = search.toLowerCase();
        const match =
          log.task_name.toLowerCase().includes(q) ||
          log.username.toLowerCase().includes(q) ||
          log.full_name.toLowerCase().includes(q) ||
          (log.account || "").toLowerCase().includes(q) ||
          (log.project || "").toLowerCase().includes(q);
        if (!match) return false;
      }
      if (categoryFilter && log.category !== categoryFilter) return false;
      if (accountFilter && log.account !== accountFilter) return false;
      if (statusFilter && log.progress !== statusFilter) return false;
      return true;
    });

    // Sort: live (no end_time) first, then by start_time descending
    return filtered.sort((a, b) => {
      const aLive = !a.end_time ? 1 : 0;
      const bLive = !b.end_time ? 1 : 0;
      if (aLive !== bLive) return bLive - aLive;
      return new Date(b.start_time).getTime() - new Date(a.start_time).getTime();
    });
  }, [allTodayLogs, selectedUsers, search, categoryFilter, accountFilter, statusFilter]);

  // Filter past in-progress logs with same filters
  const filteredPastIP = useMemo(() => {
    return pastInProgressLogs.filter((log) => {
      if (selectedUsers.size > 0 && !selectedUsers.has(log.username)) return false;
      if (search) {
        const q = search.toLowerCase();
        const match =
          log.task_name.toLowerCase().includes(q) ||
          log.username.toLowerCase().includes(q) ||
          log.full_name.toLowerCase().includes(q) ||
          (log.account || "").toLowerCase().includes(q) ||
          (log.project || "").toLowerCase().includes(q);
        if (!match) return false;
      }
      if (categoryFilter && log.category !== categoryFilter) return false;
      if (accountFilter && log.account !== accountFilter) return false;
      return true;
    }).sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
  }, [pastInProgressLogs, selectedUsers, search, categoryFilter, accountFilter]);

  // Filter past on-hold logs with same filters
  const filteredPastOnHold = useMemo(() => {
    return pastOnHoldLogs.filter((log) => {
      if (selectedUsers.size > 0 && !selectedUsers.has(log.username)) return false;
      if (search) {
        const q = search.toLowerCase();
        const match =
          log.task_name.toLowerCase().includes(q) ||
          log.username.toLowerCase().includes(q) ||
          log.full_name.toLowerCase().includes(q) ||
          (log.account || "").toLowerCase().includes(q) ||
          (log.project || "").toLowerCase().includes(q);
        if (!match) return false;
      }
      if (categoryFilter && log.category !== categoryFilter) return false;
      if (accountFilter && log.account !== accountFilter) return false;
      return true;
    }).sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
  }, [pastOnHoldLogs, selectedUsers, search, categoryFilter, accountFilter]);

  // Summary — today's logs only, with fixed/hourly & status breakdowns
  const summary = useMemo(() => {
    let totalMs = 0;
    let personalMs = 0;
    let wizardMs = 0;
    let fixedCount = 0;
    let hourlyCount = 0;
    let inProgressCount = 0;
    let completedCount = 0;
    let onHoldCount = 0;
    const categoryMs: Record<string, number> = {};

    filteredLogs.forEach((log) => {
      totalMs += log.duration_ms;
      wizardMs += log.form_fill_ms || 0;

      // Accumulate per-category
      const cat = log.category;
      categoryMs[cat] = (categoryMs[cat] || 0) + log.duration_ms;

      if (cat.toLowerCase() === "personal") {
        personalMs += log.duration_ms;
      }

      // Fixed vs hourly
      if (log.billing_type === "fixed") fixedCount++;
      else hourlyCount++;

      // Progress status
      if (log.progress === "in_progress") inProgressCount++;
      else if (log.progress === "completed") completedCount++;
      else if (log.progress === "on_hold") onHoldCount++;
    });

    const billableMs = totalMs - personalMs;

    // Build sorted category entries (alphabetical, but Personal last)
    const categoryEntries = Object.entries(categoryMs)
      .filter(([, ms]) => ms > 0)
      .sort(([a], [b]) => {
        if (a.toLowerCase() === "personal") return 1;
        if (b.toLowerCase() === "personal") return -1;
        return a.localeCompare(b);
      })
      .map(([name, ms]) => ({ name, formatted: formatHoursMinutes(ms) }));

    return {
      total: formatHoursMinutes(totalMs),
      billable: formatHoursMinutes(billableMs),
      wizard: formatHoursMinutes(wizardMs),
      entries: filteredLogs.length,
      categories: categoryEntries,
      fixedCount,
      hourlyCount,
      inProgressCount,
      completedCount,
      onHoldCount,
    };
  }, [filteredLogs]);

  const toggleUser = (username: string) => {
    setSelectedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(username)) {
        next.delete(username);
      } else {
        next.add(username);
      }
      return next;
    });
  };

  const clearFilters = () => {
    setSearch("");
    setSelectedUsers(new Set());
    setCategoryFilter("");
    setAccountFilter("");
    setStatusFilter("");
  };

  const hasActiveFilters =
    search || selectedUsers.size > 0 || categoryFilter || accountFilter || statusFilter;

  const handleModalSaved = () => {
    setEditingLog(null);
    setShowCreateModal(false);
    setCorrectionLog(null);
    onRefresh?.();
  };

  const colCount = isAdminOrManager ? 9 : 7;

  return (
    <>
      <div className="bg-white border border-sand rounded-xl mb-6">
        {/* Header */}
        <div className="py-4 px-5 border-b border-parchment flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-espresso">Activity Log</h3>
            <span className="text-[10px] font-medium text-bark bg-parchment px-2 py-0.5 rounded-full">Today</span>
          </div>
          <div className="flex gap-2 items-center">
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-terracotta px-3 py-1.5 text-[11px] font-semibold text-white transition-all hover:bg-[#a85840] cursor-pointer"
            >
              <span className="text-sm leading-none">+</span>
              {isAdminOrManager ? "Add Time Entry" : "Request Time Entry"}
            </button>
            <span className="text-[11px] text-bark">
              {filteredLogs.length} entries today
            </span>
          </div>
        </div>

        {/* User pills */}
        <div className="flex gap-1.5 py-3 px-5 border-b border-parchment overflow-x-auto">
          <button
            onClick={() => setSelectedUsers(new Set())}
            className={`inline-flex items-center gap-1.5 py-[5px] px-[13px] rounded-full text-xs font-medium border cursor-pointer transition-all whitespace-nowrap ${
              selectedUsers.size === 0
                ? "bg-espresso text-cream border-espresso"
                : "border-sand bg-white text-bark hover:border-terracotta hover:text-terracotta"
            }`}
          >
            All
          </button>
          {uniqueUsers.map((user) => (
            <button
              key={user.username}
              onClick={() => toggleUser(user.username)}
              className={`inline-flex items-center gap-1.5 py-[5px] px-[13px] rounded-full text-xs font-medium border cursor-pointer transition-all whitespace-nowrap ${
                selectedUsers.has(user.username)
                  ? "bg-espresso text-cream border-espresso"
                  : "border-sand bg-white text-bark hover:border-terracotta hover:text-terracotta"
              }`}
            >
              <span
                className="w-[18px] h-[18px] rounded-full text-[9px] font-bold text-white inline-flex items-center justify-center"
                style={{ backgroundColor: getUserColor(user.username) }}
              >
                {user.username[0]?.toUpperCase()}
              </span>
              {user.username}
              <span className="text-[10px] opacity-60">{user.count}</span>
            </button>
          ))}
        </div>

        {/* Toolbar */}
        <div className="py-3 px-5 border-b border-parchment flex items-center gap-2.5 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-[15px] h-[15px] text-stone"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks..."
              className="w-full py-2 pl-[34px] pr-3 border border-sand rounded-lg text-xs outline-none bg-white text-ink transition-colors focus:border-terracotta placeholder:text-stone"
            />
          </div>

          {/* Category filter */}
          <div className="relative">
            <button
              onClick={() => {
                setShowCategoryDropdown(!showCategoryDropdown);
                setShowAccountDropdown(false);
              }}
              className={`py-1.5 px-3 border rounded-full text-[11px] font-medium cursor-pointer bg-white transition-all ${
                categoryFilter
                  ? "border-terracotta text-terracotta"
                  : "border-sand text-bark hover:border-terracotta hover:text-terracotta"
              }`}
            >
              {categoryFilter || "Category"}
            </button>
            {showCategoryDropdown && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-sand rounded-lg shadow-lg z-10 min-w-[140px] py-1">
                <button
                  onClick={() => {
                    setCategoryFilter("");
                    setShowCategoryDropdown(false);
                  }}
                  className="block w-full text-left px-3 py-1.5 text-xs text-bark hover:bg-parchment transition-colors"
                >
                  All Categories
                </button>
                {uniqueCategories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => {
                      setCategoryFilter(cat);
                      setShowCategoryDropdown(false);
                    }}
                    className="block w-full text-left px-3 py-1.5 text-xs text-bark hover:bg-parchment transition-colors"
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Account filter */}
          <div className="relative">
            <button
              onClick={() => {
                setShowAccountDropdown(!showAccountDropdown);
                setShowCategoryDropdown(false);
              }}
              className={`py-1.5 px-3 border rounded-full text-[11px] font-medium cursor-pointer bg-white transition-all ${
                accountFilter
                  ? "border-terracotta text-terracotta"
                  : "border-sand text-bark hover:border-terracotta hover:text-terracotta"
              }`}
            >
              {accountFilter || "Account"}
            </button>
            {showAccountDropdown && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-sand rounded-lg shadow-lg z-10 min-w-[160px] py-1">
                <button
                  onClick={() => {
                    setAccountFilter("");
                    setShowAccountDropdown(false);
                  }}
                  className="block w-full text-left px-3 py-1.5 text-xs text-bark hover:bg-parchment transition-colors"
                >
                  All Accounts
                </button>
                {uniqueAccounts.map((acct) => (
                  <button
                    key={acct}
                    onClick={() => {
                      setAccountFilter(acct);
                      setShowAccountDropdown(false);
                    }}
                    className="block w-full text-left px-3 py-1.5 text-xs text-bark hover:bg-parchment transition-colors"
                  >
                    {acct}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Status filter pills */}
          <div className="flex gap-1">
            {[
              { value: "in_progress", label: "In Progress", color: "terracotta" },
              { value: "completed", label: "Completed", color: "sage" },
              { value: "on_hold", label: "On Hold", color: "amber" },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setStatusFilter(statusFilter === opt.value ? "" : opt.value)}
                className={`py-1.5 px-2.5 border rounded-full text-[10px] font-semibold cursor-pointer transition-all ${
                  statusFilter === opt.value
                    ? opt.color === "terracotta" ? "border-terracotta bg-terracotta/10 text-terracotta"
                    : opt.color === "sage" ? "border-sage bg-sage/10 text-sage"
                    : "border-amber bg-amber/10 text-amber-700"
                    : "border-sand bg-white text-bark hover:border-terracotta hover:text-terracotta"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="py-1.5 px-3 border border-terracotta-soft rounded-full text-[11px] font-medium text-terracotta cursor-pointer bg-white transition-all hover:bg-terracotta-soft"
            >
              Clear
            </button>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[820px]">
            <thead>
              <tr>
                {isAdminOrManager && (
                  <th className="py-[11px] px-3 text-left text-[11px] font-semibold text-bark bg-parchment border-b border-sand whitespace-nowrap tracking-wide">
                    User
                  </th>
                )}
                <th className="py-[11px] px-3 text-left text-[11px] font-semibold text-bark bg-parchment border-b border-sand whitespace-nowrap tracking-wide">
                  Project
                </th>
                <th className="py-[11px] px-3 text-left text-[11px] font-semibold text-bark bg-parchment border-b border-sand whitespace-nowrap tracking-wide">
                  Task
                </th>
                <th className="py-[11px] px-3 text-left text-[11px] font-semibold text-bark bg-parchment border-b border-sand whitespace-nowrap tracking-wide">
                  Category
                </th>
                <th className="py-[11px] px-3 text-left text-[11px] font-semibold text-bark bg-parchment border-b border-sand whitespace-nowrap tracking-wide">
                  Account
                </th>
                <th className="py-[11px] px-3 text-left text-[11px] font-semibold text-bark bg-parchment border-b border-sand whitespace-nowrap tracking-wide">
                  Duration
                </th>
                <th className="py-[11px] px-3 text-left text-[11px] font-semibold text-bark bg-parchment border-b border-sand whitespace-nowrap tracking-wide">
                  Progress
                </th>
                <th className="py-[11px] px-3 text-left text-[11px] font-semibold text-bark bg-parchment border-b border-sand whitespace-nowrap tracking-wide">
                  Screenshots
                </th>
                <th className="py-[11px] px-2 text-left text-[11px] font-semibold text-bark bg-parchment border-b border-sand whitespace-nowrap tracking-wide w-[50px]">
                  {/* Actions */}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((log) => {
                const catTag = getCategoryTag(log.category);
                const logScreenshots = screenshots[log.id] || [];
                const isLive = !log.end_time;
                const isEdited = editedLogIds.has(log.id);
                const isManual = log.is_manual;
                const isOwnEntry = log.user_id === currentUserId;
                const isExpanded = expandedRow === log.id;
                const hasMemos = !!(log.client_memo || log.internal_memo);

                return (
                  <tr
                    key={log.id}
                    className={`transition-colors cursor-pointer ${isExpanded ? "bg-parchment/50" : "hover:bg-parchment/40"}`}
                    onClick={() => setExpandedRow(isExpanded ? null : log.id)}
                  >
                    {/* User (admin/manager only) */}
                    {isAdminOrManager && (
                      <td className="py-2.5 px-3 text-[13px] border-b border-parchment align-top">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-[24px] h-[24px] rounded-full text-[9px] font-bold text-white flex items-center justify-center shrink-0"
                            style={{ backgroundColor: getUserColor(log.username) }}
                          >
                            {log.username[0]?.toUpperCase()}
                          </div>
                          <span className="text-[12px] text-espresso">{log.username}</span>
                        </div>
                      </td>
                    )}

                    {/* Project */}
                    <td className="py-2.5 px-3 text-[12px] border-b border-parchment align-top text-espresso max-w-[140px]">
                      {log.project ? (
                        <span className={isExpanded ? "whitespace-pre-wrap break-words" : "block overflow-hidden text-ellipsis whitespace-nowrap"}>
                          {log.project}
                        </span>
                      ) : (
                        <span className="text-stone">&mdash;</span>
                      )}
                    </td>

                    {/* Task + badges */}
                    <td className="py-2.5 px-3 text-[12px] border-b border-parchment align-top text-espresso max-w-[180px]">
                      <div className={`flex items-center gap-1 ${isExpanded ? "" : "max-w-[180px]"}`}>
                        <span className={`font-semibold ${isExpanded ? "whitespace-pre-wrap break-words" : "overflow-hidden text-ellipsis whitespace-nowrap"}`}>
                          {log.task_name}
                        </span>
                        {isManual && (
                          <span className="shrink-0 inline-block py-[1px] px-1 rounded text-[8px] font-semibold bg-slate-blue-soft text-slate-blue">M</span>
                        )}
                        {log.manual_status === "pending" && (
                          <span className="shrink-0 inline-block py-[1px] px-1.5 rounded text-[8px] font-semibold bg-amber-soft text-amber">⏳ Pending</span>
                        )}
                        {log.manual_status === "denied" && (
                          <span className="shrink-0 inline-block py-[1px] px-1.5 rounded text-[8px] font-semibold bg-terracotta-soft text-terracotta">✕ Denied</span>
                        )}
                        {isEdited && (
                          <span className="shrink-0 inline-block py-[1px] px-1 rounded text-[8px] font-semibold bg-amber-soft text-amber">E</span>
                        )}
                        {hasMemos && (
                          <span className="shrink-0 inline-block py-[1px] px-1 rounded text-[8px] font-semibold bg-parchment text-bark" title="Has memos">
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                          </span>
                        )}
                      </div>
                      {/* Expanded: show memos inline (editable) */}
                      {isExpanded && (hasMemos || editingMemoLogId === log.id) && (
                        <div className="mt-2 space-y-1.5 text-[11px]" onClick={(e) => e.stopPropagation()}>
                          {editingMemoLogId === log.id ? (
                            <>
                              <div className="p-2 rounded bg-slate-blue-soft/50 border border-slate-blue/20">
                                <span className="font-semibold text-slate-blue text-[9px] uppercase tracking-wide">Client</span>
                                <textarea
                                  value={editClientMemo}
                                  onChange={(e) => setEditClientMemo(e.target.value)}
                                  placeholder="Add client notes..."
                                  className="w-full mt-1 p-1.5 rounded text-[11px] text-espresso bg-white/80 border border-slate-blue/20 resize-none focus:outline-none focus:ring-1 focus:ring-slate-blue/40"
                                  rows={2}
                                />
                              </div>
                              <div className="p-2 rounded bg-amber-soft/50 border border-amber/20">
                                <span className="font-semibold text-walnut text-[9px] uppercase tracking-wide">Internal</span>
                                <textarea
                                  value={editInternalMemo}
                                  onChange={(e) => setEditInternalMemo(e.target.value)}
                                  placeholder="Add internal notes..."
                                  className="w-full mt-1 p-1.5 rounded text-[11px] text-espresso bg-white/80 border border-amber/20 resize-none focus:outline-none focus:ring-1 focus:ring-amber/40"
                                  rows={2}
                                />
                              </div>
                              <div className="flex gap-2 mt-1">
                                <button
                                  onClick={(e) => saveMemo(log.id, e)}
                                  disabled={savingMemo}
                                  className="px-3 py-1 rounded text-[10px] font-semibold bg-sage text-white hover:bg-sage/80 transition-colors disabled:opacity-50"
                                >
                                  {savingMemo ? "Saving..." : "Save"}
                                </button>
                                <button
                                  onClick={cancelEditMemo}
                                  className="px-3 py-1 rounded text-[10px] font-semibold bg-stone/20 text-bark hover:bg-stone/30 transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              {log.client_memo && (
                                <div className="p-2 rounded bg-slate-blue-soft/50 border border-slate-blue/20">
                                  <span className="font-semibold text-slate-blue text-[9px] uppercase tracking-wide">Client</span>
                                  <p className="text-espresso mt-0.5 whitespace-pre-wrap">{log.client_memo}</p>
                                </div>
                              )}
                              {log.internal_memo && (
                                <div className="p-2 rounded bg-amber-soft/50 border border-amber/20">
                                  <span className="font-semibold text-walnut text-[9px] uppercase tracking-wide">Internal</span>
                                  <p className="text-espresso mt-0.5 whitespace-pre-wrap">{log.internal_memo}</p>
                                </div>
                              )}
                              <button
                                onClick={(e) => startEditMemo(log, e)}
                                className="flex items-center gap-1 mt-0.5 px-2 py-0.5 rounded text-[10px] font-medium text-bark hover:bg-parchment transition-colors"
                              >
                                <PencilIcon className="w-3 h-3" /> Edit Notes
                              </button>
                            </>
                          )}
                        </div>
                      )}
                      {/* Show edit button even when no memos yet */}
                      {isExpanded && !hasMemos && editingMemoLogId !== log.id && (
                        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={(e) => startEditMemo(log, e)}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-bark hover:bg-parchment transition-colors"
                          >
                            <PencilIcon className="w-3 h-3" /> Add Notes
                          </button>
                        </div>
                      )}
                    </td>

                    {/* Category */}
                    <td className="py-2.5 px-3 text-[12px] border-b border-parchment align-top">
                      <span className={`inline-block py-[2px] px-2 rounded-[10px] text-[10px] font-medium ${catTag.bg} ${catTag.text}`}>
                        {log.category}
                      </span>
                    </td>

                    {/* Account */}
                    <td className="py-2.5 px-3 text-[12px] border-b border-parchment align-top text-espresso max-w-[120px]">
                      <span className={isExpanded ? "whitespace-pre-wrap break-words" : "block overflow-hidden text-ellipsis whitespace-nowrap"}>
                        {log.account || <span className="text-stone">&mdash;</span>}
                      </span>
                    </td>

                    {/* Duration + Time (merged) */}
                    <td className="py-2.5 px-3 text-[12px] border-b border-parchment align-top whitespace-nowrap">
                      {log.category === "Clock Out" ? (
                        <div>
                          <span className="text-stone text-[11px]">{formatTime(log.end_time || log.start_time, timezone)}</span>
                          <div className="text-[10px] text-stone">{formatDate(log.start_time, timezone)}</div>
                        </div>
                      ) : isLive ? (
                        <div>
                          <span className="inline-flex items-center gap-[4px] text-sage font-semibold text-[11px]">
                            <span className="w-[6px] h-[6px] rounded-full bg-sage animate-breathe" />
                            live
                          </span>
                          <div className="text-[10px] text-stone mt-0.5">{formatTime(log.start_time, timezone)}</div>
                        </div>
                      ) : (
                        <div>
                          <span className={`font-semibold tabular-nums text-[12px] ${getDurationClass(log)}`}>
                            {formatDuration(log.duration_ms, log.billing_type)}
                          </span>
                          <div className="text-[10px] text-stone mt-0.5 tabular-nums">
                            {formatTime(log.start_time, timezone)}
                            {log.end_time && log.end_time !== log.start_time && (
                              <>{" "}<span className="text-stone/50">&ndash;</span>{" "}{formatTime(log.end_time, timezone)}</>
                            )}
                          </div>
                        </div>
                      )}
                    </td>

                    {/* Progress */}
                    <td className="py-2.5 px-3 text-[12px] border-b border-parchment align-top">
                      <div className="flex items-center gap-1.5 relative">
                        {log.progress && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onUpdateProgress) {
                                setProgressDropdown(progressDropdown === log.id ? null : log.id);
                              }
                            }}
                            className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold transition-all ${
                              onUpdateProgress ? "cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-terracotta/30" : ""
                            } ${
                              log.progress === "completed"
                                ? "bg-sage/15 text-sage"
                                : log.progress === "on_hold"
                                ? "bg-amber/15 text-amber-700"
                                : "bg-terracotta/15 text-terracotta"
                            }`}
                            title={onUpdateProgress ? "Click to change status" : undefined}
                          >
                            {log.progress === "in_progress" ? "In Progress" : log.progress === "on_hold" ? "On Hold" : "Completed"}
                          </button>
                        )}
                        {/* Progress dropdown */}
                        {progressDropdown === log.id && onUpdateProgress && (
                          <div className="absolute top-6 left-0 z-20 bg-white border border-sand rounded-lg shadow-lg py-1 min-w-[120px]">
                            {[
                              { value: "in_progress", label: "In Progress", color: "text-terracotta" },
                              { value: "completed", label: "Completed", color: "text-sage" },
                              { value: "on_hold", label: "On Hold", color: "text-amber-700" },
                            ].map((opt) => (
                              <button
                                key={opt.value}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onUpdateProgress(log.id, opt.value);
                                  setProgressDropdown(null);
                                }}
                                className={`w-full text-left px-3 py-1.5 text-xs font-semibold cursor-pointer hover:bg-parchment transition-all ${
                                  log.progress === opt.value ? `${opt.color} bg-parchment` : "text-bark"
                                }`}
                              >
                                {opt.label}
                                {log.progress === opt.value && " ✓"}
                              </button>
                            ))}
                          </div>
                        )}
                        {log.progress === "on_hold" && onResumeTask && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onResumeTask(log); }}
                            className="w-6 h-6 rounded-full bg-sage text-white flex items-center justify-center cursor-pointer hover:bg-sage/80 transition-all"
                            title="Resume this task"
                          >
                            <span className="text-[10px] ml-0.5">&#9654;</span>
                          </button>
                        )}
                      </div>
                    </td>

                    {/* Screenshots */}
                    <td className="py-2.5 px-3 text-[12px] border-b border-parchment align-top" onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1 items-center">
                        {logScreenshots.length > 0 ? (
                          logScreenshots.slice(0, 3).map((ss) => {
                            const url = signedUrls[ss.id];
                            return (
                              <button
                                key={ss.id}
                                onClick={() => url && setLightboxUrl(url)}
                                className="w-[28px] h-[20px] rounded border border-sand bg-parchment overflow-hidden cursor-pointer transition-all hover:border-terracotta hover:scale-105 flex-shrink-0"
                                title={`Screenshot ${ss.screenshot_type || "manual"}`}
                              >
                                {url ? (
                                  <img src={url} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-[7px] text-stone">...</div>
                                )}
                              </button>
                            );
                          })
                        ) : null}
                        {logScreenshots.length > 3 && (
                          <span className="text-[9px] text-bark font-medium">+{logScreenshots.length - 3}</span>
                        )}
                        {isOwnEntry && (
                          <button
                            onClick={() => onAddScreenshot(log.id)}
                            className="w-[24px] h-[20px] rounded border border-dashed border-clay bg-transparent text-stone cursor-pointer text-[10px] flex items-center justify-center transition-all hover:border-terracotta hover:text-terracotta flex-shrink-0"
                          >
                            +
                          </button>
                        )}
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-2 text-[12px] border-b border-parchment align-top" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        {isAdminOrManager && (
                          <>
                            <button
                              onClick={() => setEditingLog(log)}
                              className="w-[22px] h-[22px] rounded flex items-center justify-center text-stone hover:text-terracotta hover:bg-terracotta-soft transition-all"
                              title="Edit entry"
                            >
                              <PencilIcon className="w-3 h-3" />
                            </button>
                            <button
                              onClick={async () => {
                                if (!confirm(`Delete "${log.task_name}" entry?`)) return;
                                const sb = createClient();
                                await sb.from("task_screenshots").delete().eq("log_id", log.id);
                                await sb.from("time_logs").delete().eq("id", log.id);
                                if (onRefresh) onRefresh();
                              }}
                              className="w-[22px] h-[22px] rounded flex items-center justify-center text-stone hover:text-red-500 hover:bg-red-50 transition-all"
                              title="Delete entry"
                            >
                              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                            </button>
                          </>
                        )}
                        {role === "va" && isOwnEntry && !isLive && (
                          <button
                            onClick={() => setCorrectionLog(log)}
                            className="text-[9px] text-stone hover:text-terracotta transition-colors"
                            title="Request correction"
                          >
                            Fix
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredLogs.length === 0 && (
                <tr>
                  <td
                    colSpan={colCount}
                    className="py-8 px-4 text-center text-sm text-stone"
                  >
                    No entries found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Summary */}
        <div className="py-4 px-5 border-t border-sand bg-parchment rounded-b-xl">
          {/* Row 1: Time totals */}
          <div className="flex gap-7 flex-wrap">
            <div>
              <div className="font-serif text-lg font-bold tabular-nums">
                {summary.total}
              </div>
              <div className="text-[10px] font-semibold text-bark mt-0.5 tracking-wide">
                Total Logged
              </div>
            </div>
            <div>
              <div className="font-serif text-lg font-bold tabular-nums text-sage">
                {summary.billable}
              </div>
              <div className="text-[10px] font-semibold text-bark mt-0.5 tracking-wide">
                Billable
              </div>
            </div>

            {/* Dynamic category breakdown */}
            {summary.categories.map((cat) => {
              const colorClass =
                cat.name.toLowerCase() === "task" ? "text-terracotta" :
                cat.name.toLowerCase() === "break" ? "text-amber" :
                cat.name.toLowerCase() === "message" ? "text-slate-blue" :
                cat.name.toLowerCase() === "meeting" ? "text-clay-rose" :
                cat.name.toLowerCase() === "personal" ? "text-clay-rose" :
                cat.name.toLowerCase() === "sorting tasks" ? "text-amber" :
                cat.name.toLowerCase() === "collaboration" ? "text-terracotta" :
                "text-bark";
              return (
                <div key={cat.name}>
                  <div className={`font-serif text-lg font-bold tabular-nums ${colorClass}`}>
                    {cat.formatted}
                  </div>
                  <div className="text-[10px] font-semibold text-bark mt-0.5 tracking-wide">
                    {cat.name}
                  </div>
                </div>
              );
            })}

            <div>
              <div className="font-serif text-lg font-bold tabular-nums text-walnut">
                {summary.wizard}
              </div>
              <div className="text-[10px] font-semibold text-bark mt-0.5 tracking-wide">
                Wizard Time
              </div>
            </div>
            <div>
              <div className="font-serif text-lg font-bold tabular-nums">
                {summary.entries}
              </div>
              <div className="text-[10px] font-semibold text-bark mt-0.5 tracking-wide">
                Entries
              </div>
            </div>
          </div>

          {/* Row 2: Task type & status breakdown */}
          <div className="flex gap-4 mt-3 pt-3 border-t border-sand/60 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-sage"></span>
              <span className="text-[11px] font-semibold text-espresso">{summary.hourlyCount}</span>
              <span className="text-[10px] text-bark">Hourly</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-slate-blue"></span>
              <span className="text-[11px] font-semibold text-espresso">{summary.fixedCount}</span>
              <span className="text-[10px] text-bark">Fixed</span>
            </div>
            <div className="w-px h-4 bg-sand/80 self-center"></div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-terracotta"></span>
              <span className="text-[11px] font-semibold text-espresso">{summary.inProgressCount}</span>
              <span className="text-[10px] text-bark">In Progress</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-sage"></span>
              <span className="text-[11px] font-semibold text-espresso">{summary.completedCount}</span>
              <span className="text-[10px] text-bark">Completed</span>
            </div>
            {summary.onHoldCount > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-amber"></span>
                <span className="text-[11px] font-semibold text-espresso">{summary.onHoldCount}</span>
                <span className="text-[10px] text-bark">On Hold</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Past In-Progress Tasks (from previous days) */}
      {filteredPastIP.length > 0 && (
        <div className="bg-white border border-amber/30 rounded-xl mb-6">
          <div className="py-3 px-5 border-b border-amber/20 bg-amber/5 rounded-t-xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-amber animate-pulse"></span>
              <h3 className="text-[12px] font-bold text-espresso">In Progress from Previous Days</h3>
            </div>
            <span className="text-[10px] text-bark">{filteredPastIP.length} {filteredPastIP.length === 1 ? "task" : "tasks"}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[600px]">
              <thead>
                <tr>
                  {isAdminOrManager && (
                    <th className="py-2 px-3 text-left text-[10px] font-semibold text-bark bg-parchment/50 border-b border-sand whitespace-nowrap">User</th>
                  )}
                  <th className="py-2 px-3 text-left text-[10px] font-semibold text-bark bg-parchment/50 border-b border-sand whitespace-nowrap">Date</th>
                  <th className="py-2 px-3 text-left text-[10px] font-semibold text-bark bg-parchment/50 border-b border-sand whitespace-nowrap">Task</th>
                  <th className="py-2 px-3 text-left text-[10px] font-semibold text-bark bg-parchment/50 border-b border-sand whitespace-nowrap">Account</th>
                  <th className="py-2 px-3 text-left text-[10px] font-semibold text-bark bg-parchment/50 border-b border-sand whitespace-nowrap">Duration</th>
                  <th className="py-2 px-3 text-left text-[10px] font-semibold text-bark bg-parchment/50 border-b border-sand whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredPastIP.map((log) => (
                  <tr key={log.id} className="hover:bg-parchment/30 transition-colors">
                    {isAdminOrManager && (
                      <td className="py-2 px-3 text-[12px] border-b border-parchment">
                        <div className="flex items-center gap-1.5">
                          <div
                            className="w-[20px] h-[20px] rounded-full text-[8px] font-bold text-white flex items-center justify-center shrink-0"
                            style={{ backgroundColor: getUserColor(log.username) }}
                          >
                            {log.username[0]?.toUpperCase()}
                          </div>
                          <span className="text-[11px] text-espresso">{log.username}</span>
                        </div>
                      </td>
                    )}
                    <td className="py-2 px-3 text-[11px] text-bark border-b border-parchment whitespace-nowrap">
                      {formatDate(log.start_time, timezone)}
                    </td>
                    <td className="py-2 px-3 text-[12px] font-semibold text-espresso border-b border-parchment">
                      {log.task_name}
                    </td>
                    <td className="py-2 px-3 text-[12px] text-espresso border-b border-parchment">
                      {log.account || <span className="text-stone">&mdash;</span>}
                    </td>
                    <td className="py-2 px-3 text-[12px] font-semibold text-terracotta border-b border-parchment whitespace-nowrap">
                      {formatDuration(log.duration_ms, log.billing_type)}
                    </td>
                    <td className="py-2 px-3 border-b border-parchment">
                      <div className="flex items-center gap-1.5">
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-terracotta/15 text-terracotta">
                          In Progress
                        </span>
                        {onUpdateProgress && (
                          <button
                            onClick={() => onUpdateProgress(log.id, "completed")}
                            className="text-[9px] font-semibold text-sage hover:text-sage/80 transition-colors"
                            title="Mark as completed"
                          >
                            ✓ Complete
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
      )}

      {/* Past On-Hold Tasks (from previous days) */}
      {filteredPastOnHold.length > 0 && (
        <div className="bg-white border border-[#d4a843]/30 rounded-xl mb-6">
          <div className="py-3 px-5 border-b border-[#d4a843]/20 bg-[#d4a843]/5 rounded-t-xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-[#d4a843]"></span>
              <h3 className="text-[12px] font-bold text-espresso">On Hold from Previous Days</h3>
            </div>
            <span className="text-[10px] text-bark">{filteredPastOnHold.length} {filteredPastOnHold.length === 1 ? "task" : "tasks"}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[600px]">
              <thead>
                <tr>
                  {isAdminOrManager && (
                    <th className="py-2 px-3 text-left text-[10px] font-semibold text-bark bg-parchment/50 border-b border-sand whitespace-nowrap">User</th>
                  )}
                  <th className="py-2 px-3 text-left text-[10px] font-semibold text-bark bg-parchment/50 border-b border-sand whitespace-nowrap">Date</th>
                  <th className="py-2 px-3 text-left text-[10px] font-semibold text-bark bg-parchment/50 border-b border-sand whitespace-nowrap">Task</th>
                  <th className="py-2 px-3 text-left text-[10px] font-semibold text-bark bg-parchment/50 border-b border-sand whitespace-nowrap">Account</th>
                  <th className="py-2 px-3 text-left text-[10px] font-semibold text-bark bg-parchment/50 border-b border-sand whitespace-nowrap">Duration</th>
                  <th className="py-2 px-3 text-left text-[10px] font-semibold text-bark bg-parchment/50 border-b border-sand whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredPastOnHold.map((log) => (
                  <tr key={log.id} className="hover:bg-parchment/30 transition-colors">
                    {isAdminOrManager && (
                      <td className="py-2 px-3 text-[12px] border-b border-parchment">
                        <div className="flex items-center gap-1.5">
                          <div
                            className="w-[20px] h-[20px] rounded-full text-[8px] font-bold text-white flex items-center justify-center shrink-0"
                            style={{ backgroundColor: getUserColor(log.username) }}
                          >
                            {log.username[0]?.toUpperCase()}
                          </div>
                          <span className="text-[11px] text-espresso">{log.username}</span>
                        </div>
                      </td>
                    )}
                    <td className="py-2 px-3 text-[11px] text-bark border-b border-parchment whitespace-nowrap">
                      {formatDate(log.start_time, timezone)}
                    </td>
                    <td className="py-2 px-3 text-[12px] font-semibold text-espresso border-b border-parchment">
                      {log.task_name}
                    </td>
                    <td className="py-2 px-3 text-[12px] text-espresso border-b border-parchment">
                      {log.account || <span className="text-stone">&mdash;</span>}
                    </td>
                    <td className="py-2 px-3 text-[12px] font-semibold text-[#d4a843] border-b border-parchment whitespace-nowrap">
                      {formatDuration(log.duration_ms, log.billing_type)}
                    </td>
                    <td className="py-2 px-3 border-b border-parchment">
                      <div className="flex items-center gap-1.5">
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#d4a843]/15 text-[#d4a843]">
                          On Hold
                        </span>
                        {onUpdateProgress && (
                          <>
                            <button
                              onClick={() => onUpdateProgress(log.id, "in_progress")}
                              className="text-[9px] font-semibold text-terracotta hover:text-terracotta/80 transition-colors"
                              title="Resume task"
                            >
                              ▶ Resume
                            </button>
                            <button
                              onClick={() => onUpdateProgress(log.id, "completed")}
                              className="text-[9px] font-semibold text-sage hover:text-sage/80 transition-colors"
                              title="Mark as completed"
                            >
                              ✓ Complete
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}
      {(editingLog || showCreateModal) && (
        <EditTimeLogModal
          log={editingLog}
          profiles={profiles}
          currentUserId={currentUserId}
          currentUserRole={role}
          onClose={() => {
            setEditingLog(null);
            setShowCreateModal(false);
          }}
          onSaved={handleModalSaved}
        />
      )}

      {correctionLog && (
        <CorrectionRequestModal
          log={correctionLog}
          currentUserId={currentUserId}
          onClose={() => setCorrectionLog(null)}
          onSubmitted={handleModalSaved}
        />
      )}

      {lightboxUrl && (
        <ScreenshotLightbox
          url={lightboxUrl}
          onClose={() => setLightboxUrl(null)}
        />
      )}
    </>
  );
}
