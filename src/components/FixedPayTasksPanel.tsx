"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { hasBroadAdminAccess } from "@/lib/financialAccess";
import type { FixedPayTaskWithClaimer } from "@/types/database";
import { normalizePosition } from "@/types/database";
import ColumnHeader from "@/components/table/ColumnHeader";
import ColumnVisibilityPicker from "@/components/table/ColumnVisibilityPicker";
import ToolbarFilterDropdown from "@/components/table/ToolbarFilterDropdown";
import TableRowDetailPanel from "@/components/table/TableRowDetailPanel";
import TaskEditor from "@/components/TaskEditor";
import { useColumnPrefs, type ColumnDef } from "@/components/table/useColumnPrefs";
import { useFilterPrefs } from "@/components/table/useFilterPrefs";

const VIEW_FILTER_PILLS: Array<{ value: "all" | "submitted" | "active" | "inactive" | "archived" | "trash"; label: string }> = [
  { value: "all", label: "All" },
  { value: "submitted", label: "Submitted" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "archived", label: "Archived" },
  { value: "trash", label: "Trash" },
];

const STATUS_OPTIONS: Array<FixedPayTaskWithClaimer["status"]> = ["open", "pending", "on_queue", "in_progress", "submitted", "revision_needed", "completed", "cancelled", "paid"];
// Statuses the VA themselves may pick from the task panel — mirrors
// VA_EDITABLE_STATUSES on the server, which is the actual enforcement point.
const VA_STATUS_OPTIONS: Array<FixedPayTaskWithClaimer["status"]> = ["open", "pending", "on_queue", "in_progress", "submitted"];
const STATUS_LABELS: Record<FixedPayTaskWithClaimer["status"], string> = {
  open: "Open",
  pending: "Pending",
  on_queue: "Queue",
  in_progress: "In Progress",
  submitted: "Submit for Review",
  revision_needed: "Revision Needed",
  completed: "Completed",
  cancelled: "Cancelled",
  paid: "Paid",
};
const STATUS_CLASSES: Record<FixedPayTaskWithClaimer["status"], string> = {
  open: "bg-slate-blue-soft text-slate-blue",
  pending: "bg-parchment text-walnut",
  on_queue: "bg-stone/10 text-stone",
  in_progress: "bg-amber-100 text-amber-700",
  submitted: "bg-sky-50 text-sky-600",
  revision_needed: "bg-amber-soft text-amber",
  completed: "bg-sage-soft text-sage",
  cancelled: "bg-red-100 text-red-500",
  paid: "bg-plum-soft text-plum",
};

type PanelMode = "create" | "edit" | "view" | null;
type ActiveFilter = "all" | "submitted" | "active" | "inactive" | "archived" | "trash";
type CreateMode = "hourly" | "fixed_pay";

type StoredFixedPayFilters = {
  activeFilter?: ActiveFilter;
  filterTaskNames?: string[];
  filterAccounts?: string[];
  filterCategories?: string[];
  filterStatuses?: FixedPayTaskWithClaimer["status"][];
  filterRates?: number[];
  filterStartDates?: string[];
  filterDueDates?: string[];
  filterClaimStates?: string[];
  filterCreators?: string[];
  filterAssignedBy?: string[];
  filterProjects?: string[];
};

function formatRate(rate: number | string | null | undefined) {
  const parsed = typeof rate === "number" ? rate : Number(rate ?? NaN);
  if (Number.isNaN(parsed)) return "—";
  return `$${parsed.toFixed(2)}`;
}

