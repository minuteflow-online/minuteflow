"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { FixedPayTaskWithClaimer } from "@/types/database";
import { countWords } from "@/lib/utils";

const CLIENT_MEMO_WORD_LIMIT = 15;

function limitToWords(text: string, limit: number): string {
  const words = text.split(/\s+/);
  if (words.length <= limit) return text;
  return words.slice(0, limit).join(" ");
}

function computeHourlyEquivalent(
  durationValue: string,
  unit: "hours" | "minutes",
  hourlyRate: number | null
): number | null {
  const raw = Number(durationValue);
  if (!Number.isFinite(raw) || raw <= 0 || hourlyRate == null) return null;
  const hours = unit === "hours" ? raw : raw / 60;
  return hours * hourlyRate;
}

function computeQuantityTotal(unitRate: string, quantity: string): number | null {
  const rate = Number(unitRate);
  const qty = Number(quantity);
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(qty) || qty <= 0) return null;
  return rate * qty;
}

const VIEW_FILTER_PILLS: Array<{ value: "all" | "active" | "inactive" | "archived" | "trash"; label: string }> = [
  { value: "all", label: "All" },
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

const EMPTY_FORM = {
  task_name: "",
  account: "",
  category: "",
  unit_rate: "",
  quantity: "",
  rate: "",
  duration_value: "",
  duration_unit: "hours" as "hours" | "minutes",
  task_detail: "",
  task_notes: "",
  link: "",
  instructions: "",
  instructions_locked: false,
};

type TaskFormState = typeof EMPTY_FORM;
type PanelMode = "create" | "view" | null;
type ActiveFilter = "all" | "active" | "inactive" | "archived" | "trash";
type CreateMode = "hourly" | "fixed_pay";

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

function mergeTextOptions(options: string[], currentValue: string | null | undefined) {
  const set = new Set(options.filter(Boolean));
  if (currentValue) set.add(currentValue);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

type FilterOptionValue = string | number;

type FilterDropdownProps<T extends FilterOptionValue> = {
  label: string;
  options: { value: T; label: string }[];
  selected: T[];
  onChange: (v: T[]) => void;
  isOpen: boolean;
  onToggle: () => void;
};

function FilterDropdown<T extends FilterOptionValue>({ label, options, selected, onChange, isOpen, onToggle }: FilterDropdownProps<T>) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] outline-none transition-all ${
          selected.length > 0 ? "border-terracotta text-terracotta" : "border-sand bg-white text-espresso hover:border-walnut"
        }`}
      >
        {label}
        {selected.length > 0 && (
          <span className="rounded-full bg-terracotta px-1.5 py-px text-[10px] font-bold leading-none text-white">{selected.length}</span>
        )}
        <svg className="h-3.5 w-3.5 text-stone" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[180px] rounded-xl border border-sand bg-white py-1 shadow-lg">
          <div className="flex items-center justify-between border-b border-sand px-3 py-1.5">
            <button type="button" onClick={() => onChange(options.map((o) => o.value))} className="cursor-pointer text-[11px] text-terracotta hover:underline">
              Select All
            </button>
            <button type="button" onClick={() => onChange([])} className="cursor-pointer text-[11px] text-stone hover:underline">
              Clear
            </button>
          </div>
          {options.length > 0 ? (
            options.map((opt) => (
              <label key={String(opt.value)} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-parchment">
                <input
                  type="checkbox"
                  checked={selected.includes(opt.value)}
                  onChange={(e) => {
                    if (e.target.checked) onChange([...selected, opt.value]);
                    else onChange(selected.filter((value) => value !== opt.value));
                  }}
                  className="accent-terracotta"
                />
                <span className="text-[13px] text-espresso">{opt.label}</span>
              </label>
            ))
          ) : (
            <div className="px-3 py-2 text-[12px] text-stone">No options found</div>
          )}
        </div>
      )}
    </div>
  );
}

type FixedPayTasksPanelProps = {
  // Bumped by the parent (e.g. after a claim in AvailableTasksWidget) to refetch.
  refreshKey?: number;
  // Hybrid VAs picking "Hourly Task" in the create panel jump back to My Tasks.
  onSwitchToHourly?: () => void;
};

export default function FixedPayTasksPanel({ refreshKey = 0, onSwitchToHourly }: FixedPayTasksPanelProps) {
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
  const [openFilter, setOpenFilter] = useState<"taskname" | "account" | "category" | "status" | "rate" | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>(null);
  const [selectedTask, setSelectedTask] = useState<FixedPayTaskWithClaimer | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([]);
  const [createMode, setCreateMode] = useState<CreateMode>("fixed_pay");
  const [form, setForm] = useState<TaskFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);

  const [accounts, setAccounts] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const headerSelectAllRef = useRef<HTMLInputElement | null>(null);

  // Same eligibility as the fixed-pay-tasks POST route: per-task VAs, or hourly VAs
  // with the hybrid "Avail. Tasks" toggle on. Hybrid VAs additionally get the
  // hourly/fixed-pay create toggle.
  const isPerTaskVa = currentPosition === "Per Task VA" || currentPayRateType === "per_task";
  const isEligibleVa = currentRole === "va" && (isPerTaskVa || canSeeAvailableTasks);
  const isAdminOrManager = currentRole === "admin" || currentRole === "manager";
  const canViewPage = isEligibleVa || isAdminOrManager;
  // Hybrid = labeled as an hourly VA (Part-time or Full-time position) with
  // the "Available Tasks" toggle on in Team management. Keyed on position,
  // not pay_rate_type, so it can't be thrown off by rate-field edge cases.
  const isHybrid = (currentPosition === "Part-time VA" || currentPosition === "Full-time VA") && canSeeAvailableTasks;

  // Two independent ways to arrive at Final Rate, both display-only helpers
  // that auto-fill form.rate (see each field's onChange handlers below) —
  // whichever the VA touches most recently wins, and either can be
  // overwritten by hand afterward.
  const hourlyEquivalentTotal = computeHourlyEquivalent(form.duration_value, form.duration_unit, currentPayRate);
  const quantityTotal = computeQuantityTotal(form.unit_rate, form.quantity);

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
      // Scope to the logged-in VA: only tasks they claimed or created.
      setTasks(rows.filter((task) => task.claimed_by_me || task.claimed_by === currentUserId || task.created_by === currentUserId));
    } catch {
      setTasks([]);
      setMessage({ type: "err", text: "Unable to load fixed pay tasks." });
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  const fetchLookups = useCallback(async () => {
    try {
      const [accountsRes, categoriesRes] = await Promise.all([
        fetch("/api/task-form-options", { cache: "no-store" }),
        fetch("/api/task-categories", { cache: "no-store" }),
      ]);

      if (accountsRes.ok) {
        const data = (await accountsRes.json()) as { accounts?: string[] };
        setAccounts(data.accounts ?? []);
      }

      if (categoriesRes.ok) {
        const data = (await categoriesRes.json()) as { categories?: Array<{ category_name: string }> };
        setCategories((data.categories ?? []).map((category) => category.category_name));
      }
    } catch {
      // Keep the form usable with values already present on tasks.
    }
  }, []);

  useEffect(() => {
    void fetchCurrentUser();
  }, [fetchCurrentUser]);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks, refreshKey]);

  useEffect(() => {
    void fetchLookups();
  }, [fetchLookups]);

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

  const filterBaseTasks = useMemo(() => {
    return tasks.filter((task) => {
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

  const filteredTasks = useMemo(() => {
    return filterBaseTasks.filter((task) => {
      if (filterRates.length > 0 && !filterRates.includes(Number(task.rate))) return false;
      return true;
    });
  }, [filterBaseTasks, filterRates]);

  const selectedTaskIdSet = useMemo(() => new Set(selectedTaskIds), [selectedTaskIds]);
  const allVisibleSelected = filteredTasks.length > 0 && filteredTasks.every((task) => selectedTaskIdSet.has(task.id));
  const someVisibleSelected = filteredTasks.some((task) => selectedTaskIdSet.has(task.id)) && !allVisibleSelected;

  useEffect(() => {
    if (headerSelectAllRef.current) {
      headerSelectAllRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);

  const accountOptions = useMemo(() => mergeTextOptions(accounts, form.account), [accounts, form.account]);
  const categoryOptions = useMemo(() => mergeTextOptions(categories, form.category), [categories, form.category]);

  const openCreatePanel = useCallback(() => {
    setPanelMode("create");
    setSelectedTask(null);
    setForm(EMPTY_FORM);
    // Non-hybrid fixed-pay VAs skip the toggle and land straight on the fixed-pay form.
    setCreateMode("fixed_pay");
    setMessage(null);
  }, []);

  const openViewPanel = useCallback((task: FixedPayTaskWithClaimer) => {
    setPanelMode("view");
    setSelectedTask(task);
    setMessage(null);
  }, []);

  const closePanel = useCallback(() => {
    setPanelMode(null);
    setSelectedTask(null);
    setForm(EMPTY_FORM);
    setSaving(false);
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

  const handleSubmit = useCallback(async () => {
    if (!form.task_name.trim()) {
      setMessage({ type: "err", text: "Task name is required." });
      return;
    }

    const rate = Number(form.rate);
    if (!form.rate.trim() || !Number.isFinite(rate)) {
      setMessage({ type: "err", text: "Rate is required." });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/fixed-pay-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_name: form.task_name.trim(),
          account: form.account.trim() || null,
          category: form.category.trim() || null,
          rate,
          task_detail: form.task_detail.trim() || null,
          task_notes: form.task_notes.trim() || null,
          link: form.link.trim() || null,
          instructions: form.instructions.trim() || null,
          instructions_locked: form.instructions_locked,
        }),
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

      closePanel();
      await fetchTasks();
      setMessage({ type: "ok", text: "Task created." });
    } catch (error) {
      setMessage({ type: "err", text: error instanceof Error ? error.message : "Unable to save task." });
    } finally {
      setSaving(false);
    }
  }, [closePanel, fetchTasks, form]);

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
        Fixed pay tasks are not enabled for your account.
      </div>
    );
  }

  return (
    <div>
      <div className="rounded-2xl border border-sand bg-white shadow-sm">
        <div className="border-b border-parchment px-5 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-lg font-bold text-espresso">Fixed Pay Tasks</h2>
              <p className="text-xs text-stone">Your fixed-pay tasks and claims.</p>
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

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <FilterDropdown
              label="Task Name"
              options={taskNameFilterOptions.map((taskName) => ({ value: taskName, label: taskName }))}
              selected={filterTaskNames}
              onChange={setFilterTaskNames}
              isOpen={openFilter === "taskname"}
              onToggle={() => setOpenFilter(openFilter === "taskname" ? null : "taskname")}
            />
            <FilterDropdown
              label="Account"
              options={accountFilterOptions.map((account) => ({ value: account, label: account }))}
              selected={filterAccounts}
              onChange={setFilterAccounts}
              isOpen={openFilter === "account"}
              onToggle={() => setOpenFilter(openFilter === "account" ? null : "account")}
            />
            <FilterDropdown
              label="Category"
              options={categoryFilterOptions.map((category) => ({ value: category, label: category }))}
              selected={filterCategories}
              onChange={setFilterCategories}
              isOpen={openFilter === "category"}
              onToggle={() => setOpenFilter(openFilter === "category" ? null : "category")}
            />
            <FilterDropdown
              label="Status"
              options={STATUS_OPTIONS.map((status) => ({ value: status, label: STATUS_LABELS[status] }))}
              selected={filterStatuses}
              onChange={setFilterStatuses}
              isOpen={openFilter === "status"}
              onToggle={() => setOpenFilter(openFilter === "status" ? null : "status")}
            />
            <FilterDropdown
              label="Rate"
              options={rateFilterOptions.map((rate) => ({ value: rate, label: formatRate(rate) }))}
              selected={filterRates}
              onChange={setFilterRates}
              isOpen={openFilter === "rate"}
              onToggle={() => setOpenFilter(openFilter === "rate" ? null : "rate")}
            />
            {(filterTaskNames.length > 0 || filterAccounts.length > 0 || filterCategories.length > 0 || filterStatuses.length > 0 || filterRates.length > 0 || activeFilter !== "all") && (
              <button
                type="button"
                onClick={() => {
                  setActiveFilter("all");
                  setFilterTaskNames([]);
                  setFilterAccounts([]);
                  setFilterCategories([]);
                  setFilterStatuses([]);
                  setFilterRates([]);
                }}
                className="cursor-pointer text-[12px] text-stone hover:text-terracotta hover:underline"
              >
                Clear all
              </button>
            )}
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
                filtered by {activeFilter === "active" ? "Active" : activeFilter === "inactive" ? "Inactive" : activeFilter === "archived" ? "Archived" : "Trash"}
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
              No fixed pay tasks found.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-sand bg-white shadow-sm">
              <table className="w-full">
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
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">Task Name</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">Account</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">Category</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">Status</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">Rate</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">Claimed</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">Active</th>
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

                        <td className="px-3 py-3 text-[13px] font-medium text-walnut">{task.task_name}</td>
                        <td className="px-3 py-3 text-[13px] text-walnut">{task.account || <span className="text-stone/60">—</span>}</td>
                        <td className="px-3 py-3 text-[13px] text-walnut">{task.category || <span className="text-stone/60">—</span>}</td>
                        <td className="px-3 py-3 text-[13px] text-walnut">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASSES[task.status]}`}>
                            {STATUS_LABELS[task.status]}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-[13px] font-medium text-walnut">{formatRate(task.rate)}</td>
                        <td className="px-3 py-3 text-[13px] text-walnut">
                          <div className="space-y-0.5">
                            <div>{claimedByMe ? "You" : task.claimed_by ? "Claimed" : "—"}</div>
                            <div className="text-[10px] text-stone/70">{formatTimestamp(task.claimed_at)}</div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-[13px] text-walnut">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold ${rowStateClass}`}>
                            {rowStateLabel}
                          </span>
                        </td>
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
        <div className="fixed inset-0 z-40 flex items-stretch">
          <div className="flex-1 bg-black/20" onClick={closePanel} />

          <div className="flex w-[520px] max-w-full flex-col overflow-hidden border-l border-sand bg-white shadow-2xl">
            <div className="shrink-0 flex items-center justify-between border-b border-sand px-5 py-4">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closePanel}
                  className="flex h-7 w-7 items-center justify-center rounded text-stone transition-colors hover:bg-sand/50 hover:text-espresso"
                  aria-label="Close task panel"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <div>
                  <span className="block text-[13px] font-semibold text-walnut">
                    {panelMode === "view" ? "Task Details" : "New Task"}
                  </span>
                  <span className="block text-[11px] text-stone">
                    {panelMode === "view" && selectedTask ? `Task #${selectedTask.id}` : "Create a task for the fixed-pay pool."}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
              {panelMode === "create" && (
                <>
                  {isHybrid && (
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
                          Hourly Task
                        </button>
                        <button
                          type="button"
                          onClick={() => setCreateMode("fixed_pay")}
                          className={`rounded-md px-3 py-1.5 transition-colors ${
                            createMode === "fixed_pay" ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"
                          }`}
                        >
                          Fixed-Pay Task
                        </button>
                      </div>
                    </div>
                  )}

                  {isHybrid && createMode === "hourly" ? (
                    <div className="rounded-xl border border-sand bg-parchment/20 p-4">
                      <p className="text-[13px] text-espresso">Hourly tasks are created from the Task List.</p>
                      <p className="mt-1 text-[11px] text-stone">Head over to My Tasks to log or submit an hourly task.</p>
                      <button
                        type="button"
                        onClick={() => {
                          closePanel();
                          onSwitchToHourly?.();
                        }}
                        className="mt-3 inline-block rounded-lg bg-terracotta px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#a85840]"
                      >
                        Go to My Tasks
                      </button>
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Task Name</label>
                        <input
                          value={form.task_name}
                          onChange={(event) => setForm((current) => ({ ...current, task_name: event.target.value }))}
                          className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                          placeholder="Task name"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Account</label>
                        <select
                          value={form.account}
                          onChange={(event) => setForm((current) => ({ ...current, account: event.target.value }))}
                          className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                        >
                          <option value="">Select account...</option>
                          {accountOptions.map((account) => (
                            <option key={account} value={account}>
                              {account}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Category</label>
                        <select
                          value={form.category}
                          onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                          className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                        >
                          <option value="">Select category...</option>
                          {categoryOptions.map((category) => (
                            <option key={category} value={category}>
                              {category}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">
                          Rate per Task <span className="font-normal normal-case text-stone/70">(optional)</span>
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={form.unit_rate}
                            onChange={(event) => {
                              const value = event.target.value;
                              setForm((current) => {
                                const total = computeQuantityTotal(value, current.quantity);
                                return {
                                  ...current,
                                  unit_rate: value,
                                  rate: total != null ? total.toFixed(2) : current.rate,
                                };
                              });
                            }}
                            className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                            placeholder="0.00"
                          />
                          <input
                            type="number"
                            step="1"
                            min="0"
                            value={form.quantity}
                            onChange={(event) => {
                              const value = event.target.value;
                              setForm((current) => {
                                const total = computeQuantityTotal(current.unit_rate, value);
                                return {
                                  ...current,
                                  quantity: value,
                                  rate: total != null ? total.toFixed(2) : current.rate,
                                };
                              });
                            }}
                            className="w-32 shrink-0 rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                            placeholder="Quantity"
                          />
                        </div>
                        {(form.unit_rate.trim() !== "" || form.quantity.trim() !== "") && (
                          <p className="mt-1.5 text-[11px] text-stone">
                            {quantityTotal != null ? (
                              <>
                                {form.unit_rate} × {form.quantity} ={" "}
                                <span className="font-semibold text-espresso">${quantityTotal.toFixed(2)}</span>
                                {" "}— we filled in Final Rate below with this; edit it if you want a different amount.
                              </>
                            ) : (
                              "Enter both a rate and a quantity to auto-fill Final Rate."
                            )}
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">
                          Estimated Duration <span className="font-normal normal-case text-stone/70">(optional)</span>
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            value={form.duration_value}
                            onChange={(event) => {
                              const value = event.target.value;
                              setForm((current) => {
                                const equivalent = computeHourlyEquivalent(value, current.duration_unit, currentPayRate);
                                return {
                                  ...current,
                                  duration_value: value,
                                  rate: equivalent != null ? equivalent.toFixed(2) : current.rate,
                                };
                              });
                            }}
                            className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                            placeholder="e.g. 2"
                          />
                          <select
                            value={form.duration_unit}
                            onChange={(event) => {
                              const unit = event.target.value as "hours" | "minutes";
                              setForm((current) => {
                                const equivalent = computeHourlyEquivalent(current.duration_value, unit, currentPayRate);
                                return {
                                  ...current,
                                  duration_unit: unit,
                                  rate: equivalent != null ? equivalent.toFixed(2) : current.rate,
                                };
                              });
                            }}
                            className="w-32 shrink-0 rounded-lg border border-sand bg-white px-2 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                          >
                            <option value="hours">Hours</option>
                            <option value="minutes">Minutes</option>
                          </select>
                        </div>
                        {form.duration_value.trim() !== "" && (
                          <p className="mt-1.5 text-[11px] text-stone">
                            {hourlyEquivalentTotal != null ? (
                              <>
                                At your hourly rate, that&apos;s worth{" "}
                                <span className="font-semibold text-espresso">${hourlyEquivalentTotal.toFixed(2)}</span>
                                {" "}— we filled in Final Rate below with this; edit it if you want a different amount.
                              </>
                            ) : currentPayRate == null ? (
                              "No hourly rate is set for your profile in Team Management, so we can't fill in a rate for you — enter one manually."
                            ) : (
                              "Enter a valid duration to auto-fill Final Rate."
                            )}
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Final Rate</label>
                        <input
                          type="number"
                          step="0.01"
                          value={form.rate}
                          onChange={(event) => setForm((current) => ({ ...current, rate: event.target.value }))}
                          className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                          placeholder="0.00"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Task Detail</label>
                        <textarea
                          value={form.task_detail}
                          onChange={(event) => setForm((current) => ({ ...current, task_detail: limitToWords(event.target.value, CLIENT_MEMO_WORD_LIMIT) }))}
                          className="min-h-[96px] w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                          placeholder="Task detail"
                        />
                        <p className="mt-1 text-[10px] text-stone">{Math.max(0, CLIENT_MEMO_WORD_LIMIT - countWords(form.task_detail))} words remaining</p>
                      </div>

                      <div>
                        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Task Notes</label>
                        <textarea
                          value={form.task_notes}
                          onChange={(event) => setForm((current) => ({ ...current, task_notes: event.target.value }))}
                          className="min-h-[96px] w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                          placeholder="Task notes"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Link</label>
                        <input
                          type="text"
                          value={form.link}
                          onChange={(event) => setForm((current) => ({ ...current, link: event.target.value }))}
                          className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                          placeholder="https://..."
                        />
                      </div>

                      <div>
                        <div className="mb-1 flex items-center justify-between gap-3">
                          <label className="block text-[11px] font-semibold uppercase tracking-wide text-stone">Instructions</label>
                          <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-stone">
                            <input
                              type="checkbox"
                              checked={form.instructions_locked}
                              onChange={(event) => setForm((current) => ({ ...current, instructions_locked: event.target.checked }))}
                              className="h-4 w-4 rounded border-sand text-terracotta focus:ring-terracotta"
                            />
                            Locked
                          </label>
                        </div>
                        <textarea
                          value={form.instructions}
                          onChange={(event) => setForm((current) => ({ ...current, instructions: event.target.value }))}
                          className="min-h-[120px] w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                          placeholder="Instructions"
                        />
                      </div>
                    </>
                  )}
                </>
              )}

              {panelMode === "view" && selectedTask && (
                <>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Task Name</label>
                    <div className="text-[13px] text-espresso">{selectedTask.task_name}</div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Account</label>
                      <div className="text-[13px] text-espresso">{selectedTask.account || "—"}</div>
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Category</label>
                      <div className="text-[13px] text-espresso">{selectedTask.category || "—"}</div>
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Rate</label>
                      <div className="text-[13px] font-medium text-espresso">{formatRate(selectedTask.rate)}</div>
                    </div>
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
                  </div>

                  {selectedTask.task_detail && (
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Task Detail</label>
                      <div className="rounded-lg border border-sand bg-parchment/20 px-3 py-2 text-[13px] text-espresso whitespace-pre-wrap">{selectedTask.task_detail}</div>
                    </div>
                  )}

                  {selectedTask.task_notes && (
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Task Notes</label>
                      <div className="rounded-lg border border-sand bg-parchment/20 px-3 py-2 text-[13px] text-espresso whitespace-pre-wrap">{selectedTask.task_notes}</div>
                    </div>
                  )}

                  {selectedTask.link && (
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Link</label>
                      <a
                        href={selectedTask.link.startsWith("http") ? selectedTask.link : `https://${selectedTask.link}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[13px] text-terracotta hover:underline break-all"
                      >
                        {selectedTask.link}
                      </a>
                    </div>
                  )}

                  {selectedTask.instructions && (
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Instructions</label>
                      <div className="rounded-lg border border-sand bg-parchment/20 px-3 py-2 text-[13px] text-espresso whitespace-pre-wrap">{selectedTask.instructions}</div>
                    </div>
                  )}

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
                </>
              )}
            </div>

            <div className="shrink-0 border-t border-sand px-5 py-4">
              <div className={`mb-3 rounded-lg px-4 py-3 text-sm ${message?.type === "ok" ? "bg-sage-soft text-sage" : message?.type === "err" ? "bg-red-50 text-red-700" : "hidden"}`}>
                {message?.text}
              </div>

              <div className="flex items-center justify-end gap-3">
                <button type="button" onClick={closePanel} className="text-xs text-stone hover:text-espresso">
                  {panelMode === "view" ? "Close" : "Cancel"}
                </button>
                {panelMode === "create" && !(isHybrid && createMode === "hourly") && (
                  <button
                    type="button"
                    onClick={() => void handleSubmit()}
                    disabled={saving}
                    className="rounded-lg bg-terracotta px-5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#a85840] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? "Saving..." : "Create Task"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
