"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import TaskEditor, { type TaskEditorInitialTask } from "@/components/TaskEditor";
import {
  type RawTask,
  CATEGORY_OPTIONS,
  getDateInTimezone,
  addDaysToDateStr,
  formatDayLabel,
  localDateOf,
  formatTimeRange,
  formatDueTime,
  normalizeAssignedRows,
  categoryDotClass,
  categoryBlockClasses,
  statusLabel,
  isDateInSpan,
  reanchorToDate,
  spanLabel,
} from "@/lib/taskSchedule";
import type { Project, UserRole } from "@/types/database";

type TeamMember = {
  id: string;
  full_name: string;
  username: string;
  role: string;
  position?: string | null;
  pay_rate_type?: string | null;
  can_see_available_tasks?: boolean | null;
};

// Same derivation as FixedPayTasksPanel's isHybrid/isPerTaskVa: position
// "Part-time VA"/"Full-time VA" is the hourly-labeled default, "Per Task VA"
// (or pay_rate_type "per_task") is fixed-pay-only, and the "Available Tasks"
// toggle in Team management is what actually makes an hourly-labeled VA
// hybrid (able to pick up Output Based work too).
function taskModesForMember(member: TeamMember | undefined): { canTimeBased: boolean; canOutputBased: boolean } {
  if (!member) return { canTimeBased: true, canOutputBased: false };
  const isPerTaskVa = member.position === "Per Task VA" || member.pay_rate_type === "per_task";
  if (isPerTaskVa) return { canTimeBased: false, canOutputBased: true };
  const isHybrid = (member.position === "Part-time VA" || member.position === "Full-time VA") && Boolean(member.can_see_available_tasks);
  return { canTimeBased: true, canOutputBased: isHybrid };
}

type DueItem = {
  id: string;
  // The underlying assigned_tasks/fixed_pay_tasks row id — id itself carries a
  // per-day suffix ("assigned-241-2026-08-12", "assigned-241-due") for the
  // multi-day span expansion, so it can't be parsed back into a number; this
  // is the actual numeric id to look the row up by.
  taskId: number;
  source: "assigned" | "fixed";
  title: string;
  account: string | null;
  date: string;
  dateType: "due" | "start";
  dueTime: string | null;
  status: string;
  category: string | null;
  projectId: string | null;
  isRecurring: boolean;
};


