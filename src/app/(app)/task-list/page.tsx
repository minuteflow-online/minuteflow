"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { AssignedTaskStatus } from "@/types/database";

type VATaskRow = {
  id: number;
  va_id: string;
  status: AssignedTaskStatus;
  log_id: number | null;
  notes: string | null;
  assigned_at: string | null;
  updated_at: string | null;
  is_collaborative?: boolean;
  collaborator_name?: string | null;
  assigned_tasks: {
    id: number;
    account: string | null;
    project: string | null;
    task_name: string;
    task_detail: string | null;
    task_notes: string | null;
    due_date: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
  };
};

type AttachmentRow = {
  id: number;
  filename: string;
  storage_path: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  url: string | null;
};

type FormObjective = {
  id: number;
  account: string | null;
  project_name: string;
};

type FormTask = {
  id: number;
  task_name: string;
  billing_type?: string;
};

const STATUS_FILTERS: Array<{ value: AssignedTaskStatus | "all"; label: string }> = [
  { value: "all", label: "All Statuses" },
  { value: "pending", label: "Pending" },
  { value: "on_queue", label: "On Queue" },
  { value: "in_progress", label: "In Progress" },
  { value: "submitted", label: "Submitted" },
  { value: "reviewing", label: "Reviewing" },
  { value: "revision_needed", label: "Revision Needed" },
  { value: "approved", label: "Approved" },
  { value: "completed", label: "Completed" },
  { value: "paid", label: "Paid" },
  { value: "cancelled", label: "Cancelled" },
];

const STATUS_ORDER: Record<AssignedTaskStatus, number> = {
  pending: -1,
  on_queue: 0,
  in_progress: 1,
  submitted: 2,
  reviewing: 3,
  revision_needed: 4,
  approved: 5,
  completed: 6,
  paid: 7,
  cancelled: 8,
};

const STATUS_LABELS: Record<AssignedTaskStatus, string> = {
  pending: "Pending",
  on_queue: "On Queue",
  in_progress: "In Progress",
  submitted: "Submitted",
  reviewing: "Reviewing",
  revision_needed: "Revision Needed",
  approved: "Approved",
  completed: "Completed",
  paid: "Paid",
  cancelled: "Cancelled",
};

const STATUS_CLASSES: Record<AssignedTaskStatus, string> = {
  pending: "bg-slate-blue-soft text-slate-blue",
  on_queue: "bg-stone/10 text-stone",
  in_progress: "bg-amber-100 text-amber-700",
  submitted: "bg-sky-100 text-sky-700",
  reviewing: "bg-violet-100 text-violet-700",
  revision_needed: "bg-amber-100 text-amber-600",
  approved: "bg-emerald-100 text-emerald-700",
  completed: "bg-sage-soft text-sage",
  paid: "bg-purple-100 text-purple-700",
  cancelled: "bg-red-100 text-red-500",
};

