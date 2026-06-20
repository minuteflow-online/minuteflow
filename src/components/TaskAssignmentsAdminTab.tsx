"use client";

import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type {
  Profile,
  AssignedTaskWithAssignees,
  AssignedTaskStatus,
  TaskScreenshot,
  RecurringTaskTemplate,
} from "@/types/database";
import ScreenshotLightbox from "@/components/ScreenshotLightbox";

// ─── Constants ────────────────────────────────────────────────────────────────

const KNOWN_ACCOUNTS = [
  "TAT Foundation",
  "WSB Awesome Team",
  "Virtual Concierge",
  "Colina Portrait",
  "SNAPS Sublimation",
  "Thess Personal",
  "Thess Base",
  "Right Path Agency",
  "Personal",
  "Quad Life",
  "TONIWSB",
];

const STATUS_OPTIONS: { value: AssignedTaskStatus | ""; label: string }[] = [
  { value: "", label: "All Statuses" },
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

const ASSIGNEE_STATUS_OPTIONS: { value: AssignedTaskStatus; label: string }[] = [
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface TaskAssignmentsAdminTabProps {
  profiles: Profile[];
  orgTimezone?: string;
}

interface DetailFormState {
  task_name: string;
  account: string;
  project: string;
  task_detail: string;
  task_notes: string;
  instructions: string;
  instructions_locked: boolean;
  due_date: string;
  assigned_by_id: string;
  recurring_template_id: number | null;
  initial_status: AssignedTaskStatus;
  assignee_ids: string[];
}

interface InlineEditState {
  taskId: number;
  field: string;
  value: string;
}

interface CsvRow {
  task_name: string;
  account: string;
  project: string;
  task_detail: string;
  due_date: string;
  va_usernames: string[];
  _valid: boolean;
  _error?: string;
}

interface FormObjective {
  id: number;
  account: string | null;
  project_name: string;
}

interface FormTask {
  id: number;
  task_name: string;
  billing_type?: string;
}

interface AttachmentRow {
  id: number;
  filename: string;
  storage_path: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  url: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDueDate(iso: string | null, tz?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: tz || undefined,
    });
  } catch {
    return iso;
  }
}

function isDueSoon(iso: string | null): boolean {
  if (!iso) return false;
  const diff = new Date(iso).getTime() - Date.now();
  return diff >= 0 && diff < 86400 * 3 * 1000;
}

function isPastDue(iso: string | null): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() < Date.now();
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mergeProfiles(
  options: Pick<Profile, "id" | "full_name" | "username">[],
  current: Pick<Profile, "id" | "full_name" | "username"> | null | undefined
) {
  const map = new Map<string, Pick<Profile, "id" | "full_name" | "username">>();
  for (const option of options) map.set(option.id, option);
  if (current) map.set(current.id, current);
  return Array.from(map.values()).sort((a, b) =>
    (a.full_name || a.username).localeCompare(b.full_name || b.username)
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AssignedTaskStatus }) {
  const map: Record<AssignedTaskStatus, { cls: string; label: string }> = {
    unassigned:     { cls: "bg-stone/10 text-stone", label: "Unassigned" },
    pending:        { cls: "bg-slate-blue-soft text-slate-blue", label: "Pending" },
    on_queue:       { cls: "bg-stone/10 text-stone", label: "On Queue" },
    in_progress:    { cls: "bg-amber-100 text-amber-700", label: "In Progress" },
    submitted:      { cls: "bg-sky-100 text-sky-700", label: "Submitted" },
    reviewing:      { cls: "bg-violet-100 text-violet-700", label: "Reviewing" },
    revision_needed:{ cls: "bg-amber-100 text-amber-600", label: "Revision Needed" },
    approved:       { cls: "bg-emerald-100 text-emerald-700", label: "Approved" },
    completed:      { cls: "bg-sage-soft text-sage", label: "Completed" },
    paid:           { cls: "bg-purple-100 text-purple-700", label: "Paid" },
    cancelled:      { cls: "bg-red-100 text-red-500", label: "Cancelled" },
  };
  const { cls, label } = map[status] ?? map.on_queue;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {label}
    </span>
  );
}

// ─── Status dot color helper ──────────────────────────────────────────────────

function statusDotColor(status: AssignedTaskStatus): string {
  switch (status) {
    case "pending":         return "text-slate-blue";
    case "on_queue":        return "text-stone";
    case "in_progress":     return "text-amber-500";
    case "submitted":       return "text-sky-600";
    case "reviewing":       return "text-violet-600";
    case "revision_needed": return "text-amber-600";
    case "approved":        return "text-emerald-600";
    case "completed":       return "text-sage";
    case "paid":            return "text-purple-600";
    case "cancelled":       return "text-red-500";
    default:                return "text-stone";
  }
}

// ─── CSV Parser ───────────────────────────────────────────────────────────────

function parseCsv(text: string, activeProfiles: Profile[]): CsvRow[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];

  const dataLines = lines.slice(1);
  const rows: CsvRow[] = [];

  for (const raw of dataLines) {
    if (!raw.trim()) continue;

    const fields: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === '"') {
        if (inQuotes && raw[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());

    const [task_name = "", account = "", project = "", task_detail = "", due_date = "", va_raw = ""] = fields;

    const va_usernames = va_raw
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    const unknownVas = va_usernames.filter(
      (u) => !activeProfiles.some((p) => p.username === u)
    );

    const valid = !!task_name.trim();
    const row: CsvRow = {
      task_name: task_name.trim(),
      account: account.trim(),
      project: project.trim(),
      task_detail: task_detail.trim(),
      due_date: due_date.trim(),
      va_usernames,
      _valid: valid,
    };

    if (!valid) {
      row._error = "task_name is required";
    } else if (unknownVas.length > 0) {
      row._error = `Unknown usernames: ${unknownVas.join(", ")}`;
      row._valid = false;
    }

    rows.push(row);
  }

  return rows;
}

// ─── VA Multi-Select Dropdown ──────────────────────────────────────────────────

