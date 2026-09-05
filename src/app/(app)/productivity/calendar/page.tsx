"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { hasBroadAdminAccess } from "@/lib/financialAccess";
import TaskEditor, { type TaskEditorHandle, type TaskEditorInitialTask } from "@/components/TaskEditor";
import TaskDetailsView from "@/components/TaskDetailsView";
import Section from "@/components/ui/Section";
import {
  type RawTask,
  CATEGORY_OPTIONS,
  getDateInTimezone,
  addDaysToDateStr,
  formatDayLabel,
  orgDateOf,
  formatDueTime,
  normalizeAssignedRows,
  categoryDotClass,
  categoryBlockClasses,
  statusLabel,
  isDateInSpan,
  reanchorToDate,
  spanLabel,
  isOverdueGivenStatus,
  DUE_DATE_FINISHED_STATUSES,
} from "@/lib/taskSchedule";
import type { AssignedTaskStatus, Project, UserRole } from "@/types/database";
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

// person + org-date + task + account — the best identity a time_log carries
// (it has no task reference), same matching used by useRevisionByLogId for
// the same underlying reason.
function actualMatchKey(userId: string, dateStr: string, taskName: string | null, account: string | null) {
  return `${userId}|${dateStr}|${(taskName ?? "").trim().toLowerCase()}|${(account ?? "").trim().toLowerCase()}`;
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


// Marks a block as generated from a recurring template. A glyph rather than a
// word: the blocks it sits on are one line tall and already carry the task name
// and client detail, so a "Recurring" badge would push the name out.
//
// Amber on its own chip rather than inheriting the block's colour. The blocks
// are category-coloured, so an inherited mark was dark green on a green Task
// block — technically legible, invisible in practice. Amber belongs to no
// category, so it reads as "recurring" on every one of them.
function RecurringMark({ className = "" }: { className?: string }) {
  return (
    <span
      title="Repeats — generated from a recurring template"
      aria-label="Recurring"
      className={`inline-flex shrink-0 items-center rounded-sm bg-amber-soft px-[3px] font-bold text-amber ${className}`}
    >
      ↻
    </span>
  );
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
  // Actual worked minutes, keyed by matchKey(vaId, dateStr, taskName, account) —
  // the fallback for logs with no assigned_task_id (below): person+name+account
  // is the same matching useRevisionByLogId uses when it has nothing better.
  // Powers the "shaded to actual time" overlay on each scheduled block.
  const [actualMinutesByKey, setActualMinutesByKey] = useState<Map<string, number>>(new Map());
  // Same overlay, but keyed by the specific task a log was actually stamped
  // against (assigned_tasks/[id]'s status-change route sets time_logs.
  // assigned_task_id when a task is started) — precise, unlike the name+account
  // fallback above, which can't tell two same-named tasks apart and used to
  // show one task's full logged time on every other task sharing its name.
  // Not every log carries this yet (only "Start" transitions stamp it), so
  // this is checked first and actualMinutesByKey covers what's left.
  const [actualMinutesByTaskId, setActualMinutesByTaskId] = useState<Map<string, number>>(new Map());
  // Same real worked time, summed per person+day regardless of which task it
  // was logged against — powers the Planned/Actual readouts (day, week, month
  // totals), which compare "what's scheduled" against "everything actually
  // worked that day", not just the portion that happens to match a block.
  const [actualMinutesByVaDate, setActualMinutesByVaDate] = useState<Map<string, number>>(new Map());
  // The logged category for actualMinutesByKey's unattributed bucket (no
  // assigned_task_id — a genuinely never-planned log, so there's no task row
  // to read a category from any other way) — lets "Worked, not on this day's
  // plan" fill with the real category color (e.g. Break's blue-slate, a real
  // Task's green) instead of falling back to the neutral/no-category look.
  const [actualCategoryByKey, setActualCategoryByKey] = useState<Map<string, string | null>>(new Map());
  const [monthYear, setMonthYear] = useState<number>(new Date().getFullYear());
  const [monthMonth, setMonthMonth] = useState<number>(new Date().getMonth());
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);

  // Per-account time consumed vs. cap — agency-wide (every VA's hours on an
  // account count against the same limit), fetched fresh whenever the visible
  // day/week/month changes. Not scoped by `scope`/dayUserId on purpose: an
  // account's budget doesn't change depending on whose calendar you're looking at.
  const [accountUsage, setAccountUsage] = useState<
    Array<{
      id: number; name: string;
      daily_hours_budget: number | null; weekly_hours_budget: number | null; monthly_hours_budget: number | null;
      daily_minutes: number; weekly_minutes: number; monthly_minutes: number;
      // Actual logged minutes (time_logs), alongside the scheduled figures
      // above — the Planned/Actual pair the account-budget table shows per VA.
      daily_actual: number; weekly_actual: number; monthly_actual: number;
      // Same account total, broken down by who spent it — a task with several
      // assignees credits its full length to each of them, so these can sum
      // to more than the account total on shared work.
      by_va: Array<{
        va_id: string; va_name: string; daily: number; weekly: number; monthly: number;
        daily_actual: number; weekly_actual: number; monthly_actual: number;
      }>;
    }>
  >([]);
  // Each VA's OWN total across every account, next to their personal cap —
  // "how much of Arianne's time is left", independent of any one account's
  // budget. The far-right column of the VA-by-account grid.
  const [vaUsageTotals, setVaUsageTotals] = useState<
    Array<{
      va_id: string; va_name: string; daily: number; weekly: number; monthly: number;
      daily_actual: number; weekly_actual: number; monthly_actual: number;
      daily_hours_budget: number | null; weekly_hours_budget: number | null; monthly_hours_budget: number | null;
    }>
  >([]);

  const [assignedTasksAll, setAssignedTasksAll] = useState<RawTask[]>([]);
  const [fixedItems, setFixedItems] = useState<DueItem[]>([]);
  // Output Based tasks carry a duration but never an hour block, so they can't
  // come through scheduledForDate. Held separately, one entry per task, and
  // folded into the day's total by durationsForDate.
  const [fixedSpend, setFixedSpend] = useState<Array<{ taskId: number; amount: number; date: string }>>([]);
  const [fixedDurations, setFixedDurations] = useState<
    Array<{ taskId: number; name: string; account: string | null; category: string | null; detail: string | null; status: string; minutes: number; date: string }>
  >([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [daySchedule, setDaySchedule] = useState<RawTask[]>([]);
  const [loadingDay, setLoadingDay] = useState(false);
  // Approved time off (va_requests type=time_off). Admin sees everyone; a VA
  // sees their own. start_time/end_time null = full day off; set = a partial
  // "short day" for that window.
  const [timeOff, setTimeOff] = useState<Array<{ user_id: string; start_date: string; end_date: string; start_time: string | null; end_time: string | null }>>([]);

  const [showFilters, setShowFilters] = useState(false);
  // Day view has three faces: the Time Block grid (the plan), the Duration
  // Block table (how long each task takes, not when), and Actual Timeline (the
  // plan reflowed by what really happened — a late-running task pushes
  // everything after it later, absorbing into any open gaps first).
  const [dayTab, setDayTab] = useState<"grid" | "hours" | "actual">("grid");
  // Week gets the same three faces as Day. Separate state so switching
  // views doesn't drag one view's choice onto the other.
  const [weekTab, setWeekTab] = useState<"grid" | "hours" | "actual">("grid");
  const [rangeTab, setRangeTab] = useState<"grid" | "hours">("grid");
  // Opening a block should answer "what is this?" before it offers to change
  // it, so the modal lands on Details and Edit Task is one click away.
  const [modalTab, setModalTab] = useState<"details" | "edit">("details");
  const [limitNotice, setLimitNotice] = useState<string | null>(null);
  const [unscheduledCollapsed, setUnscheduledCollapsed] = useState(false);
  // Collapsed by default — Account Budgets sits above every view (Month, Week,
  // Day all show it), and once the by-VA grid is in it's the tallest thing on
  // the page before you've scrolled to anything you actually opened the
  // calendar for.
  const [accountBudgetsCollapsed, setAccountBudgetsCollapsed] = useState(true);
  // Output Based work (fixed_pay_tasks) isn't hourly, so mixing it into an
  // hours grid at all is a category error, not just noise — on by default so
  // the grid reads sanely without having to discover the toggle first.
  const [excludeOutputBased, setExcludeOutputBased] = useState(true);
  // Manual per-VA override on top of the work-type filter above — everyone
  // shown by default, individuals dropped by unchecking them (or narrowed to
  // a specific few via None + re-checking). Ids, not names, so a rename
  // doesn't silently un-exclude anyone.
  const [excludedVaIds, setExcludedVaIds] = useState<string[]>([]);
  const [showVaFilterPicker, setShowVaFilterPicker] = useState(false);
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
  // Kind-level quick filters ("Operations only" / "Objectives only") — derived
  // from allProjects, not stored separately, so they stay in sync with
  // whatever project checkboxes exist below.
  const operationIds = useMemo(() => allProjects.filter((p) => p.kind === "operation").map((p) => p.id), [allProjects]);
  const objectiveIds = useMemo(() => allProjects.filter((p) => p.kind !== "operation").map((p) => p.id), [allProjects]);
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

  // "Status & Files" on the Edit Task form — same field Assignment's own edit
  // panel has, so a VA can put a task straight on their Dashboard (On Queue)
  // from here instead of having to go find it in Assignment afterward.
  const taskEditorRef = useRef<TaskEditorHandle | null>(null);
  const [panelStatus, setPanelStatus] = useState<AssignedTaskStatus>("pending");
  const [panelSaving, setPanelSaving] = useState(false);
  const [panelMsg, setPanelMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

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
        task_detail: string | null;
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
            detail: t.task_detail,
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

  // Tracks selectedDate — the calendar's one real cursor, which Day view
  // shows directly and Week view anchors its grid to. Browsing to a
  // different week shows THAT week's budget; Day view has no day-level
  // budget of its own, so it shows the week containing the day you're on.
  //
  // This is NOT the same as following Month view's own prev/next paging.
  // Those arrows only move monthYear/monthMonth and deliberately leave
  // selectedDate untouched, which is what keeps this safe: an earlier version
  // read monthYear/monthMonth directly and asked about day 1 of whatever
  // month was visible, so paging to August computed "this week" as the week
  // containing Aug 1 (July 26-Aug 1) — sharing no days with the month's real
  // activity, which all fell after Aug 18. Weekly read 0m next to a real,
  // nonzero Monthly total for the same account. selectedDate never does that:
  // it only moves through explicit navigation (Today, the date picker, or
  // actually viewing a Day/Week), never by paging Month's own arrows alone.
  useEffect(() => {
    let cancelled = false;
    const excludeParam = excludedVaIds.length > 0 ? `&excludeVaIds=${excludedVaIds.join(",")}` : "";
    fetch(`/api/accounts/usage?date=${selectedDate}&excludeOutputBased=${excludeOutputBased}${excludeParam}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) {
          setAccountUsage(d.accounts ?? []);
          setVaUsageTotals(d.by_va_totals ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAccountUsage([]);
          setVaUsageTotals([]);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, excludeOutputBased, excludedVaIds.join(",")]);
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

  // The status shown/edited on the form is the specific VA's own assignee
  // row, not a task-level field — assigned_task_assignees can hold more than
  // one person, each with their own status.
  const resolveAssigneeStatus = (task: TaskEditorInitialTask | null, vaId: string | null): AssignedTaskStatus => {
    const assignees = (task?.assigned_task_assignees ?? []) as Array<{ va_id: string; status?: AssignedTaskStatus }>;
    return assignees.find((a) => a.va_id === vaId)?.status ?? "pending";
  };

  // Fetches the full task row (task_detail, instructions, project_id, etc. —
  // fields the Calendar's own normalized RawTask doesn't carry) so TaskEditor
  // can prefill without clobbering anything the VA hasn't touched.
  const openEditBlock = async (task: RawTask) => {
    if (!task.start_time || !task.end_time) return;
    setModalTab("details");
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
    setPanelMsg(null);
    const res = await fetch(`/api/assigned-tasks/${task.id}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setEditingTaskFull(data.task ?? null);
      setPanelStatus(resolveAssigneeStatus(data.task ?? null, dayUserId));
    }
  };

  const openScheduleExisting = async (task: RawTask, dateStr: string = selectedDate) => {
    setModalTab("details");
    setEditingBlockId(task.id);
    setFormDate(dateStr);
    setFormStart("09:00");
    setFormEnd("10:00");
    setShowForm(true);
    setEditingTaskFull(null);
    setPanelMsg(null);
    const res = await fetch(`/api/assigned-tasks/${task.id}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setEditingTaskFull(data.task ?? null);
      setPanelStatus(resolveAssigneeStatus(data.task ?? null, dayUserId));
    }
  };

  const refreshAfterScheduleChange = useCallback(async () => {
    await Promise.all([fetchDaySchedule(), fetchAssignedTasksAll()]);
  }, [fetchDaySchedule, fetchAssignedTasksAll]);

  // One-click "On Queue" shortcut on a Pending block — Edit Task still covers
  // every other status change; this just skips the trip there for the single
  // transition that matters for showing up on the Dashboard (Charinade's
  // Calendar request). Hidden once a block leaves Pending.
  const [quickQueueingId, setQuickQueueingId] = useState<number | null>(null);
  const quickSetOnQueue = useCallback(
    async (task: RawTask, vaId: string | null) => {
      if (!vaId) return;
      setQuickQueueingId(task.id);
      try {
        const res = await fetch(`/api/assigned-tasks/${task.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "on_queue", va_id: vaId }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await Promise.all([refreshAfterScheduleChange(), fetchCompareSchedules()]);
      } catch {
        // Silent — Edit Task still covers this if the quick action fails.
      } finally {
        setQuickQueueingId(null);
      }
    },
    [refreshAfterScheduleChange, fetchCompareSchedules]
  );

  const renderQueueButton = (task: RawTask, vaId: string | null) =>
    task.status === "pending" && (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void quickSetOnQueue(task, vaId);
        }}
        disabled={quickQueueingId === task.id}
        title="Move to On Queue"
        // Badges in this app are always rounded-full pills — deliberately NOT
        // that shape here, so this doesn't read as a status badge. Buttons are
        // rounded-lg; this is the same shape at corner-chip scale, plus a
        // border so it still pops against the sage fill at 8px. Inset (not
        // escaping the block's edge like the "over" badge does) — blocks stack
        // back-to-back with no gap, so anything poking past the top edge lands
        // on the neighboring block above instead.
        className="pointer-events-auto absolute top-0.5 right-0.5 z-10 rounded-md border border-sage-soft bg-sage px-1.5 py-[2px] text-[8px] font-bold uppercase leading-tight text-white shadow hover:bg-sage/90 disabled:opacity-50"
      >
        {quickQueueingId === task.id ? "…" : "+ Queue"}
      </button>
    );

  // Edit mode's own Save: TaskEditor's onSaved deliberately doesn't close the
  // form here (see the edit-only onSaved below) — this is what closes it,
  // after both the form fields AND the status have actually saved. Doing the
  // status PATCH first would race the field submit if TaskEditor's own save
  // touches the same row; sequencing them avoids that.
  const handleSaveEditPanel = useCallback(async () => {
    if (!editingBlockId) return;
    setPanelMsg(null);
    setPanelSaving(true);
    try {
      if (taskEditorRef.current) {
        await taskEditorRef.current.submit();
      }
      const previousStatus = resolveAssigneeStatus(editingTaskFull, dayUserId);
      if (panelStatus !== previousStatus) {
        const res = await fetch(`/api/assigned-tasks/${editingBlockId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: panelStatus, va_id: dayUserId }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }
      await refreshAfterScheduleChange();
      setPanelMsg({ type: "ok", text: "Changes saved." });
      window.setTimeout(() => setShowForm(false), 800);
    } catch {
      setPanelMsg({ type: "err", text: "Unable to save changes right now." });
    } finally {
      setPanelSaving(false);
    }
  }, [editingBlockId, editingTaskFull, panelStatus, dayUserId, refreshAfterScheduleChange]);

  const handleDuplicateEditPanel = useCallback(async () => {
    if (!editingBlockId) return;
    setPanelMsg(null);
    setPanelSaving(true);
    try {
      await taskEditorRef.current?.duplicate();
      await refreshAfterScheduleChange();
      setShowForm(false);
    } catch {
      setPanelMsg({ type: "err", text: "Unable to duplicate this task right now." });
    } finally {
      setPanelSaving(false);
    }
  }, [editingBlockId, refreshAfterScheduleChange]);

  const handleConvertEditPanel = useCallback(async () => {
    if (!editingBlockId) return;
    setPanelMsg(null);
    setPanelSaving(true);
    try {
      // The Calendar's block editor only ever shows Time-based tasks — this
      // panel has no Output Based schedule to render — so the one meaningful
      // direction here is always toward Output Based.
      await taskEditorRef.current?.convert("output_based");
      await refreshAfterScheduleChange();
      setShowForm(false);
    } catch {
      setPanelMsg({ type: "err", text: "Unable to convert this task right now." });
    } finally {
      setPanelSaving(false);
    }
  }, [editingBlockId, refreshAfterScheduleChange]);

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
          (t) =>
            t.due_date &&
            t.due_date <= selectedDate &&
            taskPassesFilters(t) &&
            !DUE_DATE_FINISHED_STATUSES.has(t.status ?? "")
        )
        .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))
        .map((t) => ({
          id: t.id,
          name: t.task_name,
          dueDate: t.due_date as string,
          dueTime: t.due_time,
          overdue: isOverdueGivenStatus(t.due_date as string, selectedDate, t.status),
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
        detail: t.task_detail,
        todos: t.todos,
        recurring: t.isRecurring,
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
          detail: t.task_detail,
          todos: t.todos,
          recurring: t.isRecurring,
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
          detail: f.detail,
          // fixed_pay_tasks has no to-do table of its own — task_todos keys off
          // assigned_tasks.id — so these are always empty rather than missing.
          todos: [] as RawTask["todos"],
          // Output Based work isn't generated from a recurring template.
          recurring: false,
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
      // Both halves name the budget they're measured against. "2h over" sitting
      // under a "6h" total is a riddle — it reads as a second, unrelated number
      // unless you already know the shift is 4h. "2h over 4h" says it outright.
      const remaining = shiftBudgetMinutes - usedMinutes;
      const budget = formatDuration(shiftBudgetMinutes);
      if (remaining < 0) {
        return { text: `${formatDuration(-remaining)} over ${budget}`, over: true, warn: false };
      }
      const warn =
        shiftBudgetMinutes > 0 && usedMinutes / shiftBudgetMinutes >= BUDGET_WARN_THRESHOLD;
      return { text: `${formatDuration(remaining)} left of ${budget}`, over: false, warn };
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
  // Just the text colour, same severity mapping as budgetBadgeClass — for
  // plain numbers in a table cell, which don't want the pill/border chrome.
  const budgetTextClass = (badge: { over: boolean; warn: boolean }) =>
    badge.over ? "text-terracotta" : badge.warn ? "text-amber" : "text-sage";

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

  // Real worked time, for the "shade to actual" overlay. Scoped to the whole
  // visible week (selectedDate's week covers Day/Week/Compare alike, since
  // selectedDate is always one of its own weekDates) and to every VA on
  // screen — dayUserId for Week/Day, plus each compared teammate.
  const actualTimeVaIds = useMemo(() => {
    const ids = new Set<string>();
    if (dayUserId) ids.add(dayUserId);
    for (const id of compareVaIds) ids.add(id);
    return Array.from(ids);
  }, [dayUserId, compareVaIds]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (actualTimeVaIds.length === 0 || weekDates.length === 0) {
        setActualMinutesByKey(new Map());
        setActualMinutesByTaskId(new Map());
        setActualMinutesByVaDate(new Map());
        setActualCategoryByKey(new Map());
        return;
      }
      // Covers whichever is wider — the Week grid only needs its own 7 days,
      // but the Month grid's Planned/Actual cells need the whole visible
      // month, and the two ranges don't nest inside each other.
      const rangeStart = [weekDates[0], monthGrid[0]].filter(Boolean).sort()[0];
      const rangeEnd = [weekDates[weekDates.length - 1], monthGrid[monthGrid.length - 1]].filter(Boolean).sort().slice(-1)[0];
      const supabase = createClient();
      const { data } = await supabase
        .from("time_logs")
        .select("user_id, task_name, account, category, session_date, duration_ms, assigned_task_id")
        .in("user_id", actualTimeVaIds)
        .gte("session_date", rangeStart)
        .lte("session_date", rangeEnd)
        .is("deleted_at", null);
      if (cancelled) return;
      const byKey = new Map<string, number>();
      const byTaskId = new Map<string, number>();
      const byVaDate = new Map<string, number>();
      const categoryByKey = new Map<string, string | null>();
      for (const log of (data ?? []) as {
        user_id: string; task_name: string | null; account: string | null; category: string | null;
        session_date: string | null; duration_ms: number | null; assigned_task_id: number | null;
      }[]) {
        if (!log.session_date) continue;
        const ms = log.duration_ms && log.duration_ms > 0 ? log.duration_ms : 0;
        if (ms === 0) continue;
        const minutes = ms / 60000;
        const vaDateKey = `${log.user_id}|${log.session_date}`;
        byVaDate.set(vaDateKey, (byVaDate.get(vaDateKey) ?? 0) + minutes);
        // A stamped log is claimed entirely by its own task — left out of the
        // name+account pool below, or its minutes would show up twice: once
        // precisely here, once again smeared across every same-named task.
        if (log.assigned_task_id != null) {
          const taskKey = `${log.assigned_task_id}|${log.session_date}`;
          byTaskId.set(taskKey, (byTaskId.get(taskKey) ?? 0) + minutes);
          continue;
        }
        const key = actualMatchKey(log.user_id, log.session_date, log.task_name, log.account);
        byKey.set(key, (byKey.get(key) ?? 0) + minutes);
        if (log.category) categoryByKey.set(key, log.category);
      }
      setActualMinutesByKey(byKey);
      setActualMinutesByTaskId(byTaskId);
      setActualMinutesByVaDate(byVaDate);
      setActualCategoryByKey(categoryByKey);
    })();
    return () => { cancelled = true; };
  }, [actualTimeVaIds, weekDates, monthGrid]);

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
    // Unclamped, unlike height above — this is the scheduled length itself,
    // used to compare against actual worked time. A very short block still
    // floors its drawn height at 20px, but that floor shouldn't make a 10-min
    // task read as "way over" the moment 15 minutes are logged against it.
    const durationMinutes = Math.max(0, endMinutes - startMinutes);
    return { top, height, durationMinutes };
  }

  // How long dateStr's rendering of task was actually worked, per the logged
  // time_logs matched by person + task name + account (see actualMatchKey).
  // Returns 0 for anything with no matching logged time.
  const actualMinutesFor = useCallback(
    (vaId: string | null, dateStr: string, task: RawTask) => {
      if (!vaId) return 0;
      const precise = actualMinutesByTaskId.get(`${task.id}|${dateStr}`);
      if (precise != null) return precise;
      return actualMinutesByKey.get(actualMatchKey(vaId, dateStr, task.task_name, task.account)) ?? 0;
    },
    [actualMinutesByTaskId, actualMinutesByKey]
  );

  // The shade-to-actual overlay + over-time treatment shared by all three
  // hour-grid render sites (Week, Compare, Day) — height of the "worked so
  // far" fill, whether the block ran over its scheduled length, and by how
  // much. Deliberately uncapped: a block that ran long shades past its own
  // box to the true worked length, rather than maxing out at 100% fill and
  // hiding how far over it actually went. The render sites drop the block's
  // overflow-hidden so this can actually spill past the box.
  function actualOverlay(vaId: string | null, dateStr: string, task: RawTask, pos: { top: number; height: number; durationMinutes: number }) {
    const actual = actualMinutesFor(vaId, dateStr, task);
    if (actual <= 0 || pos.durationMinutes <= 0) return null;
    const ratio = actual / pos.durationMinutes;
    const shadeHeight = ratio * pos.height;
    const overMinutes = Math.round(actual - pos.durationMinutes);
    const isOver = overMinutes > 0;
    return { shadeHeight, isOver, overMinutes };
  }

  // Same shade-to-actual idea as actualOverlay, for the Duration Block list
  // rather than the Time Block grid — a row has no vertical position to shade
  // by height, so this fills left-to-right instead. Output Based rows are
  // excluded: they're never clocked through time_logs the way hourly work is,
  // so actualMinutesByKey has nothing to match them against.
  function durationRowOverlay(
    vaId: string | null,
    dateStr: string,
    row: { id: number; name: string | null; account: string | null; minutes: number; source: "assigned" | "fixed" }
  ) {
    if (!vaId || row.source === "fixed" || row.minutes <= 0) return null;
    const precise = actualMinutesByTaskId.get(`${row.id}|${dateStr}`);
    const actual = precise ?? actualMinutesByKey.get(actualMatchKey(vaId, dateStr, row.name, row.account)) ?? 0;
    if (actual <= 0) return null;
    const fillPercent = Math.min(actual / row.minutes, 1) * 100;
    const overMinutes = Math.round(actual - row.minutes);
    const isOver = overMinutes > 0;
    return { fillPercent, isOver, overMinutes };
  }

  // Real time_logs for dateStr that don't line up with anything on THAT day's
  // plan. Two different stories, told with two different colors (matching the
  // rule already established elsewhere — Submissions' late_other_day chip and
  // this file's own Actual Timeline "moved" blocks):
  //   - moved (plum): the task DOES have a plan — a start_date or due_date is
  //     set — just not today. Most often someone kept working it across
  //     several days without ever moving that date forward, so it's still
  //     sitting on whichever earlier day it was first scheduled.
  //   - never planned (blue): no start_date or due_date at all — started
  //     straight from Log a Task or the task list without ever being put on
  //     the calendar, so there was never a "today" for it to belong to.
  // Precisely-attributed logs (assigned_task_id set) are flagged when that
  // task isn't one of today's scheduled rows; unattributed logs (no
  // assigned_task_id — actualMinutesByKey's fallback bucket, always "never
  // planned" since there's no task row to have a date on) are flagged when no
  // scheduled row today shares their name+account either. The day's own
  // Planned/Actual total already counts this time; this is only about it
  // having nowhere to visually attach on the calendar for today specifically.
  function unscheduledActualForDate(vaId: string | null, dateStr: string) {
    if (!vaId) return [];
    const { rows } = durationsForDate(dateStr);
    const scheduledIds = new Set(rows.map((r) => r.id));
    const scheduledKeys = new Set(
      rows.map((r) => `${(r.name ?? "").trim().toLowerCase()}|${(r.account ?? "").trim().toLowerCase()}`)
    );
    const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

    const out: Array<{
      key: string; taskId: number | null; name: string; account: string | null;
      category: string | null; minutes: number; plannedMinutes: number | null; moved: boolean;
    }> = [];

    for (const [taskKey, minutes] of actualMinutesByTaskId) {
      const [idStr, keyDate] = taskKey.split("|");
      if (keyDate !== dateStr) continue;
      const taskId = Number(idStr);
      if (scheduledIds.has(taskId)) continue;
      const task = assignedTasksAll.find((t) => t.id === taskId);
      out.push({
        key: `task-${taskId}`,
        taskId,
        name: task?.task_name ?? "Unknown task",
        account: task?.account ?? null,
        category: task?.category ?? null,
        minutes,
        plannedMinutes: task?.planned_minutes ?? null,
        moved: Boolean(task?.start_date || task?.due_date),
      });
    }

    const prefix = `${vaId}|${dateStr}|`;
    for (const [matchKey, minutes] of actualMinutesByKey) {
      if (!matchKey.startsWith(prefix)) continue;
      const [nameLower, accountLower] = matchKey.slice(prefix.length).split("|");
      if (scheduledKeys.has(`${nameLower}|${accountLower ?? ""}`)) continue;
      out.push({
        key: matchKey,
        taskId: null,
        name: titleCase(nameLower || "Unknown task"),
        account: accountLower ? titleCase(accountLower) : null,
        category: actualCategoryByKey.get(matchKey) ?? null,
        minutes,
        plannedMinutes: null,
        moved: false,
      });
    }

    return out.sort((a, b) => b.minutes - a.minutes);
  }

  // Same shade-to-actual fill durationRowOverlay draws for a scheduled row,
  // reused here against the task's OWN planned length (not today's — there
  // is no "today's plan" for these by definition) so a moved/never-planned
  // block still shows how much of its own planned time this day's chunk used.
  // No planned_minutes at all (the unattributed, never-planned bucket) means
  // nothing to compare against, so it renders with no fill — the ring color
  // alone carries the meaning there.
  function unscheduledRowOverlay(item: { minutes: number; plannedMinutes: number | null }) {
    if (!item.plannedMinutes || item.plannedMinutes <= 0) return null;
    const fillPercent = Math.min(item.minutes / item.plannedMinutes, 1) * 100;
    const overMinutes = Math.round(item.minutes - item.plannedMinutes);
    const isOver = overMinutes > 0;
    return { fillPercent, isOver, overMinutes };
  }

  // Actual Timeline: the day's blocks reflowed by what really happened,
  // instead of where they were planned. Walks the day in scheduled order
  // carrying a running delay ("cursor") forward — a block that ran long pushes
  // everything after it later, but only by however much delay survives after
  // any open gap between two blocks eats into it first (an empty half hour
  // between two plans absorbs a 20-minute overrun with nothing downstream
  // moving at all). A block with no logged time yet is assumed to take
  // exactly as long as planned — it doesn't add its own delay, but it still
  // slides later if an earlier block already pushed the cursor forward.
  // Same-day only: a delay that runs past the day's own blocks just compresses
  // toward the end rather than spilling into tomorrow.
  function actualTimelinePositions(dateStr: string, vaId: string | null) {
    const dayTasks = scheduledForDate(dateStr);
    const withPos = dayTasks
      .map((task) => ({ task, pos: blockPosition(task) }))
      .sort((a, b) => a.pos.top - b.pos.top);

    const result = new Map<number, { top: number; height: number; overrun: number; isOver: boolean }>();
    let cursorMinutes = 0;
    let prevScheduledEndMinutes: number | null = null;

    for (const { task, pos } of withPos) {
      const scheduledStartMinutes = (pos.top / HOUR_HEIGHT) * 60;
      const scheduledEndMinutes = scheduledStartMinutes + pos.durationMinutes;

      if (prevScheduledEndMinutes != null) {
        const gap = scheduledStartMinutes - prevScheduledEndMinutes;
        cursorMinutes = Math.max(0, cursorMinutes - Math.max(0, gap));
      }

      const effectiveStartMinutes = scheduledStartMinutes + cursorMinutes;
      const actual = actualMinutesFor(vaId, dateStr, task);
      const effectiveDurationMinutes = actual > 0 ? actual : pos.durationMinutes;
      const overMinutes = actual > 0 ? Math.max(0, actual - pos.durationMinutes) : 0;

      result.set(task.id, {
        top: (effectiveStartMinutes / 60) * HOUR_HEIGHT,
        height: Math.max(20, (effectiveDurationMinutes / 60) * HOUR_HEIGHT),
        overrun: overMinutes,
        isOver: overMinutes > 0,
      });

      cursorMinutes += overMinutes;
      prevScheduledEndMinutes = scheduledEndMinutes;
    }

    return result;
  }

  // Grid-pixel top -> "9:00 AM", for the Actual Timeline hover summary below.
  // Purely a scale conversion (px / HOUR_HEIGHT * 60 = minutes-of-day) — the
  // timezone work already happened wherever the px value itself came from
  // (blockPosition, actualTimelinePositions), so there's nothing to convert here.
  function pxToClock(px: number): string {
    const minutes = Math.round((px / HOUR_HEIGHT) * 60);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, "0")} ${period}`;
  }

  // The hover summary for a rearranged Actual Timeline block — planned span
  // next to where it actually landed, so the purple border's claim ("this
  // moved") comes with the specifics instead of asking to be taken on faith.
  function timelineMoveSummary(plan: { top: number; height: number }, actual: { top: number; height: number }): string {
    const plannedSpan = `${pxToClock(plan.top)} – ${pxToClock(plan.top + plan.height)}`;
    const actualSpan = `${pxToClock(actual.top)} – ${pxToClock(actual.top + actual.height)}`;
    return `Planned ${plannedSpan} → Actual ${actualSpan}`;
  }

  // Planned (scheduled) vs. actual (logged) minutes for one day — the pair the
  // Day/Week/Month totals all read from. `off` marks a day that's outside the
  // VA's shift AND has logged time anyway, so callers can grey the pair out
  // instead of coloring it, matching budgetBadgeFor's own off-day treatment.
  const plannedActualForDate = useCallback(
    (vaId: string | null, dateStr: string) => {
      const planned = durationsForDate(dateStr).totalMinutes;
      const actual = vaId ? actualMinutesByVaDate.get(`${vaId}|${dateStr}`) ?? 0 : 0;
      return { planned, actual, off: isOffDay(dateStr) && actual > 0 };
    },
    [durationsForDate, actualMinutesByVaDate, isOffDay]
  );

  // Shared Planned/Actual readout — amber for planned, sage for actual (the
  // palette's "caution" and "completed" accents, closest to the yellow/green
  // Toni asked for), collapsing to plain stone when the day was worked off-shift.
  function plannedActualReadout(planned: number, actual: number, off: boolean, size: "xs" | "sm" | "md" = "sm") {
    const textSize = size === "md" ? "text-[13px]" : size === "sm" ? "text-[10px]" : "text-[9px]";
    return (
      <span className={`inline-flex items-center gap-1 font-bold ${textSize}`}>
        <span className={off ? "text-stone" : "text-amber"}>{formatDuration(planned)}</span>
        <span className="text-stone/40">/</span>
        <span className={off ? "text-stone" : "text-sage"}>{formatDuration(actual)}</span>
      </span>
    );
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
                    const dayTotals = plannedActualForDate(dayUserId, dateStr);
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
                        {(dayTotals.planned > 0 || dayTotals.actual > 0) &&
                          plannedActualReadout(dayTotals.planned, dayTotals.actual, dayTotals.off, "xs")}
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
                              const pos = blockPosition(task);
                              const { top, height } = pos;
                              // Due-date-driven blocks render fully opaque; start-date-driven
                              // blocks (the default) stay at 70% opacity.
                              const isDueBlock = dateStr === task.due_date && dateStr !== task.start_date;
                              const { col, cols } = overlapLayout.get(task.id) ?? { col: 0, cols: 1 };
                              const label = spanLabel(task, dateStr);
                              const overlay = actualOverlay(dayUserId, dateStr, task, pos);
                              const left = `calc(2px + (100% - 4px) * ${col} / ${cols})`;
                              const width = `calc((100% - 4px) / ${cols} - 2px)`;
                              return (
                                <div
                                  key={task.id}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => openEditBlock(task)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      openEditBlock(task);
                                    }
                                  }}
                                  title={`${task.task_name}${task.account ? " — " + task.account : ""}`}
                                  className={`pointer-events-auto absolute rounded-md border px-1 py-0.5 text-left shadow-sm hover:opacity-90 cursor-pointer ${categoryBlockClasses(task.category, isDueBlock)} ${overlay?.isOver ? "ring-2 ring-terracotta ring-inset" : ""}`}
                                  style={{ top, height, left, width }}
                                >
                                  {overlay && (
                                    <div
                                      className="pointer-events-none absolute inset-x-0 top-0 bg-ink/25"
                                      style={{ height: overlay.shadeHeight }}
                                    />
                                  )}
                                  {renderQueueButton(task, dayUserId)}
                                  <p className="relative truncate text-[9px] font-semibold leading-tight">
                                    {label && <span className="opacity-70">[{label}] </span>}
                                    {task.isRecurring && <RecurringMark className="mr-0.5" />}
                                    {task.task_detail || task.task_name}
                                  </p>
                                  {overlay?.isOver && (
                                    <p
                                      className="pointer-events-none absolute inset-x-0 -translate-y-full truncate rounded-b-md bg-terracotta px-1 text-center text-[8px] font-bold leading-tight text-white"
                                      style={{ top: overlay.shadeHeight }}
                                    >
                                      {overlay.overMinutes}m over
                                    </p>
                                  )}
                                </div>
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

  // Actual Timeline, over any list of days — same shape as renderTimeGrid
  // (one column per day) but each day's blocks are positioned by
  // actualTimelinePositions instead of blockPosition, so a late-running task
  // pushes what's after it later within that day. Read-only: no click-to-add,
  // since a slot here is a computed position, not a real place to schedule.
  const renderActualTimeline = (dates: string[]) => (
    <div className="overflow-x-auto">
      <div className="grid" style={{ minWidth: Math.max(760, dates.length * 110), gridTemplateColumns: COLS(dates.length) }}>
        <div />
        {dates.map((dateStr) => {
          const { weekday, day } = formatDayShort(dateStr);
          const isToday = dateStr === todayStr;
          const dayTotals = plannedActualForDate(dayUserId, dateStr);
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
              {(dayTotals.planned > 0 || dayTotals.actual > 0) &&
                plannedActualReadout(dayTotals.planned, dayTotals.actual, dayTotals.off, "xs")}
            </button>
          );
        })}

        <div className={GRID_SCROLL_CLASS} style={{ gridColumn: `span ${dates.length + 1}` }}>
          <div className="relative grid" style={{ height: hours.length * HOUR_HEIGHT, gridTemplateColumns: COLS(dates.length) }}>
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

            {dates.map((dateStr) => (
              <div key={dateStr} className="relative border-l border-sand">
                {hours.map((hour, i) => (
                  <div
                    key={hour}
                    className="absolute left-0 right-0 border-t border-sand"
                    style={{ top: i * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                  />
                ))}
                <div className="pointer-events-none absolute inset-0">
                  {(() => {
                    const dayTasks = scheduledForDate(dateStr);
                    const positions = actualTimelinePositions(dateStr, dayUserId);
                    return dayTasks.map((task) => {
                      const cascaded = positions.get(task.id);
                      if (!cascaded) return null;
                      const { top, height, isOver, overrun } = cascaded;
                      const plan = blockPosition(task);
                      // Same ghost-of-the-plan treatment as the Day view: only
                      // drawn when this task actually moved or grew, so it reads
                      // as the spill/readjustment itself rather than a second
                      // copy of every block.
                      const moved = top !== plan.top || height !== plan.height;
                      return (
                        <div key={task.id} className="pointer-events-none absolute inset-x-0">
                          {moved && (
                            <div
                              className="absolute inset-x-0.5 rounded-md border-2 border-dashed border-stone/40"
                              style={{ top: plan.top, height: plan.height }}
                            />
                          )}
                          <button
                            type="button"
                            onClick={() => openEditBlock(task)}
                            title={[
                              `${task.task_name}${task.account ? " — " + task.account : ""}`,
                              moved ? timelineMoveSummary(plan, { top, height }) : null,
                            ].filter(Boolean).join(" · ")}
                            className={`pointer-events-auto absolute inset-x-0.5 rounded-md px-1 py-0.5 text-left shadow-sm hover:opacity-90 cursor-pointer ${categoryBlockClasses(task.category)} ${moved ? "border-2 border-plum" : "border"} ${isOver ? "ring-2 ring-terracotta ring-inset" : ""}`}
                            style={{ top, height }}
                          >
                            <p className="truncate text-[9px] font-semibold leading-tight">
                              {task.isRecurring && <RecurringMark className="mr-0.5" />}
                              {task.task_detail || task.task_name}
                            </p>
                            {isOver && (
                              <p className="pointer-events-none absolute inset-x-0 -translate-y-full truncate rounded-b-md bg-terracotta px-1 text-center text-[8px] font-bold leading-tight text-white" style={{ top: height }}>
                                {formatDuration(overrun)} over
                              </p>
                            )}
                          </button>
                        </div>
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
        <span className="text-[11px] font-bold uppercase tracking-wide text-espresso">{totalLabel} — Planned / Actual</span>
        {plannedActualReadout(
          dates.reduce((sum, d) => sum + durationsForDate(d).totalMinutes, 0),
          dates.reduce((sum, d) => sum + (dayUserId ? actualMinutesByVaDate.get(`${dayUserId}|${d}`) ?? 0 : 0), 0),
          false,
          "md"
        )}
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
            const { rows } = durationsForDate(dateStr);
            const { weekday, day } = formatDayShort(dateStr);
            const isToday = dateStr === todayStr;
            const badge = budgetBadgeFor(dateStr, "hide");
            const dayTotals = plannedActualForDate(dayUserId, dateStr);
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
                  {rows.length === 0 && dayTotals.actual === 0 ? (
                    <span className="text-[10px] font-semibold text-stone">—</span>
                  ) : (
                    plannedActualReadout(dayTotals.planned, dayTotals.actual, dayTotals.off, "xs")
                  )}
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
                    rows.map((row) => {
                      // Clickable, same as the Day list's rows — these were plain
                      // divs, so a card here looked identical to one on the Day
                      // view but did nothing when clicked. The day comes from
                      // this column, not selectedDate, so scheduling an untimed
                      // task lands on the column you actually clicked.
                      const overlay = durationRowOverlay(dayUserId, dateStr, row);
                      return (
                      <button
                        key={`${row.source}-${row.id}`}
                        type="button"
                        disabled={row.source === "fixed"}
                        onClick={() => {
                          const blocked = scheduledForDate(dateStr).find((t) => t.id === row.id);
                          if (blocked) {
                            void openEditBlock(blocked);
                            return;
                          }
                          const task = daySchedule.find((t) => t.id === row.id);
                          if (task) void openScheduleExisting(task, dateStr);
                        }}
                        title={`${row.name}${row.account ? " — " + row.account : ""} · ${formatDuration(row.minutes)}`}
                        className={`relative w-full overflow-hidden rounded-md border px-1.5 py-1 text-left shadow-sm ${categoryBlockClasses(row.category)} ${
                          row.source === "fixed" ? "cursor-default" : "cursor-pointer hover:opacity-90"
                        } ${overlay?.isOver ? "ring-2 ring-terracotta ring-inset" : ""}`}
                      >
                        {overlay && (
                          <div
                            className="pointer-events-none absolute inset-y-0 left-0 bg-ink/25"
                            style={{ width: `${overlay.fillPercent}%` }}
                          />
                        )}
                        <p className="relative truncate text-[11px] font-semibold leading-tight">
                          {row.recurring && <RecurringMark className="mr-0.5" />}
                          {row.detail || row.name}
                        </p>
                        {/* Account and length share a line — the length has to stay
                            visible here because, unlike a Time Block, nothing about
                            this card's size says how long the task takes. */}
                        <p className="relative truncate text-[9px] opacity-80">
                          {[row.account, formatDuration(row.minutes)].filter(Boolean).join(" | ")}
                          {row.source === "fixed"
                            ? " · Output Based"
                            : !row.timed
                            ? " · no set time"
                            : ""}
                          {overlay?.isOver && (
                            <span className="font-semibold text-terracotta"> · {formatDuration(overlay.overMinutes)} over</span>
                          )}
                        </p>
                        {row.todos.length > 0 && (
                          <div className="relative mt-0.5 border-t border-black/10 pt-0.5">
                            {row.todos.map((t) => (
                              <p key={t.id} className="truncate text-[9px] opacity-70 leading-tight">
                                · {t.text}
                              </p>
                            ))}
                          </div>
                        )}
                      </button>
                      );
                    })
                  )}
                  {unscheduledActualForDate(dayUserId, dateStr).map((item) => {
                    const overlay = unscheduledRowOverlay(item);
                    return (
                    <button
                      key={item.key}
                      type="button"
                      disabled={item.taskId == null}
                      onClick={() => {
                        if (item.taskId == null) return;
                        const task = assignedTasksAll.find((t) => t.id === item.taskId);
                        if (task) void openScheduleExisting(task, dateStr);
                      }}
                      title={`${item.name}${item.account ? " — " + item.account : ""} · ${formatDuration(item.minutes)} logged, not scheduled this day`}
                      className={`relative w-full overflow-hidden rounded-md border px-1.5 py-1 text-left shadow-sm ${categoryBlockClasses(item.category)} ${
                        item.moved ? "ring-2 ring-plum ring-inset" : "ring-2 ring-blue-500 ring-inset"
                      } ${item.taskId == null ? "cursor-default" : "cursor-pointer hover:opacity-90"}`}
                    >
                      {overlay && (
                        <div
                          className="pointer-events-none absolute inset-y-0 left-0 bg-ink/25"
                          style={{ width: `${overlay.fillPercent}%` }}
                        />
                      )}
                      <p className="relative truncate text-[11px] font-semibold leading-tight">{item.name}</p>
                      <p className="relative truncate text-[9px] opacity-80">
                        {[item.account, formatDuration(item.minutes)].filter(Boolean).join(" | ")}
                        {" · "}{item.moved ? "moved" : "not planned"}
                      </p>
                    </button>
                    );
                  })}
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
                  <div className="flex gap-1 mb-2">
                    {([
                      { label: "All", isActive: projectFilter.size === 0, onClick: () => setProjectFilter(new Set()) },
                      { label: "Operations only", isActive: operationIds.length > 0 && projectFilter.size === operationIds.length && operationIds.every((id) => projectFilter.has(id)), onClick: () => setProjectFilter(new Set(operationIds)) },
                      { label: "Objectives only", isActive: objectiveIds.length > 0 && projectFilter.size === objectiveIds.length && objectiveIds.every((id) => projectFilter.has(id)), onClick: () => setProjectFilter(new Set(objectiveIds)) },
                    ] as const).map((opt) => (
                      <button
                        key={opt.label}
                        type="button"
                        onClick={opt.onClick}
                        className={`px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors ${
                          opt.isActive ? "bg-sage text-white" : "bg-stone/10 text-stone hover:bg-stone/20"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
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

      {/* Account budgets. Agency-wide by design — an account's hours cap is
          the client's, not any one VA's, so this counts everyone's time on
          it regardless of whose calendar is open. Only accounts with at
          least one limit set show here; an account with none configured
          would just be three dashes, and most accounts don't have a cap. */}
      {(() => {
        const capped = accountUsage.filter(
          (a) => a.daily_hours_budget != null || a.weekly_hours_budget != null || a.monthly_hours_budget != null
        );
        if (capped.length === 0) return null;
        // `text` is the bare remaining duration — "12h 1m", or "-2h" if over —
        // not the full "X left of Y" sentence. That sentence reads fine once;
        // read down a column of them it's the same six words repeated with
        // two numbers changing, which is what actually made it hard to scan.
        // The colour already carries the status (sage/amber/terracotta), and
        // the full sentence still shows up on hover via `full`.
        const periodBadge = (usedMinutes: number, limitHours: number | null) => {
          if (limitHours == null) return null;
          const limitMinutes = Math.round(limitHours * 60);
          const remaining = limitMinutes - usedMinutes;
          const over = remaining < 0;
          const warn = !over && limitMinutes > 0 && usedMinutes / limitMinutes >= BUDGET_WARN_THRESHOLD;
          const full = over
            ? `${formatDuration(-remaining)} over ${formatDuration(limitMinutes)}`
            : `${formatDuration(remaining)} left of ${formatDuration(limitMinutes)}`;
          return { text: `${over ? "-" : ""}${formatDuration(Math.abs(remaining))}`, full, over, warn };
        };
        return (
          <div className="rounded-xl border border-sand bg-white p-3">
            <div className={`flex w-full items-center justify-between gap-2 ${accountBudgetsCollapsed ? "" : "mb-2"}`}>
              <button
                type="button"
                onClick={() => setAccountBudgetsCollapsed((v) => !v)}
                className="flex items-center gap-2 cursor-pointer"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  className={`text-bark transition-transform ${accountBudgetsCollapsed ? "" : "rotate-90"}`}
                >
                  <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="text-[10px] font-bold uppercase tracking-wide text-walnut">Account Budgets</span>
                <span className="text-[10px] text-stone">({capped.length})</span>
              </button>
              {/* Output Based work is paid per output, not per hour, so mixing
                  it into an hours grid is a category error, not just noise —
                  fixed_pay_tasks entries drop out of every number here when
                  checked (not just hidden — the account/VA totals recompute
                  without them). On a separate control from the collapse
                  toggle, and only shown once expanded, so it isn't reachable
                  without the numbers it affects being visible. */}
              {!accountBudgetsCollapsed && (
                <div className="flex shrink-0 items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[10px] text-stone cursor-pointer">
                    <input
                      type="checkbox"
                      checked={excludeOutputBased}
                      onChange={(e) => setExcludeOutputBased(e.target.checked)}
                      className="cursor-pointer"
                    />
                    Hide Output Based
                  </label>
                  {/* Manual override on top of Hide Output Based — for garbage
                      data (duplicate rows, a bad import) that isn't actually
                      Output Based but still needs to drop out of the totals
                      until it's fixed at the source. */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowVaFilterPicker((v) => !v)}
                      className={`flex items-center gap-1 rounded-lg border border-sand px-2 py-[3px] text-[10px] font-semibold transition-colors ${
                        excludedVaIds.length > 0 ? "bg-terracotta-soft text-terracotta" : "bg-white text-stone hover:bg-parchment"
                      }`}
                    >
                      {excludedVaIds.length > 0 ? `VAs (${excludedVaIds.length} hidden)` : "Filter VAs"}
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3 w-3">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    {showVaFilterPicker && (
                      <>
                        <div className="fixed inset-0 z-20" onClick={() => setShowVaFilterPicker(false)} />
                        <div className="absolute right-0 z-30 mt-2 w-60 rounded-xl border border-sand bg-white shadow-lg">
                          <div className="flex items-center justify-between border-b border-sand px-3 py-1.5">
                            <button type="button" onClick={() => setExcludedVaIds([])} className="text-[10px] font-semibold text-terracotta hover:underline">
                              All
                            </button>
                            <span className="text-[10px] text-stone">unchecked = hidden</span>
                            <button
                              type="button"
                              onClick={() => setExcludedVaIds(teamMembers.map((m) => m.id))}
                              className="text-[10px] font-semibold text-stone hover:underline"
                            >
                              None
                            </button>
                          </div>
                          <div className="max-h-56 overflow-y-auto py-1">
                            {teamMembers.map((m) => (
                              <label key={m.id} className="flex cursor-pointer items-center gap-2 px-3 py-1 hover:bg-parchment">
                                <input
                                  type="checkbox"
                                  checked={!excludedVaIds.includes(m.id)}
                                  onChange={(e) =>
                                    setExcludedVaIds((prev) =>
                                      e.target.checked ? prev.filter((id) => id !== m.id) : [...prev, m.id]
                                    )
                                  }
                                />
                                <span className="text-[12px] text-espresso">{m.full_name || m.username}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
            {accountBudgetsCollapsed && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {capped.map((a) => (
                  <span key={a.id} className="rounded-full bg-cream/60 px-2 py-[1px] text-[10px] text-espresso">
                    {a.name}
                  </span>
                ))}
              </div>
            )}
            {!accountBudgetsCollapsed && (
            <>
            {/* One table. Rows are VAs, each account gets a Weekly|Monthly
                column pair headed by that account's own budget, and the last
                column is the VA's own personal Weekly|Monthly remaining
                (their cap is one pool spent across every account below, not
                a separate number per account). The footer row is each
                account's own remaining — budget minus the column's own VA
                cells, nothing hand-entered. */}
            {(() => {
              const vaIds = Array.from(new Set(capped.flatMap((acc) => acc.by_va.map((v) => v.va_id))));
              if (vaIds.length === 0) return null;
              const vaNameById = new Map(capped.flatMap((acc) => acc.by_va.map((v) => [v.va_id, v.va_name] as const)));
              const thCls = "border-b border-sand px-2 pb-1 text-right text-[9px] font-bold uppercase tracking-wide text-walnut";
              return (
                <div className="overflow-x-auto rounded-lg border border-sand">
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr>
                        <th className="border-b border-sand px-2 pb-1 text-left text-[9px] font-bold uppercase tracking-wide text-walnut">
                          VA Names
                        </th>
                        {capped.map((a) => (
                          <th key={a.id} colSpan={2} className="border-b border-sand border-l px-2 pb-1 text-center text-[11px] font-bold text-espresso">
                            {a.name}
                          </th>
                        ))}
                        <th colSpan={2} className="border-b border-sand border-l px-2 pb-1 text-center text-[9px] font-bold uppercase tracking-wide text-walnut">
                          Remaining Time
                        </th>
                      </tr>
                      <tr>
                        <th className="pb-1" />
                        {capped.flatMap((a) => [
                          <th key={`${a.id}-w`} className={`${thCls} border-l`}>
                            {a.weekly_hours_budget != null ? `${a.weekly_hours_budget}h/wk` : "—"}
                          </th>,
                          <th key={`${a.id}-m`} className={thCls}>
                            {a.monthly_hours_budget != null ? `${a.monthly_hours_budget}h/mo` : "—"}
                          </th>,
                        ])}
                        <th className={`${thCls} border-l`}>Weekly</th>
                        <th className={thCls}>Monthly</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-sand/60">
                      {vaIds.map((vaId) => {
                        const name = vaNameById.get(vaId);
                        const personal = vaUsageTotals.find((p) => p.va_id === vaId);
                        const personalWeekly =
                          personal && personal.weekly_hours_budget != null
                            ? periodBadge(personal.weekly, personal.weekly_hours_budget)
                            : null;
                        const personalMonthly =
                          personal && personal.monthly_hours_budget != null
                            ? periodBadge(personal.monthly, personal.monthly_hours_budget)
                            : null;
                        return (
                          <tr key={vaId}>
                            <td className="max-w-[130px] truncate px-2 py-1 text-espresso" title={name}>
                              {name}
                              {personal && (personal.weekly_hours_budget != null || personal.monthly_hours_budget != null) && (
                                <span className="ml-1 text-[9px] font-normal text-stone">
                                  ({personal.weekly_hours_budget != null ? `${personal.weekly_hours_budget}h/wk` : "—"} |{" "}
                                  {personal.monthly_hours_budget != null ? `${personal.monthly_hours_budget}h/mo` : "—"})
                                </span>
                              )}
                            </td>
                            {capped.flatMap((a) => {
                              const share = a.by_va.find((v) => v.va_id === vaId);
                              return [
                                <td key={`${a.id}-w`} className="border-l border-sand/60 px-2 py-1 text-right">
                                  {share && (share.weekly > 0 || share.weekly_actual > 0)
                                    ? plannedActualReadout(share.weekly, share.weekly_actual, false, "xs")
                                    : <span className="text-espresso">—</span>}
                                </td>,
                                <td key={`${a.id}-m`} className="px-2 py-1 text-right">
                                  {share && (share.monthly > 0 || share.monthly_actual > 0)
                                    ? plannedActualReadout(share.monthly, share.monthly_actual, false, "xs")
                                    : <span className="text-espresso">—</span>}
                                </td>,
                              ];
                            })}
                            <td
                              className={`border-l border-sand/60 px-2 py-1 text-right font-semibold ${personalWeekly ? budgetTextClass(personalWeekly) : "text-stone/40"}`}
                              title={personalWeekly?.full}
                            >
                              {personalWeekly ? personalWeekly.text : "—"}
                            </td>
                            <td
                              className={`px-2 py-1 text-right font-semibold ${personalMonthly ? budgetTextClass(personalMonthly) : "text-stone/40"}`}
                              title={personalMonthly?.full}
                            >
                              {personalMonthly ? personalMonthly.text : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-sand font-semibold">
                        <td className="px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-walnut">Remaining time</td>
                        {capped.flatMap((a) => {
                          const weeklyRemain = periodBadge(a.weekly_minutes, a.weekly_hours_budget);
                          const monthlyRemain = periodBadge(a.monthly_minutes, a.monthly_hours_budget);
                          return [
                            <td key={`${a.id}-w`} className={`border-l border-sand/60 px-2 py-1 text-right ${weeklyRemain ? budgetTextClass(weeklyRemain) : "text-stone/40"}`} title={weeklyRemain?.full}>
                              {weeklyRemain ? weeklyRemain.text : "—"}
                            </td>,
                            <td key={`${a.id}-m`} className={`px-2 py-1 text-right ${monthlyRemain ? budgetTextClass(monthlyRemain) : "text-stone/40"}`} title={monthlyRemain?.full}>
                              {monthlyRemain ? monthlyRemain.text : "—"}
                            </td>,
                          ];
                        })}
                        <td className="border-l border-sand/60" />
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              );
            })()}
            </>
            )}
          </div>
        );
      })()}

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
              {plannedActualReadout(
                monthGrid.filter((d) => Number(d.slice(5, 7)) - 1 === monthMonth).reduce((sum, d) => sum + durationsForDate(d).totalMinutes, 0),
                monthGrid.filter((d) => Number(d.slice(5, 7)) - 1 === monthMonth).reduce((sum, d) => sum + (dayUserId ? actualMinutesByVaDate.get(`${dayUserId}|${d}`) ?? 0 : 0), 0),
                false,
                "sm"
              )}
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
                    const { planned, actual, off } = plannedActualForDate(dayUserId, dateStr);
                    if (planned === 0 && actual === 0) return null;
                    return <div className="mt-0.5">{plannedActualReadout(planned, actual, off, "xs")}</div>;
                  })()}
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
            {(["grid", "hours", "actual"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setWeekTab(tab)}
                className={`px-4 py-1.5 transition-colors ${
                  weekTab === tab ? "bg-terracotta text-white" : "bg-white text-stone hover:bg-cream"
                }`}
              >
                {tab === "grid" ? "Time Block" : tab === "hours" ? "Duration Block" : "Actual Timeline"}
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
              {plannedActualReadout(
                weekDates.reduce((sum, d) => sum + durationsForDate(d).totalMinutes, 0),
                weekDates.reduce((sum, d) => sum + (dayUserId ? actualMinutesByVaDate.get(`${dayUserId}|${d}`) ?? 0 : 0), 0),
                false,
                "sm"
              )}
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
          ) : weekTab === "actual" ? (
            renderActualTimeline(weekGrid)
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
                {(["grid", "hours", "actual"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setDayTab(tab)}
                    className={`px-4 py-1.5 transition-colors ${
                      dayTab === tab ? "bg-terracotta text-white" : "bg-white text-stone hover:bg-cream"
                    }`}
                  >
                    {tab === "grid" ? "Time Block" : tab === "hours" ? "Duration Block" : "Actual Timeline"}
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
                {(() => {
                  const { planned, actual, off } = plannedActualForDate(dayUserId, selectedDate);
                  return plannedActualReadout(planned, actual, off, "sm");
                })()}
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
                        const pos = blockPosition(task);
                        const { top, height } = pos;
                        const { col, cols } = overlap.get(task.id) ?? { col: 0, cols: 1 };
                        const isDueBlock = selectedDate === task.due_date && selectedDate !== task.start_date;
                        const frac = colIdx + col / cols;
                        const label = spanLabel(task, selectedDate);
                        const overlay = actualOverlay(vaId, selectedDate, task, pos);
                        const left = `calc(3.5rem + (100% - 3.5rem) * ${frac} / ${n})`;
                        const width = `calc((100% - 3.5rem) / ${n * cols} - 3px)`;
                        return (
                          <div
                            key={`${vaId}-${task.id}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => openEditBlock(task)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                openEditBlock(task);
                              }
                            }}
                            title={`${task.task_name}${task.account ? " — " + task.account : ""}`}
                            className={`pointer-events-auto absolute rounded-md border px-1.5 py-0.5 text-left shadow-sm hover:opacity-90 cursor-pointer ${categoryBlockClasses(task.category, isDueBlock)} ${overlay?.isOver ? "ring-2 ring-terracotta ring-inset" : ""}`}
                            style={{ top, height, left, width }}
                          >
                            {overlay && (
                              <div
                                className="pointer-events-none absolute inset-x-0 top-0 bg-ink/25"
                                style={{ height: overlay.shadeHeight }}
                              />
                            )}
                            {renderQueueButton(task, vaId)}
                            <p className="relative truncate text-[10px] font-semibold leading-tight">
                              {label && <span className="mr-1 rounded bg-black/10 px-1 text-[8px] font-bold uppercase">{label}</span>}
                              {task.isRecurring && <RecurringMark className="mr-0.5" />}
                              {task.task_detail || task.task_name}
                            </p>
                            {task.account && (
                              <p className="relative truncate text-[9px] opacity-80">{task.account}</p>
                            )}
                            {overlay?.isOver && (
                              <p
                                className="pointer-events-none absolute inset-x-0 -translate-y-full truncate rounded-b-md bg-terracotta px-1 text-center text-[8px] font-bold leading-tight text-white"
                                style={{ top: overlay.shadeHeight }}
                              >
                                {overlay.overMinutes}m over
                              </p>
                            )}
                          </div>
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
                  <span className="text-[11px] font-bold uppercase tracking-wide text-espresso">Planned / Actual</span>
                  {(() => {
                    const { planned, actual, off } = plannedActualForDate(dayUserId, selectedDate);
                    return plannedActualReadout(planned, actual, off, "md");
                  })()}
                </div>
                {dayDurations.rows.length === 0 ? (
                  <p className="px-3 py-6 text-center text-[12px] text-stone">
                    Nothing blocked on this day yet.
                  </p>
                ) : (
                  <div className="space-y-1.5 p-2">
                    {dayDurations.rows.map((row) => {
                      const overlay = durationRowOverlay(dayUserId, selectedDate, row);
                      return (
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
                        title={`${row.name}${row.account ? " — " + row.account : ""} · ${formatDuration(row.minutes)}`}
                        className={`relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-md border px-2 py-1.5 text-left shadow-sm transition-opacity ${categoryBlockClasses(row.category)} ${
                          row.source === "fixed" ? "cursor-default" : "hover:opacity-90 cursor-pointer"
                        } ${overlay?.isOver ? "ring-2 ring-terracotta ring-inset" : ""}`}
                      >
                        {overlay && (
                          <div
                            className="pointer-events-none absolute inset-y-0 left-0 bg-ink/25"
                            style={{ width: `${overlay.fillPercent}%` }}
                          />
                        )}
                        <span className="relative min-w-0">
                          {/* Styled as the grid block itself, not a dot beside
                              neutral text — the same task reads the same way in
                              either view. Colours come from categoryBlockClasses,
                              so the secondary line rides the block's own text
                              colour at reduced opacity rather than fighting it. */}
                          {/* Client detail is the title so the row reads at a
                              glance; the full task name is on hover via title. */}
                          <span className="block truncate text-[13px] font-semibold">
                            {row.recurring && <RecurringMark className="mr-0.5" />}
                            {row.detail || row.name}
                          </span>
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
                        <span className="relative shrink-0 text-right text-[12px] font-semibold">
                          {formatDuration(row.minutes)}
                          {overlay?.isOver && (
                            <span className="block text-[10px] font-semibold text-terracotta">
                              {formatDuration(overlay.overMinutes)} over
                            </span>
                          )}
                        </span>
                      </button>
                      );
                    })}
                  </div>
                )}
                {/* Real work today with nowhere on TODAY's plan to attach to —
                    most often a task kept going across several days without
                    its start_date ever moving forward, so it's still sitting
                    on whichever earlier day it was first scheduled. Already
                    counted in the Planned/Actual total above; this just makes
                    it visible instead of silently missing from the list. */}
                {(() => {
                  const unscheduled = unscheduledActualForDate(dayUserId, selectedDate);
                  if (unscheduled.length === 0) return null;
                  return (
                  <div className="space-y-1.5 border-t border-sand p-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-espresso">
                      Worked, not on this day&apos;s plan
                    </p>
                    {unscheduled.map((item) => {
                      const overlay = unscheduledRowOverlay(item);
                      return (
                      <button
                        key={item.key}
                        type="button"
                        disabled={item.taskId == null}
                        onClick={() => {
                          if (item.taskId == null) return;
                          const task = assignedTasksAll.find((t) => t.id === item.taskId);
                          if (task) void openScheduleExisting(task, selectedDate);
                        }}
                        title={`${item.name}${item.account ? " — " + item.account : ""} · ${formatDuration(item.minutes)} logged today${
                          item.moved ? ", scheduled a different day" : ", never scheduled"
                        }`}
                        className={`relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-md border px-2 py-1.5 text-left shadow-sm transition-opacity ${categoryBlockClasses(item.category)} ${
                          item.moved ? "ring-2 ring-plum ring-inset" : "ring-2 ring-blue-500 ring-inset"
                        } ${item.taskId == null ? "cursor-default" : "hover:opacity-90 cursor-pointer"}`}
                      >
                        {overlay && (
                          <div
                            className="pointer-events-none absolute inset-y-0 left-0 bg-ink/25"
                            style={{ width: `${overlay.fillPercent}%` }}
                          />
                        )}
                        <span className="relative min-w-0">
                          <span className="block truncate text-[13px] font-semibold">{item.name}</span>
                          <span className="block truncate text-[10px] opacity-80">
                            {item.account ?? "—"} · {item.moved ? "scheduled a different day" : "never scheduled"}
                          </span>
                        </span>
                        <span className="relative shrink-0 text-right text-[12px] font-semibold">
                          {formatDuration(item.minutes)}
                        </span>
                      </button>
                      );
                    })}
                  </div>
                  );
                })()}
              </div>
            ) : dayTab === "actual" ? (
              <div className="rounded-lg border border-sand overflow-hidden">
                <div className="border-b border-sand bg-parchment px-3 py-2">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-espresso">Actual Timeline</span>
                  <p className="mt-0.5 text-[10px] text-stone">
                    The plan, reflowed by what really happened — a task that ran long pushes what comes after it later, absorbing into any open gaps first.
                  </p>
                </div>
                <div className={GRID_SCROLL_CLASS}>
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
                    <div className="pointer-events-none absolute inset-0">
                      {(() => {
                        const dayTasks = scheduledForDate(selectedDate);
                        const positions = actualTimelinePositions(selectedDate, dayUserId);
                        return dayTasks.map((task) => {
                          const cascaded = positions.get(task.id);
                          if (!cascaded) return null;
                          const { top, height, isOver, overrun } = cascaded;
                          const plan = blockPosition(task);
                          // The plan's own box, faint and dashed, only when this
                          // task actually moved or grew — the spill/readjustment
                          // itself, not just a restated position. A task that
                          // landed exactly where it was planned draws no ghost.
                          const moved = top !== plan.top || height !== plan.height;
                          return (
                            <div key={task.id} className="pointer-events-none absolute inset-x-0">
                              {moved && (
                                <div
                                  className="absolute left-16 right-2 rounded-md border-2 border-dashed border-stone/40"
                                  style={{ top: plan.top, height: plan.height }}
                                />
                              )}
                              <button
                                type="button"
                                onClick={() => openEditBlock(task)}
                                title={[
                                  `${task.task_name}${task.account ? " — " + task.account : ""}`,
                                  moved ? timelineMoveSummary(plan, { top, height }) : null,
                                ].filter(Boolean).join(" · ")}
                                className={`pointer-events-auto absolute left-16 right-2 rounded-md px-2 py-1 text-left shadow-sm hover:opacity-90 cursor-pointer ${categoryBlockClasses(task.category)} ${moved ? "border-2 border-plum" : "border"} ${isOver ? "ring-2 ring-terracotta ring-inset" : ""}`}
                                style={{ top, height }}
                              >
                                <p className="truncate text-[11px] font-semibold">
                                  {task.isRecurring && <RecurringMark className="mr-0.5" />}
                                  {task.task_detail || task.task_name}
                                </p>
                                {task.account && (
                                  <p className="truncate text-[10px] opacity-80">{task.account}</p>
                                )}
                                {isOver && (
                                  <p className="absolute right-1.5 top-1 rounded-full bg-terracotta px-1.5 text-[8px] font-bold leading-tight text-white">
                                    +{formatDuration(overrun)}
                                  </p>
                                )}
                              </button>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                </div>
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
                      const pos = blockPosition(task);
                      const { top, height } = pos;
                      // Due-date-driven blocks render fully opaque; start-date-driven
                      // blocks (the default) stay at 70% opacity.
                      const isDueBlock = selectedDate === task.due_date && selectedDate !== task.start_date;
                      const { col, cols } = overlapLayout.get(task.id) ?? { col: 0, cols: 1 };
                      const label = spanLabel(task, selectedDate);
                      const overlay = actualOverlay(dayUserId, selectedDate, task, pos);
                      // Reserve room on the right for a due-time badge when one
                      // falls inside this block's time span, so the two sit side
                      // by side instead of the badge floating on top of the block.
                      // Inclusive of the block's end: a task running 8-9 and due
                      // at 9 puts the marker exactly on the bottom edge, and the
                      // marker is drawn 7px above its own position, so it lands
                      // on the block. Treat the edge as a collision and dock it.
                      const collidesWithDueMarker = dueMarkerTops.some((markerTop) => markerTop >= top && markerTop <= top + height);
                      const dueGutter = collidesWithDueMarker ? 96 : 0;
                      const left = `calc(4rem + (100% - 4rem - 0.5rem - ${dueGutter}px) * ${col} / ${cols})`;
                      const width = `calc((100% - 4rem - 0.5rem - ${dueGutter}px) / ${cols} - 4px)`;
                      return (
                        <div
                          key={task.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => openEditBlock(task)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openEditBlock(task);
                            }
                          }}
                          title={`${task.task_name}${task.account ? " — " + task.account : ""}`}
                          className={`pointer-events-auto absolute rounded-md border px-2 py-1 text-left shadow-sm hover:opacity-90 cursor-pointer ${categoryBlockClasses(task.category, isDueBlock)} ${overlay?.isOver ? "ring-2 ring-terracotta ring-inset" : ""}`}
                          style={{ top, height, left, width }}
                        >
                          {overlay && (
                            <div
                              className="pointer-events-none absolute inset-x-0 top-0 bg-ink/25"
                              style={{ height: overlay.shadeHeight }}
                            />
                          )}
                          {renderQueueButton(task, dayUserId)}
                          {overlay?.isOver && (
                            <p
                              className="pointer-events-none absolute inset-x-0 -translate-y-full z-10 truncate rounded-b-md bg-terracotta px-1 text-center text-[8px] font-bold leading-tight text-white"
                              style={{ top: overlay.shadeHeight }}
                            >
                              {overlay.overMinutes}m over
                            </p>
                          )}
                          <div className="relative flex h-full items-start gap-2">
                            <div className="min-w-0 shrink-0 max-w-[55%]">
                              {/* Client detail is the title so the card reads at a
                                  glance; the full task name + account is available
                                  on hover via the block's title attribute. */}
                              <p className="truncate text-[11px] font-semibold">
                                {label && (
                                  <span className="mr-1 rounded bg-black/10 px-1 text-[9px] font-bold uppercase tracking-wide">
                                    {label}
                                  </span>
                                )}
                                {task.isRecurring && <RecurringMark className="mr-0.5" />}
                                {task.task_detail || task.task_name}
                              </p>
                              {task.account && (
                                <p className="truncate text-[10px] opacity-80">{task.account}</p>
                              )}
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
                        </div>
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
              {/* Only when there's a saved task to describe — "Add Task" has no
                  details yet, so it goes straight to the form. */}
              {editingBlockId && editingTaskFull && (
                <div className="flex rounded-lg border border-sand overflow-hidden text-[12px] font-semibold">
                  {([
                    ["details", "Details"],
                    ["edit", "Edit Task"],
                  ] as const).map(([tab, label]) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setModalTab(tab)}
                      className={`flex-1 px-3 py-1.5 transition-colors ${
                        modalTab === tab ? "bg-terracotta text-white" : "bg-white text-stone hover:bg-cream"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {editingBlockId && editingTaskFull && modalTab === "details" ? (
                <TaskDetailsView task={editingTaskFull} people={teamMembers} onEdit={() => setModalTab("edit")} />
              ) : (
              <>
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
                ref={taskEditorRef}
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
                // Edit mode hides TaskEditor's own footer — Status & Files below
                // needs to save alongside the form fields in one "Save Changes",
                // handled by handleSaveEditPanel instead.
                hideFooter={Boolean(editingBlockId)}
                onCancel={() => setShowForm(false)}
                onSaved={() => {
                  // Editing: don't close yet — handleSaveEditPanel still has the
                  // status to save, and closes the form itself once that's done.
                  if (editingBlockId) {
                    void refreshAfterScheduleChange();
                    return;
                  }
                  setShowForm(false);
                  void refreshAfterScheduleChange();
                  if (taskMode === "output_based") void fetchFixedItems();
                }}
              />

              {editingBlockId && editingTaskFull && modalTab === "edit" && (
                <>
                  <Section title="Status & Files" defaultOpen>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">
                        Update Status
                      </label>
                      <select
                        value={panelStatus}
                        onChange={(e) => setPanelStatus(e.target.value as AssignedTaskStatus)}
                        className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                      >
                        {(
                          [
                            "pending", "on_queue", "in_progress", "submitted", "reviewing",
                            "revision_needed", "approved", "completed", "paid", "cancelled",
                          ] as AssignedTaskStatus[]
                        )
                          // A VA on a task that requires review can only move it
                          // through their own side of the flow — same restriction
                          // Assignment's own Status & Files enforces.
                          .filter((value) =>
                            isAdminOrManager || !editingTaskFull.review_required
                              ? true
                              : (["on_queue", "pending", "in_progress", "submitted"] as AssignedTaskStatus[]).includes(value)
                          )
                          .map((value) => (
                            <option key={value} value={value}>
                              {statusLabel(value)}
                            </option>
                          ))}
                      </select>
                    </div>
                  </Section>

                  {panelMsg?.type === "err" && <p className="text-xs font-medium text-red-500">{panelMsg.text}</p>}
                  {panelMsg?.type === "ok" && <p className="text-xs font-medium text-sage">{panelMsg.text}</p>}

                  <div className="flex items-center justify-end gap-3 pt-1">
                    {editingBlockId && (
                      <button
                        type="button"
                        onClick={() => void handleDuplicateEditPanel()}
                        disabled={panelSaving}
                        className="cursor-pointer rounded-lg border border-sand px-3 py-2 text-[13px] font-semibold text-espresso transition-colors hover:bg-parchment disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Duplicate
                      </button>
                    )}
                    {editingBlockId && isAdminOrManager && (
                      <button
                        type="button"
                        onClick={() => void handleConvertEditPanel()}
                        disabled={panelSaving}
                        className="cursor-pointer rounded-lg border border-sand px-3 py-2 text-[13px] font-semibold text-espresso transition-colors hover:bg-parchment disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Switch to Output Based
                      </button>
                    )}
                    <button type="button" onClick={() => setShowForm(false)} className="cursor-pointer text-xs text-stone hover:text-espresso">
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSaveEditPanel()}
                      disabled={panelSaving}
                      className="cursor-pointer rounded-lg bg-terracotta px-5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#a85840] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {panelSaving ? "Saving..." : "Save Changes"}
                    </button>
                  </div>
                </>
              )}
              </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
