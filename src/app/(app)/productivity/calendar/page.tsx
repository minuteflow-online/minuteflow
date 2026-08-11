"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import TaskForm from "@/components/TaskForm";
import {
  type RawTask,
  getDateInTimezone,
  addDaysToDateStr,
  formatDayLabel,
  localDateOf,
  formatTimeRange,
  normalizeAssignedRows,
} from "@/lib/taskSchedule";
import type { Project, UserRole } from "@/types/database";

type TeamMember = { id: string; full_name: string; username: string; role: string };

type DueItem = {
  id: string;
  source: "assigned" | "fixed";
  title: string;
  account: string | null;
  date: string;
  dateType: "due" | "start";
  status: string;
  category: string | null;
  projectId: string | null;
  isRecurring: boolean;
};

const CATEGORY_OPTIONS = ["Task", "Message", "Meeting", "Sorting Tasks", "Collaboration", "Personal", "Break"];

const DAY_START_HOUR = 6;
const DAY_END_HOUR = 21;
const HOUR_HEIGHT = 48;
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function statusDotClass(status: string): string {
  switch (status) {
    case "in_progress":
    case "revision_needed":
      return "bg-amber";
    case "submitted":
      return "bg-sky-500";
    case "reviewing":
      return "bg-violet-500";
    case "approved":
      return "bg-emerald-500";
    case "completed":
      return "bg-sage";
    case "paid":
      return "bg-purple-500";
    case "cancelled":
      return "bg-terracotta";
    default:
      return "bg-stone"; // on_queue, pending, open, unassigned
  }
}

function statusBadgeClasses(status: string): string {
  switch (status) {
    case "in_progress":
      return "bg-amber-50 text-amber-500 border-amber-200";
    case "submitted":
      return "bg-sky-50 text-sky-600 border-sky-200";
    case "reviewing":
      return "bg-violet-50 text-violet-600 border-violet-200";
    case "revision_needed":
      return "bg-amber-50 text-amber-600 border-amber-200";
    case "approved":
      return "bg-emerald-50 text-emerald-600 border-emerald-200";
    case "completed":
      return "bg-sage-soft text-sage border-sage/20";
    case "paid":
      return "bg-purple-50 text-purple-600 border-purple-200";
    case "cancelled":
      return "bg-red-50 text-red-500 border-red-200";
    default:
      return "bg-stone/10 text-stone border-stone/20";
  }
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDayShort(dateStr: string): { weekday: string; day: number } {
  const d = new Date(dateStr + "T12:00:00Z");
  return {
    weekday: d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
    day: Number(dateStr.slice(8, 10)),
  };
}

function buildMonthGrid(year: number, month: number): string[] {
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay();
  const gridStart = new Date(year, month, 1 - startWeekday);
  const days: string[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    days.push(`${y}-${m}-${day}`);
  }
  return days;
}

function buildWeekGrid(dateStr: string): string[] {
  const d = new Date(dateStr + "T12:00:00Z");
  const weekday = d.getUTCDay();
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    days.push(addDaysToDateStr(dateStr, i - weekday));
  }
  return days;
}