function formatTimestamp(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// start_date/due_date are plain dates (YYYY-MM-DD) — parse as UTC-noon so the
// displayed day never shifts backward in timezones behind UTC.
function formatDateOnly(value: string | null) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const TABLE_COLUMNS: ColumnDef[] = [
  { key: "task_name", label: "Task Name", defaultWidth: 200 },
  { key: "account", label: "Account", defaultWidth: 140 },
  { key: "category", label: "Category", defaultWidth: 140 },
  { key: "status", label: "Status", defaultWidth: 140 },
  { key: "rate", label: "Rate", defaultWidth: 90 },
  { key: "start_date", label: "Start Date", defaultWidth: 110 },
  { key: "due_date", label: "Due Date", defaultWidth: 110 },
  { key: "assigned_by", label: "Assigned By", defaultWidth: 130 },
  { key: "claimed", label: "Claimed", defaultWidth: 130 },
  { key: "created", label: "Created", defaultWidth: 150 },
  { key: "active", label: "Active", defaultWidth: 90 },
];

type FixedPayTasksPanelProps = {
  // Bumped by the parent (e.g. after a claim in AvailableTasksWidget) to refetch.
  refreshKey?: number;
};

export default function FixedPayTasksPanel({ refreshKey = 0 }: FixedPayTasksPanelProps) {
  const supabase = useMemo(() => createClient(), []);

  const [profileLoading, setProfileLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentRole, setCurrentRole] = useState<string | null>(null);
  const [currentPosition, setCurrentPosition] = useState<string | null>(null);
  const [currentPayRateType, setCurrentPayRateType] = useState<string | null>(null);
  const [canSeeAvailableTasks, setCanSeeAvailableTasks] = useState(false);
  const [currentPayRate, setCurrentPayRate] = useState<number | null>(null);

  const [tasks, setTasks] = useState<FixedPayTaskWithClaimer[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");
  const [filterTaskNames, setFilterTaskNames] = useState<string[]>([]);
  const [filterAccounts, setFilterAccounts] = useState<string[]>([]);
  const [filterCategories, setFilterCategories] = useState<string[]>([]);
  const [filterStatuses, setFilterStatuses] = useState<FixedPayTaskWithClaimer["status"][]>([]);
  const [filterRates, setFilterRates] = useState<number[]>([]);
  const [filterStartDates, setFilterStartDates] = useState<string[]>([]);
  const [filterDueDates, setFilterDueDates] = useState<string[]>([]);
  const [filterClaimStates, setFilterClaimStates] = useState<string[]>([]);
  const [filterCreators, setFilterCreators] = useState<string[]>([]);
  const [filterAssignedBy, setFilterAssignedBy] = useState<string[]>([]);
  const [filterProjects, setFilterProjects] = useState<string[]>([]);
  const [panelMode, setPanelMode] = useState<PanelMode>(null);
  const [selectedTask, setSelectedTask] = useState<FixedPayTaskWithClaimer | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([]);
  const [createMode, setCreateMode] = useState<CreateMode>("fixed_pay");
  const [statusSaving, setStatusSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const headerSelectAllRef = useRef<HTMLInputElement | null>(null);

  const { widths: columnWidths, hidden: hiddenColumns, setColumnWidth, toggleColumnVisible } = useColumnPrefs(
    "fixed-pay-tasks-va",
    currentUserId,
    TABLE_COLUMNS
  );

  // Remember the filter selections across visits — same pattern as Timelog's
  // useFilterPrefs (localStorage instant, /api/table-prefs durable).
  const { ready: filterPrefsReady, stored: storedFilters, persist: persistFilters } = useFilterPrefs<StoredFixedPayFilters>(
    "fixed-pay-tasks-va",
    currentUserId
  );
  const filterPrefsAppliedRef = useRef(false);

  useEffect(() => {
    if (!filterPrefsReady || filterPrefsAppliedRef.current) return;
    filterPrefsAppliedRef.current = true;
    if (storedFilters) {
      if (storedFilters.activeFilter !== undefined) setActiveFilter(storedFilters.activeFilter);
      if (storedFilters.filterTaskNames !== undefined) setFilterTaskNames(storedFilters.filterTaskNames);
      if (storedFilters.filterAccounts !== undefined) setFilterAccounts(storedFilters.filterAccounts);
      if (storedFilters.filterCategories !== undefined) setFilterCategories(storedFilters.filterCategories);
      if (storedFilters.filterStatuses !== undefined) setFilterStatuses(storedFilters.filterStatuses);
      if (storedFilters.filterRates !== undefined) setFilterRates(storedFilters.filterRates);
      if (storedFilters.filterStartDates !== undefined) setFilterStartDates(storedFilters.filterStartDates);
      if (storedFilters.filterDueDates !== undefined) setFilterDueDates(storedFilters.filterDueDates);
      if (storedFilters.filterClaimStates !== undefined) setFilterClaimStates(storedFilters.filterClaimStates);
      if (storedFilters.filterCreators !== undefined) setFilterCreators(storedFilters.filterCreators);
      if (storedFilters.filterAssignedBy !== undefined) setFilterAssignedBy(storedFilters.filterAssignedBy);
      if (storedFilters.filterProjects !== undefined) setFilterProjects(storedFilters.filterProjects);
    }
  }, [filterPrefsReady, storedFilters]);

  useEffect(() => {
    if (!filterPrefsReady || !filterPrefsAppliedRef.current) return;
    persistFilters({
      activeFilter, filterTaskNames, filterAccounts, filterCategories, filterStatuses, filterRates,
      filterStartDates, filterDueDates, filterClaimStates, filterCreators, filterAssignedBy, filterProjects,
    });
  }, [
    filterPrefsReady, activeFilter, filterTaskNames, filterAccounts, filterCategories, filterStatuses, filterRates,
    filterStartDates, filterDueDates, filterClaimStates, filterCreators, filterAssignedBy, filterProjects, persistFilters,
  ]);

  // Same eligibility as the fixed-pay-tasks POST route: Output Based VAs, or hourly VAs
  // with the hybrid "Avail. Tasks" toggle on. Hybrid VAs additionally get the
  // hourly/fixed-pay create toggle.
  const isPerTaskVa = normalizePosition(currentPosition) === "Output Based" || currentPayRateType === "per_task";
  const isEligibleVa = currentRole === "va" && (isPerTaskVa || canSeeAvailableTasks);
  const isAdminOrManager = hasBroadAdminAccess({ role: currentRole });
  const canViewPage = isEligibleVa || isAdminOrManager;
  // Hybrid = labeled as an hourly VA (Part Time or Full Time position) with
  // the "Available Tasks" toggle on in Team management. Keyed on position,
  // not pay_rate_type, so it can't be thrown off by rate-field edge cases.
  const isHybrid =
    ["Part Time", "Full Time"].includes(normalizePosition(currentPosition) ?? "") && canSeeAvailableTasks;


  const fetchCurrentUser = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;

      setCurrentUserId(data.user.id);

      const { data: profile } = await supabase
        .from("profiles")
        .select("role, position, pay_rate_type, can_see_available_tasks, pay_rate")
        .eq("id", data.user.id)
        .single();

      setCurrentRole(profile?.role ?? null);
      setCurrentPosition(profile?.position ?? null);
      setCurrentPayRateType(profile?.pay_rate_type ?? null);
      setCanSeeAvailableTasks(Boolean(profile?.can_see_available_tasks));
      setCurrentPayRate(profile?.pay_rate != null ? Number(profile.pay_rate) : null);
    } catch {
      // leave the page in its access-denied state if the profile lookup fails
    } finally {
      setProfileLoading(false);
    }
  }, [supabase]);

  const fetchTasks = useCallback(async () => {
    if (!currentUserId) return;
    setLoading(true);
    try {
      const res = await fetch("/api/fixed-pay-tasks", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { tasks?: FixedPayTaskWithClaimer[] } | FixedPayTaskWithClaimer[];
      const rows = Array.isArray(json) ? json : json.tasks ?? [];
      // The API already scopes VA responses to unclaimed + their own; admins/
      // managers get every task and should see all of them here too — only
      // narrow to "mine" for VAs.
      setTasks(
        isAdminOrManager
          ? rows
          : rows.filter((task) => task.claimed_by_me || task.claimed_by === currentUserId || task.created_by === currentUserId)
      );
    } catch {
      setTasks([]);
      setMessage({ type: "err", text: "Unable to load fixed pay tasks." });
    } finally {
      setLoading(false);
    }
  }, [currentUserId, isAdminOrManager]);

  useEffect(() => {
    void fetchCurrentUser();
  }, [fetchCurrentUser]);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks, refreshKey]);

  const taskNameFilterOptions = useMemo(
    () => Array.from(new Set(tasks.map((task) => task.task_name).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [tasks]
  );
  const accountFilterOptions = useMemo(
    () => Array.from(new Set(tasks.map((task) => task.account ?? "").filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [tasks]
  );
  const categoryFilterOptions = useMemo(
    () => Array.from(new Set(tasks.map((task) => task.category ?? "").filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [tasks]
  );
  const creatorFilterOptions = useMemo(
    () =>
      Array.from(
        new Set(tasks.map((task) => task.created_by_profile?.full_name || task.created_by_profile?.username || "").filter(Boolean))
      ).sort((a, b) => a.localeCompare(b)),
    [tasks]
  );
  const assignedByFilterOptions = useMemo(
    () =>
      Array.from(
        new Set(tasks.map((task) => task.assigned_by_profile?.full_name || task.assigned_by_profile?.username || "").filter(Boolean))
      ).sort((a, b) => a.localeCompare(b)),
    [tasks]
  );
  const projectFilterOptions = useMemo(
    () => Array.from(new Set(tasks.map((task) => task.projects?.name ?? "").filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [tasks]
  );

  const filterBaseTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (activeFilter === "submitted" && task.status !== "submitted") return false;
      if (activeFilter === "active" && (!task.is_active || task.archived_at || task.deleted_at)) return false;
      if (activeFilter === "inactive" && (task.is_active || task.archived_at || task.deleted_at)) return false;
      if (activeFilter === "archived" && (!task.archived_at || task.deleted_at)) return false;
      if (activeFilter === "trash" && !task.deleted_at) return false;
      if (filterTaskNames.length > 0 && !filterTaskNames.includes(task.task_name ?? "")) return false;
      if (filterAccounts.length > 0 && !filterAccounts.includes(task.account ?? "")) return false;
      if (filterCategories.length > 0 && !filterCategories.includes(task.category ?? "")) return false;
      if (filterStatuses.length > 0 && !filterStatuses.includes(task.status)) return false;
      return true;
    });
  }, [activeFilter, filterAccounts, filterCategories, filterStatuses, filterTaskNames, tasks]);

  const rateFilterOptions = useMemo(
    () =>
      Array.from(new Set(filterBaseTasks.map((task) => Number(task.rate)).filter((rate) => Number.isFinite(rate)))).sort((a, b) => a - b),
    [filterBaseTasks]
  );

  const startDateFilterOptions = useMemo(
    () => Array.from(new Set(filterBaseTasks.map((task) => task.start_date).filter((v): v is string => Boolean(v)))).sort(),
    [filterBaseTasks]
  );
  const dueDateFilterOptions = useMemo(
    () => Array.from(new Set(filterBaseTasks.map((task) => task.due_date).filter((v): v is string => Boolean(v)))).sort(),
    [filterBaseTasks]
  );

  const filteredTasks = useMemo(() => {
    return filterBaseTasks.filter((task) => {
      if (filterRates.length > 0 && !filterRates.includes(Number(task.rate))) return false;
      if (filterStartDates.length > 0 && !filterStartDates.includes(task.start_date ?? "")) return false;
      if (filterDueDates.length > 0 && !filterDueDates.includes(task.due_date ?? "")) return false;
      if (filterClaimStates.length > 0) {
        const mine = task.claimed_by_me || task.claimed_by === currentUserId;
        const state = !task.claimed_by ? "unclaimed" : mine ? "mine" : "others";
        if (!filterClaimStates.includes(state)) return false;
      }
      if (filterCreators.length > 0) {
        const creator = task.created_by_profile?.full_name || task.created_by_profile?.username || "";
        if (!filterCreators.includes(creator)) return false;
      }
      if (filterAssignedBy.length > 0) {
        const assignedByName = task.assigned_by_profile?.full_name || task.assigned_by_profile?.username || "";
        if (!filterAssignedBy.includes(assignedByName)) return false;
      }
      if (filterProjects.length > 0 && !filterProjects.includes(task.projects?.name ?? "")) return false;
      return true;
    });
  }, [filterBaseTasks, filterRates, filterStartDates, filterDueDates, filterClaimStates, filterCreators, filterAssignedBy, filterProjects, currentUserId]);

  const selectedTaskIdSet = useMemo(() => new Set(selectedTaskIds), [selectedTaskIds]);
  const allVisibleSelected = filteredTasks.length > 0 && filteredTasks.every((task) => selectedTaskIdSet.has(task.id));
  const someVisibleSelected = filteredTasks.some((task) => selectedTaskIdSet.has(task.id)) && !allVisibleSelected;

  useEffect(() => {
    if (headerSelectAllRef.current) {
      headerSelectAllRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);

  const openCreatePanel = useCallback(() => {
    setPanelMode("create");
    setSelectedTask(null);
    // Non-hybrid fixed-pay VAs skip the toggle and land straight on the fixed-pay form.
    setCreateMode("fixed_pay");
    setMessage(null);
  }, []);

  const openViewPanel = useCallback((task: FixedPayTaskWithClaimer) => {
    setPanelMode("view");
    setSelectedTask(task);
    setMessage(null);
  }, []);

  const openEditPanel = useCallback((task: FixedPayTaskWithClaimer) => {
    setPanelMode("edit");
    setSelectedTask(task);
    setMessage(null);
  }, []);

  const closePanel = useCallback(() => {
    setPanelMode(null);
    setSelectedTask(null);
  }, []);

  const toggleTaskSelection = useCallback((taskId: number) => {
    setSelectedTaskIds((current) =>
      current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId]
    );
  }, []);

  const toggleVisibleSelection = useCallback(() => {
    setSelectedTaskIds((current) => {
      const visibleIds = filteredTasks.map((task) => task.id);
      if (visibleIds.length === 0) return current;
      const visibleSet = new Set(visibleIds);
      const hasAllVisible = visibleIds.every((id) => current.includes(id));
      if (hasAllVisible) {
        return current.filter((id) => !visibleSet.has(id));
      }
      return Array.from(new Set([...current, ...visibleIds]));
    });
  }, [filteredTasks]);

  const handleStatusChange = useCallback(
    async (taskId: number, status: FixedPayTaskWithClaimer["status"]) => {
      setStatusSaving(true);
      setMessage(null);
      try {
        const res = await fetch(`/api/fixed-pay-tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        if (!res.ok) {
          let errorText = `HTTP ${res.status}`;
          try {
            const data = (await res.json()) as { error?: string };
            if (data.error) errorText = data.error;
          } catch {
            // ignore parse failures
          }
          throw new Error(errorText);
        }
        const { task } = (await res.json()) as { task: FixedPayTaskWithClaimer };
        setTasks((current) => current.map((t) => (t.id === taskId ? { ...t, ...task } : t)));
        setSelectedTask((current) => (current && current.id === taskId ? { ...current, ...task } : current));
      } catch (error) {
        setMessage({ type: "err", text: error instanceof Error ? error.message : "Unable to update status." });
      } finally {
        setStatusSaving(false);
      }
    },
    []
  );

  const handleDelete = useCallback(
    async (taskId: number) => {
      if (!confirm("Delete this task? This can't be undone.")) return;
      setDeleting(true);
      setMessage(null);
      try {
        const res = await fetch(`/api/fixed-pay-tasks/${taskId}`, { method: "DELETE" });
        if (!res.ok) {
          let errorText = `HTTP ${res.status}`;
          try {
            const data = (await res.json()) as { error?: string };
            if (data.error) errorText = data.error;
          } catch {
            // ignore parse failures
          }
          throw new Error(errorText);
        }
        setTasks((current) => current.filter((t) => t.id !== taskId));
        setPanelMode(null);
        setSelectedTask(null);
      } catch (error) {
        setMessage({ type: "err", text: error instanceof Error ? error.message : "Unable to delete task." });
      } finally {
        setDeleting(false);
      }
    },
    []
  );

  // TaskEditor's onSaved callback — lands on the details view instead of
  // closing, so the VA sees exactly what was saved instead of reopening it.
  const handleTaskSaved = useCallback(
    (task: { id: number; [key: string]: unknown }) => {
      // A time-based create (via the Task Type toggle) lands in
      // assigned_tasks, not this panel's fixed_pay_tasks list — there's
      // nothing here to select/view, just confirm and close.
      if (panelMode === "create" && createMode === "hourly") {
        setMessage({ type: "ok", text: "Task created — find it in My Tasks." });
        closePanel();
        return;
      }
      setPanelMode((prevMode) => {
        setMessage({ type: "ok", text: prevMode === "edit" ? "Task updated." : "Task created." });
        return "view";
      });
      setSelectedTask(task as unknown as FixedPayTaskWithClaimer);
      void fetchTasks();
    },
    [fetchTasks, panelMode, createMode, closePanel]
  );

  // Mirrors the server-side check in the PATCH/DELETE routes: a VA may only
  // edit or delete a task they claimed, and only before it's been reviewed.
  // Admins/managers can edit any fixed-pay/output-based task (the PATCH API
  // already accepts their edits on any field/status via its admin path). VAs
  // stay restricted to their own claimed task while it's still in a
  // VA-editable status.
  const canEditSelectedTask = Boolean(
    selectedTask &&
    (isAdminOrManager ||
      ((selectedTask.claimed_by_me || selectedTask.claimed_by === currentUserId) &&
        VA_STATUS_OPTIONS.includes(selectedTask.status)))
  );

  if (profileLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl bg-parchment" />
        ))}
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <div className="rounded-xl border border-dashed border-sand px-4 py-10 text-center text-sm text-stone">
        Output Based tasks are not enabled for your account.
      </div>
    );
  }

  return (
    <div>
      <div className="rounded-2xl border border-sand bg-white shadow-sm">
        <div className="border-b border-parchment px-5 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-lg font-bold text-espresso">Output Based Tasks</h2>
              <p className="text-xs text-stone">Your output-based tasks and claims.</p>
            </div>

            <button
              type="button"
              onClick={openCreatePanel}
              className="cursor-pointer rounded-lg border border-terracotta bg-terracotta px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#a85840]"
            >
              New Task
            </button>
          </div>

          <div className="mt-4 inline-flex rounded-lg border border-sand bg-parchment/40 p-1 text-xs font-semibold">
            {VIEW_FILTER_PILLS.map((pill) => (
              <button
                key={pill.value}
                type="button"
                onClick={() => setActiveFilter(pill.value)}
                className={`rounded-md px-3 py-1.5 transition-colors ${
                  activeFilter === pill.value ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-stone">Use the ▾ on a column heading to filter it.</p>
            <div className="flex items-center gap-2">
              {(filterTaskNames.length > 0 || filterAccounts.length > 0 || filterCategories.length > 0 || filterStatuses.length > 0 || filterRates.length > 0 || filterStartDates.length > 0 || filterDueDates.length > 0 || filterClaimStates.length > 0 || filterCreators.length > 0 || filterAssignedBy.length > 0 || filterProjects.length > 0 || activeFilter !== "all") && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveFilter("all");
                    setFilterTaskNames([]);
                    setFilterAccounts([]);
                    setFilterCategories([]);
                    setFilterStatuses([]);
                    setFilterRates([]);
                    setFilterStartDates([]);
                    setFilterDueDates([]);
                    setFilterClaimStates([]);
                    setFilterCreators([]);
                    setFilterAssignedBy([]);
                    setFilterProjects([]);
                  }}
                  className="cursor-pointer text-[12px] text-stone hover:text-terracotta hover:underline"
                >
                  Clear all filters
                </button>
              )}
              <ToolbarFilterDropdown label="Project" options={projectFilterOptions} selected={filterProjects} onChange={setFilterProjects} />
              <ColumnVisibilityPicker columns={TABLE_COLUMNS} hidden={hiddenColumns} onToggle={toggleColumnVisible} />
            </div>
          </div>
        </div>
        <div className="px-5 py-4">
          {!panelMode && message && (
            <div className={`mb-4 rounded-lg px-4 py-3 text-sm ${message.type === "ok" ? "bg-sage-soft text-sage" : "bg-red-50 text-red-700"}`}>
              {message.text}
            </div>
          )}

          <div className="mb-3 flex items-center gap-2 text-[11px] text-stone">
            <span className="rounded-full bg-parchment px-2 py-0.5 font-semibold text-walnut">{filteredTasks.length}</span>
            <span>task{filteredTasks.length === 1 ? "" : "s"}</span>
            {activeFilter !== "all" && (
              <span className="rounded-full bg-slate-blue-soft px-2 py-0.5 font-semibold text-slate-blue">
                filtered by {activeFilter === "submitted" ? "Submitted" : activeFilter === "active" ? "Active" : activeFilter === "inactive" ? "Inactive" : activeFilter === "archived" ? "Archived" : "Trash"}
              </span>
            )}
          </div>

          {selectedTaskIds.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sand bg-parchment/30 px-4 py-3">
              <div className="text-[13px] text-espresso">
                <span className="font-semibold">{selectedTaskIds.length}</span> selected
              </div>
              <button
                type="button"
                onClick={() => setSelectedTaskIds([])}
                className="text-[12px] text-stone hover:text-terracotta hover:underline"
              >
                Clear selection
              </button>
            </div>
          )}

          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-xl bg-parchment" />
              ))}
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-sand px-4 py-10 text-center text-sm text-stone">
              No Output Based tasks found.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-sand bg-white shadow-sm">
              <table className="w-full table-fixed">
                <thead>
                  <tr className="border-b border-sand bg-parchment">
                    <th className="w-10 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">
                      <input
                        ref={headerSelectAllRef}
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleVisibleSelection}
                        className="h-4 w-4 rounded border-sand text-terracotta focus:ring-terracotta"
                        aria-label="Select all visible tasks"
                      />
                    </th>
                    {!hiddenColumns.has("task_name") && (
                      <ColumnHeader
                        label="Task Name"
                        width={columnWidths.task_name}
                        onResize={(w) => setColumnWidth("task_name", w)}
                        filterOptions={taskNameFilterOptions.map((v) => ({ value: v, label: v }))}
                        selected={filterTaskNames}
                        onFilterChange={setFilterTaskNames}
                      />
                    )}
                    {!hiddenColumns.has("account") && (
                      <ColumnHeader
                        label="Account"
                        width={columnWidths.account}
                        onResize={(w) => setColumnWidth("account", w)}
                        filterOptions={accountFilterOptions.map((v) => ({ value: v, label: v }))}
                        selected={filterAccounts}
                        onFilterChange={setFilterAccounts}
                      />
                    )}
                    {!hiddenColumns.has("category") && (
                      <ColumnHeader
                        label="Category"
                        width={columnWidths.category}
                        onResize={(w) => setColumnWidth("category", w)}
                        filterOptions={categoryFilterOptions.map((v) => ({ value: v, label: v }))}
                        selected={filterCategories}
                        onFilterChange={setFilterCategories}
                      />
                    )}
                    {!hiddenColumns.has("status") && (
                      <ColumnHeader
                        label="Status"
                        width={columnWidths.status}
                        onResize={(w) => setColumnWidth("status", w)}
                        filterOptions={STATUS_OPTIONS.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
                        selected={filterStatuses}
                        onFilterChange={setFilterStatuses}
                      />
                    )}
                    {!hiddenColumns.has("rate") && (
                      <ColumnHeader
                        label="Rate"
                        width={columnWidths.rate}
                        onResize={(w) => setColumnWidth("rate", w)}
                        filterOptions={rateFilterOptions.map((v) => ({ value: v, label: formatRate(v) }))}
                        selected={filterRates}
                        onFilterChange={setFilterRates}
                      />
                    )}
                    {!hiddenColumns.has("start_date") && (
                      <ColumnHeader
                        label="Start Date"
                        width={columnWidths.start_date}
                        onResize={(w) => setColumnWidth("start_date", w)}
                        filterOptions={startDateFilterOptions.map((v) => ({ value: v, label: formatDateOnly(v) }))}
                        selected={filterStartDates}
                        onFilterChange={setFilterStartDates}
                      />
                    )}
                    {!hiddenColumns.has("due_date") && (
                      <ColumnHeader
                        label="Due Date"
                        width={columnWidths.due_date}
                        onResize={(w) => setColumnWidth("due_date", w)}
                        filterOptions={dueDateFilterOptions.map((v) => ({ value: v, label: formatDateOnly(v) }))}
                        selected={filterDueDates}
                        onFilterChange={setFilterDueDates}
                      />
                    )}
                    {!hiddenColumns.has("assigned_by") && (
                      <ColumnHeader
                        label="Assigned By"
                        width={columnWidths.assigned_by}
                        onResize={(w) => setColumnWidth("assigned_by", w)}
                        filterOptions={assignedByFilterOptions.map((name) => ({ value: name, label: name }))}
                        selected={filterAssignedBy}
                        onFilterChange={setFilterAssignedBy}
                      />
                    )}
                    {!hiddenColumns.has("claimed") && (
                      <ColumnHeader
                        label="Claimed"
                        width={columnWidths.claimed}
                        onResize={(w) => setColumnWidth("claimed", w)}
                        filterOptions={[
                          { value: "mine", label: "You" },
                          { value: "others", label: "Claimed" },
                          { value: "unclaimed", label: "Unclaimed" },
                        ]}
                        selected={filterClaimStates}
                        onFilterChange={setFilterClaimStates}
                      />
                    )}
                    {!hiddenColumns.has("created") && (
                      <ColumnHeader
                        label="Created"
                        width={columnWidths.created}
                        onResize={(w) => setColumnWidth("created", w)}
                        filterOptions={creatorFilterOptions.map((name) => ({ value: name, label: name }))}
                        selected={filterCreators}
                        onFilterChange={setFilterCreators}
                      />
                    )}
                    {!hiddenColumns.has("active") && (
                      <ColumnHeader label="Active" width={columnWidths.active} onResize={(w) => setColumnWidth("active", w)} />
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.map((task) => {
                    const isSelected = selectedTaskIdSet.has(task.id) || selectedTask?.id === task.id;
                    const claimedByMe = task.claimed_by_me || task.claimed_by === currentUserId;
                    const rowStateLabel = task.deleted_at ? "Trash" : task.archived_at ? "Archived" : task.is_active ? "On" : "Off";
                    const rowStateClass = task.deleted_at
                      ? "bg-red-100 text-red-600"
                      : task.archived_at
                        ? "bg-amber-100 text-amber-700"
                        : task.is_active
                          ? "bg-sage-soft text-sage"
                          : "bg-parchment text-stone";

                    return (
                      <tr
                        key={task.id}
                        className={`cursor-pointer border-b border-sand last:border-0 transition-colors hover:bg-parchment/30 ${
                          isSelected ? "bg-parchment/50" : ""
                        }`}
                        onClick={() => openViewPanel(task)}
                      >
                        <td className="w-10 px-3 py-3" onClick={(event) => event.stopPropagation()}>
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={selectedTaskIdSet.has(task.id)}
                              onChange={() => toggleTaskSelection(task.id)}
                              className="h-4 w-4 rounded border-sand text-terracotta focus:ring-terracotta"
                              aria-label={`Select ${task.task_name}`}
                            />
                            <button
                              type="button"
                              onClick={() => openViewPanel(task)}
                              className="flex h-6 w-6 items-center justify-center rounded text-stone transition-colors hover:bg-sand/50 hover:text-walnut"
                              aria-label={`Open ${task.task_name}`}
                            >
                              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M9 18l6-6-6-6" />
                              </svg>
                            </button>
                          </div>
                        </td>

                        {!hiddenColumns.has("task_name") && (
                          <td className="truncate px-3 py-3 text-[13px] font-medium text-walnut">{task.task_name}</td>
                        )}
                        {!hiddenColumns.has("account") && (
                          <td className="truncate px-3 py-3 text-[13px] text-walnut">{task.account || <span className="text-stone/60">—</span>}</td>
                        )}
                        {!hiddenColumns.has("category") && (
                          <td className="truncate px-3 py-3 text-[13px] text-walnut">{task.category || <span className="text-stone/60">—</span>}</td>
                        )}
                        {!hiddenColumns.has("status") && (
                          <td className="px-3 py-3 text-[13px] text-walnut">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASSES[task.status]}`}>
                              {STATUS_LABELS[task.status]}
                            </span>
                          </td>
                        )}
                        {!hiddenColumns.has("rate") && (
                          <td className="px-3 py-3 text-[13px] font-medium text-walnut">{formatRate(task.rate)}</td>
                        )}
                        {!hiddenColumns.has("start_date") && (
                          <td className="px-3 py-3 text-[13px] text-walnut">{formatDateOnly(task.start_date)}</td>
                        )}
                        {!hiddenColumns.has("due_date") && (
                          <td className="px-3 py-3 text-[13px] text-walnut">{formatDateOnly(task.due_date)}</td>
                        )}
                        {!hiddenColumns.has("assigned_by") && (
                          <td className="truncate px-3 py-3 text-[13px] text-walnut">
                            {task.assigned_by_profile?.full_name || task.assigned_by_profile?.username || <span className="text-stone/60">—</span>}
                          </td>
                        )}
                        {!hiddenColumns.has("claimed") && (
                          <td className="px-3 py-3 text-[13px] text-walnut">
                            <div className="space-y-0.5 truncate">
                              <div>{claimedByMe ? "You" : task.claimed_by ? "Claimed" : "—"}</div>
                              <div className="text-[10px] text-stone/70">{formatTimestamp(task.claimed_at)}</div>
                            </div>
                          </td>
                        )}
                        {!hiddenColumns.has("created") && (
                          <td className="px-3 py-3 text-[13px] text-walnut">
                            <div className="space-y-0.5 truncate">
                              <div className="truncate">{task.created_by_profile?.full_name || task.created_by_profile?.username || "—"}</div>
                              <div className="text-[10px] text-stone/70">{formatTimestamp(task.created_at)}</div>
                            </div>
                          </td>
                        )}
                        {!hiddenColumns.has("active") && (
                          <td className="px-3 py-3 text-[13px] text-walnut">
                            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold ${rowStateClass}`}>
                              {rowStateLabel}
                            </span>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {panelMode && (
        <TableRowDetailPanel
          title={panelMode === "view" ? "Task Details" : panelMode === "edit" ? "Edit Task" : "New Task"}
          subtitle={
            panelMode === "view" && selectedTask
              ? `Task #${selectedTask.id}`
              : panelMode === "edit"
                ? "Update this task before it's reviewed."
                : "Create a task for the Output Based pool."
          }
          onClose={closePanel}
          footer={
            panelMode === "view" ? (
              <>
                <div className={`mb-3 rounded-lg px-4 py-3 text-sm ${message?.type === "ok" ? "bg-sage-soft text-sage" : message?.type === "err" ? "bg-red-50 text-red-700" : "hidden"}`}>
                  {message?.text}
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div>
                    {selectedTask && canEditSelectedTask && (
                      <button
                        type="button"
                        onClick={() => void handleDelete(selectedTask.id)}
                        disabled={deleting}
                        className="text-xs font-semibold text-terracotta hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {deleting ? "Deleting..." : "Delete"}
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={closePanel} className="text-xs text-stone hover:text-espresso">
                      Close
                    </button>
                    {selectedTask && canEditSelectedTask && (
                      <button
                        type="button"
                        onClick={() => openEditPanel(selectedTask)}
                        className="rounded-lg border border-sand bg-white px-5 py-2 text-[13px] font-semibold text-espresso transition-colors hover:bg-parchment"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                </div>
              </>
            ) : null
          }
        >
              {(panelMode === "create" || panelMode === "edit") && (
                <>
                  {panelMode === "create" && isHybrid && (
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Task Type</label>
                      <div className="inline-flex rounded-lg border border-sand bg-parchment/40 p-1 text-xs font-semibold">
                        <button
                          type="button"
                          onClick={() => setCreateMode("hourly")}
                          className={`rounded-md px-3 py-1.5 transition-colors ${
                            createMode === "hourly" ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"
                          }`}
                        >
                          Time-based Task
                        </button>
                        <button
                          type="button"
                          onClick={() => setCreateMode("fixed_pay")}
                          className={`rounded-md px-3 py-1.5 transition-colors ${
                            createMode === "fixed_pay" ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"
                          }`}
                        >
                          Output Based Task
                        </button>
                      </div>
                    </div>
                  )}

                  {panelMode === "create" && isHybrid && createMode === "hourly" ? (
                    <TaskEditor
                      key="hourly"
                      mode="time_based"
                      currentUserId={currentUserId ?? ""}
                      isAdminOrManager={false}
                      teamMembers={[]}
                      onCancel={closePanel}
                      onSaved={handleTaskSaved}
                    />
                  ) : (
                    <TaskEditor
                      // Task id in the key — a shared key kept the previous
                      // task's form state and saved it onto the next one.
                      key={panelMode === "edit" ? `fixed_pay-${selectedTask?.id ?? "none"}` : "fixed_pay-create"}
                      mode="output_based"
                      editingTaskId={panelMode === "edit" ? selectedTask?.id ?? null : null}
                      initialTask={panelMode === "edit" ? (selectedTask as unknown as Record<string, unknown>) : null}
                      currentUserId={currentUserId ?? ""}
                      isAdminOrManager={isAdminOrManager}
                      teamMembers={[]}
                      currentPayRate={currentPayRate ?? undefined}
                      onCancel={closePanel}
                      onSaved={handleTaskSaved}
                    />
                  )}
                </>
              )}

              {panelMode === "view" && selectedTask && (
                <>
                  <TaskEditor
                    key={`view-${selectedTask.id}`}
                    mode="output_based"
                    editingTaskId={selectedTask.id}
                    initialTask={selectedTask as unknown as Record<string, unknown>}
                    currentUserId={currentUserId ?? ""}
                    isAdminOrManager={isAdminOrManager}
                    teamMembers={[]}
                    currentPayRate={currentPayRate ?? undefined}
                    readOnly
                    hideFooter
                    onCancel={closePanel}
                    onSaved={handleTaskSaved}
                  />

                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Status</label>
                    {(selectedTask.claimed_by_me || selectedTask.claimed_by === currentUserId) &&
                    VA_STATUS_OPTIONS.includes(selectedTask.status) ? (
                      <select
                        value={selectedTask.status}
                        disabled={statusSaving}
                        onChange={(event) => void handleStatusChange(selectedTask.id, event.target.value as FixedPayTaskWithClaimer["status"])}
                        className="w-full rounded-lg border border-sand bg-white px-2 py-1.5 text-[12px] text-espresso outline-none transition-colors focus:border-terracotta disabled:opacity-50"
                      >
                        {VA_STATUS_OPTIONS.map((status) => (
                          <option key={status} value={status}>
                            {STATUS_LABELS[status]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASSES[selectedTask.status]}`}>
                        {STATUS_LABELS[selectedTask.status]}
                      </span>
                    )}
                  </div>

                  <div className="rounded-xl border border-sand bg-parchment/20 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-stone">Claimed</div>
                    <div className="text-[13px] text-espresso">
                      {selectedTask.claimed_by_me || selectedTask.claimed_by === currentUserId
                        ? "By you"
                        : selectedTask.claimed_by
                          ? "By another VA"
                          : "Unclaimed"}
                    </div>
                    <div className="text-[11px] text-stone">{formatTimestamp(selectedTask.claimed_at)}</div>
                  </div>

                  <div className="text-[11px] text-stone">
                    Created {formatTimestamp(selectedTask.created_at)}
                    {selectedTask.created_by_profile ? ` by ${selectedTask.created_by_profile.full_name || selectedTask.created_by_profile.username}` : ""}
                  </div>
                </>
              )}
        </TableRowDetailPanel>
      )}
    </div>
  );
}
