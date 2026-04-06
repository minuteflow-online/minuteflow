"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TimeLog, Profile, TaskScreenshot } from "@/types/database";
import EditTimeLogModal from "@/components/EditTimeLogModal";
import CorrectionRequestModal from "@/components/CorrectionRequestModal";
import ScreenshotLightbox from "@/components/ScreenshotLightbox";
import {
  formatDuration,
  formatDurationShort,
  formatTimeET,
  getTimezoneAbbr,
  weekStart,
  weekEnd,
} from "@/lib/utils";

/* ── Types ────────────────────────────────────────────────── */

type ViewMode = "day" | "week" | "month";

type WeekDay = {
  dayName: string;
  date: number;
  fullDate: Date;
  totalMs: number;
  taskCount: number;
  isToday: boolean;
};

/* ── Helpers ──────────────────────────────────────────────── */

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDateDisplay(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatWeekDisplay(d: Date): string {
  const ws = weekStart(d);
  const we = weekEnd(d);
  return `${ws.toLocaleDateString("en-US", { month: "short", day: "numeric" })} \u2013 ${we.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

function formatMonthDisplay(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

const DAY_NAMES_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const catColors: Record<string, string> = {
  Task: "bg-terracotta-soft text-terracotta",
  Communication: "bg-slate-blue-soft text-slate-blue",
  Message: "bg-slate-blue-soft text-slate-blue",
  Meeting: "bg-clay-rose-soft text-clay-rose",
  Planning: "bg-amber-soft text-amber",
  Sorting: "bg-amber-soft text-amber",
  "Sorting Tasks": "bg-amber-soft text-amber",
  Collaboration: "bg-terracotta-soft text-terracotta",
  Personal: "bg-parchment text-walnut",
  Break: "bg-amber-soft text-amber",
  "Clock Out": "bg-stone/10 text-stone",
};

/* ── Icons ────────────────────────────────────────────────── */

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

/* ── Page Component ───────────────────────────────────────── */

export default function TimeLogPage() {
  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [anchorDate, setAnchorDate] = useState<Date>(() => new Date());
  const [expandedEntry, setExpandedEntry] = useState<number | null>(null);

  /* ── Role & user state ─────────────────────────────────── */
  const [currentUserId, setCurrentUserId] = useState("");
  const [role, setRole] = useState<string>("va");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedVA, setSelectedVA] = useState<string>(""); // "" = all

  /* ── Modal state ────────────────────────────────────────── */
  const [editingLog, setEditingLog] = useState<TimeLog | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [correctionLog, setCorrectionLog] = useState<TimeLog | null>(null);

  /* ── Edited log IDs (for "edited" indicator) ───────────── */
  const [editedLogIds, setEditedLogIds] = useState<Set<number>>(new Set());

  /* ── Org timezone ────────────────────────────────────────── */
  const [orgTimezone, setOrgTimezone] = useState<string>("America/New_York");

  /* ── Screenshots state (for admin/manager) ───────────────── */
  const [screenshots, setScreenshots] = useState<Record<number, TaskScreenshot[]>>({});
  const [signedUrls, setSignedUrls] = useState<Record<number, string>>({});
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  /* ── Mood data ────────────────────────────────────────────── */
  const [moodData, setMoodData] = useState<Record<string, Record<string, string>>>({});
  // moodData: { [userId]: { [session_date]: mood } }

  const isAdminOrManager = role === "admin" || role === "manager";

  /* ── Fetch current user & profiles ─────────────────────── */

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);

      // Fetch own profile for role
      const { data: myProfile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (myProfile) {
        setRole(myProfile.role || "va");
      }

      // Fetch all profiles (for VA dropdown and edit modal)
      const { data: allProfiles } = await supabase
        .from("profiles")
        .select("*")
        .order("full_name");

      if (allProfiles) {
        setProfiles(allProfiles as Profile[]);
      }

      // Fetch org timezone
      const { data: orgSettings } = await supabase
        .from("organization_settings")
        .select("timezone")
        .limit(1)
        .single();

      if (orgSettings?.timezone) {
        setOrgTimezone(orgSettings.timezone);
      }
    }
    init();
  }, []);

  /* ── Date range ────────────────────────────────────────── */

  const { rangeStart, rangeEnd, displayLabel } = useMemo(() => {
    if (viewMode === "day") {
      return {
        rangeStart: startOfDay(anchorDate),
        rangeEnd: endOfDay(anchorDate),
        displayLabel: formatDateDisplay(anchorDate),
      };
    } else if (viewMode === "week") {
      return {
        rangeStart: weekStart(anchorDate),
        rangeEnd: weekEnd(anchorDate),
        displayLabel: formatWeekDisplay(anchorDate),
      };
    } else {
      return {
        rangeStart: startOfMonth(anchorDate),
        rangeEnd: endOfMonth(anchorDate),
        displayLabel: formatMonthDisplay(anchorDate),
      };
    }
  }, [viewMode, anchorDate]);

  /* ── Fetch data ────────────────────────────────────────── */

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    // For day view, still fetch the full week for the week overview cards
    const fetchStart =
      viewMode === "day" ? weekStart(anchorDate) : rangeStart;
    const fetchEnd = viewMode === "day" ? weekEnd(anchorDate) : rangeEnd;

    let query = supabase
      .from("time_logs")
      .select("*")
      .gte("start_time", fetchStart.toISOString())
      .lte("start_time", fetchEnd.toISOString())
      .order("start_time", { ascending: false });

    // VA: show only own entries; Admin/manager: optional VA filter
    if (!isAdminOrManager) {
      query = query.eq("user_id", currentUserId);
    } else if (selectedVA) {
      query = query.eq("user_id", selectedVA);
    }

    const { data } = await query;
    const fetchedLogs = (data ?? []) as TimeLog[];
    setLogs(fetchedLogs);

    // Fetch screenshots for all users
    if (fetchedLogs.length > 0) {
      const logIds = fetchedLogs.map((l) => l.id);
      const { data: ssData } = await supabase
        .from("task_screenshots")
        .select("*")
        .in("log_id", logIds);
      if (ssData) {
        const grouped: Record<number, TaskScreenshot[]> = {};
        (ssData as TaskScreenshot[]).forEach((ss) => {
          if (ss.log_id) {
            if (!grouped[ss.log_id]) grouped[ss.log_id] = [];
            grouped[ss.log_id].push(ss);
          }
        });
        setScreenshots(grouped);
      }
    }

    // Fetch mood data from mood_logs for the date range
    {
      const moodStart = (viewMode === "day" ? weekStart(anchorDate) : rangeStart).toISOString().split("T")[0];
      const moodEnd = (viewMode === "day" ? weekEnd(anchorDate) : rangeEnd).toISOString().split("T")[0];

      let moodQuery = supabase
        .from("mood_logs")
        .select("user_id, session_date, mood")
        .gte("session_date", moodStart)
        .lte("session_date", moodEnd);

      if (!isAdminOrManager) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) moodQuery = moodQuery.eq("user_id", user.id);
      } else if (selectedVA) {
        moodQuery = moodQuery.eq("user_id", selectedVA);
      }

      const { data: moodRows } = await moodQuery;
      if (moodRows) {
        const grouped: Record<string, Record<string, string>> = {};
        (moodRows as { user_id: string; session_date: string; mood: string }[]).forEach((row) => {
          if (!grouped[row.user_id]) grouped[row.user_id] = {};
          grouped[row.user_id][row.session_date] = row.mood;
        });
        setMoodData(grouped);
      }
    }

    setLoading(false);
  }, [viewMode, anchorDate, rangeStart, rangeEnd, isAdminOrManager, selectedVA]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  /* ── Load edited log IDs ────────────────────────────────── */

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

  /* ── Generate signed URLs for screenshots ─────────────── */

  useEffect(() => {
    const allScreenshots: TaskScreenshot[] = [];
    Object.values(screenshots).forEach((arr) => allScreenshots.push(...arr));
    if (allScreenshots.length === 0) return;

    const missing = allScreenshots.filter((s) => !signedUrls[s.id]);
    if (missing.length === 0) return;

    async function generateUrls() {
      const supabase = createClient();
      const newUrls: Record<number, string> = { ...signedUrls };
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
    }
    generateUrls();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenshots, isAdminOrManager]);

  /* ── Navigation ────────────────────────────────────────── */

  function navigatePrev() {
    setAnchorDate((prev) => {
      const d = new Date(prev);
      if (viewMode === "day") d.setDate(d.getDate() - 1);
      else if (viewMode === "week") d.setDate(d.getDate() - 7);
      else d.setMonth(d.getMonth() - 1);
      return d;
    });
  }

  function navigateNext() {
    setAnchorDate((prev) => {
      const d = new Date(prev);
      if (viewMode === "day") d.setDate(d.getDate() + 1);
      else if (viewMode === "week") d.setDate(d.getDate() + 7);
      else d.setMonth(d.getMonth() + 1);
      return d;
    });
  }

  function goToToday() {
    setAnchorDate(new Date());
  }

  /* ── Week overview data ────────────────────────────────── */

  const weekDays: WeekDay[] = useMemo(() => {
    const ws = weekStart(anchorDate);
    const today = new Date();
    return DAY_NAMES_SHORT.map((name, i) => {
      const d = new Date(ws);
      d.setDate(d.getDate() + i);
      const dayLogs = logs.filter(
        (l) =>
          l.start_time &&
          isSameDay(new Date(l.start_time), d)
      );
      return {
        dayName: name,
        date: d.getDate(),
        fullDate: d,
        totalMs: dayLogs.reduce((sum, l) => sum + (l.duration_ms || 0), 0),
        taskCount: dayLogs.length,
        isToday: isSameDay(d, today),
      };
    });
  }, [logs, anchorDate]);

  /* ── Filtered entries for current view ─────────────────── */

  const filteredLogs = useMemo(() => {
    return logs.filter((l) => {
      if (!l.start_time) return false;
      const d = new Date(l.start_time);
      return d >= rangeStart && d <= rangeEnd;
    });
  }, [logs, rangeStart, rangeEnd]);

  /* ── Group logs by day (for week/month view) ───────────── */

  const logsByDay = useMemo(() => {
    const grouped: Record<string, TimeLog[]> = {};
    filteredLogs.forEach((l) => {
      if (!l.start_time) return;
      const key = l.start_time.slice(0, 10);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(l);
    });
    return grouped;
  }, [filteredLogs]);

  /* ── Day summary stats (dynamic categories + type/status) ──── */

  const daySummary = useMemo(() => {
    let totalMs = 0;
    let personalMs = 0;
    let wizardMs = 0;
    let fixedCount = 0;
    let hourlyCount = 0;
    let inProgressCount = 0;
    let completedCount = 0;
    let onHoldCount = 0;
    const categoryMs: Record<string, number> = {};

    filteredLogs.forEach((l) => {
      totalMs += l.duration_ms || 0;
      wizardMs += l.form_fill_ms || 0;

      const rawCat = l.category || "Other";
      const cat = rawCat === "Sorting Tasks" || rawCat === "Sorting" ? "Planning"
        : rawCat === "Message" ? "Communication"
        : rawCat;
      categoryMs[cat] = (categoryMs[cat] || 0) + (l.duration_ms || 0);

      if (cat.toLowerCase() === "personal") {
        personalMs += l.duration_ms || 0;
      }

      // Fixed vs hourly
      if (l.billing_type === "fixed") fixedCount++;
      else hourlyCount++;

      // Progress status
      if (l.progress === "in_progress") inProgressCount++;
      else if (l.progress === "completed") completedCount++;
      else if (l.progress === "on_hold") onHoldCount++;
    });

    const billableMs = totalMs - personalMs;
    const entryCount = filteredLogs.length;

    // Build sorted category entries (alphabetical, Personal last)
    const categories = Object.entries(categoryMs)
      .filter(([, ms]) => ms > 0)
      .sort(([a], [b]) => {
        if (a.toLowerCase() === "personal") return 1;
        if (b.toLowerCase() === "personal") return -1;
        return a.localeCompare(b);
      })
      .map(([name, ms]) => ({ name, formatted: formatDuration(ms) }));

    return { totalMs, billableMs, wizardMs, entryCount, categories, fixedCount, hourlyCount, inProgressCount, completedCount, onHoldCount };
  }, [filteredLogs]);

  /* ── Mood summary for footer ────────────────────────────── */

  const moodSummary = useMemo(() => {
    const moodEmoji: Record<string, string> = { bad: "\uD83D\uDE1E", neutral: "\uD83D\uDE10", good: "\uD83D\uDE0A" };
    const allMoods: string[] = [];

    // Collect all moods from moodData for the current date range
    Object.values(moodData).forEach((dateMap) => {
      Object.entries(dateMap).forEach(([dateStr]) => {
        const d = new Date(dateStr + "T12:00:00");
        if (d >= rangeStart && d <= rangeEnd) {
          allMoods.push(dateMap[dateStr]);
        }
      });
    });

    if (allMoods.length === 0) return null;

    // If single VA selected (or VA viewing own data): show the emoji directly
    const userIds = Object.keys(moodData);
    if (userIds.length === 1) {
      // Single user — show latest mood emoji
      const latestMood = allMoods[allMoods.length - 1];
      return { type: "single" as const, emoji: moodEmoji[latestMood] || "", mood: latestMood };
    }

    // Multiple VAs — show count per mood
    const counts: Record<string, number> = {};
    allMoods.forEach((m) => { counts[m] = (counts[m] || 0) + 1; });
    const parts = (["good", "neutral", "bad"] as string[])
      .filter((m) => counts[m])
      .map((m) => `${counts[m]} ${moodEmoji[m]}`);
    return { type: "multi" as const, display: parts.join("  ") };
  }, [moodData, rangeStart, rangeEnd]);

  /* ── Export CSV ─────────────────────────────────────────── */

  function exportCSV() {
    const header = [
      "Date",
      "Start",
      "End",
      "Duration (min)",
      "Task",
      "Category",
      "Account",
      "Client",
      "Billable",
      "Client Memo",
      "Internal Memo",
    ];

    const rows = filteredLogs.map((l) => {
      const startDate = l.start_time
        ? new Date(l.start_time).toLocaleDateString("en-US", { timeZone: orgTimezone })
        : "";
      const startTime = l.start_time
        ? new Date(l.start_time).toLocaleTimeString("en-US", { timeZone: orgTimezone })
        : "";
      const endTime = l.end_time
        ? new Date(l.end_time).toLocaleTimeString("en-US", { timeZone: orgTimezone })
        : "";
      const mins = l.duration_ms ? Math.round(l.duration_ms / 60000) : 0;
      return [
        startDate,
        startTime,
        endTime,
        mins.toString(),
        l.task_name || "",
        l.category || "",
        l.account || "",
        l.client_name || "",
        l.billable ? "Yes" : "No",
        l.client_memo || "",
        l.internal_memo || "",
      ];
    });

    const csvContent = [header, ...rows]
      .map((row) =>
        row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")
      )
      .join("\n");

    const blob = new Blob(["\uFEFF" + csvContent], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `MinuteFlow-TimeLog-${rangeStart.toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /* ── Modal handlers ─────────────────────────────────────── */

  const handleModalSaved = () => {
    setEditingLog(null);
    setShowCreateModal(false);
    setCorrectionLog(null);
    fetchLogs();
  };

  /* ── Build flat item list for table ─────────────────────── */

  type TableItem =
    | { _type: "header"; dateKey: string; dayLabel: string; dayTotalMs: number }
    | { _type: "log"; log: TimeLog };

  const tableItems: TableItem[] = useMemo(() => {
    if (viewMode !== "day") {
      return Object.entries(logsByDay)
        .sort(([a], [b]) => b.localeCompare(a))
        .flatMap(([dateKey, dayLogs]) => {
          const d = new Date(dateKey + "T12:00:00");
          const dayLabel = d.toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          });
          const dayTotalMs = dayLogs
            .reduce((sum, l) => sum + (l.duration_ms || 0), 0);
          return [
            { _type: "header" as const, dateKey, dayLabel, dayTotalMs },
            ...dayLogs.map((l) => ({ _type: "log" as const, log: l })),
          ];
        });
    }
    return filteredLogs.map((l) => ({ _type: "log" as const, log: l }));
  }, [viewMode, logsByDay, filteredLogs]);

  /* ── Render ────────────────────────────────────────────── */

  return (
    <>
      {/* Page Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-bold text-espresso">
            Time Log
          </h1>
          <p className="mt-0.5 text-[13px] text-bark">
            {isAdminOrManager ? "Team time entries" : "Your personal time entries"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* VA Filter (admin/manager only) */}
          {isAdminOrManager && (
            <select
              value={selectedVA}
              onChange={(e) => setSelectedVA(e.target.value)}
              className="rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
            >
              <option value="">All VAs</option>
              {profiles.filter((p) => p.is_active !== false).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={exportCSV}
            className="rounded-lg bg-parchment px-4 py-2 text-[13px] font-semibold text-walnut border border-sand transition-all hover:bg-sand hover:text-espresso"
          >
            Export CSV
          </button>
          {isAdminOrManager && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="rounded-lg bg-terracotta px-4 py-2 text-[13px] font-semibold text-white transition-all hover:bg-[#a85840]"
            >
              + Add Time Entry
            </button>
          )}
        </div>
      </div>

      {/* Date Navigation */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          <button
            onClick={navigatePrev}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-sand bg-white text-base font-semibold text-walnut transition-all hover:border-terracotta hover:text-terracotta"
          >
            &larr;
          </button>
          <button
            onClick={navigateNext}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-sand bg-white text-base font-semibold text-walnut transition-all hover:border-terracotta hover:text-terracotta"
          >
            &rarr;
          </button>
        </div>

        <span className="font-serif text-base font-bold text-espresso">
          {displayLabel}
        </span>

        <button
          onClick={goToToday}
          className="ml-1 rounded-lg border border-sand bg-white px-3 py-1.5 text-xs font-semibold text-walnut transition-all hover:border-terracotta hover:text-terracotta"
        >
          Today
        </button>

        <div className="ml-auto flex gap-1">
          {(["day", "week", "month"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold capitalize transition-all ${
                viewMode === mode
                  ? "bg-espresso text-cream border border-espresso"
                  : "border border-sand bg-white text-walnut hover:border-terracotta hover:text-terracotta"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="h-24 animate-pulse rounded-xl border border-sand bg-white" />
          <div className="h-80 animate-pulse rounded-xl border border-sand bg-white" />
        </div>
      ) : (
        <>
          {/* Week Overview Cards */}
          <div className="mb-5 rounded-xl border border-sand bg-white">
            <div className="grid grid-cols-7 gap-2 p-4 max-md:grid-cols-3 max-md:gap-3">
              {weekDays.map((day) => (
                <button
                  key={day.date}
                  onClick={() => {
                    setAnchorDate(day.fullDate);
                    setViewMode("day");
                  }}
                  className={`rounded-[10px] px-3 py-3.5 text-center transition-all cursor-pointer ${
                    day.isToday
                      ? "bg-terracotta-soft border border-terracotta"
                      : "bg-parchment hover:bg-sand border border-transparent"
                  }`}
                >
                  <div className="text-[10px] font-semibold uppercase tracking-[1px] text-bark">
                    {day.dayName}
                  </div>
                  <div className="my-1.5 font-serif text-xl font-bold text-espresso">
                    {day.date}
                  </div>
                  <div className="text-xs font-semibold text-sage">
                    {day.totalMs > 0 ? formatDuration(day.totalMs) : "\u2014"}
                  </div>
                  <div className="mt-0.5 text-[10px] text-stone">
                    {day.taskCount > 0
                      ? `${day.taskCount} task${day.taskCount !== 1 ? "s" : ""}`
                      : "\u00A0"}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Timeline Card */}
          <div className="rounded-xl border border-sand bg-white">
            <div className="flex items-center justify-between border-b border-parchment px-5 py-4">
              <h3 className="text-sm font-bold text-espresso">
                {viewMode === "day"
                  ? isSameDay(anchorDate, new Date())
                    ? "Today's Timeline"
                    : "Timeline"
                  : viewMode === "week"
                    ? "This Week's Entries"
                    : "This Month's Entries"}
              </h3>
              <span className="text-[11px] text-bark">
                {filteredLogs.length}{" "}
                {filteredLogs.length === 1 ? "entry" : "entries"}
              </span>
            </div>

            {filteredLogs.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <p className="text-sm text-bark">
                  No time entries for this period
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-parchment text-[10px] font-semibold uppercase tracking-wider text-bark">
                      {isAdminOrManager && (
                        <th className="px-3 py-2.5">User</th>
                      )}
                      <th className="px-3 py-2.5">Project</th>
                      <th className="px-3 py-2.5">Task</th>
                      <th className="px-3 py-2.5">Category</th>
                      <th className="px-3 py-2.5">Account</th>
                      <th className="px-3 py-2.5 text-right">Duration</th>
                      <th className="px-3 py-2.5">Memos</th>
                      <th className="px-3 py-2.5">Screenshots</th>
                      <th className="px-2 py-2.5 w-[50px]"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-parchment">
                    {tableItems.map((item, idx) => {
                      if (item._type === "header") {
                        const colSpan = isAdminOrManager ? 9 : 8;
                        return (
                          <tr key={`hdr-${item.dateKey}`} className="bg-parchment/40">
                            <td colSpan={colSpan - 1} className="px-4 py-2 text-[11px] font-bold text-espresso">
                              {item.dayLabel}
                            </td>
                            <td className="px-3 py-2 text-right text-[11px] font-bold text-sage" colSpan={1}>
                              {formatDuration(item.dayTotalMs)}
                            </td>
                          </tr>
                        );
                      }

                      const log = item.log;
                      const isBreak = log.category === "Break";
                      const isLive = !log.end_time;
                      const isOwnEntry = log.user_id === currentUserId;
                      const isEdited = editedLogIds.has(log.id);
                      const isManual = log.is_manual;
                      const catClass = catColors[log.category] || "bg-parchment text-bark";

                      const isExpanded = expandedEntry === log.id;
                      const hasMemos = !!(log.client_memo || log.internal_memo);

                      return (
                        <tr
                          key={log.id}
                          className={`transition-colors cursor-pointer ${isExpanded ? "bg-parchment/50" : "hover:bg-parchment/30"} ${isLive ? "bg-sage-soft/20" : ""}`}
                          onClick={() => setExpandedEntry(isExpanded ? null : log.id)}
                        >
                          {/* User (admin/manager only) */}
                          {isAdminOrManager && (
                            <td className="px-3 py-2.5 align-top">
                              <div className="text-[12px] font-medium text-espresso">{log.full_name || log.username}</div>
                            </td>
                          )}

                          {/* Project */}
                          <td className="px-3 py-2.5 align-top max-w-[140px]">
                            {log.project ? (
                              <span className={`text-[12px] text-espresso ${isExpanded ? "whitespace-pre-wrap break-words" : "block overflow-hidden text-ellipsis whitespace-nowrap"}`}>
                                {log.project}
                              </span>
                            ) : (
                              <span className="text-stone text-[12px]">&mdash;</span>
                            )}
                          </td>

                          {/* Task Name */}
                          <td className="px-3 py-2.5 align-top max-w-[180px]">
                            <div className={`flex items-center gap-1 ${isExpanded ? "" : "max-w-[180px]"}`}>
                              <span className={`font-semibold text-espresso text-[12px] ${isExpanded ? "whitespace-pre-wrap break-words" : "overflow-hidden text-ellipsis whitespace-nowrap"}`}>
                                {log.task_name}
                              </span>
                              {isLive && (
                                <span className="inline-block h-2 w-2 rounded-full bg-terracotta animate-pulse shrink-0" />
                              )}
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
                                <span className="shrink-0 inline-block py-[1px] px-1 rounded text-[8px] font-semibold bg-parchment text-bark">
                                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-stone mt-0.5 whitespace-nowrap">
                              {log.start_time ? formatTimeET(log.start_time, orgTimezone) : "\u2014"}
                            </div>
                            {/* Expanded: show memos inline */}
                            {isExpanded && hasMemos && (
                              <div className="mt-2 space-y-1.5 text-[11px]">
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
                              </div>
                            )}
                          </td>

                          {/* Category */}
                          <td className="pl-1 pr-3 py-2.5 align-top">
                            <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${catClass}`}>
                              {log.category}
                            </span>
                          </td>

                          {/* Account / Client */}
                          <td className="px-3 py-2.5 align-top max-w-[120px]">
                            <span className={`text-[12px] text-espresso ${isExpanded ? "whitespace-pre-wrap break-words" : "block overflow-hidden text-ellipsis whitespace-nowrap"}`}>
                              {log.account || "\u2014"}
                            </span>
                            <div className="text-[10px] text-stone mt-0.5">{log.client_name || ""}</div>
                          </td>

                          {/* Duration */}
                          <td className={`px-3 py-2.5 text-right align-top font-serif font-bold whitespace-nowrap ${isLive ? "text-terracotta" : isBreak ? "text-amber" : "text-sage"}`}>
                            {isLive ? "live" : log.duration_ms > 0 ? formatDurationShort(log.duration_ms) : "0:00"}
                          </td>

                          {/* Memos */}
                          <td className="px-3 py-2.5 align-top">
                            <div className="flex gap-1">
                              {log.client_memo && (
                                <span className="rounded bg-slate-blue-soft px-1.5 py-0.5 text-[9px] font-semibold text-slate-blue">C</span>
                              )}
                              {log.internal_memo && (
                                <span className="rounded bg-amber-soft px-1.5 py-0.5 text-[9px] font-semibold text-walnut">I</span>
                              )}
                              {!log.client_memo && !log.internal_memo && (
                                <span className="text-stone text-[11px]">&mdash;</span>
                              )}
                            </div>
                          </td>

                          {/* Screenshots */}
                          <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                            {(() => {
                              const logScreenshots = screenshots[log.id] || [];
                              return (
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
                                  ) : (
                                    <span className="text-stone text-[11px]">&mdash;</span>
                                  )}
                                  {logScreenshots.length > 3 && (
                                    <span className="text-[9px] text-bark font-medium">+{logScreenshots.length - 3}</span>
                                  )}
                                </div>
                              );
                            })()}
                          </td>

                          {/* Actions */}
                          <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-1">
                              {isAdminOrManager && (
                                <button
                                  onClick={() => setEditingLog(log)}
                                  className="w-[24px] h-[24px] rounded flex items-center justify-center text-stone hover:text-terracotta hover:bg-terracotta-soft transition-all"
                                  title="Edit entry"
                                >
                                  <PencilIcon className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {role === "va" && isOwnEntry && !isLive && (
                                <button
                                  onClick={() => setCorrectionLog(log)}
                                  className="text-[10px] font-medium text-stone hover:text-terracotta transition-colors"
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
                  </tbody>
                </table>

                {/* Expanded detail handled inline in the row */}
              </div>
            )}

            {/* Day Summary Footer */}
            {filteredLogs.length > 0 && (
              <div className="border-t border-sand bg-parchment px-5 py-4 rounded-b-xl">
                <div className="flex flex-wrap items-end gap-7">
                  <SummaryItem
                    value={formatDuration(daySummary.totalMs)}
                    label="Total"
                    colorClass="text-espresso"
                  />
                  <SummaryItem
                    value={formatDuration(daySummary.billableMs)}
                    label="Billable"
                    colorClass="text-sage"
                  />

                  {/* Dynamic category breakdown */}
                  {daySummary.categories.map((cat) => {
                    const colorClass =
                      cat.name.toLowerCase() === "task" ? "text-terracotta" :
                      cat.name.toLowerCase() === "break" ? "text-amber" :
                      cat.name.toLowerCase() === "communication" || cat.name.toLowerCase() === "message" ? "text-slate-blue" :
                      cat.name.toLowerCase() === "meeting" ? "text-clay-rose" :
                      cat.name.toLowerCase() === "personal" ? "text-clay-rose" :
                      cat.name.toLowerCase() === "planning" || cat.name.toLowerCase() === "sorting tasks" || cat.name.toLowerCase() === "sorting" ? "text-amber" :
                      cat.name.toLowerCase() === "collaboration" ? "text-terracotta" :
                      "text-bark";
                    return (
                      <SummaryItem
                        key={cat.name}
                        value={cat.formatted}
                        label={cat.name}
                        colorClass={colorClass}
                      />
                    );
                  })}

                  <SummaryItem
                    value={formatDuration(daySummary.wizardMs)}
                    label="Wizard Time"
                    colorClass="text-walnut"
                  />
                  <SummaryItem
                    value={daySummary.entryCount.toString()}
                    label="Entries"
                    colorClass="text-espresso"
                  />

                  {/* Mood indicator */}
                  {moodSummary && (
                    <div className="ml-auto">
                      {moodSummary.type === "single" ? (
                        <div className="text-center">
                          <div className="text-2xl">{moodSummary.emoji}</div>
                          <div className="mt-0.5 text-[10px] font-semibold text-bark">Mood</div>
                        </div>
                      ) : (
                        <div className="text-center">
                          <div className="text-sm font-semibold text-espresso">{moodSummary.display}</div>
                          <div className="mt-0.5 text-[10px] font-semibold text-bark">Team Mood</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Task type & status breakdown */}
                <div className="flex gap-4 mt-3 pt-3 border-t border-sand/60 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-sage"></span>
                    <span className="text-[11px] font-semibold text-espresso">{daySummary.hourlyCount}</span>
                    <span className="text-[10px] text-bark">Hourly</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-slate-blue"></span>
                    <span className="text-[11px] font-semibold text-espresso">{daySummary.fixedCount}</span>
                    <span className="text-[10px] text-bark">Fixed</span>
                  </div>
                  <div className="w-px h-4 bg-sand/80 self-center"></div>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-terracotta"></span>
                    <span className="text-[11px] font-semibold text-espresso">{daySummary.inProgressCount}</span>
                    <span className="text-[10px] text-bark">In Progress</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-sage"></span>
                    <span className="text-[11px] font-semibold text-espresso">{daySummary.completedCount}</span>
                    <span className="text-[10px] text-bark">Completed</span>
                  </div>
                  {daySummary.onHoldCount > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-2 h-2 rounded-full bg-amber"></span>
                      <span className="text-[11px] font-semibold text-espresso">{daySummary.onHoldCount}</span>
                      <span className="text-[10px] text-bark">On Hold</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Modals ──────────────────────────────────────────── */}

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

/* ── Summary Item ────────────────────────────────────────── */

function SummaryItem({
  value,
  label,
  colorClass,
}: {
  value: string;
  label: string;
  colorClass: string;
}) {
  return (
    <div>
      <div className={`font-serif text-lg font-bold ${colorClass}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[10px] font-semibold text-bark">{label}</div>
    </div>
  );
}