export default function ProductivityCalendarPage() {
  const supabase = useMemo(() => createClient(), []);

  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<UserRole>("va");
  const [orgTimezone, setOrgTimezone] = useState("UTC");
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [ready, setReady] = useState(false);

  const todayStr = getDateInTimezone(orgTimezone);
  const isAdminOrManager = role === "admin" || role === "manager";

  const [viewMode, setViewMode] = useState<"month" | "week" | "day">("month");
  const [scope, setScope] = useState<string>("__self__");
  const [monthYear, setMonthYear] = useState<number>(new Date().getFullYear());
  const [monthMonth, setMonthMonth] = useState<number>(new Date().getMonth());
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);

  const [assignedTasksAll, setAssignedTasksAll] = useState<RawTask[]>([]);
  const [fixedItems, setFixedItems] = useState<DueItem[]>([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [daySchedule, setDaySchedule] = useState<RawTask[]>([]);
  const [loadingDay, setLoadingDay] = useState(false);

  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [sourceFilter, setSourceFilter] = useState<Set<"assigned" | "fixed">>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set());
  const [projectFilter, setProjectFilter] = useState<Set<string>>(new Set());
  const [recurringOnly, setRecurringOnly] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingBlockId, setEditingBlockId] = useState<number | null>(null);
  const [formDate, setFormDate] = useState<string>(todayStr);
  const [formTaskName, setFormTaskName] = useState("");
  const [formAccount, setFormAccount] = useState("");
  const [formStart, setFormStart] = useState("09:00");
  const [formEnd, setFormEnd] = useState("10:00");
  const [savingBlock, setSavingBlock] = useState(false);

  // Keep selectedDate at "today" until org timezone resolves
  useEffect(() => {
    setSelectedDate(getDateInTimezone(orgTimezone));
  }, [orgTimezone]);

  // Bootstrap: auth user, role, org timezone
  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setReady(true);
        return;
      }
      setUserId(user.id);

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      setRole((profile?.role as UserRole) || "va");

      const { data: org } = await supabase
        .from("organization_settings")
        .select("timezone")
        .limit(1)
        .single();
      if (org?.timezone) setOrgTimezone(org.timezone);
      setReady(true);
    })();
  }, [supabase]);

  useEffect(() => {
    if (!isAdminOrManager) return;
    fetch("/api/team-members")
      .then((r) => r.json())
      .then((d) => setTeamMembers(d.members ?? []))
      .catch(() => {});
  }, [isAdminOrManager]);

  useEffect(() => {
    fetch("/api/projects?mine=true", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setAllProjects(d.projects ?? []))
      .catch(() => {});
  }, []);

  // Month-view overview: every active assigned task in the current scope
  // (agency-wide, a specific teammate, or just me).
  const fetchAssignedTasksAll = useCallback(async () => {
    if (!userId) return;
    let assignedUrl = "/api/assigned-tasks?selfOnly=true&view=active";
    if (isAdminOrManager) {
      assignedUrl =
        scope === "__self__"
          ? "/api/assigned-tasks?selfOnly=true&view=active"
          : scope === "__all__"
          ? "/api/assigned-tasks?view=active"
          : `/api/assigned-tasks?view=active&vaId=${scope}`;
    }
    try {
      const res = await fetch(assignedUrl);
      const data = await res.json();
      setAssignedTasksAll(normalizeAssignedRows(data.tasks ?? [], userId));
    } catch {
      setAssignedTasksAll([]);
    }
  }, [userId, isAdminOrManager, scope]);

  const fetchFixedItems = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch("/api/fixed-pay-tasks?view=active");
      const data = await res.json();
      const rows = (data.tasks ?? []) as Array<{
        id: number;
        task_name: string;
        account: string | null;
        due_date: string | null;
        start_date: string | null;
        category: string | null;
        status: string;
        claimed_by: string | null;
      }>;
      let filtered = rows.filter((t) => t.due_date || t.start_date);
      if (!isAdminOrManager || scope === "__self__") {
        filtered = filtered.filter((t) => t.claimed_by === userId);
      } else if (scope !== "__all__") {
        filtered = filtered.filter((t) => t.claimed_by === scope);
      }
      const items: DueItem[] = filtered.map((t) => ({
        id: `fixed-${t.id}`,
        source: "fixed" as const,
        title: t.task_name,
        account: t.account,
        date: (t.due_date ?? t.start_date) as string,
        dateType: t.due_date ? ("due" as const) : ("start" as const),
        status: t.status,
        category: t.category,
        projectId: null,
        isRecurring: false,
      }));
      setFixedItems(items);
    } catch {
      setFixedItems([]);
    }
  }, [userId, isAdminOrManager, scope]);

  useEffect(() => {
    fetchAssignedTasksAll();
    fetchFixedItems();
  }, [fetchAssignedTasksAll, fetchFixedItems]);

  // Day/Week view always operates on one concrete person's actual task list.
  const dayUserId = scope === "__all__" || scope === "__self__" ? userId : scope;

  const fetchDaySchedule = useCallback(async () => {
    if (!dayUserId || !userId) return;
    setLoadingDay(true);
    try {
      const url =
        dayUserId === userId
          ? "/api/assigned-tasks?selfOnly=true&view=active"
          : `/api/assigned-tasks?viewAsVa=${dayUserId}&view=active`;
      const res = await fetch(url);
      const data = await res.json();
      setDaySchedule(normalizeAssignedRows(data.tasks ?? [], dayUserId));
    } catch {
      setDaySchedule([]);
    } finally {
      setLoadingDay(false);
    }
  }, [dayUserId, userId]);

  useEffect(() => {
    if (viewMode === "day" || viewMode === "week") fetchDaySchedule();
  }, [viewMode, fetchDaySchedule]);

  // Month-view due/start dots, derived from the full assigned-task list
  const assignedDueItems = useMemo<DueItem[]>(
    () =>
      assignedTasksAll
        .filter((t) => t.due_date || t.start_date)
        .map((t) => ({
          id: `assigned-${t.id}`,
          source: "assigned" as const,
          title: t.task_name,
          account: t.account,
          date: (t.due_date ?? t.start_date) as string,
          dateType: t.due_date ? ("due" as const) : ("start" as const),
          status: t.status,
          category: t.category,
          projectId: t.projectId,
          isRecurring: t.isRecurring,
        })),
    [assignedTasksAll]
  );

  const allDueItems = useMemo(() => [...assignedDueItems, ...fixedItems], [assignedDueItems, fixedItems]);

  const activeFilterCount =
    statusFilter.size + sourceFilter.size + categoryFilter.size + projectFilter.size + (recurringOnly ? 1 : 0);

  const filteredDueItems = useMemo(() => {
    return allDueItems.filter((item) => {
      if (statusFilter.size > 0 && !statusFilter.has(item.status)) return false;
      if (sourceFilter.size > 0 && !sourceFilter.has(item.source)) return false;
      if (categoryFilter.size > 0 && !(item.category && categoryFilter.has(item.category))) return false;
      if (projectFilter.size > 0) {
        const key = item.projectId ?? "__none__";
        if (!projectFilter.has(key)) return false;
      }
      if (recurringOnly && !item.isRecurring) return false;
      return true;
    });
  }, [allDueItems, statusFilter, sourceFilter, categoryFilter, projectFilter, recurringOnly]);

  const dueItemsByDate = useMemo(() => {
    const map: Record<string, DueItem[]> = {};
    for (const item of filteredDueItems) {
      if (!map[item.date]) map[item.date] = [];
      map[item.date].push(item);
    }
    return map;
  }, [filteredDueItems]);

  const toggleInSet = <T,>(set: Set<T>, setter: (s: Set<T>) => void, value: T) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  };

  const clearAllFilters = () => {
    setStatusFilter(new Set());
    setSourceFilter(new Set());
    setCategoryFilter(new Set());
    setProjectFilter(new Set());
    setRecurringOnly(false);
  };

  const allStatuses = useMemo(() => {
    const s = new Set<string>();
    for (const item of allDueItems) s.add(item.status);
    return Array.from(s).sort();
  }, [allDueItems]);

  const monthGrid = useMemo(() => buildMonthGrid(monthYear, monthMonth), [monthYear, monthMonth]);
  const monthLabel = useMemo(
    () => new Date(monthYear, monthMonth, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    [monthYear, monthMonth]
  );
  const weekGrid = useMemo(() => buildWeekGrid(selectedDate), [selectedDate]);
  const weekLabel = useMemo(() => {
    const start = weekGrid[0];
    const end = weekGrid[6];
    const fmt = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    return `${fmt(start)} – ${fmt(end)}`;
  }, [weekGrid]);

  const goToPrevMonth = () => {
    if (monthMonth === 0) {
      setMonthYear((y) => y - 1);
      setMonthMonth(11);
    } else {
      setMonthMonth((m) => m - 1);
    }
  };
  const goToNextMonth = () => {
    if (monthMonth === 11) {
      setMonthYear((y) => y + 1);
      setMonthMonth(0);
    } else {
      setMonthMonth((m) => m + 1);
    }
  };

  const openDay = (dateStr: string) => {
    setSelectedDate(dateStr);
    setViewMode("day");
  };

  const goToPrevDay = () => setSelectedDate((d) => addDaysToDateStr(d, -1));
  const goToNextDay = () => setSelectedDate((d) => addDaysToDateStr(d, 1));
  const goToPrevWeek = () => setSelectedDate((d) => addDaysToDateStr(d, -7));
  const goToNextWeek = () => setSelectedDate((d) => addDaysToDateStr(d, 7));

  const openAddBlock = (hour: number, dateStr: string = selectedDate) => {
    setEditingBlockId(null);
    setFormTaskName("");
    setFormAccount("");
    setFormDate(dateStr);
    setFormStart(`${String(hour).padStart(2, "0")}:00`);
    setFormEnd(`${String(Math.min(hour + 1, 23)).padStart(2, "0")}:00`);
    setShowForm(true);
  };

  const openEditBlock = (task: RawTask) => {
    if (!task.start_time || !task.end_time) return;
    setEditingBlockId(task.id);
    setFormTaskName(task.task_name);
    setFormAccount(task.account || "");
    setFormDate(localDateOf(task.start_time));
    setFormStart(new Date(task.start_time).toTimeString().slice(0, 5));
    setFormEnd(new Date(task.end_time).toTimeString().slice(0, 5));
    setShowForm(true);
  };

  const openScheduleExisting = (task: RawTask, dateStr: string = selectedDate) => {
    setEditingBlockId(task.id);
    setFormTaskName(task.task_name);
    setFormAccount(task.account || "");
    setFormDate(dateStr);
    setFormStart("09:00");
    setFormEnd("10:00");
    setShowForm(true);
  };

  const refreshAfterScheduleChange = useCallback(async () => {
    await Promise.all([fetchDaySchedule(), fetchAssignedTasksAll()]);
  }, [fetchDaySchedule, fetchAssignedTasksAll]);

  // Reschedules an EXISTING task (time-only). Creating a brand-new task goes
  // through TaskForm instead, which POSTs the full field set itself.
  const saveBlock = async () => {
    if (!editingBlockId || formEnd <= formStart) return;
    setSavingBlock(true);
    const startIso = new Date(`${formDate}T${formStart}:00`).toISOString();
    const endIso = new Date(`${formDate}T${formEnd}:00`).toISOString();

    try {
      await fetch(`/api/assigned-tasks/${editingBlockId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start_time: startIso, end_time: endIso }),
      });
      await refreshAfterScheduleChange();
    } finally {
      setSavingBlock(false);
      setShowForm(false);
    }
  };

  // Removes the task from the calendar (clears its schedule) — does not delete
  // the underlying task, which may still carry status/assignee history managed
  // from the Assignment tab.
  const removeFromCalendar = async () => {
    if (!editingBlockId) return;
    await fetch(`/api/assigned-tasks/${editingBlockId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start_time: null, end_time: null }),
    });
    setShowForm(false);
    await refreshAfterScheduleChange();
  };

  const scheduledTasks = useMemo(() => daySchedule.filter((t) => t.start_time && t.end_time), [daySchedule]);
  const unscheduledTasks = useMemo(() => daySchedule.filter((t) => !t.start_time || !t.end_time), [daySchedule]);
  const scheduledForDate = useCallback(
    (dateStr: string) => scheduledTasks.filter((t) => localDateOf(t.start_time as string) === dateStr),
    [scheduledTasks]
  );
  const dayTotalLabel = useMemo(() => {
    const totalMinutes = scheduledForDate(selectedDate).reduce(
      (sum, t) => sum + (new Date(t.end_time!).getTime() - new Date(t.start_time!).getTime()) / 60000,
      0
    );
    const hrs = Math.floor(totalMinutes / 60);
    const mins = Math.round(totalMinutes % 60);
    return `${hrs}h${mins > 0 ? ` ${mins}m` : ""} blocked`;
  }, [scheduledForDate, selectedDate]);
  // Exclude items already rendered as an hour block for this date — once a task
  // has scheduled hours, it shouldn't also sit up top as an unscheduled-looking badge.
  const dueTodayItems = useMemo(() => {
    const scheduledIdsToday = new Set(scheduledForDate(selectedDate).map((t) => t.id));
    return (dueItemsByDate[selectedDate] ?? []).filter((item) => {
      if (item.source !== "assigned") return true;
      const rawId = Number(item.id.replace("assigned-", ""));
      return !scheduledIdsToday.has(rawId);
    });
  }, [dueItemsByDate, selectedDate, scheduledForDate]);
  const hours = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => DAY_START_HOUR + i);

  function blockPosition(task: RawTask) {
    const start = new Date(task.start_time!);
    const end = new Date(task.end_time!);
    const startMinutes = (start.getHours() - DAY_START_HOUR) * 60 + start.getMinutes();
    const endMinutes = (end.getHours() - DAY_START_HOUR) * 60 + end.getMinutes();
    const top = Math.max(0, (startMinutes / 60) * HOUR_HEIGHT);
    const height = Math.max(20, ((endMinutes - startMinutes) / 60) * HOUR_HEIGHT);
    return { top, height };
  }


  if (!ready) {
    return <div className="p-8 text-center text-xs text-stone">Loading calendar…</div>;
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setViewMode("month")}
            className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
              viewMode === "month" ? "bg-sage text-white" : "bg-stone/10 text-stone hover:bg-stone/20"
            }`}
          >
            Month
          </button>
          <button
            type="button"
            onClick={() => setViewMode("week")}
            className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
              viewMode === "week" ? "bg-sage text-white" : "bg-stone/10 text-stone hover:bg-stone/20"
            }`}
          >
            Week
          </button>
          <button
            type="button"
            onClick={() => setViewMode("day")}
            className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
              viewMode === "day" ? "bg-sage text-white" : "bg-stone/10 text-stone hover:bg-stone/20"
            }`}
          >
            Day
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                activeFilterCount > 0 ? "bg-terracotta-soft text-terracotta" : "bg-stone/10 text-stone hover:bg-stone/20"
              }`}
            >
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            </button>

            {showFilters && (
              <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-sand bg-white p-4 shadow-lg space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-[11px] font-bold text-espresso uppercase tracking-wide">Filters</h4>
                  <button onClick={clearAllFilters} className="text-[10px] font-semibold text-terracotta hover:underline cursor-pointer">
                    Clear all
                  </button>
                </div>

                <div>
                  <p className="text-[10px] font-semibold text-walnut uppercase tracking-wide mb-1">Source</p>
                  <div className="flex flex-wrap gap-2">
                    {(["assigned", "fixed"] as const).map((s) => (
                      <label key={s} className="flex items-center gap-1 text-[11px] text-espresso">
                        <input type="checkbox" checked={sourceFilter.has(s)} onChange={() => toggleInSet(sourceFilter, setSourceFilter, s)} />
                        {s === "assigned" ? "Assignment Task" : "Fixed Pay Task"}
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-semibold text-walnut uppercase tracking-wide mb-1">Status</p>
                  <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto">
                    {allStatuses.map((s) => (
                      <label key={s} className="flex items-center gap-1 text-[11px] text-espresso">
                        <input type="checkbox" checked={statusFilter.has(s)} onChange={() => toggleInSet(statusFilter, setStatusFilter, s)} />
                        {statusLabel(s)}
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-semibold text-walnut uppercase tracking-wide mb-1">Category</p>
                  <div className="flex flex-wrap gap-2">
                    {CATEGORY_OPTIONS.map((c) => (
                      <label key={c} className="flex items-center gap-1 text-[11px] text-espresso">
                        <input type="checkbox" checked={categoryFilter.has(c)} onChange={() => toggleInSet(categoryFilter, setCategoryFilter, c)} />
                        {c}
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-semibold text-walnut uppercase tracking-wide mb-1">Project</p>
                  <div className="flex flex-wrap gap-2 max-h-28 overflow-y-auto">
                    <label className="flex items-center gap-1 text-[11px] text-espresso">
                      <input
                        type="checkbox"
                        checked={projectFilter.has("__none__")}
                        onChange={() => toggleInSet(projectFilter, setProjectFilter, "__none__")}
                      />
                      No Project
                    </label>
                    {allProjects.map((p) => (
                      <label key={p.id} className="flex items-center gap-1 text-[11px] text-espresso">
                        <input type="checkbox" checked={projectFilter.has(p.id)} onChange={() => toggleInSet(projectFilter, setProjectFilter, p.id)} />
                        {p.name} <span className="text-stone">({p.kind === "operation" ? "Operation" : "Objective"})</span>
                      </label>
                    ))}
                  </div>
                </div>

                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-espresso">
                  <input type="checkbox" checked={recurringOnly} onChange={(e) => setRecurringOnly(e.target.checked)} />
                  Recurring only
                </label>
              </div>
            )}
          </div>

          {isAdminOrManager && (
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="rounded-lg border border-sand px-2 py-1 text-[11px] text-espresso outline-none bg-white"
            >
              <option value="__self__">My View</option>
              <option value="__all__">Agency-wide (All)</option>
              {teamMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {viewMode === "month" && (
        <div className="rounded-xl border border-sand bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={goToPrevMonth}
              className="px-2 py-1 rounded-md text-bark hover:bg-parchment hover:text-espresso text-sm"
            >
              &larr;
            </button>
            <h2 className="text-sm font-bold text-espresso">{monthLabel}</h2>
            <button
              type="button"
              onClick={goToNextMonth}
              className="px-2 py-1 rounded-md text-bark hover:bg-parchment hover:text-espresso text-sm"
            >
              &rarr;
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAY_LABELS.map((w) => (
              <div key={w} className="text-center text-[10px] font-semibold text-walnut uppercase tracking-wide py-1">
                {w}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {monthGrid.map((dateStr) => {
              const isCurrentMonth = Number(dateStr.slice(5, 7)) - 1 === monthMonth;
              const isToday = dateStr === todayStr;
              const items = dueItemsByDate[dateStr] ?? [];
              return (
                <button
                  key={dateStr}
                  type="button"
                  onClick={() => openDay(dateStr)}
                  className={`min-h-[84px] rounded-lg border p-1.5 text-left align-top transition-colors cursor-pointer ${
                    isCurrentMonth ? "border-sand bg-white hover:bg-cream" : "border-transparent bg-parchment/40"
                  } ${isToday ? "ring-2 ring-terracotta" : ""}`}
                >
                  <span className={`text-[11px] font-semibold ${isCurrentMonth ? "text-espresso" : "text-stone"}`}>
                    {Number(dateStr.slice(8, 10))}
                  </span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {items.slice(0, 5).map((item) => (
                      <span
                        key={item.id}
                        title={`${item.title} — ${statusLabel(item.status)} (${item.dateType === "due" ? "due" : "starts"} this day)`}
                        className={`h-1.5 w-1.5 rounded-full ${statusDotClass(item.status)} ${
                          item.dateType === "start" ? "ring-1 ring-offset-1 ring-stone/50" : ""
                        }`}
                      />
                    ))}
                    {items.length > 5 && <span className="text-[9px] text-stone">+{items.length - 5}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {viewMode === "week" && (
        <div className="rounded-xl border border-sand bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={goToPrevWeek}
              className="px-2 py-1 rounded-md text-bark hover:bg-parchment hover:text-espresso text-sm"
            >
              &larr;
            </button>
            <h2 className="text-sm font-bold text-espresso">{weekLabel}</h2>
            <button
              type="button"
              onClick={goToNextWeek}
              className="px-2 py-1 rounded-md text-bark hover:bg-parchment hover:text-espresso text-sm"
            >
              &rarr;
            </button>
          </div>

          {scope === "__all__" && isAdminOrManager && (
            <p className="mb-3 text-[11px] text-stone">
              Agency-wide view can&apos;t render every teammate&apos;s hour blocks at once — showing your own week. Pick a teammate above to view or add blocks to theirs.
            </p>
          )}

          {loadingDay ? (
            <div className="py-8 text-center text-xs text-stone">Loading…</div>
          ) : (
            <div className="overflow-x-auto">
              <div className="grid min-w-[760px] grid-cols-[48px_repeat(7,1fr)]">
                <div />
                {weekGrid.map((dateStr) => {
                  const { weekday, day } = formatDayShort(dateStr);
                  const isToday = dateStr === todayStr;
                  return (
                    <button
                      key={dateStr}
                      type="button"
                      onClick={() => openDay(dateStr)}
                      className={`flex flex-col items-center gap-0.5 rounded-md py-1.5 text-center hover:bg-cream transition-colors cursor-pointer ${
                        isToday ? "bg-terracotta-soft" : ""
                      }`}
                    >
                      <span className="text-[9px] font-semibold text-walnut uppercase tracking-wide">{weekday}</span>
                      <span className={`text-[13px] font-bold ${isToday ? "text-terracotta" : "text-espresso"}`}>{day}</span>
                    </button>
                  );
                })}

                <div className="relative col-span-8 grid grid-cols-[48px_repeat(7,1fr)]" style={{ height: hours.length * HOUR_HEIGHT }}>
                  {/* Hour labels */}
                  <div className="relative">
                    {hours.map((hour, i) => (
                      <span
                        key={hour}
                        className="absolute left-0 w-12 pt-0.5 text-[10px] text-stone"
                        style={{ top: i * HOUR_HEIGHT }}
                      >
                        {new Date(2000, 0, 1, hour).toLocaleTimeString("en-US", { hour: "numeric" })}
                      </span>
                    ))}
                  </div>

                  {/* Day columns */}
                  {weekGrid.map((dateStr) => (
                    <div key={dateStr} className="relative border-l border-sand">
                      {hours.map((hour, i) => (
                        <button
                          key={hour}
                          type="button"
                          onClick={() => openAddBlock(hour, dateStr)}
                          className="absolute left-0 right-0 border-t border-sand hover:bg-cream transition-colors cursor-pointer"
                          style={{ top: i * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                        />
                      ))}
                      <div className="pointer-events-none absolute inset-0">
                        {scheduledForDate(dateStr).map((task) => {
                          const { top, height } = blockPosition(task);
                          return (
                            <button
                              key={task.id}
                              type="button"
                              onClick={() => openEditBlock(task)}
                              className="pointer-events-auto absolute left-0.5 right-0.5 overflow-hidden rounded-md border border-sage/30 bg-sage-soft px-1 py-0.5 text-left shadow-sm hover:border-sage cursor-pointer"
                              style={{ top, height }}
                            >
                              <p className="truncate text-[9px] font-semibold text-sage leading-tight">{task.task_name}</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {viewMode === "day" && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4">
          {/* Hour grid */}
          <div className="rounded-xl border border-sand bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <button
                type="button"
                onClick={goToPrevDay}
                className="px-2 py-1 rounded-md text-bark hover:bg-parchment hover:text-espresso text-sm"
              >
                &larr;
              </button>
              <div className="flex flex-col items-center gap-0.5">
                <h2 className="text-sm font-bold text-espresso">
                  {selectedDate === todayStr ? "Today — " : ""}
                  {formatDayLabel(selectedDate)}
                </h2>
                <span className="text-[10px] font-semibold px-2 py-[1px] rounded-full border bg-sage-soft text-sage border-sage/20">
                  {dayTotalLabel}
                </span>
              </div>
              <button
                type="button"
                onClick={goToNextDay}
                className="px-2 py-1 rounded-md text-bark hover:bg-parchment hover:text-espresso text-sm"
              >
                &rarr;
              </button>
            </div>

            {scope === "__all__" && isAdminOrManager && (
              <p className="mb-3 text-[11px] text-stone">
                Agency-wide view can&apos;t render every teammate&apos;s hour blocks at once — showing your own day. Pick a teammate above to view or add blocks to theirs.
              </p>
            )}

            {dueTodayItems.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {dueTodayItems.map((item) => {
                  const rawId = item.source === "assigned" ? Number(item.id.replace("assigned-", "")) : null;
                  const scheduleTarget = rawId ? daySchedule.find((t) => t.id === rawId) : undefined;
                  const label = `${item.dateType === "due" ? "Due" : "Starts"}: ${item.title}`;
                  if (!scheduleTarget) {
                    return (
                      <span
                        key={item.id}
                        className={`text-[10px] font-semibold px-2 py-[2px] rounded-full border ${statusBadgeClasses(item.status)}`}
                        title={item.account || undefined}
                      >
                        {label}
                      </span>
                    );
                  }
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => openScheduleExisting(scheduleTarget, selectedDate)}
                      title={`${item.account ? item.account + " — " : ""}Click to set hours`}
                      className={`text-[10px] font-semibold px-2 py-[2px] rounded-full border cursor-pointer hover:opacity-75 transition-opacity ${statusBadgeClasses(item.status)}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}

            {loadingDay ? (
              <div className="py-8 text-center text-xs text-stone">Loading…</div>
            ) : (
              <div className="relative" style={{ height: hours.length * HOUR_HEIGHT }}>
                {hours.map((hour, i) => (
                  <button
                    key={hour}
                    type="button"
                    onClick={() => openAddBlock(hour)}
                    className="absolute left-0 right-0 flex items-start gap-2 border-t border-sand text-left hover:bg-cream transition-colors cursor-pointer"
                    style={{ top: i * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                  >
                    <span className="w-14 shrink-0 pt-0.5 text-[10px] text-stone">
                      {new Date(2000, 0, 1, hour).toLocaleTimeString("en-US", { hour: "numeric" })}
                    </span>
                  </button>
                ))}

                <div className="pointer-events-none absolute inset-0 pl-16">
                  {scheduledForDate(selectedDate).map((task) => {
                    const { top, height } = blockPosition(task);
                    return (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => openEditBlock(task)}
                        className="pointer-events-auto absolute left-0 right-2 overflow-hidden rounded-md border border-sage/30 bg-sage-soft px-2 py-1 text-left shadow-sm hover:border-sage cursor-pointer"
                        style={{ top, height }}
                      >
                        <p className="truncate text-[11px] font-semibold text-sage">{task.task_name}</p>
                        <p className="truncate text-[10px] text-sage/80">{formatTimeRange(task)}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Unscheduled sidebar */}
          <div className="rounded-xl border border-sand bg-white p-4 space-y-3 h-fit">
            <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Unscheduled</h3>
            {unscheduledTasks.length === 0 ? (
              <p className="text-[11px] text-stone">Nothing unscheduled.</p>
            ) : (
              <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
                {unscheduledTasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-sand bg-white px-2.5 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-semibold text-espresso">{task.task_name}</p>
                      {task.account && <p className="truncate text-[10px] text-stone">{task.account}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => openScheduleExisting(task)}
                      className="shrink-0 px-2 py-1 rounded-lg bg-sage text-white text-[10px] font-semibold hover:bg-sage/90 transition-colors cursor-pointer"
                    >
                      Schedule
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => openAddBlock(9)}
              className="w-full px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors cursor-pointer"
            >
              + Add Hour Block
            </button>
          </div>
        </div>
      )}

      {/* Reschedule-existing-task modal (time only — full task fields live in Assignment) */}
      {showForm && editingBlockId && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-xl border border-sand shadow-xl w-full max-w-sm mx-4">
            <div className="py-4 px-5 border-b border-parchment flex items-center justify-between">
              <h3 className="text-sm font-bold text-espresso">Reschedule</h3>
              <button
                onClick={() => setShowForm(false)}
                className="text-bark hover:text-terracotta text-lg leading-none cursor-pointer"
              >
                &times;
              </button>
            </div>
            <div className="p-5 space-y-3">
              {viewMode === "week" && (
                <p className="text-[11px] text-stone">{formatDayLabel(formDate)}</p>
              )}
              <div>
                <p className="text-[11px] font-semibold text-walnut mb-1 tracking-wide">Task Name</p>
                <input
                  value={formTaskName}
                  disabled
                  className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-parchment/40 text-stone"
                />
              </div>
              <div>
                <p className="text-[11px] font-semibold text-walnut mb-1 tracking-wide">Account</p>
                <input
                  value={formAccount || "—"}
                  disabled
                  className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-parchment/40 text-stone"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <p className="text-[11px] font-semibold text-walnut mb-1 tracking-wide">Start</p>
                  <input
                    type="time"
                    value={formStart}
                    onChange={(e) => setFormStart(e.target.value)}
                    className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
                  />
                </div>
                <div className="flex-1">
                  <p className="text-[11px] font-semibold text-walnut mb-1 tracking-wide">End</p>
                  <input
                    type="time"
                    value={formEnd}
                    onChange={(e) => setFormEnd(e.target.value)}
                    className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
                  />
                </div>
              </div>
              {formEnd <= formStart && (
                <p className="text-[10px] text-terracotta">End time must be after start time.</p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={removeFromCalendar}
                  title="Clears the time, but keeps the task itself — manage it from Assignment."
                  className="px-3 py-2 rounded-lg bg-red-50 text-red-500 border border-red-200 text-[12px] font-semibold cursor-pointer hover:bg-red-100 transition-colors"
                >
                  Remove from Calendar
                </button>
                <button
                  onClick={() => setShowForm(false)}
                  className="flex-1 py-2 rounded-lg bg-parchment text-walnut border border-sand text-[12px] font-semibold cursor-pointer transition-all hover:bg-sand hover:text-espresso"
                >
                  Cancel
                </button>
                <button
                  onClick={saveBlock}
                  disabled={formEnd <= formStart || savingBlock}
                  className="flex-1 py-2 rounded-lg bg-sage text-white text-[12px] font-semibold cursor-pointer transition-all hover:bg-sage/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingBlock ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New-task modal — full shared task form, same fields as Assignment's Create Task */}
      {showForm && !editingBlockId && dayUserId && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl border border-sand shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="py-4 px-5 border-b border-parchment flex items-center justify-between sticky top-0 bg-white">
              <h3 className="text-sm font-bold text-espresso">Add Task {viewMode === "week" ? `— ${formatDayLabel(formDate)}` : ""}</h3>
              <button
                onClick={() => setShowForm(false)}
                className="text-bark hover:text-terracotta text-lg leading-none cursor-pointer"
              >
                &times;
              </button>
            </div>
            <div className="p-5">
              <TaskForm
                currentUserId={userId!}
                isAdminOrManager={isAdminOrManager}
                teamMembers={teamMembers}
                defaultVaId={dayUserId}
                defaultDate={formDate}
                defaultStartTime={formStart}
                defaultEndTime={formEnd}
                showSchedule
                onCancel={() => setShowForm(false)}
                onCreated={() => {
                  setShowForm(false);
                  void refreshAfterScheduleChange();
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