interface VAMultiSelectProps {
  activeProfiles: Profile[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  selectedTask: AssignedTaskWithAssignees | null;
}

function VAMultiSelect({ activeProfiles, selectedIds, onChange, selectedTask }: VAMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const openDropdown = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const maxH = Math.min(240, Math.max(spaceBelow, spaceAbove));
      const showAbove = spaceBelow < 120 && spaceAbove > spaceBelow;
      setDropdownStyle({
        position: "fixed",
        ...(showAbove
          ? { bottom: window.innerHeight - rect.top + 2 }
          : { top: rect.bottom + 2 }),
        left: rect.left,
        width: rect.width,
        maxHeight: maxH,
        zIndex: 9999,
      });
    }
    setOpen(true);
  };

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((i) => i !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const selectedProfiles = activeProfiles.filter((p) => selectedIds.includes(p.id));

  return (
    <div className="relative">
      {/* Trigger button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openDropdown())}
        className="w-full flex items-center justify-between py-2 px-3 border border-sand rounded-lg text-[13px] bg-white outline-none focus:border-terracotta cursor-pointer hover:border-walnut/40 transition-colors"
      >
        <span className="flex-1 text-left">
          {selectedProfiles.length === 0 ? (
            <span className="text-stone/50">Select team members...</span>
          ) : (
            <span className="flex flex-wrap gap-1">
              {selectedProfiles.map((p) => {
                const assignee = selectedTask?.assigned_task_assignees.find((a) => a.va_id === p.id);
                return (
                  <span
                    key={p.id}
                    className="inline-flex items-center gap-1 bg-parchment border border-sand rounded-full px-2 py-0.5 text-[11px] text-walnut"
                  >
                    {p.full_name || p.username}
                    {assignee && <StatusBadge status={assignee.status} />}
                  </span>
                );
              })}
            </span>
          )}
        </span>
        <svg
          className={`h-4 w-4 text-stone ml-2 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown — fixed position to escape overflow:auto clipping */}
      {open && (
        <div
          ref={dropdownRef}
          style={dropdownStyle}
          className="bg-white border border-sand rounded-lg shadow-xl overflow-y-auto"
        >
          {activeProfiles.map((va) => {
            const checked = selectedIds.includes(va.id);
            const assignee = selectedTask?.assigned_task_assignees.find((a) => a.va_id === va.id);
            return (
              <label
                key={va.id}
                className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-parchment transition-colors"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(va.id)}
                  className="accent-terracotta"
                />
                <span className="text-[13px] text-walnut flex-1">{va.full_name || va.username}</span>
                {assignee && <StatusBadge status={assignee.status} />}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TaskAssignmentsAdminTab({
  profiles,
  orgTimezone,
}: TaskAssignmentsAdminTabProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const activeProfiles = profiles.filter((p) => p.is_active !== false);
  const assignedByProfiles = activeProfiles.filter(
    (p) => p.role === "admin" || p.position === "Full-time VA" || p.position === "Part-time VA"
  );

  // ── Data state ───────────────────────────────────────────────────────────────
  const [tasks, setTasks] = useState<AssignedTaskWithAssignees[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // ── Detail panel state ───────────────────────────────────────────────────────
  const [selectedTask, setSelectedTask] = useState<AssignedTaskWithAssignees | null>(null);
  const selectedTaskRef = useRef<AssignedTaskWithAssignees | null>(null);
  useEffect(() => {
    selectedTaskRef.current = selectedTask;
  }, [selectedTask]);
  const [isCreating, setIsCreating] = useState(false);
  const [detailForm, setDetailForm] = useState<DetailFormState>({
    task_name: "",
    account: "",
    project: "",
    task_detail: "",
    task_notes: "",
    instructions: "",
    instructions_locked: false,
    due_date: "",
    assigned_by_id: "",
    recurring_template_id: null,
    initial_status: "on_queue",
    assignee_ids: [],
  });
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailSaveMsg, setDetailSaveMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // ── Inline edit state ────────────────────────────────────────────────────────
  const [inlineEdit, setInlineEdit] = useState<InlineEditState | null>(null);
  const [inlineSaving, setInlineSaving] = useState(false);

  // ── Status edit state ─────────────────────────────────────────────────────────
  const [statusEdit, setStatusEdit] = useState<{ taskId: number; vaId: string } | null>(null);
  const [taskStatusEdit, setTaskStatusEdit] = useState<{ taskId: number } | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);

  const [assignedToEdit, setAssignedToEdit] = useState<{ taskId: number } | null>(null);
  const assignedToEditRef = useRef<HTMLTableCellElement | null>(null);

  // ── Delete state ─────────────────────────────────────────────────────────────
  const [deleting, setDeleting] = useState<Record<number, boolean>>({});

  // ── Filter state ─────────────────────────────────────────────────────────────
  const [filterVaIds, setFilterVaIds] = useState<string[]>([]);
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
  const [filterAccounts, setFilterAccounts] = useState<string[]>([]);
  const [filterTaskNames, setFilterTaskNames] = useState<string[]>([]);
  const [filterObjectives, setFilterObjectives] = useState<string[]>([]);
  const [filterDueStart, setFilterDueStart] = useState<string>("");
  const [filterDueEnd, setFilterDueEnd] = useState<string>("");
  const [taskNameSearch, setTaskNameSearch] = useState<string>("");
  const [openFilter, setOpenFilter] = useState<"va" | "status" | "account" | "taskname" | "objective" | "duedate" | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const [taskView, setTaskView] = useState<"active" | "submitted" | "archived" | "trash">("active");
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([]);

  // ── CSV Upload state ─────────────────────────────────────────────────────────
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [csvUploading, setCsvUploading] = useState(false);
  const [csvResult, setCsvResult] = useState<string | null>(null);
  const csvFileRef = useRef<HTMLInputElement>(null);

  // ── Objective tags map (account → project names) ────────────────────────────────
  const [projectTagsMap, setObjectiveTagsMap] = useState<Record<string, string[]>>({});

  // ── Task form options (for cascading task name dropdown) ──────────────────────
  const [formAccounts, setFormAccounts] = useState<string[]>([]);
  const [formObjectives, setFormObjectives] = useState<FormObjective[]>([]);
  const [formTasksByObjective, setFormTasksByObjective] = useState<Record<number, FormTask[]>>({});
  const [recurringTemplates, setRecurringTemplates] = useState<RecurringTaskTemplate[]>([]);

  // ── Attachments ────────────────────────────────────────────────────────────────
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [panelScreenshots, setPanelScreenshots] = useState<TaskScreenshot[]>([]);
  const [panelSignedUrls, setPanelSignedUrls] = useState<Record<number, string>>({});
  const [panelScreenshotsLoading, setPanelScreenshotsLoading] = useState(false);
  const [lightboxUrls, setLightboxUrls] = useState<string[] | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [uploadingFile, setUploadingFile] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  // ─── Fetch tasks ─────────────────────────────────────────────────────────────

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const endpoint = taskView === "submitted"
        ? "/api/assigned-tasks?asReviewer=true"
        : `/api/assigned-tasks${taskView === "active" ? "" : `?view=${taskView}`}`;
      const res = await fetch(endpoint, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      const freshTasks = d.tasks || d || [];
      setTasks(freshTasks);
      const currentSelectedTaskId = selectedTaskRef.current?.id;
      if (currentSelectedTaskId != null) {
        const updatedSelectedTask = freshTasks.find((task: AssignedTaskWithAssignees) => task.id === currentSelectedTaskId);
        if (updatedSelectedTask) setSelectedTask(updatedSelectedTask);
      }
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, [taskView]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    fetch("/api/project-tags")
      .then((r) => r.json())
      .then((d) => {
        const map: Record<string, string[]> = {};
        for (const pt of d.projects ?? []) {
          if (!pt.is_active) continue;
          if (!map[pt.account]) map[pt.account] = [];
          if (!map[pt.account].includes(pt.project_name)) {
            map[pt.account].push(pt.project_name);
          }
        }
        setObjectiveTagsMap(map);
      })
      .catch(() => {});
  }, []);

  // Fetch task form options for cascading dropdowns
  useEffect(() => {
    fetch("/api/task-form-options")
      .then((r) => r.json())
      .then((d) => {
        if (d.accounts?.length > 0) setFormAccounts(d.accounts);
        if (d.projects?.length > 0) setFormObjectives(d.projects);
        if (d.tasksByProject) setFormTasksByObjective(d.tasksByProject);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/recurring-task-templates")
      .then((r) => r.json())
      .then((d) => {
        setRecurringTemplates((d.templates ?? d.tasks ?? []) as RecurringTaskTemplate[]);
      })
      .catch(() => {});
  }, []);

  // ── Computed cascading values for detail panel ────────────────────────────────
  const accountsForPanel = formAccounts.length > 0 ? formAccounts : KNOWN_ACCOUNTS;
  const detailObjectivesForAccount = formObjectives.filter((p) => p.account === detailForm.account);
  const detailObjectiveTagId =
    formObjectives.find(
      (p) => p.account === detailForm.account && p.project_name === detailForm.project
    )?.id ?? null;
  const detailTasksForObjective = detailObjectiveTagId
    ? (formTasksByObjective[detailObjectiveTagId] ?? [])
    : [];
  const assignedByOptions = useMemo(
    () => mergeProfiles(assignedByProfiles, selectedTask?.assigned_by_profile ?? null),
    [assignedByProfiles, selectedTask?.assigned_by_profile]
  );
  const allTaskNameOptions = Array.from(
    new Set([
      ...Object.values(formTasksByObjective).flatMap((tasks) => tasks.map((task) => task.task_name)),
      ...tasks.map((task) => task.task_name),
    ])
  ).sort();
  const taskNameFilterOptions = useMemo(
    () => Array.from(new Set(tasks.map((task) => task.task_name).filter(Boolean))).sort(),
    [tasks]
  );
  const objectiveFilterOptions = useMemo(
    () => Array.from(new Set(tasks.map((task) => task.project?.trim()).filter((project): project is string => !!project))).sort(),
    [tasks]
  );

  // ─── Fetch attachments ────────────────────────────────────────────────────────

  const fetchAttachments = useCallback(async (taskId: number) => {
    setAttachmentsLoading(true);
    try {
      const res = await fetch(`/api/assigned-tasks/${taskId}/attachments`);
      if (res.ok) {
        const d = await res.json();
        setAttachments(d.attachments || []);
      }
    } catch {
      // silently fail
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

  // ─── File upload ──────────────────────────────────────────────────────────────

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!selectedTask) return;
      const files = Array.from(e.target.files ?? []);
      if (files.length === 0) return;
      setUploadingFile(true);
      try {
        for (const file of files) {
          const formData = new FormData();
          formData.append("file", file);
          const res = await fetch(
            `/api/assigned-tasks/${selectedTask.id}/attachments`,
            { method: "POST", body: formData }
          );
          if (!res.ok) break;
        }
        await fetchAttachments(selectedTask.id);
      } catch {
        // silently fail
      } finally {
        setUploadingFile(false);
        if (attachmentInputRef.current) attachmentInputRef.current.value = "";
      }
    },
    [selectedTask, fetchAttachments]
  );

  // ─── Delete attachment ────────────────────────────────────────────────────────

  const handleDeleteAttachment = useCallback(
    async (attachmentId: number) => {
      if (!selectedTask) return;
      if (!confirm("Delete this attachment? This cannot be undone.")) return;
      try {
        await fetch(
          `/api/assigned-tasks/${selectedTask.id}/attachments?attachmentId=${attachmentId}`,
          { method: "DELETE" }
        );
        await fetchAttachments(selectedTask.id);
      } catch {
        // silently fail
      }
    },
    [selectedTask, fetchAttachments]
  );

  // ─── Panel helpers ────────────────────────────────────────────────────────────

  const emptyDetailForm = (): DetailFormState => ({
    task_name: "",
    account: "",
    project: "",
    task_detail: "",
    task_notes: "",
    instructions: "",
    instructions_locked: false,
    due_date: "",
    assigned_by_id: "",
    recurring_template_id: null,
    initial_status: "on_queue",
    assignee_ids: [],
  });

  const openCreate = () => {
    setIsCreating(true);
    setSelectedTask(null);
    setAssignedToEdit(null);
    setDetailForm(emptyDetailForm());
    setDetailSaveMsg(null);
    setAttachments([]);
    setPanelScreenshots([]);
    setPanelSignedUrls({});
    setPanelScreenshotsLoading(false);
    setLightboxUrls(null);
    setLightboxIndex(0);
  };

  const openEdit = (task: AssignedTaskWithAssignees) => {
    setIsCreating(false);
    setAssignedToEdit(null);
    setSelectedTask(task);
    setDetailForm({
      task_name: task.task_name,
      account: task.account || "",
      project: task.project || "",
      task_detail: task.task_detail || "",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      task_notes: (task as any).task_notes || "",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      instructions: (task as any).instructions || "",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      instructions_locked: Boolean((task as any).instructions_locked),
      due_date: task.due_date ? task.due_date.slice(0, 10) : "",
      assigned_by_id: task.assigned_by || "",
      recurring_template_id: (task.recurring_template_id as number | null | undefined) ?? null,
      initial_status: task.assigned_task_assignees[0]?.status ?? "on_queue",
      assignee_ids: task.assigned_task_assignees.map((a) => a.va_id),
    });
    setDetailSaveMsg(null);
    fetchAttachments(task.id);
    void fetchPanelScreenshots(task.id);
  };

  const closePanel = () => {
    setSelectedTask(null);
    setIsCreating(false);
    setAssignedToEdit(null);
    setDetailSaveMsg(null);
    setAttachments([]);
  };

  const isPanelOpen = isCreating || selectedTask !== null;

  useEffect(() => {
    if (!assignedToEdit) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (assignedToEditRef.current && !assignedToEditRef.current.contains(event.target as Node)) {
        setAssignedToEdit(null);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [assignedToEdit]);

  // Close filter dropdowns on outside click
  useEffect(() => {
    if (!openFilter) return;
    const handleClick = (event: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setOpenFilter(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openFilter]);

  // ─── Detail panel save ────────────────────────────────────────────────────────

  const handleDetailSave = useCallback(async () => {
    if (!detailForm.task_name.trim()) return;
    setDetailSaving(true);
    setDetailSaveMsg(null);

    const payload = {
      task_name: detailForm.task_name.trim(),
      account: detailForm.account.trim() || null,
      project: detailForm.project.trim() || null,
      task_detail: detailForm.task_detail.trim() || null,
      task_notes: detailForm.task_notes.trim() || null,
      instructions: detailForm.instructions.trim() || null,
      instructions_locked: detailForm.instructions_locked,
      due_date: detailForm.due_date || null,
      assigned_by: detailForm.assigned_by_id || null,
      recurring_template_id: detailForm.recurring_template_id,
      va_ids: detailForm.assignee_ids,
      ...(selectedTask ? {} : { initial_status: detailForm.initial_status }),
    };

    try {
      const res = selectedTask
        ? await fetch(`/api/assigned-tasks/${selectedTask.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/assigned-tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

      if (res.ok) {
        const result = await res.json();
        const newTask = result?.task as AssignedTaskWithAssignees | undefined;
        setDetailSaveMsg({
          type: "ok",
          text: selectedTask ? "Task updated!" : "Task created!",
        });
        if (!selectedTask && newTask) {
          setIsCreating(false);
          setSelectedTask(newTask);
        }
        await fetchTasks();
      } else {
        const e = await res.json();
        setDetailSaveMsg({ type: "err", text: e.error || "Failed to save" });
      }
    } catch {
      setDetailSaveMsg({ type: "err", text: "Network error — please try again" });
    } finally {
      setDetailSaving(false);
    }
  }, [detailForm, selectedTask, fetchTasks, router]);

  // ─── Delete ───────────────────────────────────────────────────────────────────

  const handleDelete = useCallback(
    async (id: number) => {
      if (!confirm("Delete this task? This cannot be undone.")) return;
      setDeleting((d) => ({ ...d, [id]: true }));
      try {
        await fetch(`/api/assigned-tasks/${id}`, { method: "DELETE" });
        if (selectedTask?.id === id) closePanel();
        await fetchTasks();
      } finally {
        setDeleting((d) => ({ ...d, [id]: false }));
      }
    },
    [fetchTasks, selectedTask]
  );

  const handleArchive = useCallback(async (taskId: number) => {
    setDeleting(d => ({ ...d, [taskId]: true }));
    try {
      await fetch(`/api/assigned-tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived_at: new Date().toISOString() }),
      });
      fetchTasks();
    } finally {
      setDeleting(d => { const n = { ...d }; delete n[taskId]; return n; });
    }
  }, [fetchTasks]);

  const handleTrash = useCallback(async (taskId: number) => {
    setDeleting(d => ({ ...d, [taskId]: true }));
    try {
      await fetch(`/api/assigned-tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleted_at: new Date().toISOString() }),
      });
      fetchTasks();
    } finally {
      setDeleting(d => { const n = { ...d }; delete n[taskId]; return n; });
    }
  }, [fetchTasks]);

  const handleRestore = useCallback(async (taskId: number) => {
    setDeleting(d => ({ ...d, [taskId]: true }));
    try {
      await fetch(`/api/assigned-tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived_at: null, deleted_at: null }),
      });
      fetchTasks();
    } finally {
      setDeleting(d => { const n = { ...d }; delete n[taskId]; return n; });
    }
  }, [fetchTasks]);

  const handlePermanentDelete = useCallback(async (taskId: number) => {
    if (!confirm("Permanently delete this task? This cannot be undone.")) return;
    setDeleting(d => ({ ...d, [taskId]: true }));
    try {
      await fetch(`/api/assigned-tasks/${taskId}`, { method: "DELETE" });
      fetchTasks();
    } finally {
      setDeleting(d => { const n = { ...d }; delete n[taskId]; return n; });
    }
  }, [fetchTasks]);

  const handleBulkArchive = useCallback(async () => {
    await Promise.all(
      selectedTaskIds.map(id =>
        fetch(`/api/assigned-tasks/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archived_at: new Date().toISOString() }),
        })
      )
    );
    setSelectedTaskIds([]);
    fetchTasks();
  }, [selectedTaskIds, fetchTasks]);

  const handleBulkTrash = useCallback(async () => {
    await Promise.all(
      selectedTaskIds.map(id =>
        fetch(`/api/assigned-tasks/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deleted_at: new Date().toISOString() }),
        })
      )
    );
    setSelectedTaskIds([]);
    fetchTasks();
  }, [selectedTaskIds, fetchTasks]);

  const handleEmptyTrash = useCallback(async () => {
    if (!confirm(`Permanently delete all ${tasks.length} trashed tasks? This cannot be undone.`)) return;
    await Promise.all(
      tasks.map(t => fetch(`/api/assigned-tasks/${t.id}`, { method: "DELETE" }))
    );
    fetchTasks();
  }, [tasks, fetchTasks]);

  // ─── Status change ───────────────────────────────────────────────────────────

  const handleStatusChange = useCallback(
    async (taskId: number, vaId: string, newStatus: AssignedTaskStatus) => {
      // Optimistic update — immediately reflect the new status so the dropdown
      // doesn't snap back while the API call is in flight.
      setTasks((prev) =>
        prev.map((task) =>
          task.id === taskId
            ? {
                ...task,
                assigned_task_assignees: task.assigned_task_assignees.map((a) =>
                  a.va_id === vaId ? { ...a, status: newStatus } : a
                ),
              }
            : task
        )
      );
      if (selectedTaskRef.current?.id === taskId) {
        setSelectedTask((prev) =>
          prev
            ? {
                ...prev,
                assigned_task_assignees: prev.assigned_task_assignees.map((a) =>
                  a.va_id === vaId ? { ...a, status: newStatus } : a
                ),
              }
            : null
        );
      }
      setStatusSaving(true);
      try {
        await fetch(`/api/assigned-tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ va_id: vaId, status: newStatus }),
        });
        await fetchTasks();
      } finally {
        setStatusSaving(false);
        setStatusEdit(null);
      }
    },
    [fetchTasks]
  );

  const handleTaskLevelStatusChange = useCallback(
    async (taskId: number, newStatus: AssignedTaskStatus) => {
      setTasks((prev) =>
        prev.map((task) => (task.id === taskId ? { ...task, status: newStatus } : task))
      );
      if (selectedTaskRef.current?.id === taskId) {
        setSelectedTask((prev) => (prev ? { ...prev, status: newStatus } : null));
      }
      setStatusSaving(true);
      try {
        await fetch(`/api/assigned-tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        });
        await fetchTasks();
      } finally {
        setStatusSaving(false);
        setTaskStatusEdit(null);
      }
    },
    [fetchTasks]
  );

  const handleAssignedToChange = useCallback(
    async (taskId: number, selectedIds: string[]) => {
      setInlineSaving(true);
      try {
        await fetch(`/api/assigned-tasks/${taskId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ va_ids: selectedIds }),
        });
        await fetchTasks();
      } finally {
        setInlineSaving(false);
        setAssignedToEdit(null);
      }
    },
    [fetchTasks]
  );

  // ─── Inline edit ─────────────────────────────────────────────────────────────

  const startInlineEdit = (
    e: React.MouseEvent,
    taskId: number,
    field: string,
    value: string
  ) => {
    e.stopPropagation();
    setInlineEdit({ taskId, field, value });
  };

  const commitInlineEdit = useCallback(async (nextValue?: string) => {
    if (!inlineEdit || inlineSaving) return;
    const task = tasks.find((t) => t.id === inlineEdit.taskId);
    if (!task) {
      setInlineEdit(null);
      return;
    }

    const value = nextValue ?? inlineEdit.value;

    // If value unchanged, just close
    const currentValue = (() => {
      switch (inlineEdit.field) {
        case "task_name": return task.task_name;
        case "account":   return task.account || "";
        case "project":   return task.project || "";
        case "due_date":  return task.due_date ? task.due_date.slice(0, 10) : "";
        default:          return "";
      }
    })();

    if (value === currentValue) {
      setInlineEdit(null);
      return;
    }

    setInlineSaving(true);
    const payload: Record<string, unknown> = {
      [inlineEdit.field]: value || null,
    };

    try {
      await fetch(`/api/assigned-tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await fetchTasks();
    } finally {
      setInlineSaving(false);
      setInlineEdit(null);
    }
  }, [inlineEdit, inlineSaving, tasks, fetchTasks]);

  const cancelInlineEdit = () => setInlineEdit(null);

  // ─── CSV Upload ───────────────────────────────────────────────────────────────

  const handleCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseCsv(text, activeProfiles);
      setCsvRows(parsed);
      setCsvResult(null);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleCsvUpload = useCallback(async () => {
    const valid = csvRows.filter((r) => r._valid);
    if (valid.length === 0) return;

    setCsvUploading(true);
    setCsvResult(null);

    let created = 0;
    const errors: string[] = [];

    for (const row of valid) {
      const assignee_ids = row.va_usernames
        .map((u) => activeProfiles.find((p) => p.username === u)?.id)
        .filter((id): id is string => !!id);

      const payload = {
        task_name: row.task_name,
        account: row.account || null,
        project: row.project || null,
        task_detail: row.task_detail || null,
        due_date: row.due_date || null,
        va_ids: assignee_ids,
      };

      try {
        const res = await fetch("/api/assigned-tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          created++;
        } else {
          const e = await res.json();
          errors.push(`"${row.task_name}": ${e.error || "failed"}`);
        }
      } catch {
        errors.push(`"${row.task_name}": network error`);
      }
    }

    setCsvUploading(false);

    if (errors.length > 0) {
      setCsvResult(`Created ${created} task(s). Errors:\n${errors.join("\n")}`);
    } else {
      setCsvResult(`Created ${created} task(s) successfully.`);
      setTimeout(() => {
        setShowCsvModal(false);
        setCsvRows([]);
        setCsvResult(null);
      }, 2000);
    }

    if (created > 0) fetchTasks();
  }, [csvRows, activeProfiles, fetchTasks]);

  // ─── Filtered tasks ───────────────────────────────────────────────────────────

  const filteredTasks = tasks.filter((task) => {
    if (filterVaIds.length > 0) {
      const hasVa = task.assigned_task_assignees.some((a) => filterVaIds.includes(a.va_id));
      if (!hasVa) return false;
    }
    if (filterStatuses.length > 0) {
      const hasStatus = task.assigned_task_assignees.some((a) => filterStatuses.includes(a.status));
      const matchesUnassigned =
        filterStatuses.includes("unassigned") && task.assigned_task_assignees.length === 0;
      if (!hasStatus && !matchesUnassigned) return false;
    }
    if (filterAccounts.length > 0) {
      if (!task.account || !filterAccounts.includes(task.account)) return false;
    }
    if (filterTaskNames.length > 0 && !filterTaskNames.includes(task.task_name)) {
      return false;
    }
    if (filterObjectives.length > 0) {
      if (!task.project || !filterObjectives.includes(task.project)) return false;
    }
    if (filterDueStart && (!task.due_date || task.due_date.slice(0, 10) < filterDueStart)) {
      return false;
    }
    if (filterDueEnd && (!task.due_date || task.due_date.slice(0, 10) > filterDueEnd)) {
      return false;
    }
    return true;
  });

  // ─── Inline cell renderer ─────────────────────────────────────────────────────

  function InlineCell({
    task,
    field,
    display,
    inputType = "text",
  }: {
    task: AssignedTaskWithAssignees;
    field: string;
    display: string;
    inputType?: string;
  }) {
    const isEditing = inlineEdit?.taskId === task.id && inlineEdit?.field === field;

    if (isEditing) {
      return (
        <td className="px-3 py-3 text-[13px]" onClick={(e) => e.stopPropagation()}>
          {field === "task_name" ? (
            <select
              autoFocus
              value={inlineEdit.value}
              onChange={(e) => void commitInlineEdit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelInlineEdit();
              }}
              className="w-full bg-transparent border-b-2 border-terracotta outline-none text-[13px] text-ink py-0.5"
            >
              <option value="">Select task...</option>
              {allTaskNameOptions.map((taskName) => (
                <option key={taskName} value={taskName}>
                  {taskName}
                </option>
              ))}
            </select>
          ) : field === "account" ? (
            <select
              autoFocus
              value={inlineEdit.value}
              onChange={(e) => void commitInlineEdit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelInlineEdit();
              }}
              className="w-full bg-transparent border-b-2 border-terracotta outline-none text-[13px] text-ink py-0.5"
            >
              <option value="">Select account...</option>
              {accountsForPanel.map((account) => (
                <option key={account} value={account}>
                  {account}
                </option>
              ))}
            </select>
          ) : field === "project" ? (
            <select
              autoFocus
              value={inlineEdit.value}
              onChange={(e) => void commitInlineEdit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelInlineEdit();
              }}
              className="w-full bg-transparent border-b-2 border-terracotta outline-none text-[13px] text-ink py-0.5"
            >
              <option value="">Select objective...</option>
              {(projectTagsMap[task.account ?? ""] ?? []).map((proj: string) => (
                <option key={proj} value={proj}>
                  {proj}
                </option>
              ))}
            </select>
          ) : (
            <input
              autoFocus
              type={inputType}
              value={inlineEdit.value}
              onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
              onBlur={() => void commitInlineEdit()}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitInlineEdit();
                if (e.key === "Escape") cancelInlineEdit();
              }}
              className="w-full bg-transparent border-b-2 border-terracotta outline-none text-[13px] text-ink py-0.5"
            />
          )}
        </td>
      );
    }

    const rawValue = (() => {
      switch (field) {
        case "task_name": return task.task_name;
        case "account":   return task.account || "";
        case "project":   return task.project || "";
        case "due_date":  return task.due_date ? task.due_date.slice(0, 10) : "";
        default:          return "";
      }
    })();

    return (
      <td
        className="px-3 py-3 text-[13px] cursor-text"
        onClick={(e) => startInlineEdit(e, task.id, field, rawValue)}
      >
        {display || <span className="text-stone/40">—</span>}
      </td>
    );
  }

  // ─── Filter Dropdown sub-component ───────────────────────────────────────────

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
          onClick={onToggle}
          className={`flex items-center gap-1.5 py-2 px-3 border rounded-lg text-[13px] bg-white outline-none cursor-pointer transition-all ${
            selected.length > 0
              ? "border-terracotta text-terracotta"
              : "border-sand text-ink hover:border-walnut"
          }`}
        >
          {label}
          {selected.length > 0 && (
            <span className="bg-terracotta text-white text-[10px] font-bold rounded-full px-1.5 py-px leading-none">
              {selected.length}
            </span>
          )}
          <svg className="h-3.5 w-3.5 text-stone" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {isOpen && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-sand rounded-xl shadow-lg min-w-[180px] py-1">
            {searchable && onSearchChange && (
              <div className="px-3 py-2 border-b border-sand">
                <input
                  value={searchValue || ""}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder={searchPlaceholder || `Search ${label.toLowerCase()}...`}
                  className="w-full rounded-lg border border-sand px-2.5 py-1.5 text-[13px] outline-none focus:border-terracotta"
                />
              </div>
            )}
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-sand">
              <button
                onClick={() => onChange(visibleOptions.map((o) => o.value))}
                className="text-[11px] text-terracotta hover:underline cursor-pointer"
              >Select All</button>
              <button
                onClick={() => onChange([])}
                className="text-[11px] text-stone hover:underline cursor-pointer"
              >Clear</button>
            </div>
            {visibleOptions.length > 0 ? visibleOptions.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 px-3 py-1.5 hover:bg-parchment cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.includes(opt.value)}
                  onChange={e => {
                    if (e.target.checked) onChange([...selected, opt.value]);
                    else onChange(selected.filter(v => v !== opt.value));
                  }}
                  className="accent-terracotta"
                />
                <span className="text-[13px] text-ink">{opt.label}</span>
              </label>
            )) : (
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
          onClick={onToggle}
          className={`flex items-center gap-1.5 py-2 px-3 border rounded-lg text-[13px] bg-white outline-none cursor-pointer transition-all ${
            activeCount > 0
              ? "border-terracotta text-terracotta"
              : "border-sand text-ink hover:border-walnut"
          }`}
        >
          {label}
          {activeCount > 0 && (
            <span className="bg-terracotta text-white text-[10px] font-bold rounded-full px-1.5 py-px leading-none">
              {activeCount}
            </span>
          )}
          <svg className="h-3.5 w-3.5 text-stone" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {isOpen && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-sand rounded-xl shadow-lg min-w-[240px] p-3">
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
                <button
                  onClick={() => { onStartChange(""); onEndChange(""); }}
                  className="text-[11px] text-stone hover:underline cursor-pointer"
                >Clear</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="w-full space-y-6">
      {/* ── Tab bar ─────────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-sand">
        {(["active", "submitted", "archived", "trash"] as const).map((view) => (
          <button
            key={view}
            onClick={() => { setTaskView(view); setSelectedTaskIds([]); }}
            className={`px-4 py-2 text-[13px] font-semibold border-b-2 -mb-px transition-colors capitalize ${
              taskView === view
                ? "border-terracotta text-terracotta"
                : "border-transparent text-stone hover:text-espresso"
            }`}
          >
            {view === "active" ? "Active" : view === "submitted" ? "Submitted" : view === "archived" ? "Archived" : "Trash"}
          </button>
        ))}
      </div>

      {/* ── Header row ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {taskView !== "submitted" && (
          <div ref={filterRef} className="flex items-center gap-2 flex-wrap">
            <FilterDropdown
              label="Task Name"
              options={taskNameFilterOptions.map(taskName => ({ value: taskName, label: taskName }))}
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
              options={objectiveFilterOptions.map(objective => ({ value: objective, label: objective }))}
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
              label="Member"
              options={activeProfiles.map(p => ({ value: p.id, label: p.full_name || p.username || p.id }))}
              selected={filterVaIds}
              onChange={setFilterVaIds}
              isOpen={openFilter === "va"}
              onToggle={() => setOpenFilter(openFilter === "va" ? null : "va")}
            />
            <FilterDropdown
              label="Status"
              options={STATUS_OPTIONS.filter(o => o.value !== "").map(o => ({ value: o.value as string, label: o.label }))}
              selected={filterStatuses}
              onChange={setFilterStatuses}
              isOpen={openFilter === "status"}
              onToggle={() => setOpenFilter(openFilter === "status" ? null : "status")}
            />
            <FilterDropdown
              label="Account"
              options={KNOWN_ACCOUNTS.map(a => ({ value: a, label: a }))}
              selected={filterAccounts}
              onChange={setFilterAccounts}
              isOpen={openFilter === "account"}
              onToggle={() => setOpenFilter(openFilter === "account" ? null : "account")}
            />
            {(filterVaIds.length > 0 || filterStatuses.length > 0 || filterAccounts.length > 0 || filterTaskNames.length > 0 || filterObjectives.length > 0 || filterDueStart || filterDueEnd) && (
              <button
                onClick={() => { setFilterVaIds([]); setFilterStatuses([]); setFilterAccounts([]); setFilterTaskNames([]); setFilterObjectives([]); setFilterDueStart(""); setFilterDueEnd(""); setTaskNameSearch(""); }}
                className="text-[12px] text-stone hover:text-terracotta hover:underline cursor-pointer"
              >
                Clear all
              </button>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {taskView === "active" && (
            <button
              onClick={() => {
                setShowCsvModal(true);
                setCsvRows([]);
                setCsvResult(null);
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-sand px-4 py-2.5 text-[13px] font-semibold text-walnut cursor-pointer transition-all hover:border-walnut"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
              Bulk Upload (CSV)
            </button>
          )}

          {taskView === "active" && (
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2.5 text-[13px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840]"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Create Task
            </button>
          )}
        </div>
      </div>

      {/* ── Bulk action bar ─────────────────────────────────────────────────────── */}
      {selectedTaskIds.length > 0 && taskView === "active" && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
          <span className="text-[13px] font-semibold text-amber-700">{selectedTaskIds.length} selected</span>
          <button
            onClick={handleBulkArchive}
            className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-white border border-sand text-walnut hover:border-walnut transition-colors cursor-pointer"
          >
            Archive Selected
          </button>
          <button
            onClick={handleBulkTrash}
            className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-white border border-sand text-terracotta hover:border-terracotta transition-colors cursor-pointer"
          >
            Move to Trash
          </button>
          <button
            onClick={() => setSelectedTaskIds([])}
            className="ml-auto text-[12px] text-stone hover:text-espresso cursor-pointer"
          >
            Clear
          </button>
        </div>
      )}

      {/* ── Trash warning banner ─────────────────────────────────────────────────── */}
      {taskView === "trash" && !loading && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl">
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 text-red-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span className="text-[13px] text-red-700 font-medium">Tasks in trash can be restored or permanently deleted.</span>
          </div>
          {tasks.length > 0 && (
            <button
              onClick={handleEmptyTrash}
              className="text-[12px] font-semibold text-red-600 hover:text-red-800 underline cursor-pointer shrink-0"
            >
              Empty Trash ({tasks.length})
            </button>
          )}
        </div>
      )}

      {/* ── Loading skeleton ────────────────────────────────────────────────────── */}
      {loading && (
        <div className="rounded-xl border border-sand bg-white overflow-hidden shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="bg-parchment border-b border-sand">
                <th className="text-[11px] font-semibold text-walnut uppercase tracking-wider px-3 py-2.5 text-left w-8"></th>
                <th className="text-[11px] font-semibold text-walnut uppercase tracking-wider px-3 py-2.5 text-left">Task Name</th>
                <th className="text-[11px] font-semibold text-walnut uppercase tracking-wider px-3 py-2.5 text-left">Account</th>
                <th className="text-[11px] font-semibold text-walnut uppercase tracking-wider px-3 py-2.5 text-left">Objective</th>
                <th className="text-[11px] font-semibold text-walnut uppercase tracking-wider px-3 py-2.5 text-left">Detail</th>
                <th className="text-[11px] font-semibold text-walnut uppercase tracking-wider px-3 py-2.5 text-left">Assigned To</th>
                <th className="text-[11px] font-semibold text-walnut uppercase tracking-wider px-3 py-2.5 text-left">Status</th>
                <th className="text-[11px] font-semibold text-walnut uppercase tracking-wider px-3 py-2.5 text-left">Due Date</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3].map((i) => (
                <tr key={i} className="border-b border-sand last:border-0">
                  <td className="px-3 py-3"><div className="animate-pulse bg-sand/50 rounded h-4 w-4" /></td>
                  <td className="px-3 py-3"><div className="animate-pulse bg-sand/50 rounded h-4 w-48" /></td>
                  <td className="px-3 py-3"><div className="animate-pulse bg-sand/50 rounded h-4 w-28" /></td>
                  <td className="px-3 py-3"><div className="animate-pulse bg-sand/50 rounded h-4 w-24" /></td>
                  <td className="px-3 py-3"><div className="animate-pulse bg-sand/50 rounded h-4 w-32" /></td>
                  <td className="px-3 py-3"><div className="animate-pulse bg-sand/50 rounded h-4 w-32" /></td>
                  <td className="px-3 py-3"><div className="animate-pulse bg-sand/50 rounded h-4 w-20" /></td>
                  <td className="px-3 py-3"><div className="animate-pulse bg-sand/50 rounded h-4 w-20" /></td>
                  <td className="px-3 py-3"></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Fetch error ─────────────────────────────────────────────────────────── */}
      {!loading && fetchError && (
        <div className="rounded-xl border border-sand bg-white p-5 shadow-sm text-center">
          <p className="text-sm text-red-500">{fetchError}</p>
          <button
            onClick={fetchTasks}
            className="mt-2 text-xs text-terracotta hover:underline cursor-pointer"
          >
            Try again
          </button>
        </div>
      )}

      {/* ── Empty state ─────────────────────────────────────────────────────────── */}
      {!loading && !fetchError && filteredTasks.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm font-medium text-espresso">
            {tasks.length === 0 ? "No tasks assigned yet" : "No tasks match your filters"}
          </p>
          <p className="mt-1 text-xs text-stone">
            {tasks.length === 0
              ? "Click \"Create Task\" to assign the first task."
              : "Try adjusting your filters."}
          </p>
        </div>
      )}

      {/* ── Task table ──────────────────────────────────────────────────────────── */}
      {!loading && !fetchError && filteredTasks.length > 0 && (
        <div className="rounded-xl border border-sand bg-white overflow-hidden shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="bg-parchment border-b border-sand">
                <th className="px-3 py-2.5 w-8">
                  {taskView === "active" && (
                    <input
                      type="checkbox"
                      className="accent-terracotta cursor-pointer"
                      checked={selectedTaskIds.length === filteredTasks.length && filteredTasks.length > 0}
                      onChange={e => setSelectedTaskIds(e.target.checked ? filteredTasks.map(t => t.id) : [])}
                    />
                  )}
                </th>
                <th className="text-[11px] font-semibold text-walnut uppercase tracking-wider px-3 py-2.5 text-left">Task Name</th>
                <th className="text-[11px] font-semibold text-walnut uppercase tracking-wider px-3 py-2.5 text-left">Account</th>
                <th className="text-[11px] font-semibold text-walnut uppercase tracking-wider px-3 py-2.5 text-left">Objective</th>
                <th className="text-[11px] font-semibold text-walnut uppercase tracking-wider px-3 py-2.5 text-left">Detail</th>
                <th className="text-[11px] font-semibold text-walnut uppercase tracking-wider px-3 py-2.5 text-left">Assigned To</th>
                <th className="text-[11px] font-semibold text-walnut uppercase tracking-wider px-3 py-2.5 text-left">Status</th>
                <th className="text-[11px] font-semibold text-walnut uppercase tracking-wider px-3 py-2.5 text-left">Due Date</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.map((task) => {
                const dueSoon = isDueSoon(task.due_date);
                const pastDue = isPastDue(task.due_date);
                const dueDateDisplay = fmtDueDate(task.due_date, orgTimezone);
                const assignees = task.assigned_task_assignees;
                const visibleAssignees = assignees.slice(0, 2);
                const extraCount = assignees.length - 2;

                return (
                  <tr
                    key={task.id}
                    className="border-b border-sand last:border-0 hover:bg-parchment/30 transition-colors cursor-pointer group"
                    onClick={() => openEdit(task)}
                  >
                    {/* Checkbox / Expand icon */}
                    <td className="px-3 py-3 w-8" onClick={e => e.stopPropagation()}>
                      {taskView === "active" ? (
                        <input
                          type="checkbox"
                          className="accent-terracotta cursor-pointer"
                          checked={selectedTaskIds.includes(task.id)}
                          onChange={e => {
                            if (e.target.checked) setSelectedTaskIds(ids => [...ids, task.id]);
                            else setSelectedTaskIds(ids => ids.filter(id => id !== task.id));
                          }}
                        />
                      ) : (
                        <button
                          className="flex items-center justify-center w-6 h-6 rounded text-stone hover:text-walnut hover:bg-sand/50 transition-colors"
                          onClick={() => openEdit(task)}
                        >
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                            <polyline points="15 3 21 3 21 9" />
                            <line x1="10" y1="14" x2="21" y2="3" />
                          </svg>
                        </button>
                      )}
                    </td>

                    {/* Task Name */}
                    <InlineCell
                      task={task}
                      field="task_name"
                      display={task.task_name}
                    />

                    {/* Account */}
                    <InlineCell
                      task={task}
                      field="account"
                      display={task.account || ""}
                    />

                    {/* Objective */}
                    <InlineCell
                      task={task}
                      field="project"
                      display={task.project || ""}
                    />

                    {/* Detail preview */}
                    <td
                      className="px-3 py-3 text-[13px] max-w-[180px] cursor-pointer"
                      onClick={() => openEdit(task)}
                    >
                      {task.task_detail ? (
                        <span className="text-stone/70 block truncate" title={task.task_detail}>
                          {task.task_detail.length > 45
                            ? task.task_detail.slice(0, 45) + "…"
                            : task.task_detail}
                        </span>
                      ) : (
                        <span className="text-stone/30">—</span>
                      )}
                    </td>

                    {/* Assigned To — inline multi-select */}
                    <td
                      ref={assignedToEdit?.taskId === task.id ? assignedToEditRef : null}
                      className="px-3 py-3 text-[13px] cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        setAssignedToEdit({ taskId: task.id });
                      }}
                    >
                      {assignedToEdit?.taskId === task.id ? (
                        <VAMultiSelect
                          activeProfiles={activeProfiles}
                          selectedIds={assignees.map((a) => a.va_id)}
                          onChange={(ids) => void handleAssignedToChange(task.id, ids)}
                          selectedTask={task}
                        />
                      ) : (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {visibleAssignees.map((a) => {
                            const name = a.profiles?.full_name || a.profiles?.username || a.va_id;
                            return (
                              <span
                                key={a.id}
                                className="inline-flex items-center gap-1 text-[12px] text-walnut"
                              >
                                {name}
                              </span>
                            );
                          })}
                          {extraCount > 0 && (
                            <span className="text-[11px] text-stone">+{extraCount} more</span>
                          )}
                          {assignees.length === 0 && (
                            <span className="text-[11px] text-stone/40">—</span>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Status — clickable per-assignee badge */}
                    <td className="px-3 py-3 text-[13px]" onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-wrap gap-1">
                        {assignees.length === 0 && (
                          taskStatusEdit?.taskId === task.id ? (
                            <select
                              autoFocus
                              value={task.status}
                              disabled={statusSaving}
                              onChange={(e) =>
                                void handleTaskLevelStatusChange(
                                  task.id,
                                  e.target.value as AssignedTaskStatus
                                )
                              }
                              onBlur={() => setTaskStatusEdit(null)}
                              className="text-[11px] border border-sand rounded-lg px-2 py-1 outline-none focus:border-terracotta cursor-pointer bg-white"
                            >
                              {ASSIGNEE_STATUS_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <button
                              type="button"
                              title="Unassigned task — click to change status"
                              onClick={() => setTaskStatusEdit({ taskId: task.id })}
                              disabled={statusSaving}
                              className="cursor-pointer hover:opacity-75 transition-opacity disabled:opacity-40"
                            >
                              <StatusBadge status={task.status} />
                            </button>
                          )
                        )}
                        {assignees.map((a) => {
                          const isEditing =
                            statusEdit?.taskId === task.id && statusEdit?.vaId === a.va_id;
                          const vaName = a.profiles?.full_name || a.profiles?.username || "VA";
                          if (isEditing) {
                            return (
                              <select
                                key={a.id}
                                autoFocus
                                value={a.status}
                                disabled={statusSaving}
                                onChange={(e) =>
                                  handleStatusChange(
                                    task.id,
                                    a.va_id,
                                    e.target.value as AssignedTaskStatus
                                  )
                                }
                                onBlur={() => setStatusEdit(null)}
                                className="text-[11px] border border-sand rounded-lg px-2 py-1 outline-none focus:border-terracotta cursor-pointer bg-white"
                              >
                                {ASSIGNEE_STATUS_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            );
                          }
                          return (
                            <button
                              key={a.id}
                              type="button"
                              title={`${vaName} — click to change`}
                              onClick={() => setStatusEdit({ taskId: task.id, vaId: a.va_id })}
                              disabled={statusSaving}
                              className="cursor-pointer hover:opacity-75 transition-opacity disabled:opacity-40"
                            >
                              <StatusBadge status={a.status} />
                            </button>
                          );
                        })}
                      </div>
                    </td>

                    {/* Due Date */}
                    <InlineCell
                      task={task}
                      field="due_date"
                      display={
                        task.due_date
                          ? `${dueDateDisplay}${pastDue ? " · Past Due" : dueSoon ? " · Soon" : ""}`
                          : ""
                      }
                      inputType="date"
                    />

                    {/* Archive / Trash / Restore / Permanent Delete */}
                    <td className="px-2 py-3 w-16 text-right" onClick={(e) => e.stopPropagation()}>
                      {taskView === "active" && (
                        <div className="opacity-0 group-hover:opacity-100 flex items-center justify-end gap-1 transition-all">
                          <button
                            onClick={() => handleArchive(task.id)}
                            disabled={!!deleting[task.id]}
                            className="flex items-center justify-center w-6 h-6 rounded text-stone hover:text-amber-600 hover:bg-amber-50 transition-all cursor-pointer"
                            title="Archive task"
                          >
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="21 8 21 21 3 21 3 8"/>
                              <rect x="1" y="3" width="22" height="5"/>
                              <line x1="10" y1="12" x2="14" y2="12"/>
                            </svg>
                          </button>
                          <button
                            onClick={() => handleTrash(task.id)}
                            disabled={!!deleting[task.id]}
                            className="flex items-center justify-center w-6 h-6 rounded text-stone hover:text-terracotta hover:bg-terracotta-soft transition-all cursor-pointer"
                            title="Move to trash"
                          >
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" />
                            </svg>
                          </button>
                        </div>
                      )}
                      {taskView === "archived" && (
                        <div className="opacity-0 group-hover:opacity-100 flex items-center justify-end gap-1 transition-all">
                          <button
                            onClick={() => handleRestore(task.id)}
                            disabled={!!deleting[task.id]}
                            className="flex items-center justify-center w-6 h-6 rounded text-stone hover:text-sage hover:bg-sage-soft transition-all cursor-pointer"
                            title="Restore task"
                          >
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.08"/></svg>
                          </button>
                          <button
                            onClick={() => handleTrash(task.id)}
                            disabled={!!deleting[task.id]}
                            className="flex items-center justify-center w-6 h-6 rounded text-stone hover:text-terracotta hover:bg-terracotta-soft transition-all cursor-pointer"
                            title="Move to trash"
                          >
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                          </button>
                        </div>
                      )}
                      {taskView === "trash" && (
                        <div className="opacity-0 group-hover:opacity-100 flex items-center justify-end gap-1 transition-all">
                          <button
                            onClick={() => handleRestore(task.id)}
                            disabled={!!deleting[task.id]}
                            className="flex items-center justify-center w-6 h-6 rounded text-stone hover:text-sage hover:bg-sage-soft transition-all cursor-pointer"
                            title="Restore task"
                          >
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.08"/></svg>
                          </button>
                          <button
                            onClick={() => handlePermanentDelete(task.id)}
                            disabled={!!deleting[task.id]}
                            className="flex items-center justify-center w-6 h-6 rounded text-stone hover:text-red-600 hover:bg-red-50 transition-all cursor-pointer"
                            title="Delete permanently"
                          >
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Detail Panel ────────────────────────────────────────────────────────── */}
      {isPanelOpen && (
        <div className="fixed top-0 right-0 h-full w-[520px] max-w-full z-40 bg-white border-l border-sand shadow-2xl flex flex-col overflow-hidden">
            {/* Header */}
            <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-sand">
              <div className="flex items-center gap-2">
                <button
                  onClick={closePanel}
                  className="flex items-center justify-center w-7 h-7 rounded text-stone hover:text-espresso hover:bg-sand/50 transition-colors cursor-pointer"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="19" y1="12" x2="5" y2="12" />
                    <polyline points="12 19 5 12 12 5" />
                  </svg>
                </button>
                <span className="text-[13px] font-semibold text-walnut">
                  {isCreating ? "New Task" : "Task Detail"}
                </span>
              </div>

              {selectedTask && (
                <button
                  onClick={() => handleDelete(selectedTask.id)}
                  disabled={!!deleting[selectedTask.id]}
                  className="flex items-center justify-center w-7 h-7 rounded text-terracotta hover:bg-terracotta-soft transition-colors cursor-pointer disabled:opacity-40"
                  title="Delete task"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4h6v2" />
                  </svg>
                </button>
              )}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">

              {/* Account */}
              <div>
                <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide uppercase">
                  Account
                </label>
                <select
                  value={detailForm.account}
                  onChange={(e) => {
                    const newAccount = e.target.value;
                    setDetailForm((f) => ({
                      ...f,
                      account: newAccount,
                      project: "",
                      task_name: "",
                    }));
                  }}
                  className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta cursor-pointer"
                >
                  <option value="">Select account...</option>
                  {accountsForPanel.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>

              {/* Objective */}
              <div>
                <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide uppercase">
                  Objective
                </label>
                {detailObjectivesForAccount.length > 0 ? (
                  <select
                    value={detailForm.project}
                    onChange={(e) => {
                      setDetailForm((f) => ({
                        ...f,
                        project: e.target.value,
                        task_name: "",
                      }));
                    }}
                    disabled={!detailForm.account}
                    className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta cursor-pointer disabled:opacity-60 disabled:bg-parchment"
                  >
                    <option value="">
                      {!detailForm.account ? "Select account first..." : "Select objective..."}
                    </option>
                    {detailObjectivesForAccount.map((p) => (
                      <option key={p.id} value={p.project_name}>{p.project_name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={detailForm.project}
                    onChange={(e) =>
                      setDetailForm((f) => ({ ...f, project: e.target.value, task_name: "" }))
                    }
                    placeholder="Objective name"
                    className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
                  />
                )}
              </div>

              {/* Task Name */}
              <div>
                <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide uppercase">
                  Task Name <span className="text-terracotta">*</span>
                </label>
                <select
                  value={detailForm.task_name}
                  onChange={(e) =>
                    setDetailForm((f) => ({ ...f, task_name: e.target.value }))
                  }
                  disabled={!detailForm.project}
                  className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta cursor-pointer disabled:opacity-60 disabled:bg-parchment"
                >
                  <option value="">{detailForm.project ? "Select task..." : "Select objective first..."}</option>
                  {detailTasksForObjective.map((t) => (
                    <option key={t.id} value={t.task_name}>{t.task_name}</option>
                  ))}
                </select>
              </div>

              {/* Due Date */}
              <div>
                <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide uppercase">
                  Due Date
                </label>
                <input
                  type="date"
                  value={detailForm.due_date}
                  onChange={(e) => setDetailForm((f) => ({ ...f, due_date: e.target.value }))}
                  className="py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta cursor-pointer"
                />
              </div>

              {/* Assigned By */}
              <div>
                <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide uppercase">
                  Assigned By
                </label>
                <select
                  value={detailForm.assigned_by_id}
                  onChange={(e) => setDetailForm((f) => ({ ...f, assigned_by_id: e.target.value }))}
                  className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta cursor-pointer"
                >
                  <option value="">Select assigned by...</option>
                  {assignedByOptions.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.full_name || profile.username}
                    </option>
                  ))}
                </select>
              </div>

              {/* Detail (small / single-line) */}
              <div>
                <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide uppercase">
                  Detail
                </label>
                <input
                  type="text"
                  value={detailForm.task_detail}
                  onChange={(e) => setDetailForm((f) => ({ ...f, task_detail: e.target.value }))}
                  placeholder="Short summary or reference..."
                  className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta"
                />
              </div>

              {/* Notes (larger) */}
              <div>
                <label className="block text-[11px] font-semibold text-walnut mb-1 tracking-wide uppercase">
                  Notes
                </label>
                <textarea
                  value={detailForm.task_notes}
                  onChange={(e) => setDetailForm((f) => ({ ...f, task_notes: e.target.value }))}
                  rows={5}
                  placeholder="Detailed instructions, context, links, or anything the VA needs to know..."
                  className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta resize-none"
                />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between gap-3">
                  <label className="block text-[11px] font-semibold text-walnut tracking-wide uppercase">Instructions</label>
                  <label className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-stone">
                    <input
                      type="checkbox"
                      checked={detailForm.instructions_locked}
                      onChange={(e) => setDetailForm((f) => ({ ...f, instructions_locked: e.target.checked }))}
                      className="h-4 w-4 rounded border-sand text-terracotta focus:ring-terracotta"
                    />
                    Locked
                  </label>
                </div>
                <textarea
                  value={detailForm.instructions}
                  onChange={(e) => setDetailForm((f) => ({ ...f, instructions: e.target.value }))}
                  rows={5}
                  placeholder="Add instructions for the assignee..."
                  className="w-full py-2 px-3 border border-sand rounded-lg text-[13px] text-ink bg-white outline-none focus:border-terracotta resize-none"
                />
              </div>

              {/* Assignees */}
              {isCreating && (
                <div>
                  <label className="block text-[11px] font-semibold text-walnut mb-2 tracking-wide uppercase">
                    Status
                  </label>
                  <select
                    value={detailForm.initial_status}
                    onChange={(e) =>
                      setDetailForm((f) => ({
                        ...f,
                        initial_status: e.target.value as AssignedTaskStatus,
                      }))
                    }
                    className="min-w-[140px] rounded-lg border border-sand bg-white px-2 py-1 text-[11px] outline-none transition-colors focus:border-terracotta cursor-pointer"
                  >
                    {ASSIGNEE_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-[11px] font-semibold text-walnut mb-2 tracking-wide uppercase">
                  Assigned To <span className="text-terracotta">*</span>
                </label>
                {activeProfiles.length === 0 ? (
                  <p className="text-[12px] text-stone">No active members available</p>
                ) : (
                  <VAMultiSelect
                    activeProfiles={activeProfiles}
                    selectedIds={detailForm.assignee_ids}
                    onChange={(ids) => setDetailForm((f) => ({ ...f, assignee_ids: ids }))}
                    selectedTask={selectedTask}
                  />
                )}
              </div>

              {/* Status — only visible when editing an existing task */}
              {selectedTask && (
                <div>
                  <label className="block text-[11px] font-semibold text-walnut mb-2 tracking-wide uppercase">
                    Status
                  </label>
                  {selectedTask.assigned_task_assignees.length === 0 ? (
                    taskStatusEdit?.taskId === selectedTask.id ? (
                      <select
                        autoFocus
                        value={selectedTask.status}
                        disabled={statusSaving}
                        onChange={(e) =>
                          void handleTaskLevelStatusChange(
                            selectedTask.id,
                            e.target.value as AssignedTaskStatus
                          )
                        }
                        onBlur={() => setTaskStatusEdit(null)}
                        className="min-w-[140px] rounded-lg border border-sand bg-white px-2 py-1 text-[11px] outline-none transition-colors focus:border-terracotta cursor-pointer disabled:opacity-60"
                      >
                        {ASSIGNEE_STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <button
                        type="button"
                        title="Unassigned task — click to change status"
                        onClick={() => setTaskStatusEdit({ taskId: selectedTask.id })}
                        disabled={statusSaving}
                        className="cursor-pointer hover:opacity-75 transition-opacity disabled:opacity-40"
                      >
                        <StatusBadge status={selectedTask.status} />
                      </button>
                    )
                  ) : (
                    <div className="space-y-2">
                      {selectedTask.assigned_task_assignees.map((assignee) => {
                        const assigneeName =
                          assignee.profiles?.full_name || assignee.profiles?.username || assignee.va_id;

                        return (
                          <div
                            key={assignee.id}
                            className="flex items-center gap-3 rounded-lg border border-sand bg-parchment/30 px-3 py-2"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[12px] font-medium text-walnut">{assigneeName}</p>
                            </div>
                            <select
                              value={assignee.status}
                              disabled={statusSaving}
                              onChange={(e) =>
                                void handleStatusChange(
                                  selectedTask.id,
                                  assignee.va_id,
                                  e.target.value as AssignedTaskStatus
                                )
                              }
                              className="min-w-[140px] rounded-lg border border-sand bg-white px-2 py-1 text-[11px] outline-none transition-colors focus:border-terracotta cursor-pointer disabled:opacity-60"
                            >
                              {ASSIGNEE_STATUS_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Screenshots — only visible when editing an existing task */}
              {selectedTask && (
                <div className="mb-5">
                  <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-walnut">Screenshots</label>
                  {panelScreenshotsLoading ? (
                    <div className="flex items-center gap-2 py-3 text-[12px] text-stone">
                      <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                      </svg>
                      Loading screenshots...
                    </div>
                  ) : panelScreenshots.length === 0 ? (
                    <p className="py-2 text-[12px] text-stone/50">No screenshots yet.</p>
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
              )}

              {/* Attachments — only visible when editing an existing task */}
              {selectedTask && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-[11px] font-semibold text-walnut tracking-wide uppercase">
                      Attachments
                    </label>
                    <label className={`inline-flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer rounded-lg px-3 py-1.5 transition-all ${
                      uploadingFile
                        ? "bg-parchment text-stone cursor-not-allowed"
                        : "bg-parchment border border-sand text-walnut hover:border-walnut"
                    }`}>
                      {uploadingFile ? (
                        <>
                          <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                          </svg>
                          Uploading...
                        </>
                      ) : (
                        <>
                          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                          </svg>
                          Upload File
                        </>
                      )}
                      <input
                        ref={attachmentInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        disabled={uploadingFile}
                        onChange={handleFileUpload}
                      />
                    </label>
                  </div>

                  {attachmentsLoading ? (
                    <div className="flex items-center gap-2 py-3 text-[12px] text-stone">
                      <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                      </svg>
                      Loading attachments...
                    </div>
                  ) : attachments.length === 0 ? (
                    <p className="text-[12px] text-stone/50 py-2">No attachments yet.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {attachments.map((att) => (
                        <div
                          key={att.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-sand px-3 py-2 bg-parchment/40 group/att"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <svg className="h-3.5 w-3.5 shrink-0 text-stone" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <polyline points="14 2 14 8 20 8" />
                            </svg>
                            <div className="min-w-0">
                              {att.url ? (
                                <a
                                  href={att.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[12px] text-terracotta hover:underline truncate block max-w-[280px]"
                                  title={att.filename}
                                >
                                  {att.filename}
                                </a>
                              ) : (
                                <span className="text-[12px] text-walnut truncate block max-w-[280px]">
                                  {att.filename}
                                </span>
                              )}
                              {att.file_size && (
                                <span className="text-[10px] text-stone">
                                  {formatFileSize(att.file_size)}
                                </span>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => handleDeleteAttachment(att.id)}
                            className="opacity-0 group-hover/att:opacity-100 flex items-center justify-center w-5 h-5 rounded text-stone hover:text-terracotta transition-all cursor-pointer shrink-0"
                            title="Delete attachment"
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
              )}

            </div>

            {/* Footer */}
            <div className="shrink-0 px-5 py-4 border-t border-sand flex items-center justify-between">
              <div>
                {selectedTask?.created_at && (
                  <span className="text-[11px] text-stone">
                    Created {new Date(selectedTask.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                {detailSaveMsg && (
                  <p
                    className={`text-xs font-medium ${
                      detailSaveMsg.type === "err" ? "text-red-500" : "text-sage"
                    }`}
                  >
                    {detailSaveMsg.text}
                  </p>
                )}
                <div className="flex items-center gap-3">
                  <button
                    onClick={closePanel}
                    className="text-xs text-stone hover:text-espresso cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDetailSave}
                    disabled={detailSaving || !detailForm.task_name.trim()}
                    className="rounded-lg bg-terracotta px-5 py-2 text-[13px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {detailSaving
                      ? "Saving..."
                      : isCreating
                      ? "Create Task"
                      : "Save Changes"}
                  </button>
                </div>
              </div>
            </div>
        </div>
      )}

      {/* ── CSV Modal ───────────────────────────────────────────────────────────── */}
      {showCsvModal && (
        <CsvModal
          activeProfiles={activeProfiles}
          csvRows={csvRows}
          csvUploading={csvUploading}
          csvResult={csvResult}
          fileRef={csvFileRef}
          onFileChange={handleCsvFile}
          onUpload={handleCsvUpload}
          onClose={() => {
            setShowCsvModal(false);
            setCsvRows([]);
            setCsvResult(null);
          }}
        />
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
    </div>
  );
}

// ─── CSV Modal ────────────────────────────────────────────────────────────────

interface CsvModalProps {
  activeProfiles: Profile[];
  csvRows: CsvRow[];
  csvUploading: boolean;
  csvResult: string | null;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onUpload: () => void;
  onClose: () => void;
}

function CsvModal({
  activeProfiles,
  csvRows,
  csvUploading,
  csvResult,
  fileRef,
  onFileChange,
  onUpload,
  onClose,
}: CsvModalProps) {
  void activeProfiles;
  const validCount = csvRows.filter((r) => r._valid).length;
  const invalidCount = csvRows.filter((r) => !r._valid).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl flex flex-col max-h-[90vh]">
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-sand shrink-0">
          <h2 className="text-sm font-bold text-espresso">Bulk Upload Tasks (CSV)</h2>
          <button
            onClick={onClose}
            className="text-stone hover:text-espresso cursor-pointer"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Modal body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Format instructions */}
          <div className="rounded-lg bg-parchment border border-sand p-4 space-y-2">
            <p className="text-[12px] font-semibold text-walnut">CSV Format</p>
            <p className="text-[11px] text-stone leading-relaxed">
              First row must be the header. Columns in order:
            </p>
            <code className="block text-[11px] bg-white border border-sand rounded px-3 py-2 text-bark font-mono">
              task_name, account, project, task_detail, due_date, va_usernames
            </code>
            <ul className="text-[11px] text-stone space-y-1 pl-4 list-disc">
              <li><strong>task_name</strong> — required</li>
              <li><strong>account</strong> — optional (e.g. TAT Foundation)</li>
              <li><strong>project</strong> — optional</li>
              <li><strong>task_detail</strong> — optional short description</li>
              <li><strong>due_date</strong> — optional, format YYYY-MM-DD</li>
              <li>
                <strong>va_usernames</strong> — optional, comma-separated VA usernames
                inside quotes. E.g.{" "}
                <code className="font-mono bg-sand/50 px-1 rounded">&quot;alice,bob&quot;</code>
              </li>
            </ul>
            <p className="text-[11px] text-stone">
              Example row:{" "}
              <code className="font-mono bg-sand/50 px-1 rounded text-[10px]">
                Design landing page,TAT Foundation,Website,,2026-06-20,&quot;alice,bob&quot;
              </code>
            </p>
          </div>

          {/* File picker */}
          {csvRows.length === 0 && (
            <label className="flex items-center gap-2 cursor-pointer w-fit rounded-lg border border-sand px-4 py-2.5 text-[13px] text-walnut hover:border-walnut transition-all">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Choose CSV file
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={onFileChange}
              />
            </label>
          )}

          {/* Preview table */}
          {csvRows.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[12px] font-semibold text-walnut">
                  Preview — {csvRows.length} row(s)
                  {validCount > 0 && (
                    <span className="text-sage ml-2">{validCount} valid</span>
                  )}
                  {invalidCount > 0 && (
                    <span className="text-terracotta ml-2">{invalidCount} invalid</span>
                  )}
                </p>
                <label className="text-[11px] text-terracotta hover:underline cursor-pointer">
                  Replace file
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={onFileChange}
                  />
                </label>
              </div>

              <div className="overflow-x-auto rounded-lg border border-sand">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="bg-parchment border-b border-sand">
                      <th className="text-left px-3 py-2 text-walnut font-semibold">Task</th>
                      <th className="text-left px-3 py-2 text-walnut font-semibold">Account</th>
                      <th className="text-left px-3 py-2 text-walnut font-semibold">Due</th>
                      <th className="text-left px-3 py-2 text-walnut font-semibold">VAs</th>
                      <th className="text-left px-3 py-2 text-walnut font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {csvRows.map((row, i) => (
                      <tr
                        key={i}
                        className={`border-b border-sand last:border-0 ${
                          row._valid ? "" : "bg-red-50"
                        }`}
                      >
                        <td className="px-3 py-2 text-ink font-medium">
                          {row.task_name || <span className="text-stone italic">empty</span>}
                        </td>
                        <td className="px-3 py-2 text-bark">{row.account || "—"}</td>
                        <td className="px-3 py-2 text-bark">{row.due_date || "—"}</td>
                        <td className="px-3 py-2 text-bark">
                          {row.va_usernames.length > 0
                            ? row.va_usernames.join(", ")
                            : "—"}
                        </td>
                        <td className="px-3 py-2">
                          {row._valid ? (
                            <span className="text-sage font-semibold">OK</span>
                          ) : (
                            <span className="text-red-500">{row._error || "Invalid"}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Result message */}
          {csvResult && (
            <div
              className={`rounded-lg px-4 py-3 text-[12px] whitespace-pre-wrap ${
                csvResult.includes("Error")
                  ? "bg-red-50 text-red-600"
                  : "bg-sage-soft text-sage"
              }`}
            >
              {csvResult}
            </div>
          )}
        </div>

        {/* Modal footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-sand shrink-0">
          <button
            onClick={onClose}
            className="text-xs text-stone hover:text-espresso cursor-pointer"
          >
            Cancel
          </button>

          {csvRows.length > 0 && validCount > 0 && (
            <button
              onClick={onUpload}
              disabled={csvUploading}
              className="rounded-lg bg-terracotta px-5 py-2.5 text-[13px] font-semibold text-white cursor-pointer transition-all hover:bg-[#a85840] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {csvUploading
                ? "Uploading..."
                : `Upload ${validCount} Task${validCount !== 1 ? "s" : ""}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
