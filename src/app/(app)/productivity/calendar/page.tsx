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
  // True for the per-day items of a multi-day span (start_date..end_date) —
  // rendered in Month view as a connected line across the days rather than a
  // single dot.
  isSpan: boolean;
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
  // Multi-VA "compare" for Day view: pick several teammates and see each as its
  // own skinny column. Separate from `scope` (which drives the single grid).
  const [compareVaIds, setCompareVaIds] = useState<string[]>([]);
  const [draftVaIds, setDraftVaIds] = useState<string[]>([]);
  const [compareSchedules, setCompareSchedules] = useState<Record<string, RawTask[]>>({});
  const [showComparePicker, setShowComparePicker] = useState(false);
  const [monthYear, setMonthYear] = useState<number>(new Date().getFullYear());
  const [monthMonth, setMonthMonth] = useState<number>(new Date().getMonth());
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);

  const [assignedTasksAll, setAssignedTasksAll] = useState<RawTask[]>([]);
  const [fixedItems, setFixedItems] = useState<DueItem[]>([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [daySchedule, setDaySchedule] = useState<RawTask[]>([]);
  const [loadingDay, setLoadingDay] = useState(false);
  // Approved time off (va_requests type=time_off). Admin sees everyone; a VA
  // sees their own. start_time/end_time null = full day off; set = a partial
  // "short day" for that window.
  const [timeOff, setTimeOff] = useState<Array<{ user_id: string; start_date: string; end_date: string; start_time: string | null; end_time: string | null }>>([]);

  const [showFilters, setShowFilters] = useState(false);
  const [unscheduledCollapsed, setUnscheduledCollapsed] = useState(false);
  const [expandedUnscheduledIds, setExpandedUnscheduledIds] = useState<Set<number>>(new Set());
  const toggleUnscheduledExpand = (id: number) => {
    setExpandedUnscheduledIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [sourceFilter, setSourceFilter] = useState<Set<"assigned" | "fixed">>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set());
  const [projectFilter, setProjectFilter] = useState<Set<string>>(new Set());
  const [recurringOnly, setRecurringOnly] = useState(false);
  const [dateTypeFilter, setDateTypeFilter] = useState<"all" | "start" | "due">("all");
  // Filters use a draft → Apply model: the checkboxes above are the DRAFT; the
  // calendar doesn't change until Apply copies the draft into `applied`, which
  // is the snapshot every filter below actually reads from.
  const emptyApplied = () => ({
    status: new Set<string>(),
    source: new Set<"assigned" | "fixed">(),
    category: new Set<string>(),
    project: new Set<string>(),
    recurring: false,
    dateType: "all" as "all" | "start" | "due",
  });
  const [applied, setApplied] = useState(emptyApplied);
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
          const isSpan = endDate !== t.start_date;
          for (let cursor = t.start_date; cursor <= endDate; cursor = addDaysToDateStr(cursor, 1)) {
            out.push({ ...base, id: `fixed-${t.id}-${cursor}`, date: cursor, dateType: cursor === t.due_date ? "due" : "start", dueTime: null, isSpan });
          }
        }
        if (t.due_date) {
          const dueCoveredByStart = Boolean(t.start_date) && isDateInSpan(t.due_date, t.start_date as string, t.end_date);
          if (!dueCoveredByStart) {
            out.push({ ...base, id: `fixed-${t.id}-due`, date: t.due_date, dateType: "due", dueTime: null, isSpan: false });
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

  // Fetch a schedule per compared VA (Day view multi-column). Runs one active-
  // tasks request per selected teammate.
  const fetchCompareSchedules = useCallback(async () => {
    if (compareVaIds.length === 0) {
      setCompareSchedules({});
      return;
    }
    const entries = await Promise.all(
      compareVaIds.map(async (vaId) => {
        try {
          const url = vaId === userId
            ? "/api/assigned-tasks?selfOnly=true&view=active"
            : `/api/assigned-tasks?viewAsVa=${vaId}&view=active`;
          const res = await fetch(url);
          const data = await res.json();
          return [vaId, normalizeAssignedRows(data.tasks ?? [], vaId)] as const;
        } catch {
          return [vaId, [] as RawTask[]] as const;
        }
      })
    );
    setCompareSchedules(Object.fromEntries(entries));
  }, [compareVaIds, userId]);

  useEffect(() => {
    if (viewMode === "day") fetchCompareSchedules();
  }, [viewMode, fetchCompareSchedules]);

  const fetchTimeOff = useCallback(async () => {
    try {
      const res = await fetch("/api/va-requests", { cache: "no-store" });
      const data = await res.json();
      const approved = (data.requests ?? [])
        .filter((r: { type: string; status: string; start_date: string | null }) => r.type === "time_off" && r.status === "approved" && r.start_date)
        .map((r: { user_id: string; start_date: string; end_date: string | null; start_time: string | null; end_time: string | null }) => ({
          user_id: r.user_id,
          start_date: r.start_date,
          end_date: r.end_date || r.start_date,
          start_time: r.start_time ?? null,
          end_time: r.end_time ?? null,
        }));
      setTimeOff(approved);
    } catch {
      setTimeOff([]);
    }
  }, []);

  useEffect(() => {
    fetchTimeOff();
  }, [fetchTimeOff]);

  // The approved time-off entry covering this VA on this date, if any.
  const timeOffForVaOnDate = useCallback(
    (vaId: string, dateStr: string) => timeOff.find((t) => t.user_id === vaId && dateStr >= t.start_date && dateStr <= t.end_date),
    [timeOff]
  );
  const isVaOffOnDate = useCallback((vaId: string, dateStr: string) => Boolean(timeOffForVaOnDate(vaId, dateStr)), [timeOffForVaOnDate]);
  // Label for an off entry: full day → "Time Off"; partial → "Short Day (h–h)".
  const timeOffLabel = (entry: { start_time: string | null; end_time: string | null } | undefined) => {
    if (!entry) return null;
    if (!entry.start_time || !entry.end_time) return "Time Off";
    const fmt = (t: string) => {
      const [h, m] = t.split(":").map(Number);
      const period = h >= 12 ? "pm" : "am";
      const hour12 = h % 12 === 0 ? 12 : h % 12;
      return m > 0 ? `${hour12}:${String(m).padStart(2, "0")}${period}` : `${hour12}${period}`;
    };
    return `Short Day (${fmt(entry.start_time)}–${fmt(entry.end_time)})`;
  };

  // The "My View" control is a multi-select of teammates. Opening it seeds the
  // draft from what's applied; Apply commits it. 0 selected = just me; 1 = that
  // teammate everywhere; 2+ = the Day grid splits into a column per teammate.
  const openVaPicker = () => {
    setDraftVaIds(compareVaIds);
    setShowComparePicker(true);
  };
  const applyVaSelection = () => {
    setCompareVaIds(draftVaIds);
    // Drive the single-scope views (month/week + single-day) from the selection:
    // none = me, one = that teammate, all = agency-wide, an in-between set falls
    // back to me (the Day grid handles the multi case with columns).
    if (draftVaIds.length === 0) setScope("__self__");
    else if (draftVaIds.length === 1) setScope(draftVaIds[0]);
    else if (teamMembers.length > 0 && draftVaIds.length === teamMembers.length) setScope("__all__");
    else setScope("__self__");
    setShowComparePicker(false);
  };
  const vaPickerLabel =
    compareVaIds.length === 0
      ? "My View"
      : compareVaIds.length === 1
      ? teamMembers.find((m) => m.id === compareVaIds[0])?.full_name ?? "1 selected"
      : `${compareVaIds.length} VAs`;

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
          const isSpan = endDate !== t.start_date;
          for (let cursor = t.start_date; cursor <= endDate; cursor = addDaysToDateStr(cursor, 1)) {
            items.push({
              ...base,
              id: `assigned-${t.id}-${cursor}`,
              date: cursor,
              dateType: cursor === t.due_date ? "due" : "start",
              dueTime: cursor === t.due_date ? t.due_time : null,
              isSpan,
            });
          }
        }
        if (t.due_date) {
          const dueCoveredByStart = Boolean(t.start_date) && isDateInSpan(t.due_date, t.start_date as string, t.end_date);
          if (!dueCoveredByStart) {
            items.push({ ...base, id: `assigned-${t.id}-due`, date: t.due_date, dateType: "due", dueTime: t.due_time, isSpan: false });
          }
        }
        return items;
      }),
    [assignedTasksAll]
  );

  const allDueItems = useMemo(() => [...assignedDueItems, ...fixedItems], [assignedDueItems, fixedItems]);

  const activeFilterCount =
    applied.status.size + applied.source.size + applied.category.size + applied.project.size + (applied.recurring ? 1 : 0) +
    (applied.dateType !== "all" ? 1 : 0);

  const filteredDueItems = useMemo(() => {
    return allDueItems.filter((item) => {
      if (applied.status.size > 0 && !applied.status.has(item.status)) return false;
      if (applied.source.size > 0 && !applied.source.has(item.source)) return false;
      if (applied.category.size > 0 && !(item.category && applied.category.has(item.category))) return false;
      if (applied.project.size > 0) {
        const key = item.projectId ?? "__none__";
        if (!applied.project.has(key)) return false;
      }
      if (applied.recurring && !item.isRecurring) return false;
      if (applied.dateType !== "all" && item.dateType !== applied.dateType) return false;
      return true;
    });
  }, [allDueItems, applied]);

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
    setApplied(emptyApplied());
  };

  // Commit the draft to `applied` — this is when the calendar actually updates.
  const applyFilters = () => {
    setApplied({
      status: new Set(statusFilter),
      source: new Set(sourceFilter),
      category: new Set(categoryFilter),
      project: new Set(projectFilter),
      recurring: recurringOnly,
      dateType: dateTypeFilter,
    });
    setShowFilters(false);
  };

  // Opening the popover seeds the draft from what's currently applied, so it
  // shows reality and any unapplied edits from before are discarded.
  const openFilters = () => {
    setStatusFilter(new Set(applied.status));
    setSourceFilter(new Set(applied.source));
    setCategoryFilter(new Set(applied.category));
    setProjectFilter(new Set(applied.project));
    setRecurringOnly(applied.recurring);
    setDateTypeFilter(applied.dateType);
    setShowFilters(true);
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

  // Jump the whole calendar (month grid + week/day cursor) to any date.
  const jumpToDate = (dateStr: string) => {
    if (!dateStr) return;
    setSelectedDate(dateStr);
    setMonthYear(Number(dateStr.slice(0, 4)));
    setMonthMonth(Number(dateStr.slice(5, 7)) - 1);
  };
  const goToToday = () => jumpToDate(todayStr);

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

  // Same applied-filter predicate the month dots use, so the week/day hour
  // blocks respect Source/Status/Category/Project/Recurring too. Date Type is
  // left out here — a scheduled block is inherently start-anchored, so gating
  // the whole time grid on "Due Date" would just blank it out.
  const taskPassesFilters = useCallback(
    (t: RawTask) => {
      if (applied.status.size > 0 && !applied.status.has(t.status)) return false;
      // Day/week schedule rows are always assigned-source (fetched from
      // assigned-tasks), so a source filter that excludes "assigned" hides them.
      if (applied.source.size > 0 && !applied.source.has("assigned")) return false;
      if (applied.category.size > 0 && !(t.category && applied.category.has(t.category))) return false;
      if (applied.project.size > 0 && !applied.project.has(t.projectId ?? "__none__")) return false;
      if (applied.recurring && !t.isRecurring) return false;
      return true;
    },
    [applied]
  );

  const scheduledTasks = useMemo(
    () => daySchedule.filter((t) => t.start_time && t.end_time && taskPassesFilters(t)),
    [daySchedule, taskPassesFilters]
  );
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
  // Same day-anchoring as scheduledForDate, but against a compared VA's own
  // fetched schedule, time-sorted for the skinny column list. Filters apply.
  const blocksForVaOnDate = useCallback(
    (vaId: string, dateStr: string) =>
      (compareSchedules[vaId] ?? [])
        .filter((t) => t.start_time && t.end_time && taskPassesFilters(t))
        .filter((t) => {
          const anchorDay = localDateOf(t.start_time as string);
          if (t.start_date === anchorDay && t.end_date && t.end_date !== t.start_date) {
            return isDateInSpan(dateStr, t.start_date, t.end_date);
          }
          return anchorDay === dateStr;
        })
        .map((t) => reanchorToDate(t, dateStr))
        .sort((a, b) => new Date(a.start_time as string).getTime() - new Date(b.start_time as string).getTime()),
    [compareSchedules, taskPassesFilters]
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

  // Due Time is a plain "HH:MM" clock time (not a timestamp, no timezone
  // conversion needed) — position it on the same grid the hour blocks use,
  // clamped to the visible 6am-9pm range.
  function dueTimePosition(dueTime: string): number {
    const [h, m] = dueTime.split(":").map(Number);
    const minutes = Math.max(0, Math.min((DAY_END_HOUR - DAY_START_HOUR) * 60, (h - DAY_START_HOUR) * 60 + (m || 0)));
    return (minutes / 60) * HOUR_HEIGHT;
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

          <span className="mx-1 h-4 w-px bg-sand" />
          <button
            type="button"
            onClick={goToToday}
            className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors"
          >
            Today
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => jumpToDate(e.target.value)}
            title="Jump to date"
            className="rounded-lg border border-sand px-2 py-1 text-[11px] text-espresso outline-none bg-white"
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="relative" ref={filtersRef}>
            <button
              type="button"
              onClick={() => (showFilters ? setShowFilters(false) : openFilters())}
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
                    In Month view: <span className="inline-block h-2 w-2 rounded-sm bg-stone align-middle" /> square = start date, <span className="inline-block h-2 w-2 rounded-sm rotate-45 bg-stone align-middle" /> diamond = due date, and a bar = a task spanning several days.
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

                <div className="flex items-center gap-2 border-t border-sand pt-3">
                  <button
                    type="button"
                    onClick={applyFilters}
                    className="flex-1 rounded-lg bg-sage px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-sage/90 transition-colors"
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowFilters(false)}
                    className="rounded-lg bg-stone/10 px-3 py-1.5 text-[11px] font-semibold text-stone hover:bg-stone/20 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {isAdminOrManager && (
            <div className="relative">
              <button
                type="button"
                onClick={() => (showComparePicker ? setShowComparePicker(false) : openVaPicker())}
                className={`flex items-center gap-1.5 rounded-lg border border-sand px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  compareVaIds.length >= 2 ? "bg-terracotta-soft text-terracotta" : "bg-white text-espresso hover:bg-parchment"
                }`}
              >
                {vaPickerLabel}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3 w-3">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {showComparePicker && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setShowComparePicker(false)} />
                  <div className="absolute right-0 z-30 mt-2 w-60 rounded-xl border border-sand bg-white shadow-lg">
                    <div className="flex items-center justify-between border-b border-sand px-3 py-1.5">
                      <button type="button" onClick={() => setDraftVaIds(teamMembers.map((m) => m.id))} className="text-[10px] font-semibold text-terracotta hover:underline">All</button>
                      <span className="text-[10px] text-stone">none = My View</span>
                      <button type="button" onClick={() => setDraftVaIds([])} className="text-[10px] font-semibold text-stone hover:underline">Clear</button>
                    </div>
                    <div className="max-h-56 overflow-y-auto py-1">
                      {teamMembers.map((m) => (
                        <label key={m.id} className="flex cursor-pointer items-center gap-2 px-3 py-1 hover:bg-parchment">
                          <input
                            type="checkbox"
                            checked={draftVaIds.includes(m.id)}
                            onChange={(e) =>
                              setDraftVaIds((prev) => (e.target.checked ? [...prev, m.id] : prev.filter((id) => id !== m.id)))
                            }
                          />
                          <span className="text-[12px] text-espresso">{m.full_name || m.username}</span>
                        </label>
                      ))}
                    </div>
                    <p className="px-3 pt-1 text-[10px] text-stone">Pick 2+ to split the Day view into columns.</p>
                    <div className="flex items-center gap-2 border-t border-sand p-2">
                      <button type="button" onClick={applyVaSelection} className="flex-1 rounded-lg bg-sage px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-sage/90">Apply</button>
                      <button type="button" onClick={() => setShowComparePicker(false)} className="rounded-lg bg-stone/10 px-3 py-1.5 text-[11px] font-semibold text-stone hover:bg-stone/20">Cancel</button>
                    </div>
                  </div>
                </>
              )}
            </div>
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
                  <div className="flex items-center justify-between gap-1">
                    <span className={`text-[11px] font-semibold ${isCurrentMonth ? "text-espresso" : "text-stone"}`}>
                      {Number(dateStr.slice(8, 10))}
                    </span>
                    {(() => {
                      const off = timeOffForVaOnDate(dayUserId ?? "", dateStr);
                      if (!off) return null;
                      const partial = Boolean(off.start_time && off.end_time);
                      return (
                        <span className="rounded bg-terracotta-soft px-1 text-[8px] font-bold uppercase leading-tight text-terracotta" title={timeOffLabel(off) ?? undefined}>
                          {partial ? "½ Day" : "Off"}
                        </span>
                      );
                    })()}
                  </div>
                  <div className="mt-1 space-y-1">
                    {/* Multi-day spans render as a bar; adjacent days line up into
                        a continuous line across the span. */}
                    {items.filter((i) => i.isSpan).slice(0, 3).map((item) => (
                      <div
                        key={item.id}
                        title={`${item.title} — ${item.category ?? "No category"}, ${statusLabel(item.status)} (spans this day)`}
                        className={`h-1.5 w-full rounded-sm ${categoryDotClass(item.category ?? "")}`}
                      />
                    ))}
                    <div className="flex flex-wrap gap-1">
                      {items.filter((i) => !i.isSpan).slice(0, 5).map((item) => (
                        <span
                          key={item.id}
                          title={`${item.title} — ${item.category ?? "No category"}, ${statusLabel(item.status)} (${item.dateType === "due" ? `due${item.dueTime ? ` ${formatDueTime(item.dueTime)}` : ""}` : "starts"} this day)`}
                          className={`h-2.5 w-2.5 ${item.dateType === "due" ? "rounded-sm rotate-45" : "rounded-sm"} ${categoryDotClass(item.category ?? "")}`}
                        />
                      ))}
                      {items.filter((i) => !i.isSpan).length > 5 && (
                        <span className="text-[9px] text-stone">+{items.filter((i) => !i.isSpan).length - 5}</span>
                      )}
                    </div>
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

      {viewMode === "day" && isAdminOrManager && (() => {
        const off = timeOff
          .filter((t) => selectedDate >= t.start_date && selectedDate <= t.end_date)
          .map((t) => {
            const m = teamMembers.find((tm) => tm.id === t.user_id);
            return { name: m?.full_name || m?.username || "Someone", label: timeOffLabel(t) };
          });
        if (off.length === 0) return null;
        return (
          <div className="rounded-xl border border-terracotta/30 bg-terracotta-soft px-4 py-2.5">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-terracotta">Off this day ({off.length})</p>
            <div className="flex flex-wrap gap-1.5">
              {off.map((o, i) => (
                <span key={i} className="rounded-full border border-terracotta/30 bg-white px-2 py-[2px] text-[11px] font-semibold text-terracotta">
                  {o.name} · {o.label}
                </span>
              ))}
            </div>
          </div>
        );
      })()}

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

            {compareVaIds.length < 2 && isVaOffOnDate(dayUserId ?? "", selectedDate) && (
              <div className="mb-3 rounded-lg border border-terracotta/30 bg-terracotta-soft px-3 py-2 text-[12px] font-semibold text-terracotta">
                {timeOffLabel(timeOffForVaOnDate(dayUserId ?? "", selectedDate))} — approved.
              </div>
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
            ) : compareVaIds.length >= 2 ? (
              // Multi-VA compare: the day grid itself splits into a column per
              // selected teammate. Read-only (blocks open to edit); add-by-click
              // stays in single-VA mode to keep the target VA unambiguous.
              <div>
                <div className="mb-1 flex border-b border-sand pb-1">
                  <div className="w-14 shrink-0" />
                  {compareVaIds.map((vaId) => {
                    const member = teamMembers.find((m) => m.id === vaId);
                    const blocks = blocksForVaOnDate(vaId, selectedDate);
                    const totalMin = blocks.reduce((s, t) => s + (new Date(t.end_time as string).getTime() - new Date(t.start_time as string).getTime()) / 60000, 0);
                    return (
                      <div key={vaId} className="min-w-0 flex-1 px-1 text-center">
                        <p className="truncate text-[11px] font-bold text-espresso">{member?.full_name || member?.username || "VA"}</p>
                        {isVaOffOnDate(vaId, selectedDate) ? (
                          <p className="text-[9px] font-bold uppercase tracking-wide text-terracotta">{timeOffLabel(timeOffForVaOnDate(vaId, selectedDate))}</p>
                        ) : (
                          <p className="text-[9px] text-stone">{Math.floor(totalMin / 60)}h{totalMin % 60 > 0 ? ` ${Math.round(totalMin % 60)}m` : ""}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="relative" style={{ height: hours.length * HOUR_HEIGHT }}>
                  {hours.map((hour, i) => (
                    <div
                      key={hour}
                      className="absolute left-0 right-0 flex items-start gap-2 border-t border-sand"
                      style={{ top: i * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                    >
                      <span className="w-14 shrink-0 pt-0.5 text-[10px] text-stone">
                        {new Date(2000, 0, 1, hour).toLocaleTimeString("en-US", { hour: "numeric" })}
                      </span>
                    </div>
                  ))}
                  {compareVaIds.map((_, colIdx) => (
                    <div
                      key={`sep-${colIdx}`}
                      className="absolute top-0 bottom-0 border-l border-sand/60"
                      style={{ left: `calc(3.5rem + (100% - 3.5rem) * ${colIdx} / ${compareVaIds.length})` }}
                    />
                  ))}
                  <div className="pointer-events-none absolute inset-0">
                    {compareVaIds.map((vaId, colIdx) => {
                      const blocks = blocksForVaOnDate(vaId, selectedDate);
                      const overlap = computeOverlapLayout(blocks);
                      const n = compareVaIds.length;
                      return blocks.map((task) => {
                        const { top, height } = blockPosition(task);
                        const { col, cols } = overlap.get(task.id) ?? { col: 0, cols: 1 };
                        const isDueBlock = selectedDate === task.due_date && selectedDate !== task.start_date;
                        const frac = colIdx + col / cols;
                        const label = spanLabel(task, selectedDate);
                        return (
                          <button
                            key={`${vaId}-${task.id}`}
                            type="button"
                            onClick={() => openEditBlock(task)}
                            className={`pointer-events-auto absolute overflow-hidden rounded-md border px-1.5 py-0.5 text-left shadow-sm hover:opacity-90 cursor-pointer ${categoryBlockClasses(task.category, isDueBlock)}`}
                            style={{
                              top,
                              height,
                              left: `calc(3.5rem + (100% - 3.5rem) * ${frac} / ${n})`,
                              width: `calc((100% - 3.5rem) / ${n * cols} - 3px)`,
                            }}
                          >
                            <p className="truncate text-[10px] font-semibold leading-tight">
                              {label && <span className="mr-1 rounded bg-black/10 px-1 text-[8px] font-bold uppercase">{label}</span>}
                              {task.task_name}
                            </p>
                            <p className="truncate text-[9px] opacity-80">{formatTimeRange(task)}</p>
                          </button>
                        );
                      });
                    })}
                  </div>
                </div>
              </div>
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
                          <div className="flex h-full items-start gap-2">
                            <div className="min-w-0 shrink-0 max-w-[55%]">
                              <p className="truncate text-[11px] font-semibold">
                                {label && (
                                  <span className="mr-1 rounded bg-black/10 px-1 text-[9px] font-bold uppercase tracking-wide">
                                    {label}
                                  </span>
                                )}
                                {task.task_name}
                              </p>
                              <p className="truncate text-[10px] opacity-80">{formatTimeRange(task)}</p>
                            </div>
                            {task.todos.length > 0 && (
                              // Runs alongside the title/time instead of stacking below
                              // it — a 1hr block is usually wide, not tall, so the to-dos
                              // get the block's full height to themselves here. Whatever
                              // doesn't fit is clipped by the block's own overflow.
                              <div className="min-w-0 flex-1 border-l border-black/10 pl-2">
                                <p className="truncate text-[9px] font-semibold opacity-70">
                                  {task.todos.length} to-do{task.todos.length !== 1 ? "s" : ""}
                                </p>
                                {task.todos.map((t) => (
                                  <p key={t.id} className="truncate text-[9px] opacity-70 leading-tight">
                                    · {t.text}
                                  </p>
                                ))}
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    });
                  })()}

                  {/* Due Time markers — a due date+time isn't a work span, so it
                      doesn't get an hour block; it gets a thin line at its clock
                      time instead, positioned on the same grid the blocks use. */}
                  {dueTodayItems
                    .filter((item) => item.dateType === "due" && item.dueTime)
                    .map((item) => {
                      const scheduleTarget = item.source === "assigned"
                        ? daySchedule.find((t) => t.id === item.taskId) ?? assignedTasksAll.find((t) => t.id === item.taskId)
                        : undefined;
                      const pillClasses = categoryBlockClasses(item.category, true);
                      const top = dueTimePosition(item.dueTime!);
                      return (
                        <div
                          key={`due-marker-${item.id}`}
                          className="pointer-events-none absolute left-16 right-2 flex items-center gap-1.5"
                          style={{ top: top - 7 }}
                        >
                          <span className="h-[2px] w-3 shrink-0 rounded bg-stone/60" />
                          <button
                            type="button"
                            disabled={!scheduleTarget}
                            onClick={() => scheduleTarget && openScheduleExisting(scheduleTarget, selectedDate)}
                            title={`Due ${formatDueTime(item.dueTime!)} — ${item.title}`}
                            className={`pointer-events-auto truncate max-w-[70%] text-[9px] font-bold px-1.5 py-[1px] rounded-full border shadow-sm ${scheduleTarget ? "cursor-pointer hover:opacity-80" : "cursor-default"} ${pillClasses}`}
                          >
                            Due {formatDueTime(item.dueTime!)} · {item.title}
                          </button>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>

          {/* Unscheduled sidebar */}
          <div className="rounded-xl border border-sand bg-white p-4 space-y-3 h-fit">
            <button
              type="button"
              onClick={() => setUnscheduledCollapsed((v) => !v)}
              className="flex w-full items-center justify-between gap-2 cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  className={`text-bark transition-transform ${unscheduledCollapsed ? "" : "rotate-90"}`}
                >
                  <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="text-xs font-bold text-espresso uppercase tracking-wide">Unscheduled</span>
              </span>
              {unscheduledTasks.length > 0 && (
                <span className="text-[10px] font-semibold py-[2px] px-2 rounded-full bg-terracotta-soft text-terracotta">
                  {unscheduledTasks.length}
                </span>
              )}
            </button>
            {!unscheduledCollapsed && (
              <>
                {unscheduledTasks.length === 0 ? (
                  <p className="text-[11px] text-stone">Nothing unscheduled.</p>
                ) : (
                  <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
                    {unscheduledTasks.map((task) => {
                      const isExpanded = expandedUnscheduledIds.has(task.id);
                      return (
                      <div
                        key={task.id}
                        className="rounded-lg border border-sand bg-white px-2.5 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => toggleUnscheduledExpand(task.id)}
                            className="flex min-w-0 flex-1 items-start gap-1 text-left cursor-pointer"
                          >
                            <svg
                              width="9"
                              height="9"
                              viewBox="0 0 12 12"
                              className={`mt-[3px] shrink-0 text-bark transition-transform ${isExpanded ? "rotate-90" : ""}`}
                            >
                              <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            <span className="min-w-0">
                              <p className="truncate text-[12px] font-semibold text-espresso">{task.task_name}</p>
                              {task.account && <p className="truncate text-[10px] text-stone">{task.account}</p>}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => openScheduleExisting(task)}
                            className="shrink-0 px-2 py-1 rounded-lg bg-sage text-white text-[10px] font-semibold hover:bg-sage/90 transition-colors cursor-pointer"
                          >
                            Schedule
                          </button>
                        </div>
                        {isExpanded && (
                          <p className="mt-1.5 pl-[17px] text-[11px] text-stone/80 leading-relaxed whitespace-pre-wrap">
                            {task.task_detail || "No description."}
                          </p>
                        )}
                      </div>
                      );
                    })}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => openAddBlock(9)}
                  className="w-full px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors cursor-pointer"
                >
                  + Add Hour Block
                </button>
              </>
            )}
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
