"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile, TimeLog, TaskScreenshot, UserRole } from "@/types/database";
import {
  formatDuration,
  getInitials,
  getAvatarColor,
  getTodayBoundsInTimezone,
  getWeekBoundsInTimezone,
  getMonthBoundsInTimezone,
} from "@/lib/utils";

/* ── Types ────────────────────────────────────────────────── */

type DateRange = "today" | "week" | "month" | "custom";

type DailyData = {
  label: string;
  date: string;
  billableMs: number;
  personalMs: number;
  totalMs: number;
};

type AccountHours = {
  account: string;
  totalMs: number;
};

type PersonHours = {
  profile: Profile;
  totalMs: number;
  taskCount: number;
};

type ProjectSummaryItem = {
  name: string;
  totalMs: number;
  count: number;
};

type TaskSummaryItem = {
  name: string;
  totalMs: number;
  count: number;
};

type CategoryTrend = {
  name: string;
  currentMs: number;
  currentPct: number;
  prevMs: number;
  prevPct: number;
  deltaPct: number;
};

type VAProgress = {
  userId: string;
  profile: Profile | undefined;
  currentTotalMs: number;
  prevTotalMs: number;
  productivityScore: number;
  prevProductivityScore: number;
  categories: CategoryTrend[];
  screenshotCount: number;
};

/* ── Page Component ───────────────────────────────────────── */

