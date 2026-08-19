"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { hasBroadAdminAccess } from "@/lib/financialAccess";
import TaskEditor, { type TaskEditorInitialTask } from "@/components/TaskEditor";
import {
  type RawTask,
  CATEGORY_OPTIONS,
  getDateInTimezone,
  addDaysToDateStr,
  formatDayLabel,
  orgDateOf,
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
import { normalizePosition } from "@/types/database";
import { BUDGET_WARN_THRESHOLD, shiftHoursFromProfile, workDaysFromProfile, weekdayOfOrgDate, vaBudgetType } from "@/lib/budget";
import { useUrlTab } from "@/hooks/useUrlTab";

type TeamMember = {
  id: string;
  full_name: string;
  username: string;
  role: string;
  position?: string | null;
  pay_rate_type?: string | null;
  can_see_available_tasks?: boolean | null;
  work_days?: number[] | null;
  shift_hours?: number | null;
  shift_start?: string | null;
  shift_end?: string | null;
  weekly_budget_limit?: number | null;
  monthly_budget_limit?: number | null;
};

// Same derivation as FixedPayTasksPanel's isHybrid/isPerTaskVa: position
// "Part Time"/"Full Time" is the hourly-labeled default, "Output Based"
// (or pay_rate_type "per_task") is fixed-pay-only, and the "Available Tasks"
// toggle in Team management is what actually makes an hourly-labeled VA
// hybrid (able to pick up Output Based work too).
function taskModesForMember(member: TeamMember | undefined): { canTimeBased: boolean; canOutputBased: boolean } {
  if (!member) return { canTimeBased: true, canOutputBased: false };
  const position = normalizePosition(member.position);
  const isPerTaskVa = position === "Output Based" || member.pay_rate_type === "per_task";
  if (isPerTaskVa) return { canTimeBased: false, canOutputBased: true };
  const isHybrid = ["Part Time", "Full Time"].includes(position ?? "") && Boolean(member.can_see_available_tasks);
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


// Round the clock. These were 6 and 21, which meant anything genuinely early
// or late didn't render: a block outside the window computed an offset past the
// grid and simply wasn't drawn, and a due marker was clamped to the edge, so it
// showed at 9pm however late it actually was. Neither failure announced itself.
const DAY_START_HOUR = 0;
const DAY_END_HOUR = 23;
const HOUR_HEIGHT = 48;
// 24 hours at 48px is ~1150px, so the grid scrolls inside a viewport rather than
// stretching the page into one long column. The scroll sits on a plain wrapper,
// never on the grid itself: the grid is the containing block for every
// absolutely-positioned hour row and task block, and making it the scroll
// container would resolve their offsets against the visible height instead of
// the full day.
const GRID_SCROLL_CLASS = "max-h-[70vh] overflow-y-auto";
// Vertical step for due markers that share a clock time, so the second and
// third don't render on top of the first. Roughly a badge's height — three fit
// inside one 48px hour row before they'd reach the next hour.
const DUE_MARKER_ROW = 15;
// Opens on the working day instead of midnight — otherwise every visit starts
// on six empty hours and needs a scroll before anything is visible.
const DEFAULT_SCROLL_HOUR = 6;
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Past about a month the columns are too narrow to read anything in, and every
// extra day costs a full pass over the schedule. The range is clamped, and the
// UI says so rather than silently showing a shorter span than was asked for.
const RANGE_MAX_DAYS = 31;


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
  const isAdminOrManager = hasBroadAdminAccess({ role });

  const [viewMode, setViewMode] = useUrlTab<"month" | "week" | "day" | "range">("view", "month", ["month", "week", "day", "range"]);
  // A custom span, for when the work you're looking at doesn't line up with a
  // calendar week — a two-week push, or Thu-to-Tue. Defaults to the coming
  // week so the view is never empty on arrival.
  const [rangeStart, setRangeStart] = useState<string>("");
  const [rangeEnd, setRangeEnd] = useState<string>("");
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
  // Output Based tasks carry a duration but never an hour block, so they can't
  // come through scheduledForDate. Held separately, one entry per task, and
  // folded into the day's total by durationsForDate.
  const [fixedSpend, setFixedSpend] = useState<Array<{ taskId: number; amount: number; date: string }>>([]);
  const [fixedDurations, setFixedDurations] = useState<
    Array<{ taskId: number; name: string; account: string | null; category: string | null; status: string; minutes: number; date: string }>
  >([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [daySchedule, setDaySchedule] = useState<RawTask[]>([]);
  const [loadingDay, setLoadingDay] = useState(false);
  // Approved time off (va_requests type=time_off). Admin sees everyone; a VA
  // sees their own. start_time/end_time null = full day off; set = a partial
  // "short day" for that window.
  const [timeOff, setTimeOff] = useState<Array<{ user_id: string; start_date: string; end_date: string; start_time: string | null; end_time: string | null }>>([]);

  const [showFilters, setShowFilters] = useState(false);
  // Day view has two faces: the Time Block grid, and a Duration Block table that answers
  // "how long is each of these" without caring when they sit.
  const [dayTab, setDayTab] = useState<"grid" | "hours">("grid");
  // Week gets the same Grid/Hours split as Day. Separate state so switching
  // views doesn't drag one view's choice onto the other.
  const [weekTab, setWeekTab] = useState<"grid" | "hours">("grid");
  const [rangeTab, setRangeTab] = useState<"grid" | "hours">("grid");
  const [limitNotice, setLimitNotice] = useState<string | null>(null);
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

  // Fetched for everyone, not just admins. TaskEditor renders Assign To and
  // Assigned By as <select>s over this list, so an empty list gave a VA two
  // blank fields on a task that was in fact assigned — the value was set, but
  // there was no matching <option> to display it. The team picker this list
  // also feeds stays admin-only on its own condition below, so nothing new is
  // exposed. /api/team-members is session-authenticated and RLS-scoped.
  useEffect(() => {
    fetch("/api/team-members")
      .then((r) => r.json())
      .then((d) => setTeamMembers(d.members ?? []))
      .catch(() => {});
  }, []);

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
        planned_minutes: number | null;
        rate: number | string | null;
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
      // Durations are counted from the RAW rows, not the span-expanded items:
      // a task running Mon-Fri produces five DueItems, and totalling those
      // would count its estimate five times. One row, one anchor day — the day
      // it starts, or its due date when that's all it has.
      setFixedDurations(
        filtered
          .filter((t) => t.planned_minutes != null && t.planned_minutes > 0)
          .map((t) => ({
            taskId: t.id,
            name: t.task_name,
            account: t.account,
            category: t.category,
            status: t.status,
            minutes: t.planned_minutes as number,
            date: (t.start_date ?? t.due_date) as string,
          }))
      );
      // Money, for the dollar-tracked budgets below. Kept separate from
      // fixedDurations because a task counts toward the DOLLAR budget whether
      // or not anyone estimated how long it takes.
      setFixedSpend(
        filtered.map((t) => ({
          taskId: t.id,
          amount: Number(t.rate) || 0,
          date: (t.start_date ?? t.due_date) as string,
        }))
      );
    } catch {
      setFixedItems([]);
      setFixedDurations([]);
      setFixedSpend([]);
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
    // Range draws the same hour blocks Week and Day do, so it needs the same
    // fetch — without this the grid renders empty until you visit another view.
    if (viewMode === "day" || viewMode === "week" || viewMode === "range") fetchDaySchedule();
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

  // Everyone off on the selected day — rendered as a sidebar card, so it's
  // computed here rather than inline where it used to be drawn.
  const offToday = useMemo(
    () =>
      timeOff
        .filter((t) => selectedDate >= t.start_date && selectedDate <= t.end_date)
        .map((t) => {
          const m = teamMembers.find((tm) => tm.id === t.user_id);
          return { name: m?.full_name || m?.username || "Someone", label: timeOffLabel(t) };
        }),
    [timeOff, selectedDate, teamMembers]
  );

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
  // The days the custom range covers. Falls back to a week from selectedDate
  // until both ends are picked, and is capped at RANGE_MAX_DAYS — past that the
  // columns are too narrow to read and the render cost stops being worth it.
  const rangeGrid = useMemo(() => {
    const start = rangeStart || selectedDate;
    const end = rangeEnd || addDaysToDateStr(start, 6);
    if (end < start) return [start];
    const days: string[] = [];
    for (let cursor = start; cursor <= end && days.length < RANGE_MAX_DAYS; cursor = addDaysToDateStr(cursor, 1)) {
      days.push(cursor);
    }
    return days;
  }, [rangeStart, rangeEnd, selectedDate]);
  const rangeTruncated = Boolean(
    rangeStart && rangeEnd && rangeEnd >= rangeStart && rangeGrid.length === RANGE_MAX_DAYS &&
      rangeGrid[rangeGrid.length - 1] < rangeEnd
  );
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
    // Adding is blocked once the day's budget is spent. Editing an existing
    // block is deliberately still allowed — otherwise going over would trap the
    // day, with no way to shorten the very blocks that put it over.
    // Only the weekly limit stops anything. A full day still lets work in —
    // it just eats into the week, which the notice says.
    if (dateStr === selectedDate && weekBudgetSpent) {
      setLimitNotice("Weekly limit reached — request more time to continue.");
      return;
    }
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
    // These come off the grid already reanchored, so they're naive org
    // wall-clock strings ("2026-08-18T11:00:00") — slice them rather than
    // routing back through Date, which would re-interpret them in the
    // viewer's own zone and shift the prefill for anyone outside Eastern.
    setFormDate(task.start_time.slice(0, 10));
    setFormStart(task.start_time.slice(11, 16));
    setFormEnd(task.end_time.slice(11, 16));
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

  // "Remove from Calendar" used to live here — a one-click PATCH clearing
  // start_time/end_time. Removed along with its button rather than left behind
  // as dead code; clearing the hours is still reachable by unticking Add to
  // Calendar in the task editor, which at least shows what it is about to undo.
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
  // Filtered like the scheduled blocks are. This list ignored the filter bar
  // entirely, so picking Due (or any status/category) changed the grid and left
  // the sidebar untouched — and since the sidebar is where unscheduled work
  // lives, a VA filtering for what's due saw no effect anywhere.
  //
  // Date Type has to be spelled out here rather than deferred to
  // taskPassesFilters: that predicate deliberately omits it because a scheduled
  // block is inherently start-anchored, but an unscheduled task genuinely can
  // be start-anchored, due-anchored, or neither.
  const unscheduledTasks = useMemo(
    () =>
      daySchedule.filter((t) => {
        if (t.start_time && t.end_time) return false;
        if (!taskPassesFilters(t)) return false;
        if (applied.dateType === "due" && !t.due_date) return false;
        if (applied.dateType === "start" && !t.start_date) return false;
        return true;
      }),
    [daySchedule, taskPassesFilters, applied.dateType]
  );

  // What's due on the selected day, for the sidebar's Due card. Overdue work
  // rides along so a missed deadline doesn't quietly drop off the day it was
  // due and never reappear.
  const dueSidebarItems = useMemo(
    () =>
      daySchedule
        .filter(
          (t) => t.due_date && t.due_date <= selectedDate && taskPassesFilters(t) && t.status !== "completed"
        )
        .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))
        .map((t) => ({
          id: t.id,
          name: t.task_name,
          dueDate: t.due_date as string,
          dueTime: t.due_time,
          overdue: (t.due_date as string) < selectedDate,
        })),
    [daySchedule, selectedDate, taskPassesFilters]
  );
  const scheduledForDate = useCallback(
    (dateStr: string) =>
      scheduledTasks
        .filter((t) => {
          const anchorDay = orgDateOf(t.start_time as string);
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
          const anchorDay = orgDateOf(t.start_time as string);
          if (t.start_date === anchorDay && t.end_date && t.end_date !== t.start_date) {
            return isDateInSpan(dateStr, t.start_date, t.end_date);
          }
          return anchorDay === dateStr;
        })
        .map((t) => reanchorToDate(t, dateStr))
        .sort((a, b) => new Date(a.start_time as string).getTime() - new Date(b.start_time as string).getTime()),
    [compareSchedules, taskPassesFilters]
  );
  const minutesOf = (t: RawTask) =>
    (new Date(t.end_time!).getTime() - new Date(t.start_time!).getTime()) / 60000;

  function formatDuration(totalMinutes: number): string {
    const hrs = Math.floor(totalMinutes / 60);
    const mins = Math.round(totalMinutes % 60);
    if (hrs === 0) return `${mins}m`;
    return `${hrs}h${mins > 0 ? ` ${mins}m` : ""}`;
  }

  // The Duration Block tab: the same day's work as the grid, but as a list of how long
  // each task takes rather than where it sits. Sorted longest first — the point
  // of the view is how the day is spent, not the order it happens in.
  // Two sources, never both for one task: a block contributes its own length,
  // and a task with no block contributes planned_minutes. The editor clears one
  // when you set the other, so nothing is counted twice.
  // Date-parameterised so Week and Month can ask the same question per day that
  // the Day view asks about selectedDate — the Duration Block tab, the day badges and the
  // budget all read from this one place rather than each re-deriving a total.
  const durationsForDate = useCallback(
    (dateStr: string) => {
      const blocked = scheduledForDate(dateStr).map((t) => ({
        id: t.id,
        name: t.task_name,
        account: t.account,
        category: t.category,
        minutes: minutesOf(t),
        timed: true,
      }));
      const blockedIds = new Set(blocked.map((r) => r.id));
      const untimed = daySchedule
        .filter(
          (t) =>
            !blockedIds.has(t.id) &&
            t.planned_minutes != null &&
            t.planned_minutes > 0 &&
            (t.start_date === dateStr || t.due_date === dateStr) &&
            taskPassesFilters(t)
        )
        .map((t) => ({
          id: t.id,
          name: t.task_name,
          account: t.account,
          category: t.category,
          minutes: t.planned_minutes as number,
          timed: false,
        }));
      // Output Based work on this day. Same applied filters the due dots use —
      // project and recurring don't apply to fixed-pay rows, so only source,
      // status and category can exclude one.
      const fixed = fixedDurations
        .filter((f) => {
          if (f.date !== dateStr) return false;
          if (applied.source.size > 0 && !applied.source.has("fixed")) return false;
          if (applied.status.size > 0 && !applied.status.has(f.status)) return false;
          if (applied.category.size > 0 && !(f.category && applied.category.has(f.category))) return false;
          return true;
        })
        .map((f) => ({
          id: f.taskId,
          name: f.name,
          account: f.account,
          category: f.category,
          minutes: f.minutes,
          timed: false,
          source: "fixed" as const,
        }));

      const rows = [
        ...blocked.map((r) => ({ ...r, source: "assigned" as const })),
        ...untimed.map((r) => ({ ...r, source: "assigned" as const })),
        ...fixed,
      ].sort((a, b) => b.minutes - a.minutes);
      return { rows, totalMinutes: rows.reduce((sum, r) => sum + r.minutes, 0) };
    },
    [scheduledForDate, daySchedule, taskPassesFilters, fixedDurations, applied]
  );

  const dayDurations = useMemo(() => durationsForDate(selectedDate), [durationsForDate, selectedDate]);

  // Which currency this person's budget is in. Output Based VAs are paid per
  // output, so their caps are DOLLARS (see lib/budget); everyone else is capped
  // in hours. The calendar used to assume hours for everyone, so a Per Task VA
  // with a $250 monthly cap read "250h left of 250h" — a number that looked
  // like a full month of free time.
  const budgetUnit: "hours" | "dollars" =
    vaBudgetType(teamMembers.find((m) => m.id === dayUserId) ?? {}) === "output_based" ? "dollars" : "hours";

  // Amount used in a period, in whichever unit applies: minutes booked for
  // hours-tracked VAs, task value for dollar-tracked ones.
  const usedInPeriod = useCallback(
    (dates: string[]) =>
      budgetUnit === "dollars"
        ? fixedSpend.filter((f) => dates.includes(f.date)).reduce((sum, f) => sum + f.amount, 0)
        : dates.reduce((sum, d) => sum + durationsForDate(d).totalMinutes, 0),
    [budgetUnit, fixedSpend, durationsForDate]
  );

  // A limit is stored as hours or dollars to match; both render through here.
  const formatBudgetAmount = useCallback(
    (value: number) => (budgetUnit === "dollars" ? `${Math.round(value)}` : formatDuration(value)),
    [budgetUnit]
  );
  const limitToUnit = useCallback(
    (limit: number) => (budgetUnit === "dollars" ? limit : Math.round(limit * 60)),
    [budgetUnit]
  );

  // The day's budget comes from the VA's shift in Team Management — shift_hours,
  // or the shift_start/shift_end span when that's how it's set. The badge counts
  // down from it as blocks are added, so the question it answers is "how much is
  // left to give" rather than "how much is on the calendar".
  //
  // Display only. It doesn't stop anyone booking past the budget; going over
  // just turns the badge terracotta.
  //
  // The shift itself doesn't vary by date, so it's resolved once and the
  // per-date part is just that day's total subtracted from it. Week and Month
  // ask this for every cell they draw, so keeping the profile lookup out of
  // the per-date call matters.
  const shiftBudgetMinutes = useMemo(() => {
    const member = teamMembers.find((m) => m.id === dayUserId);
    const budgetHours = member
      ? shiftHoursFromProfile({
          shift_hours: member.shift_hours ?? null,
          shift_start: member.shift_start ?? null,
          shift_end: member.shift_end ?? null,
        })
      : null;
    return budgetHours == null ? null : Math.round(budgetHours * 60);
  }, [teamMembers, dayUserId]);

  // The days this VA is scheduled for, from Team Management. A day off is not
  // blocked — it simply carries no daily budget of its own, so whatever is
  // booked there shows as coming out of the week (which is the only hard stop).
  const workDays = useMemo(
    () => workDaysFromProfile(teamMembers.find((m) => m.id === dayUserId)),
    [teamMembers, dayUserId]
  );

  const isOffDay = useCallback(
    (dateStr: string) => !workDays.includes(weekdayOfOrgDate(dateStr)),
    [workDays]
  );

  const budgetMinutesForDate = useCallback(
    (dateStr: string) => (shiftBudgetMinutes == null ? null : isOffDay(dateStr) ? 0 : shiftBudgetMinutes),
    [shiftBudgetMinutes, isOffDay]
  );

  const budgetForDate = useCallback(
    (dateStr: string) => {
      const budgetMinutes = budgetMinutesForDate(dateStr);
      if (budgetMinutes == null) return null;
      const usedMinutes = durationsForDate(dateStr).totalMinutes;
      return {
        budgetMinutes,
        usedMinutes,
        remainingMinutes: budgetMinutes - usedMinutes,
      };
    },
    [budgetMinutesForDate, durationsForDate]
  );

  const dayBudget = useMemo(() => {
    const budgetMinutes = budgetMinutesForDate(selectedDate);
    return budgetMinutes == null
      ? null
      : {
          budgetMinutes,
          usedMinutes: dayDurations.totalMinutes,
          remainingMinutes: budgetMinutes - dayDurations.totalMinutes,
        };
  }, [budgetMinutesForDate, selectedDate, dayDurations]);

  const selectedIsOffDay = useMemo(() => isOffDay(selectedDate), [isOffDay, selectedDate]);

  // The Day view's badge, shrunk to fit a week column or a month cell. Says
  // what's LEFT rather than what's booked, matching dayTotalLabel — the whole
  // point of the shift budget is how much is still available to give.
  //
  // `whenEmpty` is what separates the two callers: a week has seven columns, so
  // showing full capacity on an untouched day is useful; a month grid has
  // forty-two, and badging every empty one is just noise.
  const budgetBadgeFor = useCallback(
    (dateStr: string, whenEmpty: "show" | "hide") => {
      const usedMinutes = durationsForDate(dateStr).totalMinutes;
      if (shiftBudgetMinutes == null) {
        return usedMinutes > 0 ? { text: formatDuration(usedMinutes), over: false, warn: false } : null;
      }
      if (usedMinutes === 0 && whenEmpty === "hide") return null;
      // A day off has no budget to be over, so it never reads as overspent —
      // what's booked there is drawn from the week instead.
      if (isOffDay(dateStr)) {
        return usedMinutes > 0
          ? { text: `${formatDuration(usedMinutes)} · off`, over: false, warn: false, off: true }
          : { text: "Day off", over: false, warn: false, off: true };
      }
      const remaining = shiftBudgetMinutes - usedMinutes;
      if (remaining < 0) return { text: `${formatDuration(-remaining)} over`, over: true, warn: false };
      const warn =
        shiftBudgetMinutes > 0 && usedMinutes / shiftBudgetMinutes >= BUDGET_WARN_THRESHOLD;
      return { text: `${formatDuration(remaining)} left`, over: false, warn };
    },
    [durationsForDate, shiftBudgetMinutes, isOffDay]
  );

  const budgetBadgeClass = (badge: { over: boolean; warn: boolean; off?: boolean }) =>
    badge.off
      ? "bg-stone/10 text-stone border-stone/20"
      : badge.over
      ? "bg-terracotta-soft text-terracotta border-terracotta/30"
      : badge.warn
      ? "bg-amber-soft text-amber border-amber/30"
      : "bg-sage-soft text-sage border-sage/20";

  // Spent when nothing is left. Warned at BUDGET_WARN_THRESHOLD of the budget,
  // the same 90% the rest of the app warns at, so the day says "nearly full"
  // before it says "full".
  const dayBudgetSpent = Boolean(dayBudget && dayBudget.remainingMinutes <= 0);

  // Stale the moment the day or the person changes — the limit it described
  // belonged to a different day's budget.
  useEffect(() => {
    setLimitNotice(null);
  }, [selectedDate, dayUserId]);
  const dayBudgetWarning = Boolean(
    dayBudget &&
      !dayBudgetSpent &&
      dayBudget.budgetMinutes > 0 &&
      (dayBudget.budgetMinutes - dayBudget.remainingMinutes) / dayBudget.budgetMinutes >= BUDGET_WARN_THRESHOLD
  );

  // Two budgets, two different consequences. Filling the day is a warning —
  // the work still goes in, it just starts drawing on the week. Filling the
  // week is the actual stop, because there's nothing left to draw on: more
  // time has to be granted before anything else gets booked.
  const weekDates = useMemo(() => {
    const back = new Date(`${selectedDate}T00:00:00`).getDay();
    const start = addDaysToDateStr(selectedDate, -back);
    return Array.from({ length: 7 }, (_, i) => addDaysToDateStr(start, i));
  }, [selectedDate]);

  const weekBudget = useMemo(() => {
    const member = teamMembers.find((m) => m.id === dayUserId);
    const limit = member?.weekly_budget_limit ?? null;
    if (limit == null || limit <= 0) return null;
    // Counted through usedInPeriod, which picks the unit. For hours-tracked
    // VAs that runs through durationsForDate — this used to sum only the hour
    // BLOCKS, so duration-only work drew nothing against the weekly limit even
    // though it filled the day badge.
    const usedMinutes = usedInPeriod(weekDates);
    const budgetMinutes = limitToUnit(limit);
    return { budgetMinutes, usedMinutes, remainingMinutes: budgetMinutes - usedMinutes };
  }, [teamMembers, dayUserId, weekDates, usedInPeriod, limitToUnit]);

  const weekBudgetSpent = Boolean(weekBudget && weekBudget.remainingMinutes <= 0);

  // The third period. monthly_budget_limit is already on the profile and is
  // read as HOURS for time-based VAs (see lib/budget) — the same unit
  // weekly_budget_limit uses here.
  //
  // Counted over the days that actually belong to the month, not the 42-cell
  // grid: that grid pads with the tail of the previous month and the head of
  // the next, and totalling those would bill this month for other months' work.
  const monthBudget = useMemo(() => {
    const member = teamMembers.find((m) => m.id === dayUserId);
    const limit = member?.monthly_budget_limit ?? null;
    if (limit == null || limit <= 0) return null;
    const usedMinutes = usedInPeriod(monthGrid.filter((d) => Number(d.slice(5, 7)) - 1 === monthMonth));
    const budgetMinutes = limitToUnit(limit);
    return { budgetMinutes, usedMinutes, remainingMinutes: budgetMinutes - usedMinutes };
  }, [teamMembers, dayUserId, monthGrid, monthMonth, usedInPeriod, limitToUnit]);

  const dayTotalLabel = useMemo(() => {
    if (selectedIsOffDay) return `${formatDuration(dayDurations.totalMinutes)} blocked · day off`;
    if (!dayBudget) return `${formatDuration(dayDurations.totalMinutes)} blocked`;
    if (dayBudget.remainingMinutes < 0) {
      return `${formatDuration(-dayBudget.remainingMinutes)} over ${formatDuration(dayBudget.budgetMinutes)}`;
    }
    return `${formatDuration(dayBudget.remainingMinutes)} left of ${formatDuration(dayBudget.budgetMinutes)}`;
  }, [dayBudget, dayDurations, selectedIsOffDay]);
  // Exclude items already rendered as an hour block for this date — once a task
  // has scheduled hours, it shouldn't also sit up top as an unscheduled-looking badge.
  //
  // A due TIME is the exception. "Runs 8-9" and "is due at 9" are different
  // facts, and dropping the second because the first exists took the deadline
  // marker off the day entirely for any task that also had hours booked. The
  // redundant case is the start badge, which is what this filter is actually
  // for; a timed deadline still earns its marker on the grid.
  const dueTodayItems = useMemo(() => {
    const scheduledIdsToday = new Set(scheduledForDate(selectedDate).map((t) => t.id));
    return (dueItemsByDate[selectedDate] ?? []).filter((item) => {
      if (item.source !== "assigned") return true;
      if (item.dateType === "due" && item.dueTime) return true;
      return !scheduledIdsToday.has(item.taskId);
    });
  }, [dueItemsByDate, selectedDate, scheduledForDate]);
  const hours = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => DAY_START_HOUR + i);

  // Ref callback rather than an effect: it fires as each grid mounts, which is
  // exactly when the scroll position needs setting, and there are three grids
  // (week, compare, day) that never coexist.
  const openAtWorkingHours = useCallback((el: HTMLDivElement | null) => {
    if (el) el.scrollTop = (DEFAULT_SCROLL_HOUR - DAY_START_HOUR) * HOUR_HEIGHT;
  }, []);

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
  // conversion needed) — position it on the same grid the hour blocks use.
  //
  // Clamped to the grid's full span, which is now the whole day, so no real
  // clock time gets pinned any more. The bound used to stop at the START of the
  // last hour row, which silently parked anything in that final hour on the
  // hour line instead of its own minute — 23:30 drew at 23:00.
  function dueTimePosition(dueTime: string): number {
    const [h, m] = dueTime.split(":").map(Number);
    const gridMinutes = (DAY_END_HOUR - DAY_START_HOUR + 1) * 60;
    const minutes = Math.max(0, Math.min(gridMinutes, (h - DAY_START_HOUR) * 60 + (m || 0)));
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


  // The time grid, over ANY list of days. Week passes its seven; the custom
  // range passes however many were picked. Extracted rather than copied so the
  // two can't drift -- the block layout, the add-by-click and the overlap
  // packing are fiddly enough that a second copy would rot.
  const COLS = (n: number) => `48px repeat(${n}, minmax(96px, 1fr))`;
  const renderTimeGrid = (dates: string[]) => (
              <div className="overflow-x-auto">
                <div className="grid" style={{ minWidth: Math.max(760, dates.length * 110), gridTemplateColumns: COLS(dates.length) }}>
                  <div />
                  {dates.map((dateStr) => {
                    const { weekday, day } = formatDayShort(dateStr);
                    const isToday = dateStr === todayStr;
                    const badge = budgetBadgeFor(dateStr, "show");
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
                        {badge && (
                          <span className={`rounded-full border px-1.5 text-[9px] font-semibold leading-tight ${budgetBadgeClass(badge)}`}>
                            {badge.text}
                          </span>
                        )}
                      </button>
                    );
                  })}
  
                  <div ref={openAtWorkingHours} className={GRID_SCROLL_CLASS} style={{ gridColumn: `span ${dates.length + 1}` }}>
                  <div className="relative grid" style={{ height: hours.length * HOUR_HEIGHT, gridTemplateColumns: COLS(dates.length) }}>
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
                    {dates.map((dateStr) => (
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
              </div>
  );

  // The same work the Time Block grid shows, as lengths rather than positions.
  //
  // Laid out in the SAME shape as that grid: one column per day, not one row.
  // It was a stacked list, which meant switching tabs re-oriented the whole week
  // and you had to re-find the day you were looking at. Columns keep Monday
  // where Monday was.
  //
  // Empty days keep their column. Dropping them made a span look shorter than
  // it is and hid the thing this view is scanned for — which days are free.
  //
  // Shared by Week and Range, so the two can't drift and Range gets the tab at
  // all; it was only ever wired into Week.
  const renderDurationList = (dates: string[], totalLabel: string) => (
    <div className="rounded-lg border border-sand overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-sand bg-parchment px-3 py-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-espresso">{totalLabel}</span>
        <span className="text-[13px] font-bold text-espresso">
          {formatDuration(dates.reduce((sum, d) => sum + durationsForDate(d).totalMinutes, 0))}
        </span>
      </div>
      <div className="overflow-x-auto">
        <div
          className="grid divide-x divide-sand"
          style={{
            minWidth: Math.max(760, dates.length * 130),
            gridTemplateColumns: `repeat(${dates.length}, minmax(120px, 1fr))`,
          }}
        >
          {dates.map((dateStr) => {
            const { rows, totalMinutes } = durationsForDate(dateStr);
            const { weekday, day } = formatDayShort(dateStr);
            const isToday = dateStr === todayStr;
            const badge = budgetBadgeFor(dateStr, "hide");
            return (
              <div key={dateStr} className="flex min-w-0 flex-col">
                <button
                  type="button"
                  onClick={() => openDay(dateStr)}
                  className={`flex flex-col items-center gap-0.5 border-b border-sand px-1 py-1.5 transition-colors hover:bg-cream cursor-pointer ${
                    isToday ? "bg-terracotta-soft" : "bg-cream/50"
                  }`}
                >
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-walnut">{weekday}</span>
                  <span className={`text-[13px] font-bold ${isToday ? "text-terracotta" : "text-espresso"}`}>{day}</span>
                  <span className={`text-[10px] font-semibold ${rows.length === 0 ? "text-stone" : "text-espresso"}`}>
                    {rows.length === 0 ? "—" : formatDuration(totalMinutes)}
                  </span>
                  {badge && (
                    <span className={`rounded-full border px-1.5 text-[9px] font-semibold leading-tight ${budgetBadgeClass(badge)}`}>
                      {badge.text}
                    </span>
                  )}
                </button>
                <div className="min-h-[60px] space-y-1 p-1.5">
                  {rows.length === 0 ? (
                    <p className="pt-2 text-center text-[10px] text-stone/70">Nothing blocked</p>
                  ) : (
                    rows.map((row) => (
                      <div
                        key={`${row.source}-${row.id}`}
                        title={`${row.name}${row.account ? " — " + row.account : ""} · ${formatDuration(row.minutes)}`}
                        className={`rounded-md border px-1.5 py-1 shadow-sm ${categoryBlockClasses(row.category)}`}
                      >
                        <p className="truncate text-[11px] font-semibold leading-tight">{row.name}</p>
                        <p className="truncate text-[9px] opacity-80">
                          {formatDuration(row.minutes)}
                          {row.source === "fixed"
                            ? " · Output Based"
                            : !row.timed
                            ? " · no set time"
                            : ""}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

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
          <button
            type="button"
            onClick={() => {
              // Seed the pickers from wherever you already are, so switching in
              // shows the week around the current date rather than nothing.
              if (!rangeStart) setRangeStart(selectedDate);
              if (!rangeEnd) setRangeEnd(addDaysToDateStr(rangeStart || selectedDate, 6));
              setViewMode("range");
            }}
            className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
              viewMode === "range" ? "bg-sage text-white" : "bg-stone/10 text-stone hover:bg-stone/20"
            }`}
          >
            Range
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

          {/* Only in Range view — two more date boxes sitting next to "jump to
              date" the rest of the time would just be three ambiguous inputs. */}
          {viewMode === "range" && (
            <span className="ml-1 flex items-center gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-walnut">From</span>
              <input
                type="date"
                value={rangeStart}
                max={rangeEnd || undefined}
                onChange={(e) => setRangeStart(e.target.value)}
                className="rounded-lg border border-sand px-2 py-1 text-[11px] text-espresso outline-none bg-white"
              />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-walnut">To</span>
              <input
                type="date"
                value={rangeEnd}
                min={rangeStart || undefined}
                onChange={(e) => setRangeEnd(e.target.value)}
                className="rounded-lg border border-sand px-2 py-1 text-[11px] text-espresso outline-none bg-white"
              />
            </span>
          )}
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

      {/* Category legend. The grid, the month dots and the Hours lists are all
          colour-coded, but nothing said what the colours meant — sits above the
          calendar box so it reads once for whichever view is open. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-sand bg-white px-3 py-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-walnut">Categories</span>
        {CATEGORY_OPTIONS.map((c) => (
          <span key={c} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${categoryDotClass(c)}`} />
            <span className="text-[11px] text-espresso">{c}</span>
          </span>
        ))}
        <span className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-stone" />
            <span className="text-[10px] text-stone">Start date</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rotate-45 rounded-sm bg-stone" />
            <span className="text-[10px] text-stone">Due date</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-4 rounded-sm bg-stone" />
            <span className="text-[10px] text-stone">Spans days</span>
          </span>
        </span>
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
            <div className="flex flex-col items-center gap-0.5">
              <h2 className="text-sm font-bold text-espresso">{monthLabel}</h2>
              {monthBudget && (
                <span
                  className={`text-[11px] font-bold px-2.5 py-[2px] rounded-full border ${
                    monthBudget.remainingMinutes < 0
                      ? "bg-terracotta-soft text-terracotta border-terracotta/30"
                      : "bg-amber-soft text-amber border-amber/30"
                  }`}
                >
                  {monthBudget.remainingMinutes < 0
                    ? `${formatBudgetAmount(-monthBudget.remainingMinutes)} over ${formatBudgetAmount(monthBudget.budgetMinutes)} this month`
                    : `${formatBudgetAmount(monthBudget.remainingMinutes)} left of ${formatBudgetAmount(monthBudget.budgetMinutes)} this month`}
                </span>
              )}
            </div>
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
                  {/* Only on days with something booked — badging all 42 cells
                      would bury the dots this grid exists to show. Days outside
                      the current month stay bare for the same reason. */}
                  {isCurrentMonth && (() => {
                    const badge = budgetBadgeFor(dateStr, "hide");
                    if (!badge) return null;
                    return (
                      <div className={`mt-0.5 rounded-full border px-1 text-center text-[8px] font-semibold leading-tight ${budgetBadgeClass(badge)}`}>
                        {badge.text}
                      </div>
                    );
                  })()}
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
          {/* Same control the Day view carries, in the same place — it switches
              what the whole panel shows, so it sits above the date rather than
              under it. */}
          <div className="mb-3 mx-auto flex rounded-lg border border-sand overflow-hidden text-[12px] font-semibold w-fit">
            {(["grid", "hours"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setWeekTab(tab)}
                className={`px-4 py-1.5 transition-colors ${
                  weekTab === tab ? "bg-terracotta text-white" : "bg-white text-stone hover:bg-cream"
                }`}
              >
                {tab === "grid" ? "Time Block" : "Duration Block"}
              </button>
            ))}
          </div>
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={goToPrevWeek}
              className="px-2 py-1 rounded-md text-bark hover:bg-parchment hover:text-espresso text-sm"
            >
              &larr;
            </button>
            <div className="flex flex-col items-center gap-0.5">
              <h2 className="text-sm font-bold text-espresso">{weekLabel}</h2>
              {/* The weekly limit is the one that actually stops booking, so it
                  gets the header slot the day total holds in the Day view. */}
              {weekBudget && (
                <span
                  className={`text-[11px] font-bold px-2.5 py-[2px] rounded-full border ${
                    weekBudget.remainingMinutes < 0
                      ? "bg-terracotta-soft text-terracotta border-terracotta/30"
                      : "bg-amber-soft text-amber border-amber/30"
                  }`}
                >
                  {weekBudget.remainingMinutes < 0
                    ? `${formatBudgetAmount(-weekBudget.remainingMinutes)} over ${formatBudgetAmount(weekBudget.budgetMinutes)} this week`
                    : `${formatBudgetAmount(weekBudget.remainingMinutes)} left of ${formatBudgetAmount(weekBudget.budgetMinutes)} this week`}
                </span>
              )}
            </div>
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
          ) : weekTab === "hours" ? (
            renderDurationList(weekGrid, "Week total")
          ) : (
            renderTimeGrid(weekGrid)
          )}
        </div>
      )}

      {viewMode === "range" && (
        <div className="rounded-xl border border-sand bg-white p-4">
          <div className="mb-3 mx-auto flex rounded-lg border border-sand overflow-hidden text-[12px] font-semibold w-fit">
            {(["grid", "hours"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setRangeTab(tab)}
                className={`px-4 py-1.5 transition-colors ${
                  rangeTab === tab ? "bg-terracotta text-white" : "bg-white text-stone hover:bg-cream"
                }`}
              >
                {tab === "grid" ? "Time Block" : "Duration Block"}
              </button>
            ))}
          </div>
          <div className="mb-3 flex flex-col items-center gap-0.5">
            <h2 className="text-sm font-bold text-espresso">
              {formatDayLabel(rangeGrid[0])} – {formatDayLabel(rangeGrid[rangeGrid.length - 1])}
            </h2>
            <span className="text-[11px] text-stone">
              {rangeGrid.length} day{rangeGrid.length === 1 ? "" : "s"} ·{" "}
              {formatDuration(rangeGrid.reduce((sum, d) => sum + durationsForDate(d).totalMinutes, 0))} blocked
            </span>
            {rangeTruncated && (
              <span className="text-[11px] text-terracotta">
                Showing the first {RANGE_MAX_DAYS} days — narrow the range to see the rest.
              </span>
            )}
          </div>

          {scope === "__all__" && isAdminOrManager && (
            <p className="mb-3 text-[11px] text-stone">
              Agency-wide view can&apos;t render every teammate&apos;s hour blocks at once — showing your own. Pick a teammate above to view or add blocks to theirs.
            </p>
          )}

          {loadingDay ? (
            <div className="py-8 text-center text-xs text-stone">Loading…</div>
          ) : rangeTab === "hours" ? (
            renderDurationList(rangeGrid, "Range total")
          ) : (
            renderTimeGrid(rangeGrid)
          )}
        </div>
      )}

      {/* Who's off used to be a full-width banner above the whole day — loud,
          and the first thing you read on a day it rarely changes anything about.
          It's a small card in the sidebar now, next to Unscheduled. */}

      {viewMode === "day" && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4">
          {/* Hour grid */}
          <div className="rounded-xl border border-sand bg-white p-4">
            {/* Above the date, not tucked under it — this switches what the whole
                panel shows, so it reads as a control for the panel rather than a
                detail of the day. Hidden in the multi-VA compare view, which is a
                different shape with no single day to total. */}
            {compareVaIds.length < 2 && (
              <div className="mb-3 mx-auto flex rounded-lg border border-sand overflow-hidden text-[12px] font-semibold w-fit">
                {(["grid", "hours"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setDayTab(tab)}
                    className={`px-4 py-1.5 transition-colors ${
                      dayTab === tab ? "bg-terracotta text-white" : "bg-white text-stone hover:bg-cream"
                    }`}
                  >
                    {tab === "grid" ? "Time Block" : "Duration Block"}
                  </button>
                ))}
              </div>
            )}
            {/* Sits above the grid so the reason a click did nothing is next to
                the thing that was clicked. */}
            {(limitNotice || weekBudgetSpent || selectedIsOffDay || dayBudgetSpent || dayBudgetWarning) && (
              <div
                className={`mb-3 rounded-lg border px-3 py-2 text-[12px] font-semibold ${
                  limitNotice || weekBudgetSpent
                    ? "border-terracotta/30 bg-terracotta-soft text-terracotta"
                    : "border-amber/30 bg-amber-soft text-amber"
                }`}
              >
                {limitNotice ??
                  (weekBudgetSpent
                    ? "Weekly limit reached — request more time to continue."
                    : selectedIsOffDay
                    ? "Not a scheduled work day — anything booked here comes out of the weekly budget."
                    : dayBudgetSpent
                    ? "Daily limit reached — more time here comes out of the weekly budget."
                    : `Nearly full — ${formatDuration(dayBudget!.remainingMinutes)} left today.`)}
              </div>
            )}
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
                <span
                  className={`text-[13px] font-bold px-3 py-[3px] rounded-full border ${
                    selectedIsOffDay
                      ? "bg-stone/10 text-stone border-stone/20"
                      : dayBudget && dayBudget.remainingMinutes < 0
                      ? "bg-terracotta-soft text-terracotta border-terracotta/30"
                      : "bg-amber-soft text-amber border-amber/30"
                  }`}
                >
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

            {/* The strip of Due/Starts pills that used to sit here is gone. A
                deadline with a time belongs on the grid at that time — it's
                rendered as a due marker below — and everything without hours is
                already listed in the Unscheduled sidebar, which is where work
                waiting to be scheduled belongs. Having both meant a timed
                deadline appeared twice, once up here and once on the grid. */}

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
                <div ref={openAtWorkingHours} className={GRID_SCROLL_CLASS}>
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
              </div>
            ) : dayTab === "hours" ? (
              <div className="rounded-lg border border-sand overflow-hidden">
                <div className="flex items-center justify-between gap-2 border-b border-sand bg-parchment px-3 py-2">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-espresso">Total</span>
                  <span className="text-[13px] font-bold text-espresso">
                    {formatDuration(dayDurations.totalMinutes)}
                  </span>
                </div>
                {dayDurations.rows.length === 0 ? (
                  <p className="px-3 py-6 text-center text-[12px] text-stone">
                    Nothing blocked on this day yet.
                  </p>
                ) : (
                  <div className="space-y-1.5 p-2">
                    {dayDurations.rows.map((row) => (
                      <button
                        // assigned_tasks and fixed_pay_tasks number their rows
                        // independently, so the id alone isn't unique here.
                        key={`${row.source}-${row.id}`}
                        type="button"
                        disabled={row.source === "fixed"}
                        onClick={() => {
                          // Timed rows open through the block path (it needs the
                          // re-anchored copy); untimed ones have no block, so
                          // they open the scheduling form on this day instead.
                          const blocked = scheduledForDate(selectedDate).find((t) => t.id === row.id);
                          if (blocked) {
                            void openEditBlock(blocked);
                            return;
                          }
                          const task = daySchedule.find((t) => t.id === row.id);
                          if (task) void openScheduleExisting(task, selectedDate);
                        }}
                        className={`flex w-full items-center justify-between gap-3 rounded-md border px-2 py-1.5 text-left shadow-sm transition-opacity ${categoryBlockClasses(row.category)} ${
                          row.source === "fixed" ? "cursor-default" : "hover:opacity-90 cursor-pointer"
                        }`}
                      >
                        <span className="min-w-0">
                          {/* Styled as the grid block itself, not a dot beside
                              neutral text — the same task reads the same way in
                              either view. Colours come from categoryBlockClasses,
                              so the secondary line rides the block's own text
                              colour at reduced opacity rather than fighting it. */}
                          <span className="block truncate text-[13px] font-semibold">{row.name}</span>
                          <span className="block truncate text-[10px] opacity-80">
                            {row.account}
                            {/* Output Based rows count toward the total but have
                                no hour block to open, so they say what they are
                                rather than offering an edit that goes nowhere. */}
                            {row.source === "fixed"
                              ? row.account
                                ? " · Output Based"
                                : "Output Based"
                              : !row.timed && (row.account ? " · no set time" : "No set time")}
                          </span>
                        </span>
                        <span className="shrink-0 text-[12px] font-semibold">
                          {formatDuration(row.minutes)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div ref={openAtWorkingHours} className={GRID_SCROLL_CLASS}>
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
                    // Due-time markers are a separate list from these work-span
                    // blocks (a different task can be due at a clock-time that
                    // falls inside another task's scheduled hours) — computed
                    // once here so both this block map and the due-marker map
                    // below can tell when the two would collide.
                    const dueMarkerTops = dueTodayItems
                      .filter((item) => item.dateType === "due" && item.dueTime)
                      .map((item) => dueTimePosition(item.dueTime!));
                    const taskBlocks = dayTasks.map((task) => {
                      const { top, height } = blockPosition(task);
                      // Due-date-driven blocks render fully opaque; start-date-driven
                      // blocks (the default) stay at 70% opacity.
                      const isDueBlock = selectedDate === task.due_date && selectedDate !== task.start_date;
                      const { col, cols } = overlapLayout.get(task.id) ?? { col: 0, cols: 1 };
                      const label = spanLabel(task, selectedDate);
                      // Reserve room on the right for a due-time badge when one
                      // falls inside this block's time span, so the two sit side
                      // by side instead of the badge floating on top of the block.
                      // Inclusive of the block's end: a task running 8-9 and due
                      // at 9 puts the marker exactly on the bottom edge, and the
                      // marker is drawn 7px above its own position, so it lands
                      // on the block. Treat the edge as a collision and dock it.
                      const collidesWithDueMarker = dueMarkerTops.some((markerTop) => markerTop >= top && markerTop <= top + height);
                      const dueGutter = collidesWithDueMarker ? 96 : 0;
                      return (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => openEditBlock(task)}
                          className={`pointer-events-auto absolute overflow-hidden rounded-md border px-2 py-1 text-left shadow-sm hover:opacity-90 cursor-pointer ${categoryBlockClasses(task.category, isDueBlock)}`}
                          style={{
                            top,
                            height,
                            left: `calc(4rem + (100% - 4rem - 0.5rem - ${dueGutter}px) * ${col} / ${cols})`,
                            width: `calc((100% - 4rem - 0.5rem - ${dueGutter}px) / ${cols} - 4px)`,
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

                    // Due Time markers — a due date+time isn't a work span, so it
                    // doesn't get an hour block; it gets a thin line at its clock
                    // time instead, positioned on the same grid the blocks use.
                    // When that clock-time falls inside another task's scheduled
                    // hours, it docks as a compact badge in that block's reserved
                    // right-hand gutter instead of crossing over it.
                    // Markers sharing a clock time used to render at the same
                    // top with the same docked width, so they sat exactly on
                    // top of each other and only the last one painted — three
                    // tasks due at 3pm looked like one, and the other two read
                    // as missing due dates. Task blocks solve their own version
                    // of this with col/cols; markers had no equivalent, so each
                    // one after the first is offset down a row here. It nudges
                    // the drawn position only; the time itself is untouched.
                    const timedDueItems = dueTodayItems.filter(
                      (item) => item.dateType === "due" && item.dueTime
                    );
                    const stackIndexByItem = new Map<string, number>();
                    const takenAtTop = new Map<number, number>();
                    for (const item of timedDueItems) {
                      const markerTop = dueTimePosition(item.dueTime!);
                      const taken = takenAtTop.get(markerTop) ?? 0;
                      stackIndexByItem.set(item.id, taken);
                      takenAtTop.set(markerTop, taken + 1);
                    }
                    const dueMarkers = timedDueItems
                      .map((item) => {
                        const scheduleTarget = item.source === "assigned"
                          ? daySchedule.find((t) => t.id === item.taskId) ?? assignedTasksAll.find((t) => t.id === item.taskId)
                          : undefined;
                        const pillClasses = categoryBlockClasses(item.category, true);
                        const top = dueTimePosition(item.dueTime!);
                        const collidesWithTask = dayTasks.some((task) => {
                          const pos = blockPosition(task);
                          // Same inclusive end as the block side above — the two
                          // must agree, or the block reserves a gutter the marker
                          // doesn't dock into, or vice versa.
                          return top >= pos.top && top <= pos.top + pos.height;
                        });
                        return (
                          <div
                            key={`due-marker-${item.id}`}
                            className={`pointer-events-none absolute flex items-center gap-1.5 ${collidesWithTask ? "right-2 w-[92px] justify-end" : "left-16 right-2"}`}
                            style={{ top: top - 7 + (stackIndexByItem.get(item.id) ?? 0) * DUE_MARKER_ROW }}
                          >
                            {!collidesWithTask && <span className="h-[2px] w-3 shrink-0 rounded bg-stone/60" />}
                            <button
                              type="button"
                              disabled={!scheduleTarget}
                              onClick={() => scheduleTarget && openScheduleExisting(scheduleTarget, selectedDate)}
                              title={`Due ${formatDueTime(item.dueTime!)} — ${item.title}`}
                              className={`pointer-events-auto truncate ${collidesWithTask ? "max-w-full" : "max-w-[70%]"} text-[9px] font-bold px-1.5 py-[1px] rounded-full border shadow-sm ${scheduleTarget ? "cursor-pointer hover:opacity-80" : "cursor-default"} ${pillClasses}`}
                            >
                              Due {formatDueTime(item.dueTime!)} · {item.title}
                            </button>
                          </div>
                        );
                      });

                    return (
                      <>
                        {taskBlocks}
                        {dueMarkers}
                      </>
                    );
                  })()}
                </div>
              </div>
              </div>
            )}
          </div>

          <div className="space-y-4 h-fit">
          {/* Adding a block is about the DAY, not about the Unscheduled list —
              but it used to sit as the last thing inside that card, which read
              as an action on unscheduled items and left "Nothing unscheduled"
              sitting directly above a button. At the head of the column it's
              the first thing in reach and unambiguous about what it does. */}
          <button
            type="button"
            onClick={() => openAddBlock(9)}
            disabled={weekBudgetSpent}
            title={weekBudgetSpent ? "Weekly limit reached — request more time to continue" : undefined}
            className="w-full px-3 py-2 rounded-xl text-[12px] font-semibold bg-sage text-white hover:bg-sage/90 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-sage"
          >
            {weekBudgetSpent ? "Weekly limit reached" : "+ Add Hour Block"}
          </button>

          {/* Off today — a quiet card here rather than a banner across the top. */}
          {isAdminOrManager && offToday.length > 0 && (
            <div className="rounded-xl border border-sand bg-white p-3 h-fit">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-stone">
                Off today ({offToday.length})
              </p>
              <div className="space-y-1">
                {offToday.map((o, i) => (
                  <p key={i} className="truncate text-[11px] text-walnut">
                    <span className="font-semibold text-espresso">{o.name}</span>
                    {o.label ? ` · ${o.label}` : ""}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Due — its own card above Unscheduled, so deadlines read as their
              own thing rather than a line buried on every backlog row. */}
          {dueSidebarItems.length > 0 && (
            <div className="rounded-xl border border-sand bg-white p-4 h-fit">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-espresso">
                Due ({dueSidebarItems.length})
              </p>
              <div className="space-y-1.5 max-h-[220px] overflow-y-auto">
                {dueSidebarItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      const task = daySchedule.find((t) => t.id === item.id);
                      if (task) void openScheduleExisting(task, selectedDate);
                    }}
                    className="flex w-full items-start justify-between gap-2 rounded-lg border border-sand bg-white px-2.5 py-2 text-left transition-colors hover:bg-cream cursor-pointer"
                  >
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-espresso">
                      {item.name}
                    </span>
                    <span
                      className={`shrink-0 text-[10px] font-semibold ${
                        item.overdue ? "text-terracotta" : "text-walnut"
                      }`}
                    >
                      {item.overdue ? "Overdue" : item.dueTime ? formatDueTime(item.dueTime) : "Today"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

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
                              {/* Deadlines live in the Due card above this list,
                                  not on each row — this list is a backlog of
                                  work to schedule, and repeating the date on
                                  every row buried the ones that actually fall
                                  due. */}
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
              </>
            )}
          </div>
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
                // Keyed on the task id, not the literal "edit". TaskEditor seeds
                // every field with useState, which only runs on mount — so a
                // constant key meant opening task B after task A reused A's form
                // state, and saving wrote A's values (or blanks) over B. That is
                // how a due date got wiped by a save that never touched it.
                key={editingBlockId ? `edit-${editingBlockId}` : taskMode}
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
