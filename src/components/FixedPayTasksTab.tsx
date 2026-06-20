"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactElement } from "react";
import type { FixedPayTaskAttachment, FixedPayTaskWithClaimer, Profile } from "@/types/database";

const VIEW_FILTER_PILLS: Array<{ value: "all" | "active" | "inactive" | "archived" | "trash"; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "archived", label: "Archived" },
  { value: "trash", label: "Trash" },
];

const STATUS_OPTIONS: Array<FixedPayTaskWithClaimer["status"]> = ["open", "pending", "on_queue", "in_progress", "submitted", "revision_needed", "completed", "cancelled"];
const STATUS_LABELS: Record<FixedPayTaskWithClaimer["status"], string> = {
  open: "Open",
  pending: "Pending",
  on_queue: "Queue",
  in_progress: "In Progress",
  submitted: "Submit for Review",
  revision_needed: "Revision Needed",
  completed: "Completed",
  cancelled: "Cancelled",
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
};

const EMPTY_FORM = {
  task_name: "",
  account: "",
  category: "",
  rate: "",
  task_detail: "",
  task_notes: "",
  link: "",
  instructions: "",
  instructions_locked: false,
  assigned_to: "",
  assigned_by: "",
  status: "open" as FixedPayTaskWithClaimer["status"],
  is_active: true,
};

type TaskFormState = typeof EMPTY_FORM;
type PanelMode = "create" | "edit" | null;
type ActiveFilter = "all" | "active" | "inactive" | "archived" | "trash";

type ProfileSummary = Pick<Profile, "id" | "full_name" | "username">;


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

function formatAttachmentSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function taskToForm(task: FixedPayTaskWithClaimer): TaskFormState {
  return {
    task_name: task.task_name ?? "",
    account: task.account ?? "",
    category: task.category ?? "",
    rate: String(task.rate ?? ""),
    task_detail: task.task_detail ?? "",
    task_notes: task.task_notes ?? "",
    link: task.link ?? "",
    instructions: task.instructions ?? "",
    instructions_locked: task.instructions_locked,
    assigned_to: task.assigned_to ?? "",
    assigned_by: task.assigned_by ?? "",
    status: task.status ?? "open",
    is_active: task.is_active,
  };
}