export default function ReportsPage() {
  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [screenshots, setScreenshots] = useState<TaskScreenshot[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>("week");
  const [selectedVA, setSelectedVA] = useState<string>("all");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [appliedStart, setAppliedStart] = useState<string>("");
  const [appliedEnd, setAppliedEnd] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<UserRole>("va");
  const [orgTimezone, setOrgTimezone] = useState<string>("UTC");
  const [selectedAccount, setSelectedAccount] = useState<string>("all");
  const [selectedClient, setSelectedClient] = useState<string>("all");
  const [projectsCollapsed, setProjectsCollapsed] = useState(false);
  const [tasksCollapsed, setTasksCollapsed] = useState(false);
  const [reportTab, setReportTab] = useState<"overview" | "progress">("overview");
  const [compLogs, setCompLogs] = useState<TimeLog[]>([]);

  /* ── Fetch org timezone on mount ────────────────────────── */

  useEffect(() => {
    async function fetchTimezone() {
      const supabase = createClient();
      const { data } = await supabase
        .from("organization_settings")
        .select("timezone")
        .limit(1)
        .single();
      if (data?.timezone) setOrgTimezone(data.timezone);
    }
    fetchTimezone();
  }, []);

  /* ── Compute date range as ISO strings (stable primitives) ── */

  const { startISO, endISO, start, end, periodLabel } = useMemo(() => {
    if (dateRange === "today") {
      const { start: s, end: e } = getTodayBoundsInTimezone(orgTimezone);
      const label = new Date(s).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: orgTimezone });
      return { startISO: s, endISO: e, start: new Date(s), end: new Date(e), periodLabel: label };
    } else if (dateRange === "week") {
      const { start: s, end: e } = getWeekBoundsInTimezone(orgTimezone);
      const label = `Week of ${new Date(s).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: orgTimezone })} \u2013 ${new Date(e).toLocaleDateString("en-US", { day: "numeric", year: "numeric", timeZone: orgTimezone })}`;
      return { startISO: s, endISO: e, start: new Date(s), end: new Date(e), periodLabel: label };
    } else if (dateRange === "custom" && appliedStart && appliedEnd) {
      const s = new Date(appliedStart + "T12:00:00");
      const e = new Date(appliedEnd + "T12:00:00");
      const label = `${s.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: orgTimezone })} \u2013 ${e.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: orgTimezone })}`;
      return { startISO: s.toISOString(), endISO: e.toISOString(), start: s, end: e, periodLabel: label };
    } else if (dateRange === "custom") {
      // Custom selected but no dates applied yet — don't fetch, show placeholder
      const s = new Date(0);
      const e = new Date(0);
      return { startISO: "", endISO: "", start: s, end: e, periodLabel: "Select date range" };
    } else {
      const { start: s, end: e } = getMonthBoundsInTimezone(orgTimezone);
      const label = new Date(s).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: orgTimezone });
      return { startISO: s, endISO: e, start: new Date(s), end: new Date(e), periodLabel: label };
    }
  }, [dateRange, appliedStart, appliedEnd, orgTimezone]);

  /* ── Comparison period (previous equivalent range) ──────── */

  const { compStartISO, compEndISO, compLabel } = useMemo(() => {
    if (!startISO || !endISO) return { compStartISO: "", compEndISO: "", compLabel: "" };
    const durMs = new Date(endISO).getTime() - new Date(startISO).getTime();
    const compEnd = new Date(new Date(startISO).getTime() - 1);
    const compStart = new Date(compEnd.getTime() - durMs);
    let label = "previous period";
    if (dateRange === "today") label = "yesterday";
    else if (dateRange === "week") label = "last week";
    else if (dateRange === "month") label = "last month";
    return { compStartISO: compStart.toISOString(), compEndISO: compEnd.toISOString(), compLabel: label };
  }, [startISO, endISO, dateRange]);

  /* ── Fetch data — uses ISO strings so deps are stable primitives ── */

  const fetchData = useCallback(async (qStart: string, qEnd: string) => {
    if (!qStart || !qEnd) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();

      // Get current user and role
      const { data: { user } } = await supabase.auth.getUser();
      const currentUserId = user?.id || null;
      setUserId(currentUserId);

      if (currentUserId) {
        const { data: profileData } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", currentUserId)
          .single();
        const userRole = (profileData?.role as UserRole) || "va";
        setRole(userRole);
      }

      const [logsRes, profilesRes, screenshotsRes] = await Promise.all([
        supabase
          .from("time_logs")
          .select("*")
          .gte("session_date", qStart.slice(0, 10))
          .lte("session_date", qEnd.slice(0, 10))
          .order("start_time", { ascending: true }),
        supabase.from("profiles").select("*"),
        supabase
          .from("task_screenshots")
          .select("*")
          .gte("created_at", qStart)
          .lte("created_at", qEnd),
      ]);

      setLogs((logsRes.data ?? []) as TimeLog[]);
      setProfiles((profilesRes.data ?? []) as Profile[]);
      setScreenshots((screenshotsRes.data ?? []) as TaskScreenshot[]);
    } catch (err) {
      console.error("Reports fetch error:", err);
      // Ensure we still show the page (with empty data) rather than stuck loading
    } finally {
      setLoading(false);
    }
  }, []);

  /* ── Fetch comparison data (previous period) ────────────── */

  const fetchCompData = useCallback(async (qStart: string, qEnd: string) => {
    if (!qStart || !qEnd) return;
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("time_logs")
        .select("*")
        .gte("session_date", qStart.slice(0, 10))
        .lte("session_date", qEnd.slice(0, 10));
      setCompLogs((data ?? []) as TimeLog[]);
    } catch (err) {
      console.error("Comparison fetch error:", err);
    }
  }, []);

  /* ── Auto-fetch when startISO/endISO change (for non-custom ranges) ── */

  useEffect(() => {
    if (startISO && endISO) {
      fetchData(startISO, endISO);
    } else if (dateRange === "custom" && !appliedStart) {
      // Just switched to custom, no dates yet — stop loading, show picker
      setLoading(false);
    }
  }, [startISO, endISO, fetchData, dateRange, appliedStart]);

  useEffect(() => {
    if (compStartISO && compEndISO) fetchCompData(compStartISO, compEndISO);
  }, [compStartISO, compEndISO, fetchCompData]);

  /* ── Filter by selected VA / Account / Client ───────────── */

  const filteredLogs = useMemo(() => {
    let result = selectedVA === "all" ? logs : logs.filter((l) => l.user_id === selectedVA);
    if (selectedAccount !== "all") result = result.filter((l) => l.account === selectedAccount);
    if (selectedClient !== "all") result = result.filter((l) => l.client_name === selectedClient);
    return result;
  }, [logs, selectedVA, selectedAccount, selectedClient]);

  /* ── Derived filter options ──────────────────────────────── */

  const accountOptions = useMemo(() => {
    const accounts = new Set<string>();
    logs.forEach((l) => { if (l.account) accounts.add(l.account); });
    return Array.from(accounts).sort();
  }, [logs]);

  const clientOptions = useMemo(() => {
    const clients = new Set<string>();
    logs.forEach((l) => { if (l.client_name) clients.add(l.client_name); });
    return Array.from(clients).sort();
  }, [logs]);

  const filteredScreenshots = useMemo(
    () =>
      selectedVA === "all"
        ? screenshots
        : screenshots.filter((s) => s.user_id === selectedVA),
    [screenshots, selectedVA]
  );

  /* ── Filtered comparison logs ────────────────────────────── */

  const compFilteredLogs = useMemo(() => {
    let result = selectedVA === "all" ? compLogs : compLogs.filter((l) => l.user_id === selectedVA);
    if (selectedAccount !== "all") result = result.filter((l) => l.account === selectedAccount);
    if (selectedClient !== "all") result = result.filter((l) => l.client_name === selectedClient);
    return result;
  }, [compLogs, selectedVA, selectedAccount, selectedClient]);

  /* ── Computed stats (matches Activity Log summary + type/status) ── */

  const reportSummary = useMemo(() => {
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

      const rawCat = l.category || "Task";
      const cat = rawCat === "Sorting Tasks" || rawCat === "Sorting" ? "Planning"
        : rawCat === "Message" ? "Communication"
        : rawCat === "Meeting" ? "Collaboration"
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

    // Build sorted category entries (alphabetical, Personal last, Wizard Time second-to-last)
    const categories = Object.entries(categoryMs)
      .filter(([, ms]) => ms > 0)
      .sort(([a], [b]) => {
        if (a.toLowerCase() === "personal") return 1;
        if (b.toLowerCase() === "personal") return -1;
        return a.localeCompare(b);
      })
      .map(([name, ms]) => ({ name, ms }));

    // Insert Wizard Time before Personal (which sorts last)
    if (wizardMs > 0) {
      const personalIdx = categories.findIndex((c) => c.name.toLowerCase() === "personal");
      if (personalIdx >= 0) {
        categories.splice(personalIdx, 0, { name: "Wizard Time", ms: wizardMs });
      } else {
        categories.push({ name: "Wizard Time", ms: wizardMs });
      }
    }

    return {
      totalMs,
      billableMs,
      wizardMs,
      entries: filteredLogs.length,
      categories,
      fixedCount,
      hourlyCount,
      inProgressCount,
      completedCount,
      onHoldCount,
    };
  }, [filteredLogs]);

  /* ── Progress Report per VA ──────────────────────────────── */

  const progressReports = useMemo((): VAProgress[] => {
    const normCat = (raw: string) =>
      raw === "Sorting Tasks" || raw === "Sorting" ? "Planning"
      : raw === "Message" ? "Communication"
      : raw === "Meeting" ? "Collaboration"
      : raw;

    const computeCats = (logs: TimeLog[]) => {
      const totalMs = logs.reduce((s, l) => s + (l.duration_ms || 0), 0);
      const wizardMs = logs.reduce((s, l) => s + (l.form_fill_ms || 0), 0);
      const catMap: Record<string, number> = {};
      logs.forEach((l) => {
        const cat = normCat(l.category || "Task");
        catMap[cat] = (catMap[cat] || 0) + (l.duration_ms || 0);
      });
      if (wizardMs > 0) catMap["Wizard Time"] = (catMap["Wizard Time"] || 0) + wizardMs;
      return { totalMs, catMap };
    };

    const userIds = new Set<string>([
      ...filteredLogs.map((l) => l.user_id),
      ...compFilteredLogs.map((l) => l.user_id),
    ]);

    return Array.from(userIds).map((uid) => {
      const currLogs = filteredLogs.filter((l) => l.user_id === uid);
      const prevLogs = compFilteredLogs.filter((l) => l.user_id === uid);
      const curr = computeCats(currLogs);
      const prev = computeCats(prevLogs);

      const allCats = new Set([...Object.keys(curr.catMap), ...Object.keys(prev.catMap)]);
      const categories: CategoryTrend[] = Array.from(allCats).map((name) => {
        const currentMs = curr.catMap[name] || 0;
        const prevMs = prev.catMap[name] || 0;
        const currentPct = curr.totalMs > 0 ? (currentMs / curr.totalMs) * 100 : 0;
        const prevPct = prev.totalMs > 0 ? (prevMs / prev.totalMs) * 100 : 0;
        return { name, currentMs, currentPct, prevMs, prevPct, deltaPct: currentPct - prevPct };
      }).sort((a, b) => b.currentMs - a.currentMs);

      const nonProdMs = (curr.catMap["Personal"] || 0) + (curr.catMap["Break"] || 0);
      const productivityScore = curr.totalMs > 0 ? ((curr.totalMs - nonProdMs) / curr.totalMs) * 100 : 0;
      const prevNonProd = (prev.catMap["Personal"] || 0) + (prev.catMap["Break"] || 0);
      const prevProductivityScore = prev.totalMs > 0 ? ((prev.totalMs - prevNonProd) / prev.totalMs) * 100 : 0;

      return {
        userId: uid,
        profile: profiles.find((p) => p.id === uid),
        currentTotalMs: curr.totalMs,
        prevTotalMs: prev.totalMs,
        productivityScore,
        prevProductivityScore,
        categories,
        screenshotCount: filteredScreenshots.filter((s) => s.user_id === uid).length,
      };
    }).sort((a, b) => b.currentTotalMs - a.currentTotalMs);
  }, [filteredLogs, compFilteredLogs, profiles, filteredScreenshots]);

  // Keep these for the daily chart and financial summary
  const totalHoursMs = reportSummary.totalMs;
  const billableMs = reportSummary.billableMs;
  const breakMs = reportSummary.categories.find((c) => c.name === "Break")?.ms || 0;
  const tasksCompleted = filteredLogs.filter((l) => l.end_time && l.category !== "Break").length;

  /* ── Daily chart data ────────────────────────────────────── */

  const dailyData: DailyData[] = useMemo(() => {
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    const buildDay = (dateStr: string, label: string): DailyData => {
      const dayLogs = filteredLogs.filter(
        (l) =>
          (l.session_date ||
            (l.start_time
              ? new Date(l.start_time).toLocaleDateString("en-CA", { timeZone: orgTimezone })
              : "")) === dateStr
      );
      return {
        label,
        date: dateStr,
        billableMs: dayLogs
          .filter((l) => l.billable)
          .reduce((sum, l) => sum + (l.duration_ms || 0), 0),
        personalMs: dayLogs
          .filter((l) => l.category === "Personal")
          .reduce((sum, l) => sum + (l.duration_ms || 0), 0),
        totalMs: dayLogs.reduce((sum, l) => sum + (l.duration_ms || 0), 0),
      };
    };

    if (dateRange === "today") {
      const dateStr = new Date().toLocaleDateString("en-CA", { timeZone: orgTimezone });
      const label = new Date().toLocaleDateString("en-US", { weekday: "short", timeZone: orgTimezone });
      return [buildDay(dateStr, label)];
    } else if (dateRange === "week") {
      const days: DailyData[] = [];
      const ws = new Date(getWeekBoundsInTimezone(orgTimezone).start);
      for (let i = 0; i < 7; i++) {
        const d = new Date(ws.getTime() + i * 86400000);
        const dateStr = d.toLocaleDateString("en-CA", { timeZone: orgTimezone });
        const label = d.toLocaleDateString("en-US", { weekday: "short", timeZone: orgTimezone });
        days.push(buildDay(dateStr, label));
      }
      return days;
    } else if (dateRange === "custom" && appliedStart && appliedEnd) {
      const days: DailyData[] = [];
      const s = new Date(appliedStart + "T12:00:00");
      const e = new Date(appliedEnd + "T12:00:00");
      const diffDays = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
      for (let i = 0; i < diffDays && i < 90; i++) {
        const d = new Date(s.getTime() + i * 86400000);
        const dateStr = d.toLocaleDateString("en-CA", { timeZone: orgTimezone });
        // For short ranges show day names, for longer ranges show date
        const label =
          diffDays <= 14
            ? `${dayNames[d.getDay()]} ${d.getDate()}`
            : d.getDate().toString();
        days.push(buildDay(dateStr, label));
      }
      return days;
    } else {
      const days: DailyData[] = [];
      const monthStr = new Date(startISO).toLocaleDateString("en-CA", { timeZone: orgTimezone }).slice(0, 7);
      const [yearStr, monthNumStr] = monthStr.split("-");
      const year = Number(yearStr);
      const monthNum = Number(monthNumStr);
      const daysInMonth = new Date(year, monthNum, 0).getDate();
      for (let i = 1; i <= daysInMonth; i++) {
        const d = new Date(`${monthStr}-${String(i).padStart(2, "0")}T12:00:00`);
        const dateStr = d.toLocaleDateString("en-CA", { timeZone: orgTimezone });
        days.push(buildDay(dateStr, i.toString()));
      }
      return days;
    }
  }, [filteredLogs, dateRange, startISO, appliedStart, appliedEnd, orgTimezone]);

  const maxDayMs = useMemo(
    () => Math.max(...dailyData.map((d) => d.totalMs), 1),
    [dailyData]
  );

  /* ── By account ──────────────────────────────────────────── */

  const accountHours: AccountHours[] = useMemo(() => {
    const map: Record<string, number> = {};
    filteredLogs
      .forEach((l) => {
        const acct = l.account || "Unassigned";
        map[acct] = (map[acct] || 0) + (l.duration_ms || 0);
      });
    return Object.entries(map)
      .map(([account, totalMs]) => ({ account, totalMs }))
      .sort((a, b) => b.totalMs - a.totalMs);
  }, [filteredLogs]);

  const maxAccountMs = useMemo(
    () => Math.max(...accountHours.map((a) => a.totalMs), 1),
    [accountHours]
  );

  /* ── By person ───────────────────────────────────────────── */

  const personHours: PersonHours[] = useMemo(() => {
    const map: Record<string, { totalMs: number; taskCount: number }> = {};
    filteredLogs
      .forEach((l) => {
        if (!map[l.user_id]) map[l.user_id] = { totalMs: 0, taskCount: 0 };
        map[l.user_id].totalMs += l.duration_ms || 0;
        map[l.user_id].taskCount += 1;
      });
    return profiles
      .map((p) => ({
        profile: p,
        totalMs: map[p.id]?.totalMs || 0,
        taskCount: map[p.id]?.taskCount || 0,
      }))
      .sort((a, b) => b.totalMs - a.totalMs);
  }, [filteredLogs, profiles]);

  /* ── VA Breakdown (per-VA hours + projects + tasks) ─────── */

  const vaBreakdown = useMemo(() => {
    const map: Record<string, {
      profile: Profile | undefined;
      totalMs: number;
      projects: Record<string, number>;
      tasks: Record<string, number>;
    }> = {};

    filteredLogs
      .filter((l) => l.end_time && l.category !== "Break")
      .forEach((l) => {
        if (!map[l.user_id]) {
          map[l.user_id] = {
            profile: profiles.find((p) => p.id === l.user_id),
            totalMs: 0,
            projects: {},
            tasks: {},
          };
        }
        map[l.user_id].totalMs += l.duration_ms || 0;
        const proj = l.project || "No Project";
        map[l.user_id].projects[proj] = (map[l.user_id].projects[proj] || 0) + (l.duration_ms || 0);
        const task = l.task_name || "Untitled";
        map[l.user_id].tasks[task] = (map[l.user_id].tasks[task] || 0) + (l.duration_ms || 0);
      });

    return Object.values(map)
      .filter((v) => v.totalMs > 0)
      .sort((a, b) => b.totalMs - a.totalMs);
  }, [filteredLogs, profiles]);

  /* ── Project & Task Summary ──────────────────────────────── */

  const projectSummary: ProjectSummaryItem[] = useMemo(() => {
    const map: Record<string, { totalMs: number; count: number }> = {};
    filteredLogs
      .filter((l) => l.end_time && l.category !== "Break" && l.category !== "Personal")
      .forEach((l) => {
        const proj = l.project || "No Project";
        if (!map[proj]) map[proj] = { totalMs: 0, count: 0 };
        map[proj].totalMs += l.duration_ms || 0;
        map[proj].count += 1;
      });
    return Object.entries(map)
      .map(([name, data]) => ({ name, totalMs: data.totalMs, count: data.count }))
      .sort((a, b) => b.totalMs - a.totalMs);
  }, [filteredLogs]);

  const taskSummary: TaskSummaryItem[] = useMemo(() => {
    const map: Record<string, { totalMs: number; count: number }> = {};
    filteredLogs
      .filter((l) => l.end_time && l.category !== "Break" && l.category !== "Personal")
      .forEach((l) => {
        const task = l.task_name || "Untitled Task";
        if (!map[task]) map[task] = { totalMs: 0, count: 0 };
        map[task].totalMs += l.duration_ms || 0;
        map[task].count += 1;
      });
    return Object.entries(map)
      .map(([name, data]) => ({ name, totalMs: data.totalMs, count: data.count }))
      .sort((a, b) => b.totalMs - a.totalMs);
  }, [filteredLogs]);

  /* ── Export CSV ───────────────────────────────────────────── */

  const exportCSV = useCallback(() => {
    const header = [
      "Date",
      "Start Time",
      "End Time",
      "Duration (min)",
      "User",
      "Full Name",
      "Task",
      "Category",
      "Project",
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
        l.username || "",
        l.full_name || "",
        l.task_name || "",
        l.category || "",
        l.project || "",
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
    link.download = `MinuteFlow-Report-${start.toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [filteredLogs, start, orgTimezone]);

  /* ── Export XLSX (HTML table for Excel) ──────────────────── */

  const exportXLSX = useCallback(() => {
    let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body>`;
    html += `<table border="1"><thead><tr>`;
    const headers = [
      "Date",
      "Start",
      "End",
      "Duration (min)",
      "User",
      "Full Name",
      "Task",
      "Category",
      "Project",
      "Account",
      "Client",
      "Billable",
      "Client Memo",
      "Internal Memo",
    ];
    headers.forEach((h) => {
      html += `<th style="background:#3d3229;color:#fff;font-weight:bold;">${h}</th>`;
    });
    html += `</tr></thead><tbody>`;

    filteredLogs.forEach((l) => {
      const cat = l.category || "Task";
      const bg =
        cat === "Break"
          ? "#fff3cd"
          : cat === "Personal"
            ? "#fce4ec"
            : l.billable
              ? "#e8f4f8"
              : "#f5f5f5";
      html += `<tr style="background:${bg}">`;
      html += `<td>${l.start_time ? new Date(l.start_time).toLocaleDateString("en-US", { timeZone: orgTimezone }) : ""}</td>`;
      html += `<td>${l.start_time ? new Date(l.start_time).toLocaleTimeString("en-US", { timeZone: orgTimezone }) : ""}</td>`;
      html += `<td>${l.end_time ? new Date(l.end_time).toLocaleTimeString("en-US", { timeZone: orgTimezone }) : ""}</td>`;
      html += `<td>${l.duration_ms ? Math.round(l.duration_ms / 60000) : 0}</td>`;
      html += `<td>${l.username || ""}</td>`;
      html += `<td>${l.full_name || ""}</td>`;
      html += `<td>${l.task_name || ""}</td>`;
      html += `<td>${cat}</td>`;
      html += `<td>${l.project || ""}</td>`;
      html += `<td>${l.account || ""}</td>`;
      html += `<td>${l.client_name || ""}</td>`;
      html += `<td>${l.billable ? "Yes" : "No"}</td>`;
      html += `<td>${l.client_memo || ""}</td>`;
      html += `<td>${l.internal_memo || ""}</td>`;
      html += `</tr>`;
    });

    html += `</tbody></table></body></html>`;

    const blob = new Blob([html], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `MinuteFlow-Report-${start.toISOString().slice(0, 10)}.xls`;
    link.click();
    URL.revokeObjectURL(url);
  }, [filteredLogs, start, orgTimezone]);

  /* ── Render ──────────────────────────────────────────────── */

  return (
    <>
      {/* Page Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-bold text-espresso">
            Reports
          </h1>
          <p className="mt-0.5 text-[13px] text-bark">{periodLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Tab: Overview vs Progress */}
          <div className="flex rounded-lg border border-sand overflow-hidden mr-1">
            <button
              onClick={() => setReportTab("overview")}
              className={`px-4 py-2 text-[13px] font-semibold transition-all ${
                reportTab === "overview"
                  ? "bg-espresso text-white"
                  : "bg-parchment text-walnut hover:bg-sand"
              }`}
            >
              Overview
            </button>
            <button
              onClick={() => setReportTab("progress")}
              className={`px-4 py-2 text-[13px] font-semibold transition-all border-l border-sand ${
                reportTab === "progress"
                  ? "bg-espresso text-white"
                  : "bg-parchment text-walnut hover:bg-sand"
              }`}
            >
              Progress
            </button>
          </div>
          {/* VA Filter (admin/manager only) */}
          {(role === "admin" || role === "manager") && (
            <select
              value={selectedVA}
              onChange={(e) => setSelectedVA(e.target.value)}
              className="rounded-lg border border-sand bg-white px-3 py-2 text-[13px] font-semibold text-espresso shadow-sm outline-none focus:border-terracotta"
            >
              <option value="all">All Team</option>
              {profiles
                .filter((p) => p.is_active !== false)
                .sort((a, b) => (a.full_name || "").localeCompare(b.full_name || ""))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.username || "Unknown"}
                  </option>
                ))}
            </select>
          )}
          {/* Account Filter */}
          {accountOptions.length > 0 && (
            <select
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value)}
              className="rounded-lg border border-sand bg-white px-3 py-2 text-[13px] font-semibold text-espresso shadow-sm outline-none focus:border-terracotta"
            >
              <option value="all">All Accounts</option>
              {accountOptions.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          )}
          {/* Client Filter */}
          {clientOptions.length > 0 && (
            <select
              value={selectedClient}
              onChange={(e) => setSelectedClient(e.target.value)}
              className="rounded-lg border border-sand bg-white px-3 py-2 text-[13px] font-semibold text-espresso shadow-sm outline-none focus:border-terracotta"
            >
              <option value="all">All Clients</option>
              {clientOptions.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => setDateRange("today")}
            className={`rounded-lg px-4 py-2 text-[13px] font-semibold transition-all ${
              dateRange === "today"
                ? "bg-white text-espresso border border-sand shadow-sm"
                : "bg-parchment text-walnut border border-sand hover:bg-sand"
            }`}
          >
            Today
          </button>
          <button
            onClick={() => setDateRange("week")}
            className={`rounded-lg px-4 py-2 text-[13px] font-semibold transition-all ${
              dateRange === "week"
                ? "bg-white text-espresso border border-sand shadow-sm"
                : "bg-parchment text-walnut border border-sand hover:bg-sand"
            }`}
          >
            This Week
          </button>
          <button
            onClick={() => setDateRange("month")}
            className={`rounded-lg px-4 py-2 text-[13px] font-semibold transition-all ${
              dateRange === "month"
                ? "bg-white text-espresso border border-sand shadow-sm"
                : "bg-parchment text-walnut border border-sand hover:bg-sand"
            }`}
          >
            This Month
          </button>
          <button
            onClick={() => setDateRange("custom")}
            className={`rounded-lg px-4 py-2 text-[13px] font-semibold transition-all ${
              dateRange === "custom"
                ? "bg-white text-espresso border border-sand shadow-sm"
                : "bg-parchment text-walnut border border-sand hover:bg-sand"
            }`}
          >
            Custom
          </button>
          <button
            onClick={exportCSV}
            className="rounded-lg bg-parchment px-4 py-2 text-[13px] font-semibold text-walnut border border-sand transition-all hover:bg-sand"
          >
            Export CSV
          </button>
          <button
            onClick={exportXLSX}
            className="rounded-lg bg-terracotta px-4 py-2 text-[13px] font-semibold text-white transition-all hover:bg-[#a85840]"
          >
            Export XLSX
          </button>
        </div>
      </div>

      {/* Custom Date Range Picker */}
      {dateRange === "custom" && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-sand bg-white px-5 py-4">
          <label className="text-[13px] font-semibold text-espresso">From</label>
          <input
            type="date"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            className="rounded-lg border border-sand bg-parchment px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta"
          />
          <label className="text-[13px] font-semibold text-espresso">To</label>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            className="rounded-lg border border-sand bg-parchment px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta"
          />
          {customStart && customEnd ? (
            <button
              onClick={() => {
                // Just set the applied dates — the useEffect will detect the
                // change in startISO/endISO and trigger a single fetch.
                setAppliedStart(customStart);
                setAppliedEnd(customEnd);
              }}
              className="rounded-lg bg-terracotta px-5 py-2 text-[13px] font-semibold text-white transition-all hover:bg-[#a85840]"
            >
              Apply
            </button>
          ) : (
            <span className="text-[12px] text-bark">Pick both dates to load data</span>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex flex-wrap gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="h-28 w-40 animate-pulse rounded-xl border border-sand bg-white"
            />
          ))}
        </div>
      ) : reportTab === "progress" ? (
        /* ── Progress Report Tab ────────────────────────────────── */
        <div className="space-y-4">
          {progressReports.length === 0 ? (
            <div className="rounded-xl border border-sand bg-white px-5 py-10 text-center">
              <p className="text-[13px] text-bark">No data for this period.</p>
            </div>
          ) : (
            progressReports.map((va) => {
              const name = va.profile?.full_name || va.profile?.username || "Unknown";
              const initials = getInitials(name);
              const avatarColor = getAvatarColor(name);
              const scoreChange = va.productivityScore - va.prevProductivityScore;
              const hoursChange =
                va.prevTotalMs > 0
                  ? ((va.currentTotalMs - va.prevTotalMs) / va.prevTotalMs) * 100
                  : null;

              // Auto-generate insights
              const insights: string[] = [];
              if (va.currentTotalMs > 0 && va.prevTotalMs > 0 && hoursChange !== null && Math.abs(hoursChange) >= 5) {
                insights.push(
                  hoursChange > 0
                    ? `Total hours up ${hoursChange.toFixed(0)}% vs ${compLabel}`
                    : `Total hours down ${Math.abs(hoursChange).toFixed(0)}% vs ${compLabel}`
                );
              }
              const actionableCats = va.categories.filter(
                (c) => c.name !== "Break" && c.name !== "Wizard Time"
              );
              const topUp = actionableCats
                .filter((c) => c.deltaPct > 3)
                .sort((a, b) => b.deltaPct - a.deltaPct)[0];
              const topDown = actionableCats
                .filter((c) => c.deltaPct < -3)
                .sort((a, b) => a.deltaPct - b.deltaPct)[0];
              if (topUp)
                insights.push(`${topUp.name} up ${topUp.deltaPct.toFixed(1)}pp vs ${compLabel}`);
              if (topDown)
                insights.push(
                  `${topDown.name} down ${Math.abs(topDown.deltaPct).toFixed(1)}pp vs ${compLabel}`
                );

              return (
                <div key={va.userId} className="rounded-xl border border-sand bg-white">
                  {/* Card Header */}
                  <div className="flex flex-wrap items-center gap-4 border-b border-parchment px-5 py-4">
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
                      style={{ backgroundColor: avatarColor }}
                    >
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-bold text-espresso">{name}</div>
                      {va.profile?.position && (
                        <div className="text-[11px] text-bark">{va.profile.position}</div>
                      )}
                    </div>
                    {/* Productivity Score */}
                    <div className="text-right">
                      <div
                        className={`font-serif text-2xl font-bold ${
                          va.productivityScore >= 80
                            ? "text-sage"
                            : va.productivityScore >= 60
                            ? "text-amber"
                            : "text-terracotta"
                        }`}
                      >
                        {va.productivityScore.toFixed(0)}%
                      </div>
                      <div className="flex items-center justify-end gap-1 text-[10px] text-bark">
                        <span>Productivity</span>
                        {Math.abs(scoreChange) >= 1 && (
                          <span
                            className={`font-semibold ${
                              scoreChange > 0 ? "text-sage" : "text-terracotta"
                            }`}
                          >
                            {scoreChange > 0 ? "↑" : "↓"}
                            {Math.abs(scoreChange).toFixed(0)}pp
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Total Hours */}
                    <div className="text-right border-l border-parchment pl-4">
                      <div className="font-serif text-base font-bold text-espresso">
                        {formatDuration(va.currentTotalMs)}
                      </div>
                      <div className="text-[10px] text-bark">
                        vs {formatDuration(va.prevTotalMs)}
                        {hoursChange !== null && Math.abs(hoursChange) >= 1 && (
                          <span
                            className={`ml-1 font-semibold ${
                              hoursChange > 0 ? "text-sage" : "text-terracotta"
                            }`}
                          >
                            {hoursChange > 0 ? "+" : ""}
                            {hoursChange.toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Category Trends */}
                  <div className="px-5 py-4">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-bark mb-3">
                      Time by Category — vs {compLabel}
                    </div>
                    <div className="space-y-3">
                      {va.categories
                        .filter((c) => c.currentMs > 0 || c.prevMs > 0)
                        .map((cat) => (
                          <div key={cat.name} className="flex items-center gap-3">
                            <div className="w-[110px] shrink-0 text-[12px] font-semibold text-espresso truncate">
                              {cat.name}
                            </div>
                            <div className="flex-1 space-y-1">
                              {/* Current period bar */}
                              <div className="flex items-center gap-2">
                                <div className="w-[30px] shrink-0 text-right text-[10px] text-espresso font-semibold">
                                  {cat.currentPct.toFixed(0)}%
                                </div>
                                <div className="flex-1 h-2 rounded bg-parchment overflow-hidden">
                                  <div
                                    className="h-full rounded bg-terracotta"
                                    style={{ width: `${Math.max(cat.currentPct, cat.currentMs > 0 ? 2 : 0)}%` }}
                                  />
                                </div>
                                <div className="w-[55px] shrink-0 text-right text-[10px] text-espresso">
                                  {formatDuration(cat.currentMs)}
                                </div>
                              </div>
                              {/* Previous period bar */}
                              {cat.prevMs > 0 && (
                                <div className="flex items-center gap-2 opacity-50">
                                  <div className="w-[30px] shrink-0 text-right text-[10px] text-bark">
                                    {cat.prevPct.toFixed(0)}%
                                  </div>
                                  <div className="flex-1 h-1.5 rounded bg-parchment overflow-hidden">
                                    <div
                                      className="h-full rounded bg-bark"
                                      style={{ width: `${Math.max(cat.prevPct, 2)}%` }}
                                    />
                                  </div>
                                  <div className="w-[55px] shrink-0 text-right text-[10px] text-bark">
                                    {formatDuration(cat.prevMs)}
                                  </div>
                                </div>
                              )}
                            </div>
                            {/* Delta badge */}
                            <div
                              className={`w-[44px] shrink-0 text-right text-[11px] font-bold ${
                                cat.deltaPct > 2
                                  ? "text-sage"
                                  : cat.deltaPct < -2
                                  ? "text-terracotta"
                                  : "text-bark"
                              }`}
                            >
                              {Math.abs(cat.deltaPct) < 0.5
                                ? "—"
                                : `${cat.deltaPct > 0 ? "+" : ""}${cat.deltaPct.toFixed(1)}pp`}
                            </div>
                          </div>
                        ))}
                    </div>

                    {/* Insights */}
                    {insights.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {insights.map((insight, i) => (
                          <div
                            key={i}
                            className="rounded-full bg-parchment px-3 py-1 text-[11px] font-semibold text-espresso border border-sand"
                          >
                            {insight.toLowerCase().includes("up") ? "📈 " : "📉 "}
                            {insight}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Screenshots */}
                    {va.screenshotCount > 0 && (
                      <div className="mt-3 text-[11px] text-bark">
                        📷 {va.screenshotCount} screenshot{va.screenshotCount !== 1 ? "s" : ""} captured
                        this period
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : (
        <>
          {/* Summary — compact grouped layout */}
          <div className="mb-6 grid gap-4 grid-cols-3">
            {/* Time Overview */}
            <div className="rounded-xl border border-sand bg-white px-5 py-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-bark mb-3">Time Overview</div>
              <div className="flex gap-6">
                <div>
                  <div className="font-serif text-xl font-bold text-espresso">{formatDuration(reportSummary.totalMs)}</div>
                  <div className="text-[10px] text-bark mt-0.5">Total Logged</div>
                </div>
                <div>
                  <div className="font-serif text-xl font-bold text-sage">{formatDuration(reportSummary.billableMs)}</div>
                  <div className="text-[10px] text-bark mt-0.5">Billable</div>
                </div>
                <div>
                  <div className="font-serif text-xl font-bold text-walnut">{formatDuration(reportSummary.wizardMs)}</div>
                  <div className="text-[10px] text-bark mt-0.5">Wizard Time</div>
                </div>
              </div>
            </div>

            {/* Category Breakdown */}
            <div className="rounded-xl border border-sand bg-white px-5 py-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-bark mb-3">Categories</div>
              <div className="space-y-1.5">
                {reportSummary.categories.map((cat) => {
                  const colorClass: Record<string, string> = {
                    task: "bg-terracotta",
                    break: "bg-amber",
                    communication: "bg-slate-blue",
                    message: "bg-slate-blue",
                    meeting: "bg-clay-rose",
                    personal: "bg-clay-rose",
                    planning: "bg-amber",
                    "sorting tasks": "bg-amber",
                    sorting: "bg-amber",
                    collaboration: "bg-terracotta",
                    "wizard time": "bg-walnut",
                  };
                  const barColor = colorClass[cat.name.toLowerCase()] || "bg-bark";
                  const pct = reportSummary.totalMs > 0 ? (cat.ms / reportSummary.totalMs) * 100 : 0;
                  return (
                    <div key={cat.name} className="flex items-center gap-2">
                      <span className="text-[11px] text-espresso w-[90px] truncate">{cat.name}</span>
                      <div className="flex-1 h-1.5 rounded bg-parchment overflow-hidden">
                        <div className={`h-full rounded ${barColor}`} style={{ width: `${Math.max(pct, 2)}%` }} />
                      </div>
                      <span className="text-[11px] font-semibold text-espresso w-[60px] text-right">{formatDuration(cat.ms)}</span>
                    </div>
                  );
                })}
                {reportSummary.categories.length === 0 && (
                  <span className="text-[11px] text-bark">No data</span>
                )}
              </div>
            </div>

            {/* Task Types & Status */}
            <div className="rounded-xl border border-sand bg-white px-5 py-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-bark mb-3">Entries &amp; Status</div>
              <div className="flex gap-6 mb-3">
                <div>
                  <div className="font-serif text-xl font-bold text-espresso">{reportSummary.entries}</div>
                  <div className="text-[10px] text-bark mt-0.5">Total Entries</div>
                </div>
                <div>
                  <div className="font-serif text-xl font-bold text-sage">{reportSummary.hourlyCount}</div>
                  <div className="text-[10px] text-bark mt-0.5">Hourly</div>
                </div>
                <div>
                  <div className="font-serif text-xl font-bold text-slate-blue">{reportSummary.fixedCount}</div>
                  <div className="text-[10px] text-bark mt-0.5">Fixed</div>
                </div>
              </div>
              <div className="flex gap-3 pt-3 border-t border-parchment">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-terracotta"></span>
                  <span className="text-[11px] font-semibold">{reportSummary.inProgressCount}</span>
                  <span className="text-[10px] text-bark">In Progress</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-sage"></span>
                  <span className="text-[11px] font-semibold">{reportSummary.completedCount}</span>
                  <span className="text-[10px] text-bark">Completed</span>
                </div>
                {reportSummary.onHoldCount > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber"></span>
                    <span className="text-[11px] font-semibold">{reportSummary.onHoldCount}</span>
                    <span className="text-[10px] text-bark">On Hold</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Daily Hours Chart */}
          <div className="mb-6 rounded-xl border border-sand bg-white">
            <div className="flex items-center justify-between border-b border-parchment px-5 py-4">
              <h3 className="text-sm font-bold text-espresso">Daily Hours</h3>
              <span className="text-[11px] text-bark">
                {dateRange === "today" ? "Today" : dateRange === "week" ? "This week" : dateRange === "month" ? "This month" : "Custom range"}
              </span>
            </div>
            <div
              className="flex items-end gap-2.5 px-5 py-5"
              style={{ height: 220 }}
            >
              {dailyData.map((day) => {
                const billablePercent =
                  maxDayMs > 0 ? (day.billableMs / maxDayMs) * 100 : 0;
                const personalPercent =
                  maxDayMs > 0 ? (day.personalMs / maxDayMs) * 100 : 0;
                const hasData = day.totalMs > 0;

                return (
                  <div
                    key={day.date}
                    className="flex flex-1 flex-col items-center gap-1.5"
                  >
                    <span className="text-[10px] font-bold text-espresso">
                      {hasData ? formatDuration(day.totalMs) : "\u2014"}
                    </span>
                    <div className="flex w-full flex-col items-stretch gap-0">
                      {day.personalMs > 0 && (
                        <div
                          className="w-full rounded-t-md bg-clay-rose opacity-50"
                          style={{
                            height: `${Math.max(personalPercent * 1.4, 4)}px`,
                          }}
                        />
                      )}
                      <div
                        className="w-full bg-sage"
                        style={{
                          height: `${Math.max(hasData ? billablePercent * 1.4 : 2, hasData ? 4 : 2)}px`,
                          opacity: hasData ? 1 : 0.2,
                          borderRadius:
                            day.personalMs > 0 ? "0" : "6px 6px 0 0",
                        }}
                      />
                    </div>
                    <span className="text-[10px] font-semibold text-bark">
                      {day.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Hours by Account + Project & Task Summary */}
          <div className="mb-6 grid gap-5 grid-cols-2">
            {/* Hours by Account */}
            <div className="rounded-xl border border-sand bg-white">
              <div className="border-b border-parchment px-5 py-4">
                <h3 className="text-sm font-bold text-espresso">
                  Hours by Account
                </h3>
              </div>
              <div className="px-5 py-4">
                {accountHours.length === 0 ? (
                  <p className="text-[13px] text-bark">No data yet</p>
                ) : (
                  accountHours.map((item, i) => {
                    const barColors = [
                      "var(--color-terracotta)",
                      "var(--color-sage)",
                      "var(--color-amber)",
                      "var(--color-clay-rose)",
                      "var(--color-slate-blue)",
                      "var(--color-walnut)",
                    ];
                    const barColor = barColors[i % barColors.length];
                    const pct = (item.totalMs / maxAccountMs) * 100;

                    return (
                      <div
                        key={item.account}
                        className="flex items-center gap-3.5 border-b border-parchment py-3 last:border-b-0"
                      >
                        <div className="flex-1 text-[13px] font-semibold text-espresso">
                          {item.account}
                        </div>
                        <div className="flex-[2] h-2 overflow-hidden rounded bg-parchment">
                          <div
                            className="h-full rounded"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: barColor,
                            }}
                          />
                        </div>
                        <div className="w-[70px] text-right font-serif text-sm font-bold text-sage">
                          {formatDuration(item.totalMs)}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Project & Task Summary */}
            <div className="rounded-xl border border-sand bg-white">
              <div className="border-b border-parchment px-5 py-4">
                <h3 className="text-sm font-bold text-espresso">
                  Project &amp; Task Summary
                </h3>
                <div className="mt-1 flex gap-4 text-[11px] text-bark">
                  <span><strong className="text-espresso">{projectSummary.length}</strong> projects</span>
                  <span><strong className="text-espresso">{taskSummary.reduce((sum, t) => sum + t.count, 0)}</strong> tasks completed</span>
                </div>
              </div>
              <div className="px-5 py-4">
                {projectSummary.length === 0 && taskSummary.length === 0 ? (
                  <p className="text-[13px] text-bark">No completed tasks yet</p>
                ) : (
                  <>
                    {/* Projects section */}
                    {projectSummary.length > 0 && (
                      <>
                        <button
                          onClick={() => setProjectsCollapsed((v) => !v)}
                          className="flex w-full items-center justify-between mb-2 group"
                        >
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-bark group-hover:text-espresso transition-colors">
                            By Project
                          </span>
                          <span className="text-[10px] text-bark group-hover:text-espresso transition-colors">
                            {projectsCollapsed ? "▸" : "▾"}
                          </span>
                        </button>
                        {!projectsCollapsed && projectSummary.map((p) => (
                          <div
                            key={p.name}
                            className="flex items-center gap-3 border-b border-parchment py-2.5 last:border-b-0"
                          >
                            <div className="flex-1 text-[13px] font-semibold text-espresso">
                              {p.name}
                            </div>
                            <div className="text-[11px] text-bark mr-2">
                              {p.count} {p.count === 1 ? "entry" : "entries"}
                            </div>
                            <div className="w-[70px] text-right font-serif text-sm font-bold text-sage">
                              {formatDuration(p.totalMs)}
                            </div>
                          </div>
                        ))}
                      </>
                    )}

                    {/* Tasks section */}
                    {taskSummary.length > 0 && (
                      <>
                        <button
                          onClick={() => setTasksCollapsed((v) => !v)}
                          className={`flex w-full items-center justify-between mb-2 group ${projectSummary.length > 0 ? "mt-4" : ""}`}
                        >
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-bark group-hover:text-espresso transition-colors">
                            By Task
                          </span>
                          <span className="text-[10px] text-bark group-hover:text-espresso transition-colors">
                            {tasksCollapsed ? "▸" : "▾"}
                          </span>
                        </button>
                        {!tasksCollapsed && taskSummary.map((t) => (
                          <div
                            key={t.name}
                            className="flex items-center gap-3 border-b border-parchment py-2.5 last:border-b-0"
                          >
                            <div className="flex-1 text-[13px] font-semibold text-espresso truncate">
                              {t.name}
                            </div>
                            <div className="text-[11px] text-bark mr-2 shrink-0">
                              {t.count}x
                            </div>
                            <div className="w-[70px] text-right font-serif text-sm font-bold text-terracotta shrink-0">
                              {formatDuration(t.totalMs)}
                            </div>
                          </div>
                        ))}
                      </>
                    )}

                    {/* Grand Total */}
                    <div className="flex items-center gap-3 border-t-2 border-espresso pt-3 mt-3">
                      <div className="flex-1 text-[13px] font-bold text-espresso">
                        Grand Total
                      </div>
                      <div className="text-[11px] font-semibold text-bark mr-2">
                        {taskSummary.reduce((sum, t) => sum + t.count, 0)} tasks
                      </div>
                      <div className="w-[70px] text-right font-serif text-base font-bold text-espresso">
                        {formatDuration(
                          taskSummary.reduce((sum, t) => sum + t.totalMs, 0)
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* VA Breakdown */}
          {vaBreakdown.length > 0 && (
            <div className="mb-6 rounded-xl border border-sand bg-white">
              <div className="flex items-center justify-between border-b border-parchment px-5 py-4">
                <h3 className="text-sm font-bold text-espresso">
                  {selectedAccount !== "all"
                    ? `Team — ${selectedAccount}`
                    : selectedClient !== "all"
                    ? `Team — ${selectedClient}`
                    : "Team Breakdown"}
                </h3>
                <span className="text-[11px] text-bark">{vaBreakdown.length} member{vaBreakdown.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="divide-y divide-parchment">
                {vaBreakdown.map((va, i) => {
                  const name = va.profile?.full_name || va.profile?.username || "Unknown";
                  const initials = getInitials(name);
                  const avatarColor = getAvatarColor(name);
                  const topProjects = Object.entries(va.projects)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 3);
                  const topTasks = Object.entries(va.tasks)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 3);
                  return (
                    <div key={va.profile?.id || i} className="px-5 py-4">
                      <div className="flex items-center gap-3 mb-3">
                        <div
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                          style={{ backgroundColor: avatarColor }}
                        >
                          {initials}
                        </div>
                        <div className="flex-1">
                          <div className="text-[13px] font-bold text-espresso">{name}</div>
                          {va.profile?.position && (
                            <div className="text-[11px] text-bark">{va.profile.position}</div>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="font-serif text-base font-bold text-sage">{formatDuration(va.totalMs)}</div>
                          <div className="text-[10px] text-bark">{Object.values(va.tasks).length} task{Object.values(va.tasks).length !== 1 ? "s" : ""}</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4 pl-11">
                        {/* Top Projects */}
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-bark mb-1.5">Top Projects</div>
                          {topProjects.map(([proj, ms]) => (
                            <div key={proj} className="flex items-center gap-2 py-0.5">
                              <span className="flex-1 text-[12px] text-espresso truncate">{proj}</span>
                              <span className="text-[11px] font-semibold text-walnut shrink-0">{formatDuration(ms)}</span>
                            </div>
                          ))}
                        </div>
                        {/* Top Tasks */}
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-bark mb-1.5">Top Tasks</div>
                          {topTasks.map(([task, ms]) => (
                            <div key={task} className="flex items-center gap-2 py-0.5">
                              <span className="flex-1 text-[12px] text-espresso truncate">{task}</span>
                              <span className="text-[11px] font-semibold text-terracotta shrink-0">{formatDuration(ms)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Screenshot Count */}
          <div className="rounded-xl border border-sand bg-white px-5 py-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-bark mb-3">Screenshots</div>
            {filteredScreenshots.length === 0 ? (
              <span className="text-[13px] text-bark">No screenshots in this period</span>
            ) : (
              <div className="flex flex-wrap gap-6">
                <div>
                  <div className="font-serif text-xl font-bold text-espresso">{filteredScreenshots.length}</div>
                  <div className="text-[10px] text-bark mt-0.5">Total Captured</div>
                </div>
                {/* Per-VA breakdown if multiple VAs */}
                {selectedVA === "all" && (() => {
                  const byVA: Record<string, { name: string; count: number }> = {};
                  filteredScreenshots.forEach((ss) => {
                    if (!byVA[ss.user_id]) {
                      const p = profiles.find((pr) => pr.id === ss.user_id);
                      byVA[ss.user_id] = { name: p?.full_name || p?.username || "Unknown", count: 0 };
                    }
                    byVA[ss.user_id].count += 1;
                  });
                  const entries = Object.values(byVA).sort((a, b) => b.count - a.count);
                  if (entries.length <= 1) return null;
                  return entries.map((e) => (
                    <div key={e.name}>
                      <div className="font-serif text-xl font-bold text-walnut">{e.count}</div>
                      <div className="text-[10px] text-bark mt-0.5">{e.name}</div>
                    </div>
                  ));
                })()}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

/* ── Big Stat Card ────────────────────────────────────────── */

function BigStat({
  value,
  label,
  color,
}: {
  value: string | number;
  label: string;
  color: "green" | "terra" | "gold" | "blue" | "rose" | "walnut" | "default";
}) {
  const colorClass = {
    green: "text-sage",
    terra: "text-terracotta",
    gold: "text-amber",
    blue: "text-slate-blue",
    rose: "text-clay-rose",
    walnut: "text-walnut",
    default: "text-espresso",
  }[color];

  return (
    <div className="rounded-xl border border-sand bg-white px-5 py-[22px]">
      <div className={`font-serif text-[32px] font-bold ${colorClass}`}>
        {value}
      </div>
      <div className="mt-1 text-xs font-semibold text-bark">{label}</div>
    </div>
  );
}