const DAY_START_HOUR = 6;
const DAY_END_HOUR = 21;
const HOUR_HEIGHT = 48;
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];


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
  const [dateTypeFilter, setDateTypeFilter] = useState<"all" | "start" | "due">("all");
  const filtersRef = useRef<HTMLDivElement | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingBlockId, setEditingBlockId] = useState<number | null>(null);
  const [editingTaskFull, setEditingTaskFull] = useState<TaskEditorInitialTask | null>(null);
  const [formDate, setFormDate] = useState<string>(todayStr);
  const [formStart, setFormStart] = useState("09:00");
  const [formEnd, setFormEnd] = useState("10:00");
  const [taskMode, setTaskMode] = useState<"time_based" | "output_based">("time_based");

  // Keep selectedDate at "today" until org timezone resolves
  useEffect(() => {
    setSelectedDate(getDateInTimezone(orgTimezone));
  }, [orgTimezone]);

  // Close the Filters dropdown on any click outside it
  useEffect(() => {
    if (!showFilters) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (filtersRef.current && !filtersRef.current.contains(e.target as Node)) {
        setShowFilters(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showFilters]);

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
        end_date: string | null;
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
      // Same span-expansion as assignedDueItems: one dot per day in
      // [start_date, end_date], with the exact due_date day marked "due".
      const items: DueItem[] = filtered.flatMap((t) => {
        const base = {
          taskId: t.id,
          source: "fixed" as const,
          title: t.task_name,
          account: t.account,
          status: t.status,
          category: t.category,
          projectId: null,
          isRecurring: false,
        };
        const out: DueItem[] = [];
        if (t.start_date) {
          const endDate = t.end_date && t.end_date > t.start_date ? t.end_date : t.start_date;
          for (let cursor = t.start_date; cursor <= endDate; cursor = addDaysToDateStr(cursor, 1)) {
            out.push({ ...base, id: `fixed-${t.id}-${cursor}`, date: cursor, dateType: cursor === t.due_date ? "due" : "start", dueTime: null });
          }
        }
        if (t.due_date) {
          const dueCoveredByStart = Boolean(t.start_date) && isDateInSpan(t.due_date, t.start_date as string, t.end_date);
          if (!dueCoveredByStart) {
            out.push({ ...base, id: `fixed-${t.id}-due`, date: t.due_date, dateType: "due", dueTime: null });
          }
        }
        return out;
      });
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

  // Month-view due/start dots, derived from the full assigned-task list.
  // A task with a start_date span (start_date..end_date) gets one item per
  // day in that inclusive range; the exact due_date day (if it falls within
  // the span) is marked "due" instead of "start" rather than duplicated.
  // A due_date outside the span (or a task with no start_date at all) still
  // gets its own separate item, same as before spans existed.
  const assignedDueItems = useMemo<DueItem[]>(
    () =>
      assignedTasksAll.flatMap((t) => {
        if (!t.due_date && !t.start_date) return [];
        const base = {
          taskId: t.id,
          source: "assigned" as const,
          title: t.task_name,
          account: t.account,
          status: t.status,
          category: t.category,
          projectId: t.projectId,
          isRecurring: t.isRecurring,
        };
        const items: DueItem[] = [];
        if (t.start_date) {
          const endDate = t.end_date && t.end_date > t.start_date ? t.end_date : t.start_date;
          for (let cursor = t.start_date; cursor <= endDate; cursor = addDaysToDateStr(cursor, 1)) {
            items.push({
              ...base,
              id: `assigned-${t.id}-${cursor}`,
              date: cursor,
              dateType: cursor === t.due_date ? "due" : "start",
              dueTime: cursor === t.due_date ? t.due_time : null,
            });
          }
        }
        if (t.due_date) {
          const dueCoveredByStart = Boolean(t.start_date) && isDateInSpan(t.due_date, t.start_date as string, t.end_date);
          if (!dueCoveredByStart) {
            items.push({ ...base, id: `assigned-${t.id}-due`, date: t.due_date, dateType: "due", dueTime: t.due_time });
          }
        }
        return items;
      }),
    [assignedTasksAll]
  );

  const allDueItems = useMemo(() => [...assignedDueItems, ...fixedItems], [assignedDueItems, fixedItems]);

  const activeFilterCount =
    statusFilter.size + sourceFilter.size + categoryFilter.size + projectFilter.size + (recurringOnly ? 1 : 0) +
    (dateTypeFilter !== "all" ? 1 : 0);

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
      if (dateTypeFilter !== "all" && item.dateType !== dateTypeFilter) return false;
      return true;
    });
  }, [allDueItems, statusFilter, sourceFilter, categoryFilter, projectFilter, recurringOnly, dateTypeFilter]);

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
    setDateTypeFilter("all");
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
    setEditingTaskFull(null);
    setFormDate(dateStr);
    setFormStart(`${String(hour).padStart(2, "0")}:00`);
    setFormEnd(`${String(Math.min(hour + 1, 23)).padStart(2, "0")}:00`);
    const modes = taskModesForMember(teamMembers.find((m) => m.id === dayUserId));
    setTaskMode(modes.canTimeBased ? "time_based" : "output_based");
    setShowForm(true);
  };

  // Fetches the full task row (task_detail, instructions, project_id, etc. —
  // fields the Calendar's own normalized RawTask doesn't carry) so TaskEditor
  // can prefill without clobbering anything the VA hasn't touched.
  const openEditBlock = async (task: RawTask) => {
    if (!task.start_time || !task.end_time) return;
    setEditingBlockId(task.id);
    setFormDate(localDateOf(task.start_time));
    setFormStart(new Date(task.start_time).toTimeString().slice(0, 5));
    setFormEnd(new Date(task.end_time).toTimeString().slice(0, 5));
    setShowForm(true);
    setEditingTaskFull(null);
    const res = await fetch(`/api/assigned-tasks/${task.id}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setEditingTaskFull(data.task ?? null);
  };

  const openScheduleExisting = async (task: RawTask, dateStr: string = selectedDate) => {
    setEditingBlockId(task.id);
    setFormDate(dateStr);
    setFormStart("09:00");
    setFormEnd("10:00");
    setShowForm(true);
    setEditingTaskFull(null);
    const res = await fetch(`/api/assigned-tasks/${task.id}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setEditingTaskFull(data.task ?? null);
  };

  const refreshAfterScheduleChange = useCallback(async () => {
    await Promise.all([fetchDaySchedule(), fetchAssignedTasksAll()]);
  }, [fetchDaySchedule, fetchAssignedTasksAll]);

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
    (dateStr: string) =>
      scheduledTasks
        .filter((t) => {
          const anchorDay = localDateOf(t.start_time as string);
          // Only expand into a multi-day span when start_date lines up with the
          // block's actual scheduled day — guards against a due-date-only task
          // whose start_time was set independently (openScheduleExisting) ever
          // silently spanning days it wasn't meant to.
          if (t.start_date === anchorDay && t.end_date && t.end_date !== t.start_date) {
            return isDateInSpan(dateStr, t.start_date, t.end_date);
          }
          return anchorDay === dateStr;
        })
        .map((t) => reanchorToDate(t, dateStr)),
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
      return !scheduledIdsToday.has(item.taskId);
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

  // Lays out same-day scheduled blocks side-by-side when their times overlap,
  // instead of stacking them directly on top of each other. Groups tasks into
  // overlap "clusters", then greedily assigns each task the first free column
  // within its cluster (classic calendar side-by-side layout).
  function computeOverlapLayout(tasks: RawTask[]): Map<number, { col: number; cols: number }> {
    const sorted = [...tasks].sort((a, b) => {
      const aStart = new Date(a.start_time!).getTime();
      const bStart = new Date(b.start_time!).getTime();
      if (aStart !== bStart) return aStart - bStart;
      return new Date(a.end_time!).getTime() - new Date(b.end_time!).getTime();
    });

    const layout = new Map<number, { col: number; cols: number }>();
    let cluster: RawTask[] = [];
    let clusterMaxEnd = -Infinity;

    const flushCluster = () => {
      if (cluster.length === 0) return;
      const columnEnds: number[] = [];
      const taskCols = new Map<number, number>();
      for (const t of cluster) {
        const start = new Date(t.start_time!).getTime();
        const end = new Date(t.end_time!).getTime();
        let placed = false;
        for (let c = 0; c < columnEnds.length; c++) {
          if (columnEnds[c] <= start) {
            columnEnds[c] = end;
            taskCols.set(t.id, c);
            placed = true;
            break;
          }
        }
        if (!placed) {
          columnEnds.push(end);
          taskCols.set(t.id, columnEnds.length - 1);
        }
      }
      const cols = columnEnds.length;
      for (const t of cluster) {
        layout.set(t.id, { col: taskCols.get(t.id)!, cols });
      }
      cluster = [];
      clusterMaxEnd = -Infinity;
    };

    for (const t of sorted) {
      const start = new Date(t.start_time!).getTime();
      const end = new Date(t.end_time!).getTime();
      if (cluster.length > 0 && start >= clusterMaxEnd) {
        flushCluster();
      }
      cluster.push(t);
      clusterMaxEnd = Math.max(clusterMaxEnd, end);
    }
    flushCluster();

    return layout;
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
          <div className="relative" ref={filtersRef}>
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
                        {s === "assigned" ? "Assignment Task" : "Output Based Task"}
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
                      <label key={c} className="flex items-center gap-1.5 text-[11px] text-espresso">
                        <input type="checkbox" checked={categoryFilter.has(c)} onChange={() => toggleInSet(categoryFilter, setCategoryFilter, c)} />
                        <span className={`h-2 w-2 rounded-full ${categoryDotClass(c)}`} />
                        {c}
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-semibold text-walnut uppercase tracking-wide mb-1">Date Type</p>
                  <div className="flex flex-wrap gap-1">
                    {([
                      { value: "all", label: "All" },
                      { value: "start", label: "Start Date" },
                      { value: "due", label: "Due Date" },
                    ] as const).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setDateTypeFilter(opt.value)}
                        className={`px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors ${
                          dateTypeFilter === opt.value ? "bg-sage text-white" : "bg-stone/10 text-stone hover:bg-stone/20"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[10px] text-stone">
                    In Month view: <span className="inline-block h-1.5 w-1.5 rounded-full bg-stone align-middle" /> circle = start date, <span className="inline-block h-1.5 w-1.5 rotate-45 bg-stone align-middle" /> diamond = due date.
                  </p>
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
                        title={`${item.title} — ${item.category ?? "No category"}, ${statusLabel(item.status)} (${item.dateType === "due" ? `due${item.dueTime ? ` ${formatDueTime(item.dueTime)}` : ""}` : "starts"} this day)`}
                        className={`h-1.5 w-1.5 ${item.dateType === "due" ? "rounded-sm rotate-45" : "rounded-full"} ${categoryDotClass(item.category ?? "")}`}
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
                        {(() => {
                          const dayTasks = scheduledForDate(dateStr);
                          const overlapLayout = computeOverlapLayout(dayTasks);
                          return dayTasks.map((task) => {
                            const { top, height } = blockPosition(task);
                            // Due-date-driven blocks render fully opaque; start-date-driven
                            // blocks (the default) stay at 70% opacity.
                            const isDueBlock = dateStr === task.due_date && dateStr !== task.start_date;
                            const { col, cols } = overlapLayout.get(task.id) ?? { col: 0, cols: 1 };
                            const label = spanLabel(task, dateStr);
                            return (
                              <button
                                key={task.id}
                                type="button"
                                onClick={() => openEditBlock(task)}
                                className={`pointer-events-auto absolute overflow-hidden rounded-md border px-1 py-0.5 text-left shadow-sm hover:opacity-90 cursor-pointer ${categoryBlockClasses(task.category, isDueBlock)}`}
                                style={{
                                  top,
                                  height,
                                  left: `calc(2px + (100% - 4px) * ${col} / ${cols})`,
                                  width: `calc((100% - 4px) / ${cols} - 2px)`,
                                }}
                              >
                                <p className="truncate text-[9px] font-semibold leading-tight">
                                  {label && <span className="opacity-70">[{label}] </span>}
                                  {task.task_name}
                                </p>
                              </button>
                            );
                          });
                        })()}
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
                  // Look up against the admin-wide list (same source dueTodayItems is
                  // built from), not just the current viewer's own daySchedule —
                  // otherwise an unassigned/other-VA task shows this pill but it's
                  // unclickable, since it never appears in dayUserId's own task list.
                  const scheduleTarget = item.source === "assigned"
                    ? daySchedule.find((t) => t.id === item.taskId) ?? assignedTasksAll.find((t) => t.id === item.taskId)
                    : undefined;
                  const dueTimeLabel = item.dateType === "due" && item.dueTime ? ` ${formatDueTime(item.dueTime)}` : "";
                  const label = `${item.dateType === "due" ? "Due" : "Starts"}${dueTimeLabel}: ${item.title}`;
                  const pillClasses = categoryBlockClasses(item.category, true);
                  if (!scheduleTarget) {
                    return (
                      <span
                        key={item.id}
                        className={`text-[10px] font-semibold px-2 py-[2px] rounded-full border ${pillClasses}`}
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
                      className={`text-[10px] font-semibold px-2 py-[2px] rounded-full border cursor-pointer hover:opacity-75 transition-opacity ${pillClasses}`}
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

                <div className="pointer-events-none absolute inset-0">
                  {(() => {
                    const dayTasks = scheduledForDate(selectedDate);
                    const overlapLayout = computeOverlapLayout(dayTasks);
                    return dayTasks.map((task) => {
                      const { top, height } = blockPosition(task);
                      // Due-date-driven blocks render fully opaque; start-date-driven
                      // blocks (the default) stay at 70% opacity.
                      const isDueBlock = selectedDate === task.due_date && selectedDate !== task.start_date;
                      const { col, cols } = overlapLayout.get(task.id) ?? { col: 0, cols: 1 };
                      const label = spanLabel(task, selectedDate);
                      return (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => openEditBlock(task)}
                          className={`pointer-events-auto absolute overflow-hidden rounded-md border px-2 py-1 text-left shadow-sm hover:opacity-90 cursor-pointer ${categoryBlockClasses(task.category, isDueBlock)}`}
                          style={{
                            top,
                            height,
                            left: `calc(4rem + (100% - 4rem - 0.5rem) * ${col} / ${cols})`,
                            width: `calc((100% - 4rem - 0.5rem) / ${cols} - 4px)`,
                          }}
                        >
                          <p className="truncate text-[11px] font-semibold">
                            {label && (
                              <span className="mr-1 rounded bg-black/10 px-1 text-[9px] font-bold uppercase tracking-wide">
                                {label}
                              </span>
                            )}
                            {task.task_name}
                          </p>
                          <p className="truncate text-[10px] opacity-80">{formatTimeRange(task)}</p>
                        </button>
                      );
                    });
                  })()}
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

      {/* Add/Edit modal — shared TaskEditor, same form used across the app */}
      {showForm && (!editingBlockId || editingTaskFull) && dayUserId && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl border border-sand shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="py-4 px-5 border-b border-parchment flex items-center justify-between sticky top-0 bg-white">
              <h3 className="text-sm font-bold text-espresso">
                {editingBlockId ? "Edit Task" : "Add Task"} {viewMode === "week" ? `— ${formatDayLabel(formDate)}` : ""}
              </h3>
              <button
                onClick={() => setShowForm(false)}
                className="text-bark hover:text-terracotta text-lg leading-none cursor-pointer"
              >
                &times;
              </button>
            </div>
            <div className="p-5 space-y-3">
              {editingBlockId && (
                <button
                  onClick={removeFromCalendar}
                  title="Clears the time, but keeps the task itself — manage it from Assignment."
                  className="w-full px-3 py-2 rounded-lg bg-red-50 text-red-500 border border-red-200 text-[12px] font-semibold cursor-pointer hover:bg-red-100 transition-colors"
                >
                  Remove from Calendar
                </button>
              )}
              {!editingBlockId && (() => {
                const modes = taskModesForMember(teamMembers.find((m) => m.id === dayUserId));
                if (!modes.canTimeBased || !modes.canOutputBased) return null;
                return (
                  <div className="flex rounded-lg border border-sand overflow-hidden text-[12px] font-semibold">
                    <button
                      type="button"
                      onClick={() => setTaskMode("time_based")}
                      className={`flex-1 px-3 py-1.5 transition-colors ${taskMode === "time_based" ? "bg-terracotta text-white" : "bg-white text-stone hover:bg-cream"}`}
                    >
                      Time-based
                    </button>
                    <button
                      type="button"
                      onClick={() => setTaskMode("output_based")}
                      className={`flex-1 px-3 py-1.5 transition-colors ${taskMode === "output_based" ? "bg-terracotta text-white" : "bg-white text-stone hover:bg-cream"}`}
                    >
                      Output Based
                    </button>
                  </div>
                );
              })()}
              <TaskEditor
                key={editingBlockId ? "edit" : taskMode}
                mode={editingBlockId ? "time_based" : taskMode}
                editingTaskId={editingBlockId}
                initialTask={editingTaskFull}
                currentUserId={userId!}
                isAdminOrManager={isAdminOrManager}
                teamMembers={teamMembers}
                defaultVaId={dayUserId}
                defaultDate={formDate}
                defaultStartTime={formStart}
                defaultEndTime={formEnd}
                onCancel={() => setShowForm(false)}
                onSaved={() => {
                  setShowForm(false);
                  void refreshAfterScheduleChange();
                  if (taskMode === "output_based") void fetchFixedItems();
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