function mergeTextOptions(options: string[], currentValue: string | null | undefined) {
  const set = new Set(options.filter(Boolean));
  if (currentValue) set.add(currentValue);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function mergeProfiles(options: ProfileSummary[], current: ProfileSummary | null | undefined) {
  const map = new Map<string, ProfileSummary>();
  for (const option of options) map.set(option.id, option);
  if (current) map.set(current.id, current);
  return Array.from(map.values()).sort((a, b) => a.full_name.localeCompare(b.full_name));
}

function parseLinks(text: string) {
  const parts: ReactElement[] = [];
  const urlRegex = /(https?:\/\/[\w\-._~:/?#\[\]@!$&'()*+,;=%]+|www\.[\w\-._~:/?#\[\]@!$&'()*+,;=%]+)/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = urlRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={`text-${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>);
    }

    const rawUrl = match[0];
    const href = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
    parts.push(
      <a key={`link-${match.index}`} href={href} target="_blank" rel="noreferrer" className="text-terracotta hover:underline">
        {rawUrl}
      </a>
    );
    lastIndex = match.index + rawUrl.length;
  }

  if (lastIndex < text.length) {
    parts.push(<span key={`text-${lastIndex}`}>{text.slice(lastIndex)}</span>);
  }

  return parts;
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

export default function FixedPayTasksTab() {
  const [tasks, setTasks] = useState<FixedPayTaskWithClaimer[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");
  const [filterTaskNames, setFilterTaskNames] = useState<string[]>([]);
  const [filterAccounts, setFilterAccounts] = useState<string[]>([]);
  const [filterCategories, setFilterCategories] = useState<string[]>([]);
  const [filterStatuses, setFilterStatuses] = useState<FixedPayTaskWithClaimer["status"][]>([]);
  const [filterClaimedBy, setFilterClaimedBy] = useState<string[]>([]);
  const [filterRates, setFilterRates] = useState<number[]>([]);
  const [openFilter, setOpenFilter] = useState<"taskname" | "account" | "category" | "status" | "claimedBy" | "rate" | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>(null);
  const [selectedTask, setSelectedTask] = useState<FixedPayTaskWithClaimer | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([]);
  const [form, setForm] = useState<TaskFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [bulkAction, setBulkAction] = useState<"archive" | "trash" | "delete" | null>(null);
  const [revokingClaim, setRevokingClaim] = useState(false);

  const [accounts, setAccounts] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [activeProfiles, setActiveProfiles] = useState<ProfileSummary[]>([]);

  const [attachments, setAttachments] = useState<FixedPayTaskAttachment[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [attachmentMessage, setAttachmentMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<File | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const headerSelectAllRef = useRef<HTMLInputElement | null>(null);

  const fetchTasks = useCallback(async (view: ActiveFilter = activeFilter) => {
    setLoading(true);
    try {
      const query = view === "all" ? "" : `?view=${encodeURIComponent(view)}`;
      const res = await fetch(`/api/fixed-pay-tasks${query}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { tasks?: FixedPayTaskWithClaimer[] } | FixedPayTaskWithClaimer[];
      const rows = Array.isArray(json) ? json : json.tasks ?? [];
      setTasks(rows);
    } catch {
      setTasks([]);
      setMessage({ type: "err", text: "Unable to load fixed pay tasks." });
    } finally {
      setLoading(false);
    }
  }, [activeFilter]);

  const fetchLookups = useCallback(async () => {
    try {
      const [accountsRes, categoriesRes, profilesRes] = await Promise.all([
        fetch("/api/task-form-options", { cache: "no-store" }),
        fetch("/api/task-categories", { cache: "no-store" }),
        fetch("/api/team-members", { cache: "no-store" }),
      ]);

      if (accountsRes.ok) {
        const data = (await accountsRes.json()) as { accounts?: string[] };
        setAccounts(data.accounts ?? []);
      }

      if (categoriesRes.ok) {
        const data = (await categoriesRes.json()) as { categories?: Array<{ category_name: string }> };
        setCategories((data.categories ?? []).map((category) => category.category_name));
      }

      if (profilesRes.ok) {
        const data = (await profilesRes.json()) as { members?: ProfileSummary[] };
        setActiveProfiles(data.members ?? []);
      }
    } catch {
      // Keep the form usable with values already present on tasks.
    }
  }, []);

  const fetchAttachments = useCallback(async (taskId: string | number) => {
    setAttachmentsLoading(true);
    try {
      const res = await fetch(`/api/fixed-pay-tasks/${taskId}/attachments`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { attachments?: FixedPayTaskAttachment[] };
      setAttachments(json.attachments ?? []);
    } catch {
      setAttachments([]);
    } finally {
      setAttachmentsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    void fetchLookups();
  }, [fetchLookups]);

  useEffect(() => {
    if (panelMode === "edit" && selectedTask) {
      void fetchAttachments(selectedTask.id);
      setPendingAttachment(null);
      setAttachmentMessage(null);
    } else {
      setAttachments([]);
      setPendingAttachment(null);
      setAttachmentMessage(null);
    }
  }, [fetchAttachments, panelMode, selectedTask]);

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

  const claimedByFilterOptions = useMemo(
    () =>
      Array.from(
        new Map(
          filterBaseTasks
            .filter((task) => task.claimed_by)
            .map((task) => {
              const profile = task.claimed_by_profile;
              const label = profile?.full_name || profile?.username || task.claimed_by || "";
              return [task.claimed_by!, { value: task.claimed_by!, label } as const];
            })
        ).values()
      ).sort((a, b) => a.label.localeCompare(b.label)),
    [filterBaseTasks]
  );

  const rateFilterOptions = useMemo(
    () =>
      Array.from(new Set(filterBaseTasks.map((task) => Number(task.rate)).filter((rate) => Number.isFinite(rate)))).sort((a, b) => a - b),
    [filterBaseTasks]
  );

  const filteredTasks = useMemo(() => {
    return filterBaseTasks.filter((task) => {
      if (filterClaimedBy.length > 0 && !filterClaimedBy.includes(task.claimed_by ?? "")) return false;
      if (filterRates.length > 0 && !filterRates.includes(Number(task.rate))) return false;
      return true;
    });
  }, [filterBaseTasks, filterClaimedBy, filterRates]);

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
  const selectedAssignedProfile = selectedTask?.assigned_to_profile ?? null;
  const selectedClaimer = selectedTask?.claimed_by_profile ?? null;
  const vaOptions = useMemo(
    () => mergeProfiles(activeProfiles, selectedAssignedProfile),
    [selectedAssignedProfile, activeProfiles]
  );

  const syncTaskInState = useCallback((updatedTask: FixedPayTaskWithClaimer) => {
    setTasks((current) => current.map((item) => (item.id === updatedTask.id ? updatedTask : item)));
    setSelectedTask((current) => (current && current.id === updatedTask.id ? updatedTask : current));
  }, []);

  const removeTaskInState = useCallback((taskId: number) => {
    setTasks((current) => current.filter((item) => item.id !== taskId));
    setSelectedTask((current) => (current && current.id === taskId ? null : current));
    setSelectedTaskIds((current) => current.filter((id) => id !== taskId));
  }, []);

  const updateTaskVisibility = useCallback(
    async (task: FixedPayTaskWithClaimer, payload: Record<string, unknown>) => {
      const res = await fetch(`/api/fixed-pay-tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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

      const data = (await res.json()) as { task?: FixedPayTaskWithClaimer };
      if (data.task) syncTaskInState(data.task);
      return data.task ?? null;
    },
    [syncTaskInState]
  );

  const deleteTaskPermanently = useCallback(
    async (task: FixedPayTaskWithClaimer) => {
      const res = await fetch(`/api/fixed-pay-tasks/${task.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        let errorText = `HTTP ${res.status}`;
        try {
          const data = (await res.json()) as { error?: string };
          if (data.error) errorText = data.error;
        } catch {
          // ignore parse failures
        }
        throw new Error(errorText);
      }
      removeTaskInState(task.id);
    },
    [removeTaskInState]
  );

  const openCreatePanel = useCallback(() => {
    setPanelMode("create");
    setSelectedTask(null);
    setForm(EMPTY_FORM);
    setMessage(null);
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

  const runBulkVisibilityAction = useCallback(
    async (payload: Record<string, unknown>, successText: string, action: "archive" | "trash") => {
      const targets = tasks.filter((task) => selectedTaskIdSet.has(task.id));
      if (targets.length === 0) return;

      setBulkAction(action);
      setMessage(null);
      try {
        for (const task of targets) {
          await updateTaskVisibility(task, payload);
        }
        setSelectedTaskIds([]);
        setMessage({ type: "ok", text: successText });
      } catch (error) {
        setMessage({ type: "err", text: error instanceof Error ? error.message : "Unable to update tasks." });
      } finally {
        setBulkAction(null);
      }
    },
    [selectedTaskIdSet, tasks, updateTaskVisibility]
  );

  const runBulkDeleteAction = useCallback(async () => {
    const targets = tasks.filter((task) => selectedTaskIdSet.has(task.id));
    if (targets.length === 0) return;

    setBulkAction("delete");
    setMessage(null);
    try {
      for (const task of targets) {
        await deleteTaskPermanently(task);
      }
      setSelectedTaskIds([]);
      setMessage({ type: "ok", text: "Selected tasks permanently deleted." });
    } catch (error) {
      setMessage({ type: "err", text: error instanceof Error ? error.message : "Unable to delete tasks." });
    } finally {
      setBulkAction(null);
    }
  }, [deleteTaskPermanently, selectedTaskIdSet, tasks]);

  const openEditPanel = useCallback((task: FixedPayTaskWithClaimer) => {
    setPanelMode("edit");
    setSelectedTask(task);
    setForm(taskToForm(task));
    setMessage(null);
  }, []);

  const closePanel = useCallback(() => {
    setPanelMode(null);
    setSelectedTask(null);
    setForm(EMPTY_FORM);
    setSaving(false);
    setPendingAttachment(null);
    setAttachmentMessage(null);
    setAttachments([]);
  }, []);

  const handleToggleActive = useCallback(
    async (task: FixedPayTaskWithClaimer) => {
      try {
        const restoreArchive = Boolean(task.archived_at || task.deleted_at);
        const res = await fetch(`/api/fixed-pay-tasks/${task.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            restoreArchive
              ? { archived_at: null, deleted_at: null, is_active: true }
              : { is_active: !task.is_active }
          ),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { task?: FixedPayTaskWithClaimer };
        if (data.task) {
          setTasks((current) => current.map((item) => (item.id === task.id ? data.task! : item)));
          if (selectedTask?.id === task.id) {
            setSelectedTask(data.task);
            setForm(taskToForm(data.task));
          }
        } else {
          await fetchTasks();
        }
      } catch (error) {
        setMessage({ type: "err", text: error instanceof Error ? error.message : "Unable to update task." });
      }
    },
    [fetchTasks, selectedTask?.id]
  );

  const handleRevokeClaim = useCallback(async () => {
    if (!selectedTask) return;

    setRevokingClaim(true);
    try {
      const res = await fetch(`/api/fixed-pay-tasks/${selectedTask.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimed_by: null, claimed_at: null }),
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

      const data = (await res.json()) as { task?: FixedPayTaskWithClaimer };
      if (data.task) {
        setTasks((current) => current.map((task) => (task.id === data.task!.id ? data.task! : task)));
        setSelectedTask(data.task);
      } else {
        setSelectedTask((current) =>
          current && current.id === selectedTask.id
            ? { ...current, claimed_by: null, claimed_at: null, claimed_by_profile: null }
            : current
        );
      }

      setForm((current) => ({ ...current, assigned_to: "" }));
      await fetchTasks(activeFilter);
      setMessage({ type: "ok", text: "Claim revoked." });
    } catch (error) {
      setMessage({ type: "err", text: error instanceof Error ? error.message : "Unable to revoke claim." });
    } finally {
      setRevokingClaim(false);
    }
  }, [activeFilter, fetchTasks, selectedTask]);

  const handleTaskVisibilityChange = useCallback(
    async (task: FixedPayTaskWithClaimer, payload: Record<string, unknown>, successText: string) => {
      try {
        const res = await fetch(`/api/fixed-pay-tasks/${task.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = (await res.json()) as { task?: FixedPayTaskWithClaimer };
        if (data.task) {
          setTasks((current) => current.map((item) => (item.id === task.id ? data.task! : item)));
          if (selectedTask?.id === task.id) {
            setSelectedTask(data.task);
            setForm(taskToForm(data.task));
          }
        }

        await fetchTasks(activeFilter);
        setMessage({ type: "ok", text: successText });
      } catch (error) {
        setMessage({ type: "err", text: error instanceof Error ? error.message : "Unable to update task." });
      }
    },
    [activeFilter, fetchTasks, selectedTask?.id]
  );

  const handleArchiveTask = useCallback(
    (task: FixedPayTaskWithClaimer) => void handleTaskVisibilityChange(task, { archived_at: new Date().toISOString(), deleted_at: null }, "Task archived."),
    [handleTaskVisibilityChange]
  );

  const handleTrashTask = useCallback(
    (task: FixedPayTaskWithClaimer) => void handleTaskVisibilityChange(task, { deleted_at: new Date().toISOString(), archived_at: null }, "Task moved to trash."),
    [handleTaskVisibilityChange]
  );

  const handleRestoreTask = useCallback(
    (task: FixedPayTaskWithClaimer) => void handleTaskVisibilityChange(task, { archived_at: null, deleted_at: null, is_active: true }, "Task restored."),
    [handleTaskVisibilityChange]
  );

  const handleSubmit = useCallback(async () => {
    if (!form.task_name.trim()) {
      setMessage({ type: "err", text: "Task name is required." });
      return;
    }

    const rate = Number(form.rate);
    if (!Number.isFinite(rate)) {
      setMessage({ type: "err", text: "Rate is required." });
      return;
    }

    if (!STATUS_OPTIONS.includes(form.status)) {
      setMessage({ type: "err", text: "Status is invalid." });
      return;
    }

    const isEdit = panelMode === "edit" && Boolean(selectedTask);
    const endpoint = isEdit && selectedTask ? `/api/fixed-pay-tasks/${selectedTask.id}` : "/api/fixed-pay-tasks";
    const method = isEdit ? "PATCH" : "POST";

    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch(endpoint, {
        method,
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
          assigned_to: form.assigned_to || null,
          assigned_by: form.assigned_by || null,
          status: form.status,
          is_active: form.is_active,
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

      const data = (await res.json()) as { task?: FixedPayTaskWithClaimer };
      const savedTask = data.task ?? null;

      await fetchTasks();
      if (savedTask) {
        setSelectedTask(savedTask);
        setPanelMode("edit");
        setForm(taskToForm(savedTask));
        setMessage({ type: "ok", text: isEdit ? "Task updated." : "Task created." });
      } else {
        setMessage({ type: "ok", text: isEdit ? "Task updated." : "Task created." });
      }
    } catch (error) {
      setMessage({ type: "err", text: error instanceof Error ? error.message : "Unable to save task." });
    } finally {
      setSaving(false);
    }
  }, [
    fetchTasks,
    form.account,
    form.assigned_by,
    form.assigned_to,
    form.category,
    form.instructions,
    form.instructions_locked,
    form.is_active,
    form.link,
    form.rate,
    form.status,
    form.task_detail,
    form.task_name,
    form.task_notes,
    panelMode,
    selectedTask,
  ]);

  const handleAttachmentPick = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setPendingAttachment(event.target.files?.[0] ?? null);
    setAttachmentMessage(null);
  }, []);

  const handleUploadAttachment = useCallback(async () => {
    if (!selectedTask) return;
    if (!pendingAttachment) {
      setAttachmentMessage({ type: "err", text: "Choose a file first." });
      return;
    }

    setAttachmentUploading(true);
    setAttachmentMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", pendingAttachment);

      const res = await fetch(`/api/fixed-pay-tasks/${selectedTask.id}/attachments`, {
        method: "POST",
        body: formData,
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

      await fetchAttachments(selectedTask.id);
      setPendingAttachment(null);
      if (attachmentInputRef.current) attachmentInputRef.current.value = "";
      setAttachmentMessage({ type: "ok", text: "Attachment uploaded." });
    } catch (error) {
      setAttachmentMessage({ type: "err", text: error instanceof Error ? error.message : "Unable to upload attachment." });
    } finally {
      setAttachmentUploading(false);
    }
  }, [fetchAttachments, pendingAttachment, selectedTask]);

  const panelTitle = panelMode === "edit" ? "Edit Task" : "New Task";
  const panelSubtitle = panelMode === "edit" && selectedTask ? `Editing #${selectedTask.id}` : "Create a task for the fixed-pay pool.";

  const currentAssignedProfile = selectedTask?.assigned_to_profile ?? null;
  const currentAssignedByProfile = selectedTask?.assigned_by_profile ?? null;
  const assignedToOptions = useMemo(() => mergeProfiles(vaOptions, currentAssignedProfile), [currentAssignedProfile, vaOptions]);
  const assignedByOptions = useMemo(() => mergeProfiles(activeProfiles, currentAssignedByProfile), [activeProfiles, currentAssignedByProfile]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="rounded-2xl border border-sand bg-white shadow-sm">
        <div className="border-b border-parchment px-5 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-lg font-bold text-espresso">Fixed Pay Tasks</h1>
              <p className="text-xs text-stone">Manage the fixed-pay task pool for per-task VAs.</p>
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
              label="Claimed By"
              options={claimedByFilterOptions}
              selected={filterClaimedBy}
              onChange={setFilterClaimedBy}
              isOpen={openFilter === "claimedBy"}
              onToggle={() => setOpenFilter(openFilter === "claimedBy" ? null : "claimedBy")}
            />
            <FilterDropdown
              label="Rate"
              options={rateFilterOptions.map((rate) => ({ value: rate, label: formatRate(rate) }))}
              selected={filterRates}
              onChange={setFilterRates}
              isOpen={openFilter === "rate"}
              onToggle={() => setOpenFilter(openFilter === "rate" ? null : "rate")}
            />
            {(filterTaskNames.length > 0 || filterAccounts.length > 0 || filterCategories.length > 0 || filterStatuses.length > 0 || filterClaimedBy.length > 0 || filterRates.length > 0 || activeFilter !== "all") && (
              <button
                type="button"
                onClick={() => {
                  setActiveFilter("all");
                  setFilterTaskNames([]);
                  setFilterAccounts([]);
                  setFilterCategories([]);
                  setFilterStatuses([]);
                  setFilterClaimedBy([]);
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
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void runBulkVisibilityAction({ archived_at: new Date().toISOString(), deleted_at: null }, "Selected tasks archived.", "archive")}
                  disabled={bulkAction !== null}
                  className="rounded-lg border border-amber-400 px-3 py-2 text-[12px] font-semibold text-amber-700 transition-colors hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {bulkAction === "archive" ? "Archiving..." : "Archive"}
                </button>
                <button
                  type="button"
                  onClick={() => void runBulkVisibilityAction({ deleted_at: new Date().toISOString(), archived_at: null }, "Selected tasks moved to trash.", "trash")}
                  disabled={bulkAction !== null}
                  className="rounded-lg border border-red-300 px-3 py-2 text-[12px] font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {bulkAction === "trash" ? "Trashing..." : "Trash"}
                </button>
                {activeFilter === "trash" && (
                  <button
                    type="button"
                    onClick={() => void runBulkDeleteAction()}
                    disabled={bulkAction !== null}
                    className="rounded-lg border border-stone px-3 py-2 text-[12px] font-semibold text-stone transition-colors hover:bg-stone/5 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {bulkAction === "delete" ? "Deleting..." : "Permanently Delete"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedTaskIds([])}
                  className="text-[12px] text-stone hover:text-terracotta hover:underline"
                >
                  Clear selection
                </button>
              </div>
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
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">Claimed By</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.map((task) => {
                    const claimedBy = task.claimed_by_profile?.full_name || task.claimed_by_profile?.username || "—";
                    const isSelected = selectedTaskIdSet.has(task.id) || selectedTask?.id === task.id;
                    const rowStateLabel = task.deleted_at ? "Trash" : task.archived_at ? "Archived" : task.is_active ? "On" : "Off";
                    const rowStateClass = task.deleted_at
                      ? "bg-red-100 text-red-600 hover:bg-red-100"
                      : task.archived_at
                        ? "bg-amber-100 text-amber-700 hover:bg-amber-100"
                        : task.is_active
                          ? "bg-sage-soft text-sage hover:bg-sage/20"
                          : "bg-parchment text-stone hover:bg-sand";

                    return (
                      <tr
                        key={task.id}
                        className={`cursor-pointer border-b border-sand last:border-0 transition-colors hover:bg-parchment/30 ${
                          isSelected ? "bg-parchment/50" : ""
                        }`}
                        onClick={() => openEditPanel(task)}
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
                              onClick={() => openEditPanel(task)}
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
                            <div>{claimedBy}</div>
                            <div className="text-[10px] text-stone/70">{formatTimestamp(task.claimed_at)}</div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-[13px] text-walnut" onClick={(event) => event.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => void handleToggleActive(task)}
                            className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors ${rowStateClass}`}
                          >
                            {rowStateLabel}
                          </button>
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
                  <span className="block text-[13px] font-semibold text-walnut">{panelTitle}</span>
                  <span className="block text-[11px] text-stone">{panelSubtitle}</span>
                </div>
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
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
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Rate</label>
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
                  onChange={(event) => setForm((current) => ({ ...current, task_detail: event.target.value }))}
                  className="min-h-[96px] w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                  placeholder="Task detail"
                />
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
                {form.instructions_locked && form.instructions.trim() && (
                  <div className="mt-2 rounded-lg border border-sand bg-parchment/30 px-3 py-2 text-[13px] text-espresso">
                    {parseLinks(form.instructions)}
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Assigned By</label>
                <select
                  value={form.assigned_by}
                  onChange={(event) => setForm((current) => ({ ...current, assigned_by: event.target.value }))}
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                >
                  <option value="">Unassigned</option>
                  {assignedByOptions.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.full_name || profile.username || profile.id}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Assign To</label>
                <select
                  value={form.assigned_to}
                  onChange={(event) => setForm((current) => ({ ...current, assigned_to: event.target.value }))}
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                >
                  <option value="">Unassigned</option>
                  {assignedToOptions.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.full_name || profile.username || profile.id}
                    </option>
                  ))}
                </select>
              </div>

              {panelMode === "edit" && selectedTask?.claimed_by && (
                <div className="rounded-xl border border-sand bg-parchment/20 p-4">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-stone">Claimed By</div>
                      <div className="text-[13px] text-espresso">
                        {selectedClaimer?.full_name || selectedClaimer?.username || selectedTask.claimed_by}
                      </div>
                      <div className="text-[11px] text-stone">{formatTimestamp(selectedTask.claimed_at)}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleRevokeClaim()}
                      disabled={revokingClaim}
                      className="rounded-lg bg-terracotta px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-[#a85840] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {revokingClaim ? "Revoking..." : "Revoke Claim"}
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Status</label>
                <select
                  value={form.status}
                  onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as FixedPayTaskWithClaimer["status"] }))}
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-stone">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))}
                  className="h-4 w-4 rounded border-sand text-terracotta focus:ring-terracotta"
                />
                Active
              </label>

              {panelMode === "edit" && selectedTask && (
                <div className="flex flex-wrap gap-2">
                  {selectedTask.archived_at || selectedTask.deleted_at ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleRestoreTask(selectedTask)}
                        className="rounded-lg border border-sage px-3 py-1.5 text-[11px] font-semibold text-sage transition-colors hover:bg-sage-soft"
                      >
                        Restore
                      </button>
                      {selectedTask.deleted_at && (
                        <button
                          type="button"
                          onClick={() => void deleteTaskPermanently(selectedTask)}
                          className="rounded-lg border border-stone px-3 py-1.5 text-[11px] font-semibold text-stone transition-colors hover:bg-stone/5"
                        >
                          Permanently Delete
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleArchiveTask(selectedTask)}
                        className="rounded-lg border border-amber-400 px-3 py-1.5 text-[11px] font-semibold text-amber-700 transition-colors hover:bg-amber-50"
                      >
                        Archive
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleTrashTask(selectedTask)}
                        className="rounded-lg border border-red-300 px-3 py-1.5 text-[11px] font-semibold text-red-600 transition-colors hover:bg-red-50"
                      >
                        Trash
                      </button>
                    </>
                  )}
                </div>
              )}

              <div className="rounded-xl border border-sand bg-parchment/20 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-stone">Attachments</div>
                    <div className="text-[11px] text-stone">Upload files to the task-attachments bucket.</div>
                  </div>
                  <span className="text-[11px] text-stone">{attachments.length} file{attachments.length === 1 ? "" : "s"}</span>
                </div>

                {attachmentMessage && (
                  <div className={`mb-3 rounded-lg px-3 py-2 text-sm ${attachmentMessage.type === "ok" ? "bg-sage-soft text-sage" : "bg-red-50 text-red-700"}`}>
                    {attachmentMessage.text}
                  </div>
                )}

                {panelMode === "edit" && selectedTask ? (
                  <div className="space-y-3">
                    <input
                      ref={attachmentInputRef}
                      type="file"
                      onChange={handleAttachmentPick}
                      className="block w-full text-[13px] text-stone file:mr-3 file:rounded-lg file:border-0 file:bg-terracotta file:px-3 file:py-2 file:text-[12px] file:font-semibold file:text-white hover:file:bg-[#a85840]"
                    />

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleUploadAttachment()}
                        disabled={attachmentUploading || !pendingAttachment}
                        className="rounded-lg bg-terracotta px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#a85840] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {attachmentUploading ? "Uploading..." : "Upload Attachment"}
                      </button>
                      {pendingAttachment && <span className="text-[11px] text-stone">{pendingAttachment.name}</span>}
                    </div>

                    {attachmentsLoading ? (
                      <div className="space-y-2">
                        {[1, 2].map((item) => (
                          <div key={item} className="h-12 animate-pulse rounded-lg bg-parchment" />
                        ))}
                      </div>
                    ) : attachments.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-sand px-3 py-4 text-[12px] text-stone">
                        No attachments yet.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {attachments.map((attachment) => (
                          <div key={attachment.id} className="rounded-lg border border-sand bg-white px-3 py-2 text-[12px] text-walnut">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate font-medium">{attachment.filename}</div>
                                <div className="text-[11px] text-stone">
                                  {formatAttachmentSize(attachment.file_size)}
                                  {attachment.file_size ? " · " : ""}
                                  {formatTimestamp(attachment.uploaded_at)}
                                </div>
                              </div>
                              <a
                                href={attachment.url ?? undefined}
                                target="_blank"
                                rel="noreferrer"
                                className="shrink-0 rounded-md border border-sand px-2 py-1 text-[11px] font-semibold text-stone transition-colors hover:border-terracotta hover:text-terracotta"
                              >
                                Open
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-sand px-3 py-4 text-[12px] text-stone">
                    Save the task first to upload attachments.
                  </div>
                )}
              </div>
            </div>

            <div className="shrink-0 border-t border-sand px-5 py-4">
              <div className={`mb-3 rounded-lg px-4 py-3 text-sm ${message?.type === "ok" ? "bg-sage-soft text-sage" : message?.type === "err" ? "bg-red-50 text-red-700" : "hidden"}`}>
                {message?.text}
              </div>

              <div className="flex items-center justify-end gap-3">
                <button type="button" onClick={closePanel} className="text-xs text-stone hover:text-espresso">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={saving}
                  className="rounded-lg bg-terracotta px-5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#a85840] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? "Saving..." : panelMode === "edit" ? "Update Task" : "Create Task"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
