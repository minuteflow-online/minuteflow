"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactElement, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AssignedTask, AssignedTaskStatus, TaskScreenshot } from "@/types/database";
import AvailableTasksWidget from "@/components/AvailableTasksWidget";
import ProjectInfoModal from "@/components/ProjectInfoModal";
import ScreenshotLightbox from "@/components/ScreenshotLightbox";
import { useScreenCapture } from "@/hooks/useScreenCapture";
import RecurringTemplatesManager from "@/components/RecurringTemplatesManager";
import type { RecurringTaskTemplate } from "@/types/database";
import VAProjectsTab from "@/components/VAProjectsTab";

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
    project_id: string | null;
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
    projects?: { id: string; name: string } | null;
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

type HourlyPoolTask = AssignedTask;

// Admin-format response shape returned by ?asReviewer=true
type AdminAssigneeFlat = {
  id: number;
  va_id: string;
  status: AssignedTaskStatus;
  log_id: number | null;
  notes: string | null;
  assigned_at: string | null;
  updated_at: string | null;
  instructions?: string | null;
  instructions_locked?: boolean;
  profiles?: { id: string; full_name: string; username: string } | null;
};
type AdminTaskFlat = {
  id: number;
  account: string | null;
  project: string | null;
  project_id: string | null;
  task_name: string;
  task_detail: string | null;
  task_notes: string | null;
  due_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  assigned_by?: string | null;
  assigned_by_profile?: { id: string; full_name: string; username: string } | null;
  instructions?: string | null;
  instructions_locked?: boolean;
  fixed_pay_task_id?: number | null;
  fixed_pay_tasks?: { rate: number } | null;
  projects?: { id: string; name: string } | null;
  assigned_task_assignees: AdminAssigneeFlat[];
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

function parseDueDateSafe(dueDate: string): Date {
  // Append UTC noon so a date-only string (e.g. "2026-06-21") is never
  // shifted to the previous day when converted to a local timezone.
  return new Date(dueDate.slice(0, 10) + "T12:00:00Z");
}

function formatDueDate(dueDate: string | null) {
  if (!dueDate) return { label: "—", isOverdue: false };

  const date = parseDueDateSafe(dueDate);
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
  // Return the date portion directly — no UTC conversion needed.
  return dueDate.slice(0, 10);
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
  const { isActive, requestStream, captureFrame } = useScreenCapture();

  const [tasks, setTasks] = useState<VATaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [taskView, setTaskView] = useState<"active" | "archived" | "trash">("active");
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([]);
  const [filterStatuses, setFilterStatuses] = useState<AssignedTaskStatus[]>([]);
  const [filterAccounts, setFilterAccounts] = useState<string[]>([]);
  const [filterTaskNames, setFilterTaskNames] = useState<string[]>([]);
  const [filterObjectives, setFilterObjectives] = useState<string[]>([]);
  const [filterDueStart, setFilterDueStart] = useState("");
  const [filterDueEnd, setFilterDueEnd] = useState("");
  const [taskNameSearch, setTaskNameSearch] = useState("");
  const [openFilter, setOpenFilter] = useState<"taskname" | "objective" | "duedate" | "status" | "account" | null>(null);

  const [formAccounts, setFormAccounts] = useState<string[]>([]);
  const [formProjects, setFormProjects] = useState<FormObjective[]>([]);
  const [formTasksByProject, setFormTasksByProject] = useState<Record<number, FormTask[]>>({});
  const [currentRole, setCurrentRole] = useState<string | null>(null);
  const [currentPosition, setCurrentPosition] = useState<string | null>(null);
  const [currentPayRateType, setCurrentPayRateType] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<ProfileOption | null>(null);
  const [assignedByProfiles, setAssignedByProfiles] = useState<ProfileOption[]>([]);
  const [assignedByProfilesLoaded, setAssignedByProfilesLoaded] = useState(false);
  const [canSeeAvailableTasks, setCanSeeAvailableTasks] = useState(false);
  const [activeView, setActiveView] = useState<"my_tasks" | "submitted" | "available_tasks" | "hourly_pool" | "recurring" | "projects">("my_tasks");
  const [hourlyPoolTasks, setHourlyPoolTasks] = useState<HourlyPoolTask[]>([]);
  const [hourlyPoolLoading, setHourlyPoolLoading] = useState(true);
  const [hourlyPoolError, setHourlyPoolError] = useState<string | null>(null);
  const [hourlyGrabbingId, setHourlyGrabbingId] = useState<number | null>(null);
  const [hourlyExpandedIds, setHourlyExpandedIds] = useState<number[]>([]);
  const [recurringTemplates, setRecurringTemplates] = useState<RecurringTaskTemplate[]>([]);
  const [recurringLoading, setRecurringLoading] = useState(false);
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
  const [projectModalId, setProjectModalId] = useState<string | null>(null);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [panelScreenshots, setPanelScreenshots] = useState<TaskScreenshot[]>([]);
  const [panelSignedUrls, setPanelSignedUrls] = useState<Record<number, string>>({});
  const [panelScreenshotsLoading, setPanelScreenshotsLoading] = useState(false);
  const [lightboxUrls, setLightboxUrls] = useState<string[] | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [pendingCreateFiles, setPendingCreateFiles] = useState<File[]>([]);
  const [createUploadSaving, setCreateUploadSaving] = useState(false);
  const activeLogIdRef = useRef<number | null>(null);
  const panelAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const createAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const captureWorkerRef = useRef<Worker | null>(null);
  const silentCaptureRef = useRef<((logId: number, screenshotType: "start" | "progress") => Promise<boolean>) | null>(
    null
  );
  const taskViewOptions = currentRole === "va" ? (["active", "archived"] as const) : (["active", "archived", "trash"] as const);

  useEffect(() => {
    setSelectedTaskIds([]);
  }, [taskView]);

  const fetchTasks = useCallback(
    async (mode: "my_tasks" | "submitted" = activeView === "submitted" ? "submitted" : "my_tasks"):
      Promise<VATaskRow[]> => {
      setLoading(true);
      setError(null);
      try {
        const endpoint =
          mode === "submitted"
            ? "/api/assigned-tasks?asReviewer=true"
            : `/api/assigned-tasks?selfOnly=true&view=${taskView}`;
        const res = await fetch(endpoint, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const raw = Array.isArray(json) ? json : json.tasks ?? [];

        let normalized: VATaskRow[];
        if (mode === "submitted") {
          // asReviewer=true returns admin format: task rows with nested assignees.
          // Flatten each submitted assignee into a VA-format row so the task list
          // can render it with the same logic as My Tasks.
          normalized = (raw as AdminTaskFlat[]).flatMap((task) =>
            (task.assigned_task_assignees ?? []).map((assignee) => ({
              id: assignee.id,
              va_id: assignee.va_id,
              status: assignee.status,
              log_id: assignee.log_id,
              notes: assignee.notes,
              assigned_at: assignee.assigned_at,
              updated_at: assignee.updated_at,
              is_collaborative: false,
              collaborator_name: null,
              assigned_tasks: {
                id: task.id,
                account: task.account,
                project: task.project,
                project_id: task.project_id,
                task_name: task.task_name,
                task_detail: task.task_detail,
                task_notes: task.task_notes,
                due_date: task.due_date,
                assigned_by: task.assigned_by ?? null,
                assigned_by_profile: task.assigned_by_profile ?? null,
                instructions: task.instructions ?? null,
                instructions_locked: Boolean(task.instructions_locked),
                fixed_pay_task_id: task.fixed_pay_task_id ?? null,
                fixed_pay_tasks: task.fixed_pay_tasks ?? null,
                projects: task.projects ?? null,
                created_by: task.created_by,
                created_at: task.created_at,
                updated_at: task.updated_at,
              },
            }))
          );
        } else {
          normalized = raw.map((row: VATaskRow) => ({
            ...row,
            is_collaborative: Boolean(row.is_collaborative),
            collaborator_name: row.collaborator_name ?? null,
          }));
        }

        const sorted = sortTasks(normalized);
        setTasks(sorted);
        return sorted;
      } catch {
        setError("Unable to load assigned tasks right now.");
        return [];
      } finally {
        setLoading(false);
      }
    },
    [activeView, taskView]
  );

  const fetchHourlyPool = useCallback(async () => {
    setHourlyPoolLoading(true);
    setHourlyPoolError(null);
    try {
      const res = await fetch("/api/assigned-tasks?unassigned=true", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const raw = Array.isArray(json) ? json : json.tasks ?? [];
      const normalized = (raw as HourlyPoolTask[]).filter((row) => row.fixed_pay_task_id == null);
      setHourlyPoolTasks(normalized);
    } catch {
      setHourlyPoolTasks([]);
      setHourlyPoolError("Unable to load unassigned tasks right now.");
    } finally {
      setHourlyPoolLoading(false);
    }
  }, []);

  const fetchRecurringTemplates = useCallback(async () => {
    if (!currentUserId) return;
    setRecurringLoading(true);
    try {
      const res = await fetch("/api/recurring-task-templates?mine=true", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setRecurringTemplates((d.templates ?? []) as RecurringTaskTemplate[]);
    } catch {
      setRecurringTemplates([]);
    } finally {
      setRecurringLoading(false);
    }
  }, [currentUserId]);

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
        .select("id, role, position, pay_rate_type, can_see_available_tasks, full_name, username")
        .eq("id", data.user.id)
        .single();

      setCurrentRole(profile?.role ?? null);
      setCurrentPosition(profile?.position ?? null);
      setCurrentPayRateType(profile?.pay_rate_type ?? null);
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

  const isSubmittedView = activeView === "submitted";
  const isAdmin = currentRole === "admin";
  const isPerTaskVa = currentPosition === "Per Task VA";
  const canShowAvailableTasks = isPerTaskVa || canSeeAvailableTasks;
  const canShowHourlyPool = isAdmin || (currentRole === "va" && !isPerTaskVa);
  const canShowProjects = currentRole === "va" && currentPayRateType === "hourly";

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

      screenshots.forEach((ss) => {
        if (ss.drive_file_id) {
          signedUrls[ss.id] = `/api/drive-image?id=${ss.drive_file_id}`;
        }
      });

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
  }, [fetchCurrentUser, fetchFormOptions]);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    if (canShowHourlyPool) {
      void fetchHourlyPool();
    } else {
      setHourlyPoolTasks([]);
      setHourlyPoolLoading(false);
      setHourlyPoolError(null);
    }
  }, [canShowHourlyPool, fetchHourlyPool]);

  useEffect(() => {
    const id = setInterval(() => {
      void fetchTasks();
      if (canShowHourlyPool) void fetchHourlyPool();
    }, 30_000);
    return () => clearInterval(id);
  }, [fetchTasks, fetchHourlyPool, canShowHourlyPool]);

  useEffect(() => {
    if (!canShowAvailableTasks && !canShowHourlyPool) {
      setActiveView("my_tasks");
    }
  }, [canShowAvailableTasks, canShowHourlyPool]);

  useEffect(() => {
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
        if (!cancelled) { setAssignedByProfiles(members); setAssignedByProfilesLoaded(true); }
      } catch {
        if (!cancelled) { setAssignedByProfiles(currentUserProfile ? [currentUserProfile] : []); setAssignedByProfilesLoaded(true); }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUserProfile]);

  useEffect(() => {
    setFilterStatuses([]);
    setFilterAccounts([]);
    setFilterTaskNames([]);
    setFilterObjectives([]);
    setFilterDueStart("");
    setFilterDueEnd("");
    setTaskNameSearch("");
    setOpenFilter(null);
  }, [taskView]);

  useEffect(() => {
    const activeTask = tasks.find((task) => task.status === "in_progress" && typeof task.log_id === "number");
    activeLogIdRef.current = activeTask?.log_id ?? null;
  }, [tasks]);

  const appendPanelScreenshot = useCallback(
    (logId: number, screenshot: TaskScreenshot) => {
      if (selectedTask?.log_id !== logId) return;
      setPanelScreenshots((current) => [...current, screenshot]);
      if (screenshot.drive_file_id) {
        setPanelSignedUrls((current) => ({
          ...current,
          [screenshot.id]: `/api/drive-image?id=${screenshot.drive_file_id}`,
        }));
      }
    },
    [selectedTask?.log_id]
  );

  const updateCaptureRequest = useCallback(
    async (captureRequestId: number, status: "failed" | "completed", logId?: number, screenshotId?: number) => {
      await supabase
        .from("capture_requests")
        .update({
          status,
          log_id: logId ?? null,
          screenshot_id: screenshotId ?? null,
          completed_at: new Date().toISOString(),
        })
        .eq("id", captureRequestId);
    },
    [supabase]
  );

  const uploadTaskScreenshot = useCallback(
    async (blob: Blob, logId: number, screenshotType: "start" | "remote", captureRequestId?: number) => {
      if (!currentUserId) return null;

      const formData = new FormData();
      formData.append("file", blob, "screenshot.png");
      formData.append("userId", currentUserId);
      formData.append("logId", String(logId));
      formData.append("screenshotType", screenshotType);
      if (captureRequestId) {
        formData.append("captureRequestId", String(captureRequestId));
      }

      const res = await fetch("/api/upload-screenshot", { method: "POST", body: formData });
      if (!res.ok) return null;
      const json = await res.json();
      return (json.screenshot ?? null) as TaskScreenshot | null;
    },
    [currentUserId]
  );

  const silentCapture = useCallback(
    async (logId: number, screenshotType: "start" | "progress") => {
      const blob = await captureFrame();
      if (!blob) return false;

      const screenshot = await uploadTaskScreenshot(blob, logId, screenshotType === "start" ? "start" : "remote");
      if (!screenshot) return false;

      appendPanelScreenshot(logId, screenshot);
      return true;
    },
    [appendPanelScreenshot, captureFrame, uploadTaskScreenshot]
  );

  useEffect(() => {
    silentCaptureRef.current = silentCapture;
  }, [silentCapture]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const worker = new Worker("/capture-worker.js");
      worker.onmessage = (event: MessageEvent) => {
        const { type, logId, screenshotType } = event.data ?? {};
        if (type === "capture" && silentCaptureRef.current) {
          void silentCaptureRef.current(logId, screenshotType);
        }
      };
      worker.onerror = () => {
        captureWorkerRef.current = null;
      };
      captureWorkerRef.current = worker;
    } catch {
      captureWorkerRef.current = null;
    }

    return () => {
      captureWorkerRef.current?.postMessage({ type: "stop" });
      captureWorkerRef.current?.terminate();
      captureWorkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isActive) {
      captureWorkerRef.current?.postMessage({ type: "stop" });
    }
  }, [isActive]);

  const captureTaskScreenshot = useCallback(
    async (logId: number, screenshotType: "start" | "remote", captureRequestId?: number) => {
      const blob = await captureFrame();
      if (!blob) {
        if (captureRequestId) {
          await updateCaptureRequest(captureRequestId, "failed");
        }
        return false;
      }

      const screenshot = await uploadTaskScreenshot(blob, logId, screenshotType, captureRequestId);
      if (!screenshot) {
        if (captureRequestId) {
          await updateCaptureRequest(captureRequestId, "failed");
        }
        return false;
      }

      if (captureRequestId) {
        await updateCaptureRequest(captureRequestId, "completed", logId, screenshot.id);
      }

      appendPanelScreenshot(logId, screenshot);
      return true;
    },
    [appendPanelScreenshot, captureFrame, updateCaptureRequest, uploadTaskScreenshot]
  );

  useEffect(() => {
    if (!currentUserId) return;

    const channel = supabase
      .channel("task-list-capture-requests")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "capture_requests",
          filter: `target_user_id=eq.${currentUserId}`,
        },
        async (payload) => {
          const request = payload.new as { id: number; status: string };
          if (request.status !== "pending") return;

          const logId = activeLogIdRef.current;
          if (!logId) {
            await updateCaptureRequest(request.id, "failed");
            return;
          }

          await captureTaskScreenshot(logId, "remote", request.id);
        }
      )
      .subscribe();

    void (async () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: pendingCaptures } = await supabase
        .from("capture_requests")
        .select("id")
        .eq("target_user_id", currentUserId)
        .eq("status", "pending")
        .gte("created_at", fiveMinutesAgo);

      for (const req of pendingCaptures ?? []) {
        const logId = activeLogIdRef.current;
        if (!logId) {
          await updateCaptureRequest(req.id, "failed");
          continue;
        }

        await captureTaskScreenshot(logId, "remote", req.id);
      }
    })();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [captureTaskScreenshot, currentUserId, supabase, updateCaptureRequest]);

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

  const panelCanEditFields = Boolean(selectedTask) && isAdmin;
  const panelCanEditAssignedBy = Boolean(selectedTask) && isAdmin;
  const panelCanEditInstructions = Boolean(selectedTask) && isAdmin;

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

  const taskNameFilterOptions = useMemo(
    () => Array.from(new Set(tasks.map((task) => task.assigned_tasks.task_name).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [tasks]
  );
  const objectiveFilterOptions = useMemo(
    () => Array.from(new Set(tasks.map((task) => task.assigned_tasks.project ?? "").filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [tasks]
  );
  const accountFilterOptions = useMemo(
    () => Array.from(new Set(tasks.map((task) => task.assigned_tasks.account ?? "").filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [tasks]
  );

  const filteredTasks = useMemo(() => {
    const start = filterDueStart ? parseDueDateSafe(filterDueStart) : null;
    const end = filterDueEnd ? new Date(filterDueEnd.slice(0, 10) + "T23:59:59Z") : null;
    const taskNameSearchLower = taskNameSearch.trim().toLowerCase();

    return tasks.filter((task) => {
      const detail = task.assigned_tasks;
      const dueDate = detail.due_date ? parseDueDateSafe(detail.due_date) : null;
      const dueTime = dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate.getTime() : null;

      if (filterStatuses.length > 0 && !filterStatuses.includes(task.status)) return false;
      if (filterAccounts.length > 0 && !filterAccounts.includes(detail.account ?? "")) return false;
      if (filterTaskNames.length > 0 && !filterTaskNames.includes(detail.task_name)) return false;
      if (filterObjectives.length > 0 && !filterObjectives.includes(detail.project ?? "")) return false;
      if (taskNameSearchLower && !detail.task_name.toLowerCase().includes(taskNameSearchLower)) return false;
      if (start && (!dueTime || dueTime < start.getTime())) return false;
      if (end && (!dueTime || dueTime > end.getTime())) return false;
      return true;
    });
  }, [filterAccounts, filterDueEnd, filterDueStart, filterObjectives, filterStatuses, filterTaskNames, taskNameSearch, tasks]);

  const selectedTaskIdSet = useMemo(() => new Set(selectedTaskIds), [selectedTaskIds]);
  const allFilteredTasksSelected = filteredTasks.length > 0 && filteredTasks.every((task) => selectedTaskIdSet.has(task.id));

  const toggleTaskSelection = useCallback((taskId: number) => {
    setSelectedTaskIds((prev) => (prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]));
  }, []);

  const toggleAllFilteredTasks = useCallback(() => {
    setSelectedTaskIds((prev) => {
      if (filteredTasks.length === 0) return prev;
      const filteredIds = filteredTasks.map((task) => task.id);
      const filteredIdSet = new Set(filteredIds);
      const allSelected = filteredIds.every((id) => prev.includes(id));
      if (allSelected) {
        return prev.filter((id) => !filteredIdSet.has(id));
      }
      return Array.from(new Set([...prev, ...filteredIds]));
    });
  }, [filteredTasks]);

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
        if (inlineEdit.field === "status") {
          if (isSubmittedView && task.va_id) {
            body.va_id = task.va_id;
          } else if (currentUserId) {
            body.va_id = currentUserId;
          }
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
    [fetchTasks, inlineEdit, inlineSaving, tasks, currentUserId, isSubmittedView]
  );

  const cancelInlineEdit = useCallback(() => {
    setInlineEdit(null);
  }, []);

  function FilterDropdown<T extends string>({
    label,
    options,
    selected,
    onChange,
    isOpen,
    onToggle,
    searchable,
    searchValue,
    onSearchChange,
    searchPlaceholder,
  }: {
    label: string;
    options: { value: T; label: string }[];
    selected: T[];
    onChange: (v: T[]) => void;
    isOpen: boolean;
    onToggle: () => void;
    searchable?: boolean;
    searchValue?: string;
    onSearchChange?: (v: string) => void;
    searchPlaceholder?: string;
  }) {
    const visibleOptions = searchable && searchValue
      ? options.filter((opt) => opt.label.toLowerCase().includes(searchValue.toLowerCase()))
      : options;

    return (
      <div className="relative">
        <button
          type="button"
          onClick={onToggle}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] outline-none transition-all ${
            selected.length > 0
              ? "border-terracotta text-terracotta"
              : "border-sand bg-white text-espresso hover:border-walnut"
          }`}
        >
          {label}
          {selected.length > 0 && (
            <span className="rounded-full bg-terracotta px-1.5 py-px text-[10px] font-bold leading-none text-white">
              {selected.length}
            </span>
          )}
          <svg className="h-3.5 w-3.5 text-stone" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {isOpen && (
          <div className="absolute left-0 top-full z-50 mt-1 min-w-[180px] rounded-xl border border-sand bg-white py-1 shadow-lg">
            {searchable && onSearchChange && (
              <div className="border-b border-sand px-3 py-2">
                <input
                  value={searchValue || ""}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder={searchPlaceholder || `Search ${label.toLowerCase()}...`}
                  className="w-full rounded-lg border border-sand px-2.5 py-1.5 text-[13px] outline-none focus:border-terracotta"
                />
              </div>
            )}
            <div className="flex items-center justify-between border-b border-sand px-3 py-1.5">
              <button type="button" onClick={() => onChange(visibleOptions.map((o) => o.value))} className="cursor-pointer text-[11px] text-terracotta hover:underline">
                Select All
              </button>
              <button type="button" onClick={() => onChange([])} className="cursor-pointer text-[11px] text-stone hover:underline">
                Clear
              </button>
            </div>
            {visibleOptions.length > 0 ? (
              visibleOptions.map((opt) => (
                <label key={opt.value} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-parchment">
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

  function DateRangeDropdown({
    label,
    start,
    end,
    isOpen,
    onToggle,
    onStartChange,
    onEndChange,
  }: {
    label: string;
    start: string;
    end: string;
    isOpen: boolean;
    onToggle: () => void;
    onStartChange: (v: string) => void;
    onEndChange: (v: string) => void;
  }) {
    const activeCount = Number(Boolean(start)) + Number(Boolean(end));

    return (
      <div className="relative">
        <button
          type="button"
          onClick={onToggle}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] outline-none transition-all ${
            activeCount > 0
              ? "border-terracotta text-terracotta"
              : "border-sand bg-white text-espresso hover:border-walnut"
          }`}
        >
          {label}
          {activeCount > 0 && (
            <span className="rounded-full bg-terracotta px-1.5 py-px text-[10px] font-bold leading-none text-white">
              {activeCount}
            </span>
          )}
          <svg className="h-3.5 w-3.5 text-stone" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {isOpen && (
          <div className="absolute left-0 top-full z-50 mt-1 min-w-[240px] rounded-xl border border-sand bg-white p-3 shadow-lg">
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">From</label>
                <input
                  type="date"
                  value={start}
                  onChange={(e) => onStartChange(e.target.value)}
                  className="w-full rounded-lg border border-sand px-2.5 py-1.5 text-[13px] outline-none focus:border-terracotta"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">To</label>
                <input
                  type="date"
                  value={end}
                  onChange={(e) => onEndChange(e.target.value)}
                  className="w-full rounded-lg border border-sand px-2.5 py-1.5 text-[13px] outline-none focus:border-terracotta"
                />
              </div>
              <div className="flex items-center justify-between border-t border-sand pt-2">
                <button type="button" onClick={() => { onStartChange(""); onEndChange(""); }} className="cursor-pointer text-[11px] text-stone hover:underline">
                  Clear
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  function InlineCell({
    task,
    field,
    display,
    className,
    disabled,
  }: {
    task: VATaskRow;
    field: InlineEditField;
    display: ReactNode;
    className?: string;
    disabled?: boolean;
  }) {
    const isEditing = inlineEdit?.taskId === task.id && inlineEdit?.field === field;

    if (disabled) {
      return <td className={className ?? "px-3 py-3 text-[13px]"}>{display || <span className="text-stone/40">—</span>}</td>;
    }

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
    setPendingCreateFiles([]);
    setCreateUploadSaving(false);
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
    setPendingCreateFiles([]);
    setCreateUploadSaving(false);
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
    setLightboxUrls(null);
    setLightboxIndex(0);
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

      // Upload any pending files before transitioning to the detail panel
      if (newTaskId && pendingCreateFiles.length > 0) {
        setCreateUploadSaving(true);
        for (const file of pendingCreateFiles) {
          const formData = new FormData();
          formData.append("file", file);
          try {
            await fetch(`/api/assigned-tasks/${newTaskId}/attachments`, {
              method: "POST",
              body: formData,
            });
          } catch {
            // best-effort — don't block task creation if an upload fails
          }
        }
        setCreateUploadSaving(false);
        setPendingCreateFiles([]);
      }

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
  }, [addForm.account, addForm.assigned_by, addForm.due_date, addForm.instructions, addForm.instructions_locked, addForm.project, addForm.task_detail, addForm.task_name, addForm.task_notes, closeCreate, currentUserId, fetchTasks, openPanel, pendingCreateFiles]);

  const handleClaimedTaskRefresh = useCallback(async () => {
    await Promise.all([fetchTasks(), canShowHourlyPool ? fetchHourlyPool() : Promise.resolve()]);
    setActiveView("my_tasks");
  }, [canShowHourlyPool, fetchHourlyPool, fetchTasks]);

  const handleHourlyGrab = useCallback(
    async (taskId: number) => {
      setHourlyGrabbingId(taskId);
      try {
        const res = await fetch(`/api/assigned-tasks/${taskId}/grab`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) {
          let message = `HTTP ${res.status}`;
          try {
            const data = await res.json();
            if (data?.error) message = data.error;
          } catch {
            // ignore parse failures
          }
          throw new Error(message);
        }
        await Promise.all([fetchTasks(), fetchHourlyPool()]);
        setActiveView("my_tasks");
      } catch (err) {
        setHourlyPoolError(err instanceof Error ? err.message : "Failed to grab task.");
      } finally {
        setHourlyGrabbingId(null);
      }
    },
    [fetchHourlyPool, fetchTasks]
  );

  const handleSavePanel = useCallback(async () => {
    if (!selectedTask) return;

    const taskId = selectedTask.assigned_tasks.id;
    const taskLogId = selectedTask.log_id;
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

    if (!statusChanged && !metadataChanged && !notesChanged) {
      closePanel();
      return;
    }

    setPanelSaving(true);
    setPanelMsg(null);

    try {
      const body: Record<string, unknown> = {};
      if (statusChanged) body.status = nextStatus;
      if (notesChanged) body.notes = nextNotes;
      if (statusChanged || notesChanged) {
        if (isSubmittedView && selectedTask?.va_id) {
          // Admin reviewing submitted work: target the specific VA's assignee row
          body.va_id = selectedTask.va_id;
        } else if (currentUserId) {
          // VA updating their own submission
          body.va_id = currentUserId;
        }
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
      if (statusChanged && nextStatus === "in_progress" && taskLogId) {
        activeLogIdRef.current = taskLogId;
        void (async () => {
          const result = await requestStream();
          if (result !== "granted") return;
          const captured = await captureTaskScreenshot(taskLogId, "start");
          if (captured) {
            captureWorkerRef.current?.postMessage({ type: "start", logId: taskLogId });
          }
        })();
      } else if (statusChanged && nextStatus !== "in_progress" && taskLogId) {
        captureWorkerRef.current?.postMessage({ type: "stop" });
      }
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
    currentUserId,
    isSubmittedView,
    requestStream,
    captureTaskScreenshot,
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

  const patchTaskVisibility = useCallback(
    async (taskId: number, payload: Record<string, string | null>) => {
      const res = await fetch(`/api/assigned-tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    []
  );

  // Map assignee row IDs (stored in selectedTaskIds) to actual assigned_tasks IDs
  const assigneeIdsToTaskIds = useCallback((assigneeIds: number[]): number[] => {
    return assigneeIds
      .map((id) => tasks.find((t) => t.id === id)?.assigned_tasks.id)
      .filter((id): id is number => id !== undefined);
  }, [tasks]);

  const handleBulkArchive = useCallback(async () => {
    const assigneeIds = [...selectedTaskIds];
    const taskIds = assigneeIdsToTaskIds(assigneeIds);
    await Promise.all(taskIds.map((id) => patchTaskVisibility(id, { archived_at: new Date().toISOString() })));
    setSelectedTaskIds([]);
    if (selectedTask && assigneeIds.includes(selectedTask.id)) closePanel();
    await fetchTasks();
  }, [assigneeIdsToTaskIds, closePanel, fetchTasks, patchTaskVisibility, selectedTask, selectedTaskIds]);

  const handleBulkTrash = useCallback(async () => {
    const assigneeIds = [...selectedTaskIds];
    const taskIds = assigneeIdsToTaskIds(assigneeIds);
    await Promise.all(taskIds.map((id) => patchTaskVisibility(id, { deleted_at: new Date().toISOString() })));
    setSelectedTaskIds([]);
    if (selectedTask && assigneeIds.includes(selectedTask.id)) closePanel();
    await fetchTasks();
  }, [assigneeIdsToTaskIds, closePanel, fetchTasks, patchTaskVisibility, selectedTask, selectedTaskIds]);

  const handleBulkRestore = useCallback(async () => {
    const assigneeIds = [...selectedTaskIds];
    const taskIds = assigneeIdsToTaskIds(assigneeIds);
    const payload: Record<string, string | null> = taskView === "archived" ? { archived_at: null } : { deleted_at: null };
    await Promise.all(taskIds.map((id) => patchTaskVisibility(id, payload)));
    setSelectedTaskIds([]);
    if (selectedTask && assigneeIds.includes(selectedTask.id)) closePanel();
    await fetchTasks();
  }, [assigneeIdsToTaskIds, closePanel, fetchTasks, patchTaskVisibility, selectedTask, selectedTaskIds, taskView]);

  const handleBulkPermanentDelete = useCallback(async () => {
    const assigneeIds = [...selectedTaskIds];
    const taskIds = assigneeIdsToTaskIds(assigneeIds);
    await Promise.all(taskIds.map((id) => fetch(`/api/assigned-tasks/${id}`, { method: "DELETE" })));
    setSelectedTaskIds([]);
    if (selectedTask && assigneeIds.includes(selectedTask.id)) closePanel();
    await fetchTasks();
  }, [assigneeIdsToTaskIds, closePanel, fetchTasks, selectedTask, selectedTaskIds]);

  // Row-level handlers receive the actual assigned_tasks.id (not assignee row id)
  const handleRestoreTask = useCallback(async (taskId: number) => {
    const payload: Record<string, string | null> = taskView === "archived" ? { archived_at: null } : { deleted_at: null };
    await patchTaskVisibility(taskId, payload);
    if (selectedTask?.assigned_tasks.id === taskId) closePanel();
    await fetchTasks();
  }, [closePanel, fetchTasks, patchTaskVisibility, selectedTask, taskView]);

  const handlePermanentDeleteTask = useCallback(async (taskId: number) => {
    await fetch(`/api/assigned-tasks/${taskId}`, { method: "DELETE" });
    if (selectedTask?.assigned_tasks.id === taskId) closePanel();
    await fetchTasks();
  }, [closePanel, fetchTasks, selectedTask]);

  return (
    <>
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="rounded-2xl border border-sand bg-white shadow-sm">
        <div className="border-b border-parchment px-5 py-3">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-lg font-bold text-espresso">Tasks</h1>
              <p className="text-xs text-stone">Assigned work and collaborative tasks visible to you.</p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <div className="inline-flex rounded-lg border border-sand bg-parchment/40 p-1 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setActiveView("my_tasks")}
                  className={`rounded-md px-3 py-1.5 transition-colors ${activeView === "my_tasks" ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"}`}
                >
                  My Tasks
                </button>
                {canShowAvailableTasks && (
                  <button
                    type="button"
                    onClick={() => setActiveView("available_tasks")}
                    className={`rounded-md px-3 py-1.5 transition-colors ${activeView === "available_tasks" ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"}`}
                  >
                    Available Tasks
                  </button>
                )}
                {canShowHourlyPool && (
                  <button
                    type="button"
                    onClick={() => { setActiveView("hourly_pool"); void fetchHourlyPool(); }}
                    className={`rounded-md px-3 py-1.5 transition-colors ${activeView === "hourly_pool" ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"}`}
                  >
                    Unassigned Tasks
                  </button>
                )}
                {!isPerTaskVa && (
                  <button
                    type="button"
                    onClick={() => { setActiveView("recurring"); void fetchRecurringTemplates(); }}
                    className={`rounded-md px-3 py-1.5 transition-colors ${activeView === "recurring" ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"}`}
                  >
                    Recurring
                  </button>
                )}
                {canShowProjects && (
                  <button
                    type="button"
                    onClick={() => setActiveView("projects")}
                    className={`rounded-md px-3 py-1.5 transition-colors ${activeView === "projects" ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"}`}
                  >
                    Projects
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {(activeView === "my_tasks" || activeView === "submitted") && (
          <div className="border-b border-parchment bg-cream/50 px-5 py-4">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveView("submitted")}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                      activeView === "submitted"
                        ? "border-sky-200 bg-sky-100 text-sky-700"
                        : "border-sand bg-parchment/40 text-stone hover:text-espresso"
                    }`}
                  >
                    Submitted
                  </button>

                  <div className="inline-flex rounded-lg border border-sand bg-parchment/40 p-1 text-xs font-semibold">
                    {taskViewOptions.map((view) => (
                      <button
                        key={view}
                        type="button"
                        onClick={() => setTaskView(view)}
                        className={`rounded-md px-3 py-1.5 capitalize transition-colors ${
                          taskView === view ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"
                        }`}
                      >
                        {view === "active" ? "Active" : view === "archived" ? "Archived" : "Trash"}
                      </button>
                    ))}
                  </div>
                </div>

                {taskView === "active" && activeView === "my_tasks" && (
                  <button
                    type="button"
                    onClick={openCreate}
                    className="cursor-pointer rounded-lg border border-terracotta bg-terracotta px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#a85840]"
                  >
                    + Create Task
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <FilterDropdown
                  label="Task Name"
                  options={taskNameFilterOptions.map((taskName) => ({ value: taskName, label: taskName }))}
                  selected={filterTaskNames}
                  onChange={setFilterTaskNames}
                  isOpen={openFilter === "taskname"}
                  onToggle={() => setOpenFilter(openFilter === "taskname" ? null : "taskname")}
                  searchable
                  searchValue={taskNameSearch}
                  onSearchChange={setTaskNameSearch}
                  searchPlaceholder="Search task names..."
                />
                <FilterDropdown
                  label="Objective"
                  options={objectiveFilterOptions.map((objective) => ({ value: objective, label: objective }))}
                  selected={filterObjectives}
                  onChange={setFilterObjectives}
                  isOpen={openFilter === "objective"}
                  onToggle={() => setOpenFilter(openFilter === "objective" ? null : "objective")}
                />
                <DateRangeDropdown
                  label="Due Date"
                  start={filterDueStart}
                  end={filterDueEnd}
                  isOpen={openFilter === "duedate"}
                  onToggle={() => setOpenFilter(openFilter === "duedate" ? null : "duedate")}
                  onStartChange={setFilterDueStart}
                  onEndChange={setFilterDueEnd}
                />
                <FilterDropdown
                  label="Status"
                  options={STATUS_FILTERS.filter((option) => option.value !== "all")}
                  selected={filterStatuses.map((status) => status)}
                  onChange={(values) => setFilterStatuses(values as AssignedTaskStatus[])}
                  isOpen={openFilter === "status"}
                  onToggle={() => setOpenFilter(openFilter === "status" ? null : "status")}
                />
                <FilterDropdown
                  label="Account"
                  options={accountFilterOptions.map((account) => ({ value: account, label: account }))}
                  selected={filterAccounts}
                  onChange={setFilterAccounts}
                  isOpen={openFilter === "account"}
                  onToggle={() => setOpenFilter(openFilter === "account" ? null : "account")}
                />

                {(filterStatuses.length > 0 || filterAccounts.length > 0 || filterTaskNames.length > 0 || filterObjectives.length > 0 || filterDueStart || filterDueEnd || taskNameSearch) && (
                  <button
                    type="button"
                    onClick={() => {
                      setFilterStatuses([]);
                      setFilterAccounts([]);
                      setFilterTaskNames([]);
                      setFilterObjectives([]);
                      setFilterDueStart("");
                      setFilterDueEnd("");
                      setTaskNameSearch("");
                    }}
                    className="cursor-pointer text-[12px] text-stone hover:text-terracotta hover:underline"
                  >
                    Clear all
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        <div className="px-5 py-4">
          {canShowAvailableTasks && activeView === "available_tasks" ? (
            <AvailableTasksWidget onClaimed={handleClaimedTaskRefresh} canSeeFixedPay={isPerTaskVa || canSeeAvailableTasks} fixedPayOnly={true} currentUserId={currentUserId ?? undefined} />
          ) : canShowHourlyPool && activeView === "hourly_pool" ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[11px] text-stone">
                <span className="rounded-full bg-parchment px-2 py-0.5 font-semibold text-walnut">{hourlyPoolTasks.length}</span>
                <span>task{hourlyPoolTasks.length === 1 ? "" : "s"}</span>
                <span className="rounded-full bg-sage-soft px-2 py-0.5 font-semibold text-sage">Unassigned Pool</span>
              </div>

              {hourlyPoolError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{hourlyPoolError}</div>
              )}

              {hourlyPoolLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-20 animate-pulse rounded-xl bg-parchment" />
                  ))}
                </div>
              ) : hourlyPoolTasks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-sand px-4 py-10 text-center text-sm text-stone">
                  No unassigned tasks found.
                </div>
              ) : (
                <div className="space-y-2">
                  {hourlyPoolTasks.map((task) => {
                    const due = formatDueDate(task.due_date);
                    const isGrabbing = hourlyGrabbingId === task.id;
                    const dueBadgeClass = due.isOverdue ? "bg-terracotta/10 text-terracotta" : "bg-sage-soft text-sage";

                    const isExpanded = hourlyExpandedIds.includes(task.id);

                    return (
                      <div key={task.id} className="rounded-lg border border-sand overflow-hidden">
                        <div className="px-2.5 py-2 bg-parchment/20">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-xs font-medium text-espresso truncate">{task.task_name}</span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold ${dueBadgeClass}`}>
                                {due.label === "—" ? "No due date" : `Due ${due.label}`}
                              </span>
                              <button
                                type="button"
                                onClick={() => setHourlyExpandedIds((current) => current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id])}
                                className="flex h-5 w-5 items-center justify-center rounded-full border border-sand bg-white text-stone transition-colors hover:bg-parchment"
                                aria-label={isExpanded ? "Collapse task details" : "Expand task details"}
                              >
                                <svg className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M6 9l6 6 6-6" />
                                </svg>
                              </button>
                            </div>
                          </div>
                          <div className="mt-0.5 truncate text-[10px] text-stone">
                            {task.account ?? ""}
                            {task.project ? ` / ${task.project}` : ""}
                          </div>
                        </div>

                        <div className="px-2.5 py-2.5 bg-parchment/10 space-y-2">
                          {isExpanded && (
                            <div className="space-y-1 rounded-lg border border-sand bg-white px-2.5 py-2 text-[11px] text-stone">
                              <div>
                                <span className="font-semibold text-espresso">Detail: </span>
                                {task.task_detail || "—"}
                              </div>
                              <div>
                                <span className="font-semibold text-espresso">Notes: </span>
                                {task.task_notes || "—"}
                              </div>
                              <div>
                                <span className="font-semibold text-espresso">Instructions: </span>
                                {task.instructions || "—"}
                              </div>
                            </div>
                          )}
                          <div className="text-[11px] text-stone">Open pool — grab this task to assign it to yourself.</div>
                          <button
                            type="button"
                            onClick={() => void handleHourlyGrab(task.id)}
                            disabled={isGrabbing}
                            className="w-full cursor-pointer rounded-lg bg-sage px-3 py-2 text-[11px] font-semibold text-white transition-colors hover:bg-sage/90 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isGrabbing ? "Grabbing..." : "Grab"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : canShowProjects && activeView === "projects" ? (
            <div className="p-4">
              <VAProjectsTab
                activeProfiles={assignedByProfiles}
                currentUserId={currentUserId ?? ""}
              />
            </div>
          ) : activeView === "recurring" ? (
            <div className="p-4">
              <RecurringTemplatesManager
                templates={recurringTemplates}
                loading={recurringLoading}
                activeProfiles={assignedByProfiles}
                profilesLoaded={assignedByProfilesLoaded}
                accountOptions={formAccounts}
                projectTagsMap={Object.fromEntries(
                  formProjects.map((p) => [
                    p.account ?? "",
                    formProjects.filter((fp) => fp.account === p.account).map((fp) => fp.project_name),
                  ])
                )}
                formObjectives={formProjects}
                formTasksByObjective={formTasksByProject}
                assignedByOptions={currentUserProfile ? [currentUserProfile] : []}
                onRefresh={fetchRecurringTemplates}
                vaMode={true}
                currentUserId={currentUserId ?? ""}
              />
            </div>
          ) : (
            <>
              {selectedTaskIds.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sand bg-parchment/40 px-4 py-3 text-sm">
              <div className="text-stone">
                {selectedTaskIds.length} task{selectedTaskIds.length === 1 ? "" : "s"} selected
              </div>
              <div className="flex items-center gap-2">
                {taskView === "active" && (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleBulkArchive()}
                      className="rounded-lg border border-sand bg-white px-3 py-2 text-xs font-semibold text-espresso transition-colors hover:bg-parchment"
                    >
                      Archive
                    </button>
                    {currentRole !== "va" && (
                      <button
                        type="button"
                        onClick={() => void handleBulkTrash()}
                        className="rounded-lg border border-terracotta bg-terracotta px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#a85840]"
                      >
                        Trash
                      </button>
                    )}
                  </>
                )}
                {(taskView === "archived" || taskView === "trash") && (
                  <button
                    type="button"
                    onClick={() => void handleBulkRestore()}
                    className="rounded-lg border border-sand bg-white px-3 py-2 text-xs font-semibold text-espresso transition-colors hover:bg-parchment"
                  >
                    Restore
                  </button>
                )}
                {taskView === "trash" && isAdmin && (
                  <button
                    type="button"
                    onClick={() => void handleBulkPermanentDelete()}
                    className="rounded-lg border border-red-300 bg-red-500 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-600"
                  >
                    Delete Forever
                  </button>
                )}
              </div>
            </div>
          )}
              <div className="mb-3 flex items-center gap-2 text-[11px] text-stone">
                <span className="rounded-full bg-parchment px-2 py-0.5 font-semibold text-walnut">
                  {filteredTasks.length}
                </span>
                <span>task{filteredTasks.length === 1 ? "" : "s"}</span>
                <span className="rounded-full bg-slate-blue-soft px-2 py-0.5 font-semibold text-slate-blue">
                  {activeView === "submitted" ? "Submitted" : taskView === "active" ? "Active" : taskView === "archived" ? "Archived" : "Trash"}
                </span>
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
                        <th className="w-8 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">
                          <input
                            type="checkbox"
                            checked={allFilteredTasksSelected}
                            onChange={toggleAllFilteredTasks}
                            className="h-4 w-4 rounded border-sand text-terracotta focus:ring-terracotta"
                            aria-label="Select all visible tasks"
                          />
                        </th>
                        <th className="w-8 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut" />
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">Task Name</th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">Account</th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">Objective</th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">Client Detail</th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">Status</th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">Due Date</th>
                        {(taskView === "archived" || taskView === "trash") && (
                          <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">Actions</th>
                        )}
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
                              <input
                                type="checkbox"
                                checked={selectedTaskIdSet.has(task.id)}
                                onChange={() => toggleTaskSelection(task.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="h-4 w-4 rounded border-sand text-terracotta focus:ring-terracotta"
                                aria-label={`Select ${detail.task_name}`}
                              />
                            </td>
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
                              disabled={taskView !== "active"}
                              display={
                                <div className="flex flex-col gap-0.5">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-medium text-walnut">{detail.task_name}</span>
                                    {task.is_collaborative && (
                                      <span className="rounded-full bg-slate-blue-soft px-2 py-0.5 text-[10px] font-semibold text-slate-blue">
                                        Collaborative
                                      </span>
                                    )}
                                    {detail.project_id && (
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          if (detail.project_id) setProjectModalId(detail.project_id);
                                        }}
                                        className="text-[10px] font-semibold px-2 py-[2px] rounded-full bg-plum-soft text-plum border border-plum/20 cursor-pointer"
                                      >
                                        Project: {detail.projects?.name || detail.project || "Linked project"}
                                      </button>
                                    )}
                                  </div>
                                  <div className="mt-0.5 text-[11px] text-stone">
                                    Assigned by {detail.assigned_by_profile?.full_name ?? detail.assigned_by_profile?.username ?? "—"}
                                  </div>
                                </div>
                              }
                            />
                            <InlineCell
                              task={task}
                              field="account"
                              className="px-3 py-3 text-[13px] text-walnut"
                              disabled={taskView !== "active"}
                              display={detail.account || <span className="text-stone/60">—</span>}
                            />

                            <InlineCell
                              task={task}
                              field="project"
                              className="px-3 py-3 text-[13px] text-walnut"
                              disabled={taskView !== "active"}
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
                              disabled={taskView !== "active"}
                              display={<StatusBadge status={task.status} />}
                            />

                            <InlineCell
                              task={task}
                              field="due_date"
                              className={`px-3 py-3 text-[13px] font-medium ${dueTextClass}`}
                              disabled={taskView !== "active"}
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
                            {(taskView === "archived" || taskView === "trash") && (
                              <td className="px-3 py-3 text-[13px]" onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => void handleRestoreTask(task.assigned_tasks.id)}
                                    className="rounded-lg border border-sand bg-white px-2.5 py-1 text-[11px] font-semibold text-espresso transition-colors hover:bg-parchment"
                                  >
                                    Restore
                                  </button>
                                  {taskView === "trash" && isAdmin && (
                                    <button
                                      type="button"
                                      onClick={() => void handlePermanentDeleteTask(task.assigned_tasks.id)}
                                      className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-600 transition-colors hover:bg-red-100"
                                    >
                                      Delete Forever
                                    </button>
                                  )}
                                </div>
                              </td>
                            )}
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
    </div>

    {projectModalId && (
      <ProjectInfoModal
        projectId={projectModalId}
        isOpen={Boolean(projectModalId)}
        onClose={() => setProjectModalId(null)}
      />
    )}

      {isCreating && (
        <div className="fixed right-0 top-0 h-full z-40 w-[520px] max-w-full flex flex-col overflow-hidden border-l border-sand bg-white shadow-2xl">
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
                <div className="mb-1 flex items-center gap-1.5">
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-stone">Client Detail</label>
                  <div className="group relative">
                    <span className="cursor-help text-[11px] text-stone/60">ⓘ</span>
                    <div className="pointer-events-none absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-sand bg-white px-3 py-2 text-[10px] text-espresso opacity-0 shadow-md transition-opacity group-hover:opacity-100">
                      <p className="mb-2 italic text-[10px] text-walnut">Client Memo should answer: Who, What, Where, Why, Status.</p>
                      <div className="space-y-0.5 text-[10px]">
                        <p><span className="font-semibold">1. Who:</span> Who</p>
                        <p><span className="font-semibold">2. What:</span> Event, task title, or specific item (e.g., Checking May payment, Early bird flyer)</p>
                        <p><span className="font-semibold">3. Where:</span> Platform or destination (e.g., Social media post, Email Marketing, CRM)</p>
                        <p><span className="font-semibold">4. Why:</span> Purpose (e.g., Start Production, Continue Production, Revise flyer)</p>
                      </div>
                    </div>
                  </div>
                </div>
                <input
                  type="text"
                  value={addForm.task_detail}
                  onChange={(e) => setAddForm((form) => ({ ...form, task_detail: e.target.value }))}
                  placeholder="Added to client memo — keep it short and sensible"
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Notes</label>
                <textarea
                  value={addForm.task_notes}
                  onChange={(e) => setAddForm((form) => ({ ...form, task_notes: e.target.value }))}
                  rows={2}
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
                  rows={2}
                  placeholder="Add task instructions..."
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta resize-none"
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-stone">Attachments</label>
                  <button
                    type="button"
                    onClick={() => createAttachmentInputRef.current?.click()}
                    className="cursor-pointer rounded-lg border border-sand bg-white px-3 py-1.5 text-[11px] font-semibold text-espresso transition-colors hover:bg-parchment"
                  >
                    Attach File
                  </button>
                  <input
                    ref={createAttachmentInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const picked = Array.from(e.target.files ?? []);
                      e.target.value = "";
                      if (picked.length > 0) setPendingCreateFiles((prev) => [...prev, ...picked]);
                    }}
                  />
                </div>
                {pendingCreateFiles.length === 0 ? (
                  <p className="py-2 text-[12px] text-stone/50">No files selected — will upload after task is created.</p>
                ) : (
                  <div className="space-y-1.5">
                    {pendingCreateFiles.map((file, idx) => (
                      <div key={idx} className="flex items-center gap-2 rounded-lg border border-sand bg-parchment/40 px-3 py-2">
                        <svg className="h-3.5 w-3.5 shrink-0 text-stone" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                        <span className="min-w-0 flex-1 truncate text-[12px] text-walnut">{file.name}</span>
                        <button
                          type="button"
                          onClick={() => setPendingCreateFiles((prev) => prev.filter((_, i) => i !== idx))}
                          className="shrink-0 text-stone/50 hover:text-terracotta"
                          aria-label="Remove file"
                        >
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
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
                disabled={addSaving || createUploadSaving || !addForm.task_name.trim()}
                className="rounded-lg bg-terracotta px-5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#a85840] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {createUploadSaving ? "Uploading files..." : addSaving ? "Saving..." : "Create Task"}
              </button>
            </div>
          </div>
      )}

      {selectedTask && (
        <div className="fixed right-0 top-0 h-full z-40 w-[520px] max-w-full flex flex-col overflow-hidden border-l border-sand bg-white shadow-2xl">
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
                {panelCanEditFields ? (
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
                ) : (
                  <div className="rounded-lg border border-sand bg-parchment/40 px-3 py-2 text-[13px] text-espresso">
                    {selectedTask.assigned_tasks.task_name || <span className="text-stone/60">—</span>}
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
                <div className="mb-1 flex items-center gap-1.5">
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-stone">Client Detail</label>
                  <div className="group relative">
                    <span className="cursor-help text-[11px] text-stone/60">ⓘ</span>
                    <div className="pointer-events-none absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-sand bg-white px-3 py-2 text-[10px] text-espresso opacity-0 shadow-md transition-opacity group-hover:opacity-100">
                      <p className="mb-2 italic text-[10px] text-walnut">Client Memo should answer: Who, What, Where, Why, Status.</p>
                      <div className="space-y-0.5 text-[10px]">
                        <p><span className="font-semibold">1. Who:</span> Who</p>
                        <p><span className="font-semibold">2. What:</span> Event, task title, or specific item (e.g., Checking May payment, Early bird flyer)</p>
                        <p><span className="font-semibold">3. Where:</span> Platform or destination (e.g., Social media post, Email Marketing, CRM)</p>
                        <p><span className="font-semibold">4. Why:</span> Purpose (e.g., Start Production, Continue Production, Revise flyer)</p>
                      </div>
                    </div>
                  </div>
                </div>
                {panelCanEditFields ? (
                  <textarea
                    value={panelDetail}
                    onChange={(e) => setPanelDetail(e.target.value)}
                    rows={2}
                    placeholder="Added to client memo — keep it short and sensible"
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
                    rows={2}
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
                    {selectedTask.assigned_tasks.assigned_by_profile?.full_name
                      || selectedTask.assigned_tasks.assigned_by_profile?.username
                      || selectedTask.assigned_tasks.assigned_by
                      || <span className="text-stone/60">—</span>}
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
                    rows={2}
                    placeholder="Add task instructions..."
                    className="w-full resize-none rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                  />
                ) : (
                  <div className="min-h-[80px] whitespace-pre-wrap rounded-lg border border-sand bg-parchment/40 px-3 py-2 text-[13px] text-espresso">
                    {selectedTask.assigned_tasks.instructions ? renderTextWithLinks(selectedTask.assigned_tasks.instructions) : <span className="text-stone/60">No instructions provided.</span>}
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">My Notes</label>
                <textarea
                  value={panelNotes}
                  onChange={(e) => setPanelNotes(e.target.value)}
                  rows={2}
                  placeholder="Add your private notes for this task..."
                  className="w-full resize-none rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                />
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-stone">Assigned To</label>
                {selectedTask.is_collaborative ? (
                  <div className="space-y-3 rounded-xl border border-slate-blue/20 bg-slate-blue-soft px-3 py-3 text-sm text-slate-blue">
                    <StatusBadge status={selectedTask.status} />
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Update Status</label>
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
                    {selectedTask.collaborator_name ? (
                      <p className="text-[12px] text-stone">Also assigned to: {selectedTask.collaborator_name}</p>
                    ) : null}
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
                          onClick={() => {
                            if (!url) return;
                            const urls = panelScreenshots
                              .map((s) => panelSignedUrls[s.id])
                              .filter((candidate): candidate is string => Boolean(candidate));
                            setLightboxUrls(urls);
                            setLightboxIndex(Math.max(0, urls.indexOf(url)));
                          }}
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
                <button
                  type="button"
                  onClick={() => void handleSavePanel()}
                  disabled={panelSaving}
                  className="cursor-pointer rounded-lg bg-terracotta px-5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#a85840] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {panelSaving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
      )}
      {lightboxUrls && lightboxUrls.length > 0 && (
        <ScreenshotLightbox
          urls={lightboxUrls}
          initialIndex={lightboxIndex}
          onClose={() => {
            setLightboxUrls(null);
            setLightboxIndex(0);
          }}
        />
      )}
    </>
  );
}