function StatusBadge({ status }: { status: AssignedTaskStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASSES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function formatDueDate(dueDate: string | null) {
  if (!dueDate) return { label: "—", isOverdue: false };

  const date = new Date(dueDate);
  if (Number.isNaN(date.getTime())) return { label: dueDate, isOverdue: false };

  return {
    label: date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    isOverdue: date.getTime() < Date.now(),
  };
}

function formatDateInputValue(dueDate: string | null) {
  if (!dueDate) return "";

  const date = new Date(dueDate);
  if (Number.isNaN(date.getTime())) return dueDate;

  return date.toISOString().slice(0, 10);
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sortTasks(tasks: VATaskRow[]) {
  return [...tasks].sort((a, b) => {
    const statusDiff = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
    if (statusDiff !== 0) return statusDiff;

    const aTime = new Date(a.assigned_at ?? a.updated_at ?? a.assigned_tasks.created_at).getTime();
    const bTime = new Date(b.assigned_at ?? b.updated_at ?? b.assigned_tasks.created_at).getTime();
    return bTime - aTime;
  });
}

function sameText(a: string | null | undefined, b: string | null | undefined) {
  return (a ?? "") === (b ?? "");
}

export default function TaskListPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [tasks, setTasks] = useState<VATaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<AssignedTaskStatus | "all">("all");

  const [formAccounts, setFormAccounts] = useState<string[]>([]);
  const [formProjects, setFormProjects] = useState<FormObjective[]>([]);
  const [formTasksByProject, setFormTasksByProject] = useState<Record<number, FormTask[]>>({});

  const [isCreating, setIsCreating] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addForm, setAddForm] = useState({
    account: "",
    project: "",
    task_name: "",
    task_detail: "",
    due_date: "",
    task_notes: "",
  });

  const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null);
  const [panelStatus, setPanelStatus] = useState<AssignedTaskStatus>("pending");
  const [panelAccount, setPanelAccount] = useState("");
  const [panelProject, setPanelProject] = useState("");
  const [panelTaskName, setPanelTaskName] = useState("");
  const [panelDueDate, setPanelDueDate] = useState("");
  const [panelDetail, setPanelDetail] = useState("");
  const [panelTaskNotes, setPanelTaskNotes] = useState("");
  const [panelNotes, setPanelNotes] = useState("");
  const [panelSaving, setPanelSaving] = useState(false);
  const [panelUploadSaving, setPanelUploadSaving] = useState(false);
  const [panelMsg, setPanelMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const panelAttachmentInputRef = useRef<HTMLInputElement | null>(null);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/assigned-tasks", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const raw = Array.isArray(json) ? json : json.tasks ?? [];
      const normalized = raw.map((row: VATaskRow) => ({
        ...row,
        is_collaborative: Boolean(row.is_collaborative),
        collaborator_name: row.collaborator_name ?? null,
      }));
      setTasks(sortTasks(normalized));
    } catch {
      setError("Unable to load assigned tasks right now.");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchFormOptions = useCallback(async () => {
    try {
      const res = await fetch("/api/task-form-options", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (data.accounts?.length > 0) setFormAccounts(data.accounts);
      if (data.projects?.length > 0) setFormProjects(data.projects);
      if (data.tasksByProject) setFormTasksByProject(data.tasksByProject);
    } catch {
      // keep fallbacks from existing task data
    }
  }, []);

  const fetchCurrentUser = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", data.user.id)
        .single();

      if (profile?.role === "admin" || profile?.role === "manager") {
        router.replace("/admin");
      }
    } catch {
      // leave the task list usable for VAs if profile lookup fails
    }
  }, [router, supabase]);

  const fetchAttachments = useCallback(async (taskId: number) => {
    setAttachmentsLoading(true);
    setAttachments([]);
    try {
      const res = await fetch(`/api/assigned-tasks/${taskId}/attachments`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const raw = Array.isArray(json) ? json : json.attachments ?? [];
      setAttachments(
        raw.map((row: AttachmentRow) => ({
          ...row,
          file_size: row.file_size ?? null,
          mime_type: row.mime_type ?? null,
          uploaded_by: row.uploaded_by ?? null,
          url: row.url ?? null,
        }))
      );
    } catch {
      setAttachments([]);
    } finally {
      setAttachmentsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCurrentUser();
    void fetchFormOptions();
    void fetchTasks();
  }, [fetchCurrentUser, fetchFormOptions, fetchTasks]);

  const accountOptions = useMemo(() => {
    if (formAccounts.length > 0) return formAccounts;
    return Array.from(
      new Set(tasks.map((task) => task.assigned_tasks.account).filter((v): v is string => Boolean(v)))
    ).sort();
  }, [formAccounts, tasks]);

  const addProjectsForAccount = useMemo(
    () => formProjects.filter((project) => project.account === addForm.account),
    [formProjects, addForm.account]
  );
  const addProjectId = useMemo(
    () =>
      formProjects.find((project) => project.account === addForm.account && project.project_name === addForm.project)?.id ??
      null,
    [formProjects, addForm.account, addForm.project]
  );
  const addTasksForProject = useMemo(
    () => (addProjectId ? formTasksByProject[addProjectId] ?? [] : []),
    [addProjectId, formTasksByProject]
  );

  const openCreate = useCallback(() => {
    setExpandedTaskId(null);
    setPanelStatus("pending");
    setPanelAccount("");
    setPanelProject("");
    setPanelTaskName("");
    setPanelDueDate("");
    setPanelDetail("");
    setPanelTaskNotes("");
    setPanelNotes("");
    setPanelSaving(false);
    setPanelUploadSaving(false);
    setPanelMsg(null);
    setAttachments([]);
    setAttachmentsLoading(false);
    setIsCreating(true);
    setAddError(null);
    setAddSaving(false);
    setAddForm({
      account: "",
      project: "",
      task_name: "",
      task_detail: "",
      due_date: "",
      task_notes: "",
    });
  }, []);

  const closeCreate = useCallback(() => {
    setIsCreating(false);
    setAddError(null);
    setAddSaving(false);
    setAddForm({
      account: "",
      project: "",
      task_name: "",
      task_detail: "",
      due_date: "",
      task_notes: "",
    });
  }, []);

  const filteredTasks = useMemo(
    () => (statusFilter === "all" ? tasks : tasks.filter((task) => task.status === statusFilter)),
    [tasks, statusFilter]
  );

  const panelProjectsForAccount = useMemo(
    () => formProjects.filter((project) => project.account === panelAccount),
    [formProjects, panelAccount]
  );
  const panelProjectId = useMemo(
    () =>
      formProjects.find((project) => project.account === panelAccount && project.project_name === panelProject)?.id ??
      null,
    [formProjects, panelAccount, panelProject]
  );
  const panelTasksForProject = useMemo(
    () => (panelProjectId ? formTasksByProject[panelProjectId] ?? [] : []),
    [panelProjectId, formTasksByProject]
  );

  const expandedTask = useMemo(() => tasks.find((task) => task.id === expandedTaskId) ?? null, [tasks, expandedTaskId]);
  const panelCanEditFields = Boolean(expandedTask && !expandedTask.is_collaborative);

  const resetTaskEditor = useCallback(() => {
    setPanelStatus("pending");
    setPanelAccount("");
    setPanelProject("");
    setPanelTaskName("");
    setPanelDueDate("");
    setPanelDetail("");
    setPanelTaskNotes("");
    setPanelNotes("");
    setPanelSaving(false);
    setPanelUploadSaving(false);
    setPanelMsg(null);
    setAttachments([]);
    setAttachmentsLoading(false);
  }, []);

  const openTask = useCallback(
    async (task: VATaskRow) => {
      closeCreate();
      setExpandedTaskId(task.id);
      setPanelStatus(task.status);
      setPanelAccount(task.assigned_tasks.account ?? "");
      setPanelProject(task.assigned_tasks.project ?? "");
      setPanelTaskName(task.assigned_tasks.task_name ?? "");
      setPanelDueDate(task.assigned_tasks.due_date ?? "");
      setPanelDetail(task.assigned_tasks.task_detail ?? "");
      setPanelTaskNotes(task.assigned_tasks.task_notes ?? "");
      setPanelNotes(task.notes ?? "");
      setPanelUploadSaving(false);
      setPanelMsg(null);
      setAttachments([]);
      setAttachmentsLoading(true);
      await fetchAttachments(task.assigned_tasks.id);
    },
    [closeCreate, fetchAttachments]
  );

  const closeTask = useCallback(() => {
    setExpandedTaskId(null);
    resetTaskEditor();
  }, [resetTaskEditor]);

  const toggleTask = useCallback(
    (task: VATaskRow) => {
      if (expandedTaskId === task.id) {
        closeTask();
        return;
      }

      void openTask(task);
    },
    [closeTask, expandedTaskId, openTask]
  );

  const handleQuickStatusChange = useCallback(
    async (task: VATaskRow, nextStatus: AssignedTaskStatus) => {
      try {
        const res = await fetch(`/api/assigned-tasks/${task.assigned_tasks.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        await fetchTasks();
        if (expandedTaskId === task.id) {
          setPanelStatus(nextStatus);
        }
      } catch {
        setError("Unable to update task status right now.");
      }
    },
    [expandedTaskId, fetchTasks]
  );

  const handleAddTask = useCallback(async () => {
    if (!addForm.task_name.trim()) {
      setAddError("Task name is required.");
      return;
    }

    setAddSaving(true);
    setAddError(null);

    try {
      const res = await fetch("/api/assigned-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account: addForm.account || null,
          project: addForm.project || null,
          task_name: addForm.task_name.trim(),
          task_detail: addForm.task_detail.trim() || null,
          due_date: addForm.due_date || null,
          task_notes: addForm.task_notes.trim() || null,
        }),
      });

      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (data?.error) message = data.error;
        } catch {
          // ignore JSON parsing errors
        }
        throw new Error(message);
      }

      await fetchTasks();
      closeCreate();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Unable to add task right now.");
    } finally {
      setAddSaving(false);
    }
  }, [addForm.account, addForm.due_date, addForm.project, addForm.task_detail, addForm.task_name, addForm.task_notes, closeCreate, fetchTasks]);

  const handleSaveTask = useCallback(async () => {
    if (!expandedTask) return;

    const taskId = expandedTask.assigned_tasks.id;
    const previousStatus = expandedTask.status;
    const previousNotes = expandedTask.notes ?? "";
    const nextStatus = panelStatus;
    const statusChanged = nextStatus !== previousStatus;
    const nextAccount = panelAccount.trim();
    const nextProject = panelProject.trim();
    const nextTaskName = panelTaskName.trim();
    const nextDueDate = panelDueDate.trim();
    const nextDetail = panelDetail;
    const nextTaskNotes = panelTaskNotes;
    const nextNotes = panelNotes;
    const notesChanged = !sameText(nextNotes, previousNotes);
    const metadataChanged =
      !sameText(nextAccount, expandedTask.assigned_tasks.account) ||
      !sameText(nextProject, expandedTask.assigned_tasks.project) ||
      !sameText(nextTaskName, expandedTask.assigned_tasks.task_name) ||
      !sameText(nextDueDate, expandedTask.assigned_tasks.due_date) ||
      !sameText(nextDetail, expandedTask.assigned_tasks.task_detail) ||
      !sameText(nextTaskNotes, expandedTask.assigned_tasks.task_notes);

    if (expandedTask.is_collaborative || (!statusChanged && !metadataChanged && !notesChanged)) {
      closeTask();
      return;
    }

    setPanelSaving(true);
    setPanelMsg(null);

    try {
      const body: Record<string, unknown> = {};
      if (statusChanged) body.status = nextStatus;
      if (notesChanged) body.notes = nextNotes;
      if (metadataChanged) {
        body.account = nextAccount || null;
        body.project = nextProject || null;
        body.task_name = nextTaskName;
        body.due_date = nextDueDate || null;
        body.task_detail = nextDetail || null;
        body.task_notes = nextTaskNotes || null;
      }

      const saveRes = await fetch(`/api/assigned-tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!saveRes.ok) throw new Error(`HTTP ${saveRes.status}`);

      await fetchTasks();
      setPanelMsg({ type: "ok", text: "Changes saved." });
      window.setTimeout(() => closeTask(), 600);
    } catch {
      setPanelMsg({ type: "err", text: "Unable to save changes right now." });
    } finally {
      setPanelSaving(false);
    }
  }, [
    closeTask,
    expandedTask,
    fetchTasks,
    panelAccount,
    panelDetail,
    panelDueDate,
    panelNotes,
    panelProject,
    panelStatus,
    panelTaskName,
    panelTaskNotes,
  ]);

  const handleAttachmentUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file || !expandedTask) return;

      setPanelUploadSaving(true);
      setPanelMsg(null);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch(`/api/assigned-tasks/${expandedTask.assigned_tasks.id}/attachments`, {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          let message = `HTTP ${res.status}`;
          try {
            const data = await res.json();
            if (data?.error) message = data.error;
          } catch {
            // ignore JSON parsing errors
          }
          throw new Error(message);
        }

        await fetchAttachments(expandedTask.assigned_tasks.id);
        setPanelMsg({ type: "ok", text: "Attachment uploaded." });
      } catch (err) {
        setPanelMsg({ type: "err", text: err instanceof Error ? err.message : "Unable to upload file right now." });
      } finally {
        setPanelUploadSaving(false);
      }
    },
    [fetchAttachments, expandedTask]
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="rounded-2xl border border-sand bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-parchment px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-lg font-bold text-espresso">Tasks</h1>
            <p className="text-xs text-stone">Assigned work and collaborative tasks visible to you.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openCreate}
              className="cursor-pointer rounded-lg border border-terracotta bg-terracotta px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#a85840]"
            >
              + Create Task
            </button>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as AssignedTaskStatus | "all")}
              className="rounded-lg border border-sand bg-white px-3 py-2 text-xs text-espresso outline-none focus:border-terracotta"
            >
              {STATUS_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="px-5 py-4">
          <div className="mb-3 flex items-center gap-2 text-[11px] text-stone">
            <span className="rounded-full bg-parchment px-2 py-0.5 font-semibold text-walnut">
              {filteredTasks.length}
            </span>
            <span>task{filteredTasks.length === 1 ? "" : "s"}</span>
            {statusFilter !== "all" && (
              <span className="rounded-full bg-slate-blue-soft px-2 py-0.5 font-semibold text-slate-blue">
                filtered by {STATUS_LABELS[statusFilter]}
              </span>
            )}
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
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
              No assigned tasks found.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTasks.map((task) => {
                const detail = task.assigned_tasks;
                const due = formatDueDate(detail.due_date);
                const isExpanded = expandedTaskId === task.id;
                const dueTextClass = due.isOverdue ? "text-terracotta" : "text-walnut";
                const canPlay = ["pending", "on_queue", "revision_needed"].includes(task.status);
                const canSubmit =
                  !task.is_collaborative &&
                  !["submitted", "approved", "completed", "paid", "cancelled"].includes(task.status);

                return (
                  <article key={task.id} className="overflow-hidden rounded-xl border border-sand bg-white shadow-sm">
                    <button
                      type="button"
                      onClick={() => void toggleTask(task)}
                      className="flex w-full items-start justify-between gap-4 px-4 py-4 text-left transition-colors hover:bg-parchment/30"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-semibold text-walnut">{detail.task_name}</span>
                          {task.is_collaborative && (
                            <span className="rounded-full bg-slate-blue-soft px-2 py-0.5 text-[10px] font-semibold text-slate-blue">
                              Collaborative
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-stone">
                          <span className="truncate">{detail.account || "—"}</span>
                          <span className={dueTextClass}>{due.isOverdue ? "Overdue · " : ""}{due.label}</span>
                        </div>
                      </div>

                      <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
                        {canPlay && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleQuickStatusChange(task, "in_progress");
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-sand bg-white text-walnut transition-colors hover:bg-parchment"
                            aria-label={`Mark ${detail.task_name} in progress`}
                          >
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </button>
                        )}
                        {canSubmit && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleQuickStatusChange(task, "submitted");
                            }}
                            className="rounded-lg bg-sage px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-sage/90"
                          >
                            Submit
                          </button>
                        )}
                        <StatusBadge status={task.status} />
                        <svg
                          className={`h-4 w-4 shrink-0 text-stone transition-transform ${isExpanded ? "rotate-90" : ""}`}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden="true"
                        >
                          <path d="M9 18l6-6-6-6" />
                        </svg>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-sand px-4 py-4">
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Account</label>
                            {panelCanEditFields ? (
                              <select
                                value={panelAccount}
                                onChange={(e) => {
                                  const nextAccount = e.target.value;
                                  setPanelAccount(nextAccount);
                                  setPanelProject("");
                                  setPanelTaskName("");
                                }}
                                className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                              >
                                <option value="">Select account...</option>
                                {accountOptions.map((account) => (
                                  <option key={account} value={account}>
                                    {account}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <div className="rounded-lg border border-sand bg-parchment/40 px-3 py-2 text-[13px] text-espresso">
                                {expandedTask?.assigned_tasks.account || <span className="text-stone/60">—</span>}
                              </div>
                            )}
                          </div>

                          <div>
                            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Objective</label>
                            {panelCanEditFields ? (
                              <select
                                value={panelProject}
                                onChange={(e) => {
                                  setPanelProject(e.target.value);
                                  setPanelTaskName("");
                                }}
                                disabled={!panelAccount}
                                className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta disabled:bg-parchment disabled:opacity-60"
                              >
                                <option value="">{panelAccount ? "Select objective..." : "Select account first..."}</option>
                                {panelProjectsForAccount.map((project) => (
                                  <option key={project.id} value={project.project_name}>
                                    {project.project_name}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <div className="rounded-lg border border-sand bg-parchment/40 px-3 py-2 text-[13px] text-espresso">
                                {expandedTask?.assigned_tasks.project || <span className="text-stone/60">—</span>}
                              </div>
                            )}
                          </div>

                          <div>
                            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Task Name</label>
                            {panelCanEditFields ? (
                              panelTasksForProject.length > 0 ? (
                                <select
                                  value={panelTaskName}
                                  onChange={(e) => setPanelTaskName(e.target.value)}
                                  disabled={!panelProject}
                                  className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta disabled:bg-parchment disabled:opacity-60"
                                >
                                  <option value="">{panelProject ? "Select task..." : "Select objective first..."}</option>
                                  {panelTasksForProject.map((taskOption) => (
                                    <option key={taskOption.id} value={taskOption.task_name}>
                                      {taskOption.task_name}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  type="text"
                                  value={panelTaskName}
                                  onChange={(e) => setPanelTaskName(e.target.value)}
                                  placeholder="Task name"
                                  className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                                />
                              )
                            ) : (
                              <div className="rounded-lg border border-sand bg-parchment/40 px-3 py-2 text-[13px] font-medium text-espresso">
                                {expandedTask?.assigned_tasks.task_name}
                              </div>
                            )}
                          </div>

                          <div>
                            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Due Date</label>
                            {panelCanEditFields ? (
                              <input
                                type="date"
                                value={formatDateInputValue(panelDueDate)}
                                onChange={(e) => setPanelDueDate(e.target.value)}
                                className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                              />
                            ) : (
                              <div
                                className={`rounded-lg border border-sand bg-parchment/40 px-3 py-2 text-[13px] ${
                                  due.isOverdue ? "text-terracotta" : "text-espresso"
                                }`}
                              >
                                {due.label}
                                {due.isOverdue && detail.due_date ? " · Overdue" : ""}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="mt-4 grid gap-4 lg:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Detail</label>
                            {panelCanEditFields ? (
                              <textarea
                                value={panelDetail}
                                onChange={(e) => setPanelDetail(e.target.value)}
                                rows={4}
                                placeholder="Add task detail..."
                                className="w-full resize-none rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                              />
                            ) : (
                              <div className="min-h-[44px] whitespace-pre-wrap rounded-lg border border-sand bg-parchment/40 px-3 py-2 text-[13px] text-espresso">
                                {detail.task_detail || <span className="text-stone/60">No detail provided.</span>}
                              </div>
                            )}
                          </div>

                          <div>
                            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Task Notes</label>
                            {panelCanEditFields ? (
                              <textarea
                                value={panelTaskNotes}
                                onChange={(e) => setPanelTaskNotes(e.target.value)}
                                rows={4}
                                placeholder="Add task notes..."
                                className="w-full resize-none rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                              />
                            ) : (
                              <div className="min-h-[80px] whitespace-pre-wrap rounded-lg border border-sand bg-parchment/40 px-3 py-2 text-[13px] text-espresso">
                                {detail.task_notes || <span className="text-stone/60">No notes provided.</span>}
                              </div>
                            )}
                          </div>
                        </div>

                        {!task.is_collaborative && (
                          <div className="mt-4">
                            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">My Notes</label>
                            <textarea
                              value={panelNotes}
                              onChange={(e) => setPanelNotes(e.target.value)}
                              rows={4}
                              placeholder="Add your private notes for this task..."
                              className="w-full resize-none rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                            />
                          </div>
                        )}

                        <div className="mt-4 grid gap-4 lg:grid-cols-2">
                          <div>
                            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-stone">Status</label>
                            {task.is_collaborative ? (
                              <div className="space-y-3 rounded-xl border border-slate-blue/20 bg-slate-blue-soft px-3 py-3 text-sm text-slate-blue">
                                <StatusBadge status={task.status} />
                                <p>Collaborative task — status is read only here.</p>
                              </div>
                            ) : (
                              <div className="space-y-3">
                                <StatusBadge status={task.status} />
                                <select
                                  value={panelStatus}
                                  onChange={(e) => setPanelStatus(e.target.value as AssignedTaskStatus)}
                                  className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                                >
                                  {STATUS_FILTERS.filter(
                                    (option): option is { value: AssignedTaskStatus; label: string } => option.value !== "all"
                                  ).map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>

                          <div>
                            <div className="mb-2 flex items-center justify-between gap-3">
                              <label className="block text-[11px] font-semibold uppercase tracking-wide text-stone">Attachments</label>
                              <button
                                type="button"
                                onClick={() => panelAttachmentInputRef.current?.click()}
                                disabled={panelUploadSaving}
                                className="cursor-pointer rounded-lg border border-sand bg-white px-3 py-1.5 text-[11px] font-semibold text-espresso transition-colors hover:bg-parchment disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {panelUploadSaving ? "Uploading..." : "Attach File"}
                              </button>
                            </div>
                            <input
                              ref={panelAttachmentInputRef}
                              type="file"
                              className="hidden"
                              onChange={(e) => void handleAttachmentUpload(e)}
                            />
                            {attachmentsLoading ? (
                              <div className="flex items-center gap-2 py-3 text-[12px] text-stone">
                                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                </svg>
                                Loading attachments...
                              </div>
                            ) : attachments.length === 0 ? (
                              <p className="py-2 text-[12px] text-stone/50">No attachments.</p>
                            ) : (
                              <div className="space-y-1.5">
                                {attachments.map((att) => (
                                  <div key={att.id} className="flex items-start gap-2 rounded-lg border border-sand bg-parchment/40 px-3 py-2">
                                    <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-stone" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                      <polyline points="14 2 14 8 20 8" />
                                    </svg>
                                    <div className="min-w-0 flex-1">
                                      {att.url ? (
                                        <a
                                          href={att.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="block truncate text-[12px] text-terracotta hover:underline"
                                          title={att.filename}
                                        >
                                          {att.filename}
                                        </a>
                                      ) : (
                                        <span className="block truncate text-[12px] text-walnut" title={att.filename}>
                                          {att.filename}
                                        </span>
                                      )}
                                      <div className="mt-0.5 text-[10px] text-stone">
                                        {formatFileSize(att.file_size)}
                                        {att.mime_type ? ` · ${att.mime_type}` : ""}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        {panelMsg?.type === "err" && <p className="mt-4 text-xs font-medium text-red-500">{panelMsg.text}</p>}
                        {panelMsg?.type === "ok" && <p className="mt-4 text-xs font-medium text-sage">{panelMsg.text}</p>}

                        <div className="mt-4 flex items-center justify-end gap-3 border-t border-sand pt-4">
                          <button type="button" onClick={closeTask} className="text-xs text-stone hover:text-espresso">
                            Cancel
                          </button>
                          {!task.is_collaborative && (
                            <button
                              type="button"
                              onClick={() => void handleSaveTask()}
                              disabled={panelSaving}
                              className="rounded-lg bg-terracotta px-5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#a85840] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {panelSaving ? "Saving..." : "Save Changes"}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>

      {isCreating && (
        <div className="fixed inset-0 z-40 flex items-stretch">
          <div className="flex-1 bg-black/20" onClick={closeCreate} />

          <div className="flex w-[520px] max-w-full flex-col overflow-hidden border-l border-sand bg-white shadow-2xl">
            <div className="shrink-0 flex items-center justify-between border-b border-sand px-5 py-4">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeCreate}
                  className="flex h-7 w-7 items-center justify-center rounded text-stone transition-colors hover:bg-sand/50 hover:text-espresso"
                  aria-label="Close create task panel"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <span className="text-[13px] font-semibold text-walnut">New Task</span>
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Account</label>
                <select
                  value={addForm.account}
                  onChange={(e) =>
                    setAddForm((form) => ({
                      ...form,
                      account: e.target.value,
                      project: "",
                      task_name: "",
                    }))
                  }
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
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Objective</label>
                <select
                  value={addForm.project}
                  onChange={(e) =>
                    setAddForm((form) => ({
                      ...form,
                      project: e.target.value,
                      task_name: "",
                    }))
                  }
                  disabled={!addForm.account}
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta disabled:bg-parchment disabled:opacity-60"
                >
                  <option value="">{addForm.account ? "Select objective..." : "Select account first..."}</option>
                  {addProjectsForAccount.map((project) => (
                    <option key={project.id} value={project.project_name}>
                      {project.project_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Task Name</label>
                {addTasksForProject.length > 0 ? (
                  <select
                    value={addForm.task_name}
                    onChange={(e) => setAddForm((form) => ({ ...form, task_name: e.target.value }))}
                    disabled={!addForm.project}
                    className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta disabled:bg-parchment disabled:opacity-60"
                  >
                    <option value="">{addForm.project ? "Select task..." : "Select objective first..."}</option>
                    {addTasksForProject.map((task) => (
                      <option key={task.id} value={task.task_name}>
                        {task.task_name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={addForm.task_name}
                    onChange={(e) => setAddForm((form) => ({ ...form, task_name: e.target.value }))}
                    placeholder="Task name"
                    className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                  />
                )}
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Due Date</label>
                <input
                  type="date"
                  value={addForm.due_date}
                  onChange={(e) => setAddForm((form) => ({ ...form, due_date: e.target.value }))}
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Detail</label>
                <input
                  type="text"
                  value={addForm.task_detail}
                  onChange={(e) => setAddForm((form) => ({ ...form, task_detail: e.target.value }))}
                  placeholder="Short summary or reference..."
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Notes</label>
                <textarea
                  value={addForm.task_notes}
                  onChange={(e) => setAddForm((form) => ({ ...form, task_notes: e.target.value }))}
                  rows={5}
                  placeholder="Add any helpful notes for this task..."
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta resize-none"
                />
              </div>

              {addError && <p className="text-xs font-medium text-red-500">{addError}</p>}
            </div>

            <div className="shrink-0 flex items-center justify-end gap-3 border-t border-sand px-5 py-4">
              <button type="button" onClick={closeCreate} className="text-xs text-stone hover:text-espresso">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleAddTask()}
                disabled={addSaving || !addForm.task_name.trim()}
                className="rounded-lg bg-terracotta px-5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#a85840] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {addSaving ? "Saving..." : "Create Task"}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
