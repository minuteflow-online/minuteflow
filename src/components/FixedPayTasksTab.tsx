"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { FixedPayTaskAttachment, FixedPayTaskWithClaimer, Profile } from "@/types/database";
import { createClient } from "@/lib/supabase/client";
import ColumnHeader from "@/components/table/ColumnHeader";
import ColumnVisibilityPicker from "@/components/table/ColumnVisibilityPicker";
import TableRowDetailPanel from "@/components/table/TableRowDetailPanel";
import TaskEditor, { type TaskEditorHandle } from "@/components/TaskEditor";
import { useColumnPrefs, type ColumnDef } from "@/components/table/useColumnPrefs";

const VIEW_FILTER_PILLS: Array<{ value: "all" | "active" | "inactive" | "archived" | "trash"; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "archived", label: "Archived" },
  { value: "trash", label: "Trash" },
];

const STATUS_OPTIONS: Array<FixedPayTaskWithClaimer["status"]> = ["open", "pending", "on_queue", "in_progress", "submitted", "revision_needed", "completed", "cancelled", "paid"];
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

// start_date/due_date are plain dates (YYYY-MM-DD) — parse as UTC-noon so the
// displayed day never shifts backward in timezones behind UTC.
function formatDateOnly(value: string | null) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatAttachmentSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const TABLE_COLUMNS: ColumnDef[] = [
  { key: "task_name", label: "Task Name", defaultWidth: 200 },
  { key: "account", label: "Account", defaultWidth: 140 },
  { key: "category", label: "Category", defaultWidth: 140 },
  { key: "status", label: "Status", defaultWidth: 140 },
  { key: "rate", label: "Rate", defaultWidth: 90 },
  { key: "start_date", label: "Start Date", defaultWidth: 110 },
  { key: "due_date", label: "Due Date", defaultWidth: 110 },
  { key: "claimed_by", label: "Claimed By", defaultWidth: 150 },
  { key: "created", label: "Created", defaultWidth: 150 },
  { key: "active", label: "Active", defaultWidth: 90 },
];

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
  const [filterStartDates, setFilterStartDates] = useState<string[]>([]);
  const [filterDueDates, setFilterDueDates] = useState<string[]>([]);
  const [panelMode, setPanelMode] = useState<PanelMode>(null);
  const [selectedTask, setSelectedTask] = useState<FixedPayTaskWithClaimer | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([]);
  const [panelStatus, setPanelStatus] = useState<FixedPayTaskWithClaimer["status"]>("open");
  const [panelIsActive, setPanelIsActive] = useState(true);
  const [panelSaving, setPanelSaving] = useState(false);
  const [bulkAction, setBulkAction] = useState<"archive" | "trash" | "delete" | null>(null);
  const [revokingClaim, setRevokingClaim] = useState(false);
  const taskEditorRef = useRef<TaskEditorHandle | null>(null);

  const [activeProfiles, setActiveProfiles] = useState<ProfileSummary[]>([]);

  const [attachments, setAttachments] = useState<FixedPayTaskAttachment[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [attachmentMessage, setAttachmentMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<File | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const headerSelectAllRef = useRef<HTMLInputElement | null>(null);

  const supabase = useMemo(() => createClient(), []);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
  }, [supabase]);

  const { widths: columnWidths, hidden: hiddenColumns, setColumnWidth, toggleColumnVisible } = useColumnPrefs(
    "fixed-pay-tasks-admin",
    currentUserId,
    TABLE_COLUMNS
  );

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
      setMessage({ type: "err", text: "Unable to load Output Based tasks." });
    } finally {
      setLoading(false);
    }
  }, [activeFilter]);

  const fetchLookups = useCallback(async () => {
    try {
      const profilesRes = await fetch("/api/team-members", { cache: "no-store" });
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
      if (filterClaimedBy.length > 0 && !filterClaimedBy.includes(task.claimed_by ?? "")) return false;
      if (filterRates.length > 0 && !filterRates.includes(Number(task.rate))) return false;
      if (filterStartDates.length > 0 && !filterStartDates.includes(task.start_date ?? "")) return false;
      if (filterDueDates.length > 0 && !filterDueDates.includes(task.due_date ?? "")) return false;
      return true;
    });
  }, [filterBaseTasks, filterClaimedBy, filterRates, filterStartDates, filterDueDates]);

  const selectedTaskIdSet = useMemo(() => new Set(selectedTaskIds), [selectedTaskIds]);
  const allVisibleSelected = filteredTasks.length > 0 && filteredTasks.every((task) => selectedTaskIdSet.has(task.id));
  const someVisibleSelected = filteredTasks.some((task) => selectedTaskIdSet.has(task.id)) && !allVisibleSelected;

  useEffect(() => {
    if (headerSelectAllRef.current) {
      headerSelectAllRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);

  const selectedClaimer = selectedTask?.claimed_by_profile ?? null;

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
    setPanelStatus("open");
    setPanelIsActive(true);
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
    setPanelStatus(task.status);
    setPanelIsActive(task.is_active);
    setMessage(null);
  }, []);

  const closePanel = useCallback(() => {
    setPanelMode(null);
    setSelectedTask(null);
    setPanelSaving(false);
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
            setPanelIsActive(data.task.is_active);
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
            setPanelStatus(data.task.status);
            setPanelIsActive(data.task.is_active);
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

  // TaskEditor's onSaved callback — lands in edit mode with the fresh task,
  // mirroring the old handleSubmit's post-save behavior.
  const handleTaskSaved = useCallback(
    (task: { id: number; [key: string]: unknown }) => {
      const savedTask = task as unknown as FixedPayTaskWithClaimer;
      void fetchTasks();
      setSelectedTask(savedTask);
      setPanelMode("edit");
      setPanelStatus(savedTask.status);
      setPanelIsActive(savedTask.is_active);
    },
    [fetchTasks]
  );

  // Combined Save Changes — submits TaskEditor's metadata form, then (in
  // edit mode) applies Status/Active as a separate PATCH, since those live
  // outside TaskEditor's own fields. TaskEditor's submit() rejects on
  // failure (validation or network), so a failed metadata save correctly
  // stops here instead of reporting success.
  const handleSaveAll = useCallback(async () => {
    setMessage(null);
    setPanelSaving(true);
    try {
      await taskEditorRef.current?.submit();
      if (panelMode === "edit" && selectedTask) {
        const statusChanged = panelStatus !== selectedTask.status;
        const isActiveChanged = panelIsActive !== selectedTask.is_active;
        if (statusChanged || isActiveChanged) {
          const payload: Record<string, unknown> = {};
          if (statusChanged) payload.status = panelStatus;
          if (isActiveChanged) payload.is_active = panelIsActive;
          await updateTaskVisibility(selectedTask, payload);
        }
        setMessage({ type: "ok", text: "Task updated." });
      }
    } catch (error) {
      setMessage({ type: "err", text: error instanceof Error ? error.message : "Unable to save task." });
    } finally {
      setPanelSaving(false);
    }
  }, [panelMode, selectedTask, panelStatus, panelIsActive, updateTaskVisibility]);

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
  const panelSubtitle = panelMode === "edit" && selectedTask ? `Editing #${selectedTask.id}` : "Create a task for the Output Based pool.";

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="rounded-2xl border border-sand bg-white shadow-sm">
        <div className="border-b border-parchment px-5 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-lg font-bold text-espresso">Output Based Tasks</h1>
              <p className="text-xs text-stone">Manage the Output Based task pool for per-task VAs.</p>
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
              {(filterTaskNames.length > 0 || filterAccounts.length > 0 || filterCategories.length > 0 || filterStatuses.length > 0 || filterClaimedBy.length > 0 || filterRates.length > 0 || filterStartDates.length > 0 || filterDueDates.length > 0 || activeFilter !== "all") && (
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
                    setFilterStartDates([]);
                    setFilterDueDates([]);
                  }}
                  className="cursor-pointer text-[12px] text-stone hover:text-terracotta hover:underline"
                >
                  Clear all filters
                </button>
              )}
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
                    {!hiddenColumns.has("claimed_by") && (
                      <ColumnHeader
                        label="Claimed By"
                        width={columnWidths.claimed_by}
                        onResize={(w) => setColumnWidth("claimed_by", w)}
                        filterOptions={claimedByFilterOptions}
                        selected={filterClaimedBy}
                        onFilterChange={setFilterClaimedBy}
                      />
                    )}
                    {!hiddenColumns.has("created") && (
                      <ColumnHeader label="Created" width={columnWidths.created} onResize={(w) => setColumnWidth("created", w)} />
                    )}
                    {!hiddenColumns.has("active") && (
                      <ColumnHeader label="Active" width={columnWidths.active} onResize={(w) => setColumnWidth("active", w)} />
                    )}
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
                        {!hiddenColumns.has("claimed_by") && (
                          <td className="px-3 py-3 text-[13px] text-walnut">
                            <div className="space-y-0.5 truncate">
                              <div className="truncate">{claimedBy}</div>
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
                          <td className="px-3 py-3 text-[13px] text-walnut" onClick={(event) => event.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => void handleToggleActive(task)}
                              className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors ${rowStateClass}`}
                            >
                              {rowStateLabel}
                            </button>
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
          title={panelTitle}
          subtitle={panelSubtitle}
          onClose={closePanel}
          footer={
            <>
              <div className={`mb-3 rounded-lg px-4 py-3 text-sm ${message?.type === "ok" ? "bg-sage-soft text-sage" : message?.type === "err" ? "bg-red-50 text-red-700" : "hidden"}`}>
                {message?.text}
              </div>

              <div className="flex items-center justify-end gap-3">
                <button type="button" onClick={closePanel} className="text-xs text-stone hover:text-espresso">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveAll()}
                  disabled={panelSaving}
                  className="rounded-lg bg-terracotta px-5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#a85840] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {panelSaving ? "Saving..." : panelMode === "edit" ? "Update Task" : "Create Task"}
                </button>
              </div>
            </>
          }
        >
              <TaskEditor
                ref={taskEditorRef}
                mode="output_based"
                editingTaskId={panelMode === "edit" ? selectedTask?.id ?? null : null}
                initialTask={panelMode === "edit" ? (selectedTask as unknown as Record<string, unknown>) : null}
                currentUserId={currentUserId ?? ""}
                isAdminOrManager
                teamMembers={activeProfiles}
                hideFooter
                onCancel={closePanel}
                onSaved={handleTaskSaved}
              />

              {panelMode === "edit" && selectedTask && (
                <p className="text-[11px] text-stone">
                  Created {formatTimestamp(selectedTask.created_at)}
                  {selectedTask.created_by_profile ? ` by ${selectedTask.created_by_profile.full_name || selectedTask.created_by_profile.username}` : ""}
                </p>
              )}

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

              {panelMode === "edit" && selectedTask && (
                <>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Status</label>
                    <select
                      value={panelStatus}
                      onChange={(event) => setPanelStatus(event.target.value as FixedPayTaskWithClaimer["status"])}
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
                      checked={panelIsActive}
                      onChange={(event) => setPanelIsActive(event.target.checked)}
                      className="h-4 w-4 rounded border-sand text-terracotta focus:ring-terracotta"
                    />
                    Active
                  </label>
                </>
              )}

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
        </TableRowDetailPanel>
      )}
    </div>
  );
}
