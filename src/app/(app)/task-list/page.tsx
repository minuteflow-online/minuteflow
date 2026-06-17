"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactElement } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AssignedTaskStatus, TaskScreenshot } from "@/types/database";
import AvailableTasksWidget from "@/components/AvailableTasksWidget";
import ScreenshotLightbox from "@/components/ScreenshotLightbox";

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
    assigned_by: string | null;
    assigned_by_profile?: { id: string; full_name: string; username: string } | null;
    instructions: string | null;
    instructions_locked: boolean;
    fixed_pay_task_id: number | null;
    fixed_pay_tasks?: { rate: number } | null;
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

type ProfileOption = {
  id: string;
  full_name: string;
  username: string;
};

type InlineEditField = "task_name" | "account" | "project" | "status" | "due_date";

type InlineEditState = {
  taskId: number;
  field: InlineEditField;
  value: string;
};

const STATUS_FILTERS: Array<{ value: AssignedTaskStatus | "all"; label: string }> = [
  { value: "all", label: "All Statuses" },
  { value: "unassigned", label: "Unassigned" },
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
  unassigned: -2,
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
  unassigned: "Unassigned",
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
  unassigned: "bg-stone/10 text-stone",
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

function renderTextWithLinks(text: string) {
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

  return parts.length > 0 ? parts : [<span key="empty">{text}</span>];
}

export default function TaskListPage() {
  const supabase = useMemo(() => createClient(), []);

  const [tasks, setTasks] = useState<VATaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<AssignedTaskStatus | "all">("all");

  const [formAccounts, setFormAccounts] = useState<string[]>([]);
  const [formProjects, setFormProjects] = useState<FormObjective[]>([]);
  const [formTasksByProject, setFormTasksByProject] = useState<Record<number, FormTask[]>>({});
  const [currentRole, setCurrentRole] = useState<string | null>(null);
  const [currentPosition, setCurrentPosition] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<ProfileOption | null>(null);
  const [assignedByProfiles, setAssignedByProfiles] = useState<ProfileOption[]>([]);
  const [canSeeAvailableTasks, setCanSeeAvailableTasks] = useState(false);
  const [activeView, setActiveView] = useState<"my_tasks" | "available_tasks">("my_tasks");
  const [inlineEdit, setInlineEdit] = useState<InlineEditState | null>(null);
  const [inlineSaving, setInlineSaving] = useState(false);

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
    assigned_by: "",
    instructions: "",
    instructions_locked: false,
  });

  const [selectedTask, setSelectedTask] = useState<VATaskRow | null>(null);
  const [panelStatus, setPanelStatus] = useState<AssignedTaskStatus>("pending");
  const [panelAccount, setPanelAccount] = useState("");
  const [panelProject, setPanelProject] = useState("");
  const [panelTaskName, setPanelTaskName] = useState("");
  const [panelDueDate, setPanelDueDate] = useState("");
  const [panelDetail, setPanelDetail] = useState("");
  const [panelTaskNotes, setPanelTaskNotes] = useState("");
  const [panelAssignedBy, setPanelAssignedBy] = useState("");
  const [panelInstructions, setPanelInstructions] = useState("");
  const [panelInstructionsLocked, setPanelInstructionsLocked] = useState(false);
  const [panelNotes, setPanelNotes] = useState("");
  const [panelSaving, setPanelSaving] = useState(false);
  const [panelUploadSaving, setPanelUploadSaving] = useState(false);
  const [panelMsg, setPanelMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [panelScreenshots, setPanelScreenshots] = useState<TaskScreenshot[]>([]);
  const [panelSignedUrls, setPanelSignedUrls] = useState<Record<number, string>>({});
  const [panelScreenshotsLoading, setPanelScreenshotsLoading] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const panelAttachmentInputRef = useRef<HTMLInputElement | null>(null);

  const fetchTasks = useCallback(async (): Promise<VATaskRow[]> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/assigned-tasks?selfOnly=true", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const raw = Array.isArray(json) ? json : json.tasks ?? [];
      const normalized = raw.map((row: VATaskRow) => ({
        ...row,
        is_collaborative: Boolean(row.is_collaborative),
        collaborator_name: row.collaborator_name ?? null,
      }));
      const sorted = sortTasks(normalized);
      setTasks(sorted);
      return sorted;
    } catch {
      setError("Unable to load assigned tasks right now.");
      return [];
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

      setCurrentUserId(data.user.id);

      const { data: profile } = await supabase
        .from("profiles")
        .select("id, role, position, can_see_available_tasks, full_name, username")
        .eq("id", data.user.id)
        .single();

      setCurrentRole(profile?.role ?? null);
      setCurrentPosition(profile?.position ?? null);
      setCurrentUserProfile(
        profile?.id
          ? { id: profile.id, full_name: profile.full_name ?? "", username: profile.username ?? "" }
          : null
      );
      setCanSeeAvailableTasks(Boolean(profile?.can_see_available_tasks));
    } catch {
      // leave the task list usable for all users if profile lookup fails
    }
  }, [supabase]);

  const isPerTaskVa = currentPosition === "Per Task VA";
  const canShowAvailableTasks = isPerTaskVa || canSeeAvailableTasks;

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

  const fetchPanelScreenshots = useCallback(async (taskId: number) => {
    setPanelScreenshotsLoading(true);
    setPanelScreenshots([]);
    setPanelSignedUrls({});
    try {
      const { data: assigneeRows } = await supabase
        .from("assigned_task_assignees")
        .select("log_id")
        .eq("assigned_task_id", taskId);

      const logIds = Array.from(
        new Set(
          (assigneeRows ?? [])
            .map((row) => row.log_id)
            .filter((logId): logId is number => typeof logId === "number")
        )
      );

      if (logIds.length === 0) return;

      const { data: screenshotRows } = await supabase
        .from("task_screenshots")
        .select("*")
        .in("log_id", logIds);

      const screenshots = (screenshotRows ?? []) as TaskScreenshot[];
      setPanelScreenshots(screenshots);

      const signedUrls: Record<number, string> = {};
      const missing = screenshots.filter((ss) => !ss.drive_file_id);

      screenshots.forEach((ss) => {
        if (ss.drive_file_id) {
          signedUrls[ss.id] = `/api/drive-image?id=${ss.drive_file_id}`;
        }
      });

      await Promise.all(
        missing.map(async (ss) => {
          const { data } = await supabase.storage.from("screenshots").createSignedUrl(ss.storage_path, 3600);
          if (data?.signedUrl) signedUrls[ss.id] = data.signedUrl;
        })
      );

      setPanelSignedUrls(signedUrls);
    } catch {
      setPanelScreenshots([]);
      setPanelSignedUrls({});
    } finally {
      setPanelScreenshotsLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void fetchCurrentUser();
    void fetchFormOptions();
    void fetchTasks();
  }, [fetchCurrentUser, fetchFormOptions, fetchTasks]);

  useEffect(() => {
    if (currentRole !== "admin") {
      setAssignedByProfiles(currentUserProfile ? [currentUserProfile] : []);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/team-members", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const members: ProfileOption[] = (json.members ?? []).map((member: ProfileOption) => ({
          id: member.id,
          full_name: member.full_name ?? "",
          username: member.username ?? "",
        }));
        if (!cancelled) setAssignedByProfiles(members);
      } catch {
        if (!cancelled) setAssignedByProfiles(currentUserProfile ? [currentUserProfile] : []);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentRole, currentUserProfile]);

  useEffect(() => {
    if (!canShowAvailableTasks) {
      setActiveView("my_tasks");
    }
  }, [canShowAvailableTasks]);

  const accountOptions = useMemo(() => {
    if (formAccounts.length > 0) return formAccounts;
    return Array.from(
      new Set(tasks.map((task) => task.assigned_tasks.account).filter((v): v is string => Boolean(v)))
    ).sort();
  }, [formAccounts, tasks]);

  const taskNameOptions = useMemo(() => {
    const options = new Set<string>();
    for (const taskList of Object.values(formTasksByProject)) {
      for (const task of taskList) {
        if (task.task_name) options.add(task.task_name);
      }
    }
    for (const task of tasks) {
      if (task.assigned_tasks.task_name) options.add(task.assigned_tasks.task_name);
    }
    return Array.from(options).sort();
  }, [formTasksByProject, tasks]);

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

  const panelCanEditFields = Boolean(selectedTask && !selectedTask.is_collaborative);
  const panelCanEditAssignedBy = Boolean(selectedTask && !selectedTask.is_collaborative);
  const panelCanEditInstructions = Boolean(selectedTask && !selectedTask.is_collaborative);

  const panelProjectsForAccount = useMemo(
    () => formProjects.filter((project) => project.account === panelAccount),
    [formProjects, panelAccount]
  );
  const panelProjectId = useMemo(
    () =>
      formProjects.find(
        (project) => project.account === panelAccount && project.project_name === panelProject
      )?.id ?? null,
    [formProjects, panelAccount, panelProject]
  );
  const panelTasksForProject = useMemo(
    () => (panelProjectId ? formTasksByProject[panelProjectId] ?? [] : []),
    [panelProjectId, formTasksByProject]
  );
  const panelAssignedByOptions = useMemo(() => {
    if (assignedByProfiles.length > 0) return assignedByProfiles;
    return currentUserProfile ? [currentUserProfile] : [];
  }, [assignedByProfiles, currentUserProfile]);

  const filteredTasks = useMemo(
    () => (statusFilter === "all" ? tasks : tasks.filter((task) => task.status === statusFilter)),
    [tasks, statusFilter]
  );

  const startInlineEdit = useCallback(
    (e: React.MouseEvent, taskId: number, field: InlineEditField, value: string) => {
      e.stopPropagation();
      if (inlineSaving) return;
      setInlineEdit({ taskId, field, value });
    },
    [inlineSaving]
  );

  const commitInlineEdit = useCallback(
    async (nextValue?: string) => {
      if (!inlineEdit || inlineSaving) return;

      const task = tasks.find((item) => item.id === inlineEdit.taskId);
      if (!task) {
        setInlineEdit(null);
        return;
      }

      const value = nextValue ?? inlineEdit.value;
      const currentValue = (() => {
        switch (inlineEdit.field) {
          case "task_name":
            return task.assigned_tasks.task_name;
          case "account":
            return task.assigned_tasks.account ?? "";
          case "project":
            return task.assigned_tasks.project ?? "";
          case "status":
            return task.status;
          case "due_date":
            return formatDateInputValue(task.assigned_tasks.due_date);
          default:
            return "";
        }
      })();

      if (value === currentValue) {
        setInlineEdit(null);
        return;
      }

      if (inlineEdit.field === "task_name" && !value.trim()) {
        setInlineEdit(null);
        return;
      }

      setInlineSaving(true);
      try {
        const payloadValue = inlineEdit.field === "due_date" && value === "" ? null : value || null;
        const body: Record<string, unknown> = { [inlineEdit.field]: payloadValue };
        if (inlineEdit.field === "status" && currentRole === "admin" && currentUserId) {
          body.va_id = currentUserId;
        }
        const res = await fetch(`/api/assigned-tasks/${task.assigned_tasks.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await fetchTasks();
      } catch (error) {
        console.error("Failed to save inline task edit", error);
      } finally {
        setInlineSaving(false);
        setInlineEdit(null);
      }
    },
    [fetchTasks, inlineEdit, inlineSaving, tasks]
  );

  const cancelInlineEdit = useCallback(() => {
    setInlineEdit(null);
  }, []);

  function InlineCell({
    task,
    field,
    display,
    className,
  }: {
    task: VATaskRow;
    field: InlineEditField;
    display: React.ReactNode;
    className?: string;
  }) {
    const isEditing = inlineEdit?.taskId === task.id && inlineEdit?.field === field;

    if (isEditing) {
      return (
        <td className={className ?? "px-3 py-3 text-[13px]"} onClick={(e) => e.stopPropagation()}>
          {field === "task_name" ? (
            <select
              autoFocus
              disabled={inlineSaving}
              value={inlineEdit.value}
              onChange={(e) => void commitInlineEdit(e.target.value)}
              onBlur={() => cancelInlineEdit()}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelInlineEdit();
              }}
              className="w-full rounded-lg border border-terracotta bg-white px-2 py-1 text-[13px] outline-none"
            >
              <option value="">Select task...</option>
              {taskNameOptions.map((taskName) => (
                <option key={taskName} value={taskName}>
                  {taskName}
                </option>
              ))}
            </select>
          ) : field === "account" ? (
            <select
              autoFocus
              disabled={inlineSaving}
              value={inlineEdit.value}
              onChange={(e) => void commitInlineEdit(e.target.value)}
              onBlur={() => cancelInlineEdit()}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelInlineEdit();
              }}
              className="w-full rounded-lg border border-terracotta bg-white px-2 py-1 text-[13px] outline-none"
            >
              <option value="">Select account...</option>
              {accountOptions.map((account) => (
                <option key={account} value={account}>
                  {account}
                </option>
              ))}
            </select>
          ) : field === "project" ? (
            <select
              autoFocus
              disabled={inlineSaving}
              value={inlineEdit.value}
              onChange={(e) => void commitInlineEdit(e.target.value)}
              onBlur={() => cancelInlineEdit()}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelInlineEdit();
              }}
              className="w-full rounded-lg border border-terracotta bg-white px-2 py-1 text-[13px] outline-none"
            >
              <option value="">Select objective...</option>
              {formProjects
                .filter((project) => project.account === task.assigned_tasks.account)
                .map((project) => project.project_name)
                .filter((value, index, arr) => arr.indexOf(value) === index)
                .map((projectName) => (
                  <option key={projectName} value={projectName}>
                    {projectName}
                  </option>
                ))}
              {task.assigned_tasks.project &&
                !formProjects.some(
                  (project) =>
                    project.account === task.assigned_tasks.account &&
                    project.project_name === task.assigned_tasks.project
                ) && (
                  <option value={task.assigned_tasks.project}>{task.assigned_tasks.project}</option>
                )}
            </select>
          ) : field === "status" ? (
            <select
              autoFocus
              disabled={inlineSaving}
              value={inlineEdit.value}
              onChange={(e) => void commitInlineEdit(e.target.value)}
              onBlur={() => cancelInlineEdit()}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelInlineEdit();
              }}
              className="w-full rounded-lg border border-terracotta bg-white px-2 py-1 text-[13px] outline-none"
            >
              {STATUS_FILTERS.filter((option) => option.value !== "all").map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              autoFocus
              disabled={inlineSaving}
              type="date"
              value={inlineEdit.value}
              onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
              onBlur={() => void commitInlineEdit()}
              onKeyDown={(e) => {
                if (e.key === "Enter") void commitInlineEdit();
                if (e.key === "Escape") cancelInlineEdit();
              }}
              className="w-full rounded-lg border border-terracotta bg-white px-2 py-1 text-[13px] outline-none"
            />
          )}
        </td>
      );
    }

    return (
      <td
        className={`${className ?? "px-3 py-3 text-[13px]"} cursor-pointer`}
        onClick={(e) => startInlineEdit(e, task.id, field, (() => {
          switch (field) {
            case "task_name":
              return task.assigned_tasks.task_name;
            case "account":
              return task.assigned_tasks.account ?? "";
            case "project":
              return task.assigned_tasks.project ?? "";
            case "status":
              return task.status;
            case "due_date":
              return formatDateInputValue(task.assigned_tasks.due_date);
          }
        })())}
      >
        {display || <span className="text-stone/40">—</span>}
      </td>
    );
  }

  const openCreate = useCallback(() => {
    setSelectedTask(null);
    setPanelStatus("pending");
    setPanelAccount("");
    setPanelProject("");
    setPanelTaskName("");
    setPanelDueDate("");
    setPanelDetail("");
    setPanelTaskNotes("");
    setPanelAssignedBy("");
    setPanelInstructions("");
    setPanelInstructionsLocked(false);
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
      assigned_by: currentUserId ?? "",
      instructions: "",
      instructions_locked: false,
    });
  }, [currentUserId]);

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
      assigned_by: currentUserId ?? "",
      instructions: "",
      instructions_locked: false,
    });
  }, [currentUserId]);

  const openPanel = useCallback(
    async (task: VATaskRow) => {
      closeCreate();
      setSelectedTask(task);
      setPanelStatus(task.status);
      setPanelAccount(task.assigned_tasks.account ?? "");
      setPanelProject(task.assigned_tasks.project ?? "");
      setPanelTaskName(task.assigned_tasks.task_name ?? "");
      setPanelDueDate(task.assigned_tasks.due_date ?? "");
      setPanelDetail(task.assigned_tasks.task_detail ?? "");
      setPanelTaskNotes(task.assigned_tasks.task_notes ?? "");
      setPanelAssignedBy(task.assigned_tasks.assigned_by ?? "");
      setPanelInstructions(task.assigned_tasks.instructions ?? "");
      setPanelInstructionsLocked(Boolean(task.assigned_tasks.instructions_locked));
      setPanelNotes(task.notes ?? "");
      setPanelUploadSaving(false);
      setPanelMsg(null);
      setAttachments([]);
      setPanelScreenshots([]);
      setPanelSignedUrls({});
      setAttachmentsLoading(true);
      setPanelScreenshotsLoading(true);
      await fetchAttachments(task.assigned_tasks.id);
      await fetchPanelScreenshots(task.assigned_tasks.id);
    },
    [closeCreate, fetchAttachments, fetchPanelScreenshots]
  );

  const closePanel = useCallback(() => {
    setSelectedTask(null);
    setPanelStatus("pending");
    setPanelAccount("");
    setPanelProject("");
    setPanelTaskName("");
    setPanelDueDate("");
    setPanelDetail("");
    setPanelTaskNotes("");
    setPanelAssignedBy("");
    setPanelInstructions("");
    setPanelInstructionsLocked(false);
    setPanelNotes("");
    setPanelSaving(false);
    setPanelUploadSaving(false);
    setPanelMsg(null);
    setAttachments([]);
    setAttachmentsLoading(false);
    setPanelScreenshots([]);
    setPanelSignedUrls({});
    setPanelScreenshotsLoading(false);
    setLightboxUrl(null);
  }, []);

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
          assigned_by: addForm.assigned_by || currentUserId || null,
          instructions: addForm.instructions.trim() || null,
          instructions_locked: addForm.instructions_locked,
          va_ids: currentUserId ? [currentUserId] : undefined,
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

      const responseData = await res.json();
      const newTaskId: number | undefined = responseData?.task?.id;
      const freshTasks = await fetchTasks();
      if (newTaskId) {
        const newTask = freshTasks.find((t) => t.assigned_tasks?.id === newTaskId);
        if (newTask) {
          openPanel(newTask);
          return;
        }
      }
      closeCreate();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Unable to add task right now.");
    } finally {
      setAddSaving(false);
    }
  }, [addForm.account, addForm.assigned_by, addForm.due_date, addForm.instructions, addForm.instructions_locked, addForm.project, addForm.task_detail, addForm.task_name, addForm.task_notes, closeCreate, currentUserId, fetchTasks, openPanel]);

  const handleClaimedTaskRefresh = useCallback(async () => {
    await fetchTasks();
    setActiveView("my_tasks");
  }, [fetchTasks]);

  const handleSavePanel = useCallback(async () => {
    if (!selectedTask) return;

    const taskId = selectedTask.assigned_tasks.id;
    const previousStatus = selectedTask.status;
    const previousNotes = selectedTask.notes ?? "";
    const nextStatus = panelStatus;
    const statusChanged = nextStatus !== previousStatus;
    const nextAccount = panelAccount.trim();
    const nextProject = panelProject.trim();
    const nextTaskName = panelTaskName.trim();
    const nextDueDate = panelDueDate.trim();
    const nextDetail = panelDetail;
    const nextTaskNotes = panelTaskNotes;
    const nextAssignedBy = panelAssignedBy;
    const nextInstructions = panelInstructions;
    const nextInstructionsLocked = panelInstructionsLocked;
    const nextNotes = panelNotes;
    const notesChanged = !sameText(nextNotes, previousNotes);
    const metadataChanged =
      !sameText(nextAccount, selectedTask.assigned_tasks.account) ||
      !sameText(nextProject, selectedTask.assigned_tasks.project) ||
      !sameText(nextTaskName, selectedTask.assigned_tasks.task_name) ||
      !sameText(nextDueDate, selectedTask.assigned_tasks.due_date) ||
      !sameText(nextDetail, selectedTask.assigned_tasks.task_detail) ||
      !sameText(nextTaskNotes, selectedTask.assigned_tasks.task_notes) ||
      !sameText(nextAssignedBy, selectedTask.assigned_tasks.assigned_by) ||
      !sameText(nextInstructions, selectedTask.assigned_tasks.instructions) ||
      nextInstructionsLocked !== Boolean(selectedTask.assigned_tasks.instructions_locked);

    if (selectedTask.is_collaborative || (!statusChanged && !metadataChanged && !notesChanged)) {
      closePanel();
      return;
    }

    setPanelSaving(true);
    setPanelMsg(null);

    try {
      const body: Record<string, unknown> = {};
      if (statusChanged) body.status = nextStatus;
      if (notesChanged) body.notes = nextNotes;
      if ((statusChanged || notesChanged) && currentRole === "admin" && currentUserId) {
        body.va_id = currentUserId;
      }
      if (metadataChanged) {
        body.account = nextAccount || null;
        body.project = nextProject || null;
        body.task_name = nextTaskName;
        body.due_date = nextDueDate || null;
        body.task_detail = nextDetail || null;
        body.task_notes = nextTaskNotes || null;
        body.assigned_by = nextAssignedBy || null;
        body.instructions = nextInstructions || null;
        body.instructions_locked = nextInstructionsLocked;
      }

      const saveRes = await fetch(`/api/assigned-tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!saveRes.ok) throw new Error(`HTTP ${saveRes.status}`);

      const updatedAt = new Date().toISOString();
      setTasks((prev) =>
        sortTasks(
          prev.map((row) => {
            if (row.id !== selectedTask.id) return row;

            return {
              ...row,
              status: statusChanged ? nextStatus : row.status,
              notes: notesChanged ? nextNotes : row.notes,
              updated_at: statusChanged || notesChanged ? updatedAt : row.updated_at,
              assigned_tasks: {
                ...row.assigned_tasks,
                account: metadataChanged ? (nextAccount || null) : row.assigned_tasks.account,
                project: metadataChanged ? (nextProject || null) : row.assigned_tasks.project,
                task_name: metadataChanged ? nextTaskName : row.assigned_tasks.task_name,
                due_date: metadataChanged ? (nextDueDate || null) : row.assigned_tasks.due_date,
                task_detail: metadataChanged ? (nextDetail || null) : row.assigned_tasks.task_detail,
                task_notes: metadataChanged ? (nextTaskNotes || null) : row.assigned_tasks.task_notes,
                assigned_by: metadataChanged ? (nextAssignedBy || null) : row.assigned_tasks.assigned_by,
                instructions: metadataChanged ? (nextInstructions || null) : row.assigned_tasks.instructions,
                instructions_locked: metadataChanged ? nextInstructionsLocked : row.assigned_tasks.instructions_locked,
                updated_at: metadataChanged ? updatedAt : row.assigned_tasks.updated_at,
              },
            };
          })
        )
      );
      setSelectedTask((current) =>
        current
          ? {
              ...current,
              status: statusChanged ? nextStatus : current.status,
              notes: notesChanged ? nextNotes : current.notes,
              updated_at: statusChanged || notesChanged ? updatedAt : current.updated_at,
              assigned_tasks: {
                ...current.assigned_tasks,
                account: metadataChanged ? (nextAccount || null) : current.assigned_tasks.account,
                project: metadataChanged ? (nextProject || null) : current.assigned_tasks.project,
                task_name: metadataChanged ? nextTaskName : current.assigned_tasks.task_name,
                due_date: metadataChanged ? (nextDueDate || null) : current.assigned_tasks.due_date,
                task_detail: metadataChanged ? (nextDetail || null) : current.assigned_tasks.task_detail,
                task_notes: metadataChanged ? (nextTaskNotes || null) : current.assigned_tasks.task_notes,
                assigned_by: metadataChanged ? (nextAssignedBy || null) : current.assigned_tasks.assigned_by,
                instructions: metadataChanged ? (nextInstructions || null) : current.assigned_tasks.instructions,
                instructions_locked: metadataChanged ? nextInstructionsLocked : current.assigned_tasks.instructions_locked,
                updated_at: metadataChanged ? updatedAt : current.assigned_tasks.updated_at,
              },
            }
          : current
      );
      setPanelMsg({ type: "ok", text: "Changes saved." });
      window.setTimeout(() => closePanel(), 800);
    } catch {
      setPanelMsg({ type: "err", text: "Unable to save changes right now." });
    } finally {
      setPanelSaving(false);
    }
  }, [
    closePanel,
    panelAccount,
    panelAssignedBy,
    panelDetail,
    panelDueDate,
    panelInstructions,
    panelInstructionsLocked,
    panelNotes,
    panelProject,
    panelStatus,
    panelTaskName,
    panelTaskNotes,
    selectedTask,
    currentRole,
    currentUserId,
  ]);

  const handleAttachmentUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      if (files.length === 0 || !selectedTask) return;

      setPanelUploadSaving(true);
      setPanelMsg(null);

      try {
        let uploadedCount = 0;
        let failureMessage: string | null = null;

        for (const file of files) {
          const formData = new FormData();
          formData.append("file", file);

          const res = await fetch(`/api/assigned-tasks/${selectedTask.assigned_tasks.id}/attachments`, {
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
            failureMessage = `${file.name}: ${message}`;
            break;
          }

          uploadedCount += 1;
        }

        await fetchAttachments(selectedTask.assigned_tasks.id);
        if (failureMessage) {
          setPanelMsg({
            type: "err",
            text:
              uploadedCount > 0
                ? `Uploaded ${uploadedCount} file${uploadedCount === 1 ? "" : "s"} before an error. ${failureMessage}`
                : failureMessage,
          });
        } else {
          setPanelMsg({
            type: "ok",
            text: uploadedCount === 1 ? "Attachment uploaded." : `${uploadedCount} attachments uploaded.`,
          });
        }
      } catch (err) {
        setPanelMsg({ type: "err", text: err instanceof Error ? err.message : "Unable to upload file right now." });
      } finally {
        setPanelUploadSaving(false);
      }
    },
    [fetchAttachments, selectedTask]
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="rounded-2xl border border-sand bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-parchment px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-lg font-bold text-espresso">Tasks</h1>
            <p className="text-xs text-stone">Assigned work and collaborative tasks visible to you.</p>
          </div>

          {canShowAvailableTasks && (
            <div className="inline-flex rounded-lg border border-sand bg-parchment/40 p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setActiveView("my_tasks")}
                className={`rounded-md px-3 py-1.5 transition-colors ${activeView === "my_tasks" ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"}`}
              >
                My Tasks
              </button>
              <button
                type="button"
                onClick={() => setActiveView("available_tasks")}
                className={`rounded-md px-3 py-1.5 transition-colors ${activeView === "available_tasks" ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"}`}
              >
                Available Tasks
              </button>
            </div>
          )}

          {(!canShowAvailableTasks || activeView === "my_tasks") && (
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
          )}
        </div>

        <div className="px-5 py-4">
          {canShowAvailableTasks && activeView === "available_tasks" ? (
            <AvailableTasksWidget onClaimed={handleClaimedTaskRefresh} />
          ) : (
            <>
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
                <div className="overflow-hidden rounded-xl border border-sand bg-white shadow-sm">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-sand bg-parchment">
                        <th className="w-8 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut" />
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">Task Name</th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">Account</th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">Objective</th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">Detail</th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">Status</th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">Due Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTasks.map((task) => {
                        const detail = task.assigned_tasks;
                        const due = formatDueDate(detail.due_date);
                        const isSelected = selectedTask?.id === task.id;
                        const dueTextClass = due.isOverdue ? "text-terracotta" : "text-walnut";

                        return (
                          <tr
                            key={task.id}
                            className={`group cursor-pointer border-b border-sand last:border-0 transition-colors hover:bg-parchment/30 ${
                              isSelected ? "bg-parchment/50" : ""
                            }`}
                            onClick={() => void openPanel(task)}
                          >
                            <td className="w-8 px-3 py-3" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={() => void openPanel(task)}
                                className="flex h-6 w-6 items-center justify-center rounded text-stone transition-colors hover:bg-sand/50 hover:text-walnut"
                                aria-label={`Open ${detail.task_name}`}
                              >
                                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M9 18l6-6-6-6" />
                                </svg>
                              </button>
                            </td>

                            <InlineCell
                              task={task}
                              field="task_name"
                              className="px-3 py-3 text-[13px]"
                              display={
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-medium text-walnut">{detail.task_name}</span>
                                  {task.is_collaborative && (
                                    <span className="rounded-full bg-slate-blue-soft px-2 py-0.5 text-[10px] font-semibold text-slate-blue">
                                      Collaborative
                                    </span>
                                  )}
                                </div>
                              }
                            />

                            <InlineCell
                              task={task}
                              field="account"
                              className="px-3 py-3 text-[13px] text-walnut"
                              display={detail.account || <span className="text-stone/60">—</span>}
                            />

                            <InlineCell
                              task={task}
                              field="project"
                              className="px-3 py-3 text-[13px] text-walnut"
                              display={detail.project || <span className="text-stone/60">—</span>}
                            />

                            <td className="max-w-[220px] px-3 py-3 text-[13px] text-walnut" onClick={(e) => e.stopPropagation()}>
                              {detail.task_detail ? (
                                <span className="block truncate text-stone/70" title={detail.task_detail}>
                                  {detail.task_detail.length > 45 ? `${detail.task_detail.slice(0, 45)}…` : detail.task_detail}
                                </span>
                              ) : (
                                <span className="text-stone/30">—</span>
                              )}
                            </td>

                            <InlineCell
                              task={task}
                              field="status"
                              className="px-3 py-3 text-[13px]"
                              display={<StatusBadge status={task.status} />}
                            />

                            <InlineCell
                              task={task}
                              field="due_date"
                              className={`px-3 py-3 text-[13px] font-medium ${dueTextClass}`}
                              display={
                                detail.due_date ? (
                                  <>
                                    {due.isOverdue ? "Overdue · " : ""}
                                    {due.label}
                                  </>
                                ) : (
                                  <span className="text-stone/30">—</span>
                                )
                              }
                            />
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
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
                <select
                  value={addForm.task_name}
                  onChange={(e) => setAddForm((form) => ({ ...form, task_name: e.target.value }))}
                  disabled={!addForm.project || addTasksForProject.length === 0}
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta disabled:bg-parchment disabled:opacity-60"
                >
                  <option value="">
                    {addForm.project
                      ? addTasksForProject.length > 0
                        ? "Select task..."
                        : "No tasks available"
                      : "Select objective first..."}
                  </option>
                  {addTasksForProject.map((task) => (
                    <option key={task.id} value={task.task_name}>
                      {task.task_name}
                    </option>
                  ))}
                </select>
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

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Assigned By</label>
                {true ? (
                  <select
                    value={addForm.assigned_by}
                    onChange={(e) => setAddForm((form) => ({ ...form, assigned_by: e.target.value }))}
                    className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                  >
                    <option value="">Select assignee...</option>
                    {panelAssignedByOptions.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.full_name || profile.username || profile.id}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="rounded-lg border border-sand bg-parchment/40 px-3 py-2 text-[13px] text-espresso">
                    {currentUserProfile?.full_name || currentUserProfile?.username || "—"}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between gap-3">
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-stone">Instructions</label>
                  <label className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-stone">
                    <input
                      type="checkbox"
                      checked={addForm.instructions_locked}
                      onChange={(e) => setAddForm((form) => ({ ...form, instructions_locked: e.target.checked }))}
                      className="h-4 w-4 rounded border-sand text-terracotta focus:ring-terracotta"
                    />
                    Locked
                  </label>
                </div>
                <textarea
                  value={addForm.instructions}
                  onChange={(e) => setAddForm((form) => ({ ...form, instructions: e.target.value }))}
                  rows={4}
                  placeholder="Add task instructions..."
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

      {selectedTask && (
        <div className="fixed inset-0 z-40 flex items-stretch">
          <div className="flex-1 bg-black/20" onClick={closePanel} />

          <div className="flex w-[520px] max-w-full flex-col overflow-hidden border-l border-sand bg-white shadow-2xl">
            <div className="shrink-0 flex items-center justify-between border-b border-sand px-5 py-4">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closePanel}
                  className="flex h-7 w-7 items-center justify-center rounded text-stone transition-colors hover:bg-sand/50 hover:text-espresso"
                  aria-label="Close task detail panel"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="19" y1="12" x2="5" y2="12" />
                    <polyline points="12 19 5 12 12 5" />
                  </svg>
                </button>
                <span className="text-[13px] font-semibold text-walnut">Task Detail</span>
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
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
                    {selectedTask.assigned_tasks.account || <span className="text-stone/60">—</span>}
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
                    {selectedTask.assigned_tasks.project || <span className="text-stone/60">—</span>}
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Task Name</label>
                <select
                  value={panelTaskName}
                  onChange={(e) => setPanelTaskName(e.target.value)}
                  disabled={!panelProject || panelTasksForProject.length === 0}
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta disabled:bg-parchment disabled:opacity-60"
                >
                  <option value="">
                    {panelProject
                      ? panelTasksForProject.length > 0
                        ? "Select task..."
                        : "No tasks available"
                      : "Select objective first..."}
                  </option>
                  {panelTasksForProject.map((task) => (
                    <option key={task.id} value={task.task_name}>
                      {task.task_name}
                    </option>
                  ))}
                </select>
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
                  (() => {
                    const due = formatDueDate(selectedTask.assigned_tasks.due_date);
                    return (
                      <div
                        className={`rounded-lg border border-sand bg-parchment/40 px-3 py-2 text-[13px] ${
                          due.isOverdue ? "text-terracotta" : "text-espresso"
                        }`}
                      >
                        {due.label}
                        {due.isOverdue && selectedTask.assigned_tasks.due_date ? " · Overdue" : ""}
                      </div>
                    );
                  })()
                )}
              </div>

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
                    {selectedTask.assigned_tasks.task_detail || <span className="text-stone/60">No detail provided.</span>}
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Task Notes</label>
                {panelCanEditFields ? (
                  <textarea
                    value={panelTaskNotes}
                    onChange={(e) => setPanelTaskNotes(e.target.value)}
                    rows={5}
                    placeholder="Add task notes..."
                    className="w-full resize-none rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                  />
                ) : (
                  <div className="min-h-[80px] whitespace-pre-wrap rounded-lg border border-sand bg-parchment/40 px-3 py-2 text-[13px] text-espresso">
                    {selectedTask.assigned_tasks.task_notes || <span className="text-stone/60">No notes provided.</span>}
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Assigned By</label>
                {panelCanEditAssignedBy ? (
                  <select
                    value={panelAssignedBy}
                    onChange={(e) => setPanelAssignedBy(e.target.value)}
                    className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                  >
                    <option value="">Select assignee...</option>
                    {panelAssignedByOptions.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.full_name || profile.username || profile.id}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="rounded-lg border border-sand bg-parchment/40 px-3 py-2 text-[13px] text-espresso">
                    {selectedTask.assigned_tasks.assigned_by || <span className="text-stone/60">—</span>}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between gap-3">
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-stone">Instructions</label>
                  {panelCanEditInstructions ? (
                    <label className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-stone">
                      <input
                        type="checkbox"
                        checked={panelInstructionsLocked}
                        onChange={(e) => setPanelInstructionsLocked(e.target.checked)}
                        className="h-4 w-4 rounded border-sand text-terracotta focus:ring-terracotta"
                      />
                      Locked
                    </label>
                  ) : null}
                </div>
                {panelCanEditInstructions && !panelInstructionsLocked ? (
                  <textarea
                    value={panelInstructions}
                    onChange={(e) => setPanelInstructions(e.target.value)}
                    rows={4}
                    placeholder="Add task instructions..."
                    className="w-full resize-none rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                  />
                ) : (
                  <div className="min-h-[80px] whitespace-pre-wrap rounded-lg border border-sand bg-parchment/40 px-3 py-2 text-[13px] text-espresso">
                    {selectedTask.assigned_tasks.instructions ? renderTextWithLinks(selectedTask.assigned_tasks.instructions) : <span className="text-stone/60">No instructions provided.</span>}
                  </div>
                )}
              </div>

              {!selectedTask.is_collaborative && (
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">My Notes</label>
                  <textarea
                    value={panelNotes}
                    onChange={(e) => setPanelNotes(e.target.value)}
                    rows={5}
                    placeholder="Add your private notes for this task..."
                    className="w-full resize-none rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                  />
                </div>
              )}

              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-stone">Assigned To</label>
                {selectedTask.is_collaborative ? (
                  <div className="space-y-3 rounded-xl border border-slate-blue/20 bg-slate-blue-soft px-3 py-3 text-sm text-slate-blue">
                    <StatusBadge status={selectedTask.status} />
                    <p>Collaborative task — status is read only here.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <StatusBadge status={selectedTask.status} />
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">
                        Update Status
                      </label>
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
                  </div>
                )}
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-stone">Screenshots</label>
                {panelScreenshotsLoading ? (
                  <div className="flex items-center gap-2 py-3 text-[12px] text-stone">
                    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    Loading screenshots...
                  </div>
                ) : panelScreenshots.length === 0 ? (
                  <p className="py-2 text-[12px] text-stone/50">No screenshots.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {panelScreenshots.map((ss) => {
                      const url = panelSignedUrls[ss.id];
                      return (
                        <button
                          key={ss.id}
                          type="button"
                          onClick={() => url && setLightboxUrl(url)}
                          className="relative group w-[48px] h-[36px] rounded border border-sand bg-parchment overflow-hidden cursor-pointer hover:border-terracotta hover:scale-105 transition-all shrink-0"
                          title={`Screenshot ${ss.screenshot_type || "manual"}`}
                        >
                          {url ? (
                            <img src={url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[8px] text-stone">...</div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-stone">Attachments</label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => panelAttachmentInputRef.current?.click()}
                      disabled={panelUploadSaving}
                      className="cursor-pointer rounded-lg border border-sand bg-white px-3 py-1.5 text-[11px] font-semibold text-espresso transition-colors hover:bg-parchment disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {panelUploadSaving ? "Uploading..." : "Attach File"}
                    </button>
                    <input
                      ref={panelAttachmentInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => void handleAttachmentUpload(e)}
                    />
                  </div>
                </div>
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

              {panelMsg?.type === "err" && <p className="text-xs font-medium text-red-500">{panelMsg.text}</p>}
              {panelMsg?.type === "ok" && <p className="text-xs font-medium text-sage">{panelMsg.text}</p>}
            </div>

            <div className="shrink-0 flex items-center justify-between border-t border-sand px-5 py-4">
              <div>
                {selectedTask.assigned_tasks.created_at && (
                  <span className="text-[11px] text-stone">
                    Created {new Date(selectedTask.assigned_tasks.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                <button type="button" onClick={closePanel} className="cursor-pointer text-xs text-stone hover:text-espresso">
                  Cancel
                </button>
                {!selectedTask.is_collaborative && (
                  <button
                    type="button"
                    onClick={() => void handleSavePanel()}
                    disabled={panelSaving}
                    className="cursor-pointer rounded-lg bg-terracotta px-5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#a85840] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {panelSaving ? "Saving..." : "Save Changes"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {lightboxUrl && (
        <ScreenshotLightbox
          url={lightboxUrl}
          onClose={() => setLightboxUrl(null)}
        />
      )}
    </div>
  );
}
