"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { assignedTaskWindow } from "@/lib/assignedTaskWindow";
import { hasBroadAdminAccess } from "@/lib/financialAccess";
import type { AssignedTask, AssignedTaskStatus, Project, TaskScreenshot } from "@/types/database";
import { normalizePosition } from "@/types/database";
import AvailableTasksWidget from "@/components/AvailableTasksWidget";
import JobOrdersSection from "@/components/JobOrdersSection";
import TaskEditor, { type TaskEditorHandle, type TaskEditorInitialTask } from "@/components/TaskEditor";
import TaskDetailsView from "@/components/TaskDetailsView";
import Section from "@/components/ui/Section";
import FixedPayTasksPanel from "@/components/FixedPayTasksPanel";
import ProjectInfoModal from "@/components/ProjectInfoModal";
import ConfirmModal from "@/components/ConfirmModal";
import { useToast } from "@/contexts/ToastProvider";
import ScreenshotLightbox from "@/components/ScreenshotLightbox";
import { useScreenCapture } from "@/hooks/useScreenCapture";
import RecurringTemplatesManager from "@/components/RecurringTemplatesManager";
import TeamWorkloadView from "@/components/TeamWorkloadView";
import ObjectiveProgressView from "@/components/ObjectiveProgressView";
import type { RecurringTaskTemplate } from "@/types/database";
import { countWords } from "@/lib/utils";
import { CATEGORY_OPTIONS, collapseRecurringSeriesBy, DUE_DATE_FINISHED_STATUSES } from "@/lib/taskSchedule";
import ColumnHeader from "@/components/table/ColumnHeader";
import RevisionBadge from "@/components/RevisionBadge";
import RecurringBadge from "@/components/RecurringBadge";
import ColumnVisibilityPicker from "@/components/table/ColumnVisibilityPicker";
import { useColumnPrefs, type ColumnDef } from "@/components/table/useColumnPrefs";
import { useUrlTab } from "@/hooks/useUrlTab";

const TABLE_COLUMNS: ColumnDef[] = [
  { key: "task_name", label: "Task Name", defaultWidth: 200 },
  { key: "account", label: "Account", defaultWidth: 140 },
  { key: "assigned_by", label: "Assigned By", defaultWidth: 140 },
  { key: "objective", label: "Project", defaultWidth: 140 },
  { key: "detail", label: "Client Detail", defaultWidth: 180 },
  { key: "status", label: "Status", defaultWidth: 150 },
  { key: "accuracy", label: "Accuracy", defaultWidth: 100 },
  { key: "submitted_by", label: "Submitted By", defaultWidth: 150 },
  { key: "start_date", label: "Start Date", defaultWidth: 130 },
  { key: "due_date", label: "Due Date", defaultWidth: 130 },
  { key: "created", label: "Created", defaultWidth: 130 },
];

const CLIENT_MEMO_WORD_LIMIT = 15;

function limitToWords(text: string, limit: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= limit) return text;
  return words.slice(0, limit).join(" ");
}

// Toolbar multi-select filter dropdown for dimensions that don't have their own
// table column (Assigned By, Project) — mirrors ColumnHeader's caret popover so
// the filter UI stays consistent across the page.
function ToolbarFilterDropdown({ label, options, selected, onChange }: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const isFiltered = selected.length > 0;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[12px] transition-colors ${
          isFiltered ? "border-terracotta text-terracotta" : "border-sand text-stone hover:text-walnut"
        }`}
      >
        {label}
        {isFiltered && <span className="rounded-full bg-terracotta/10 px-1.5 text-[10px] font-semibold">{selected.length}</span>}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3 w-3">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 max-h-72 min-w-[200px] overflow-y-auto rounded-xl border border-sand bg-white py-1 shadow-lg">
            <div className="flex items-center justify-between border-b border-sand px-3 py-1.5">
              <button type="button" onClick={() => onChange(options)} className="text-[11px] text-terracotta hover:underline">Select All</button>
              <button type="button" onClick={() => onChange([])} className="text-[11px] text-stone hover:underline">Clear</button>
            </div>
            {options.length > 0 ? (
              options.map((opt) => (
                <label key={opt} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-parchment">
                  <input
                    type="checkbox"
                    checked={selected.includes(opt)}
                    onChange={(e) => {
                      if (e.target.checked) onChange([...selected, opt]);
                      else onChange(selected.filter((v) => v !== opt));
                    }}
                    className="accent-terracotta"
                  />
                  <span className="text-[13px] text-espresso">{opt}</span>
                </label>
              ))
            ) : (
              <div className="px-3 py-2 text-[12px] text-stone">No options</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

type VATaskRow = {
  id: number;
  va_id: string;
  status: AssignedTaskStatus;
  log_id: number | null;
  notes: string | null;
  accuracy_score: number;
  assigned_at: string | null;
  updated_at: string | null;
  is_collaborative?: boolean;
  collaborator_name?: string | null;
  profiles?: { id: string; full_name: string; username: string } | null;
  assigned_tasks: {
    id: number;
    account: string | null;
    project: string | null;
    project_id: string | null;
    category: string | null;
    task_name: string;
    task_detail: string | null;
    task_notes: string | null;
    due_date: string | null;
    start_date: string | null;
    start_time: string | null;
    end_time: string | null;
    assigned_by: string | null;
    assigned_by_profile?: { id: string; full_name: string; username: string } | null;
    instructions: string | null;
    instructions_locked: boolean;
    review_required: boolean;
    review_required_locked?: boolean;
    revision_count: number;
    /* Both mean recurring: spawned BY a template, or spawns one. */
    recurring_template_id: string | null;
    spawned_template_id: string | null;
    fixed_pay_task_id: number | null;
    fixed_pay_tasks?: { rate: number } | null;
    projects?: { id: string; name: string } | null;
    created_by: string | null;
    created_by_profile?: { id: string; full_name: string; username: string } | null;
    created_at: string;
    updated_at: string;
  };
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
  role?: string;
  position?: string;
};

type InlineEditField = "task_name" | "account" | "project" | "status" | "due_date" | "start_date";

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
  accuracy_score: number;
  assigned_at: string | null;
  updated_at: string | null;
  instructions?: string | null;
  instructions_locked?: boolean;
  profiles?: { id: string; full_name: string; username: string } | null;
};
type AdminTaskFlat = {
  id: number;
  recurring_template_id?: string | null;
  spawned_template_id?: string | null;
  account: string | null;
  project: string | null;
  project_id: string | null;
  category: string | null;
  task_name: string;
  task_detail: string | null;
  task_notes: string | null;
  due_date: string | null;
  start_date: string | null;
  start_time: string | null;
  end_time: string | null;
  review_required: boolean;
  review_required_locked?: boolean;
  revision_count?: number;
  created_by: string | null;
  created_by_profile?: { id: string; full_name: string; username: string } | null;
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

function formatDueDate(dueDate: string | null, status?: string | null) {
  if (!dueDate) return { label: "—", isOverdue: false };

  const date = parseDueDateSafe(dueDate);
  if (Number.isNaN(date.getTime())) return { label: dueDate, isOverdue: false };

  const finished = Boolean(status && DUE_DATE_FINISHED_STATUSES.has(status));
  return {
    label: date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    isOverdue: !finished && date.getTime() < Date.now(),
  };
}

function formatDateInputValue(dueDate: string | null) {
  if (!dueDate) return "";
  // Return the date portion directly — no UTC conversion needed.
  return dueDate.slice(0, 10);
}

function formatCreatedAt(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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
  const { showToast } = useToast();
  // Pilot: toast on create/update/delete, confirmation modal before any
  // delete-type action — permanent (Delete Forever, single or bulk) and the
  // softer move-to-Trash alike, per Toni's "avoid accidental deletion" — even
  // though Trash is recoverable via Restore, it still deserves a pause.
  // null = no confirmation open. See ConfirmModal.tsx / ToastProvider.tsx.
  const [pendingDelete, setPendingDelete] = useState<
    { kind: "single-permanent"; taskId: number } | { kind: "bulk-permanent" } | { kind: "bulk-trash" } | null
  >(null);
  const [deleting, setDeleting] = useState(false);

  const [tasks, setTasks] = useState<VATaskRow[]>([]);
  // Deep link from Productivity > Submissions: ?task=<id> opens that task's
  // editor once the list has loaded. Runs once per id so re-selecting or
  // closing the panel doesn't yank it back open.
  const openedFromUrlRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [taskView, setTaskView] = useUrlTab<"active" | "archived" | "trash">("status", "active", ["active", "archived", "trash"]);
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([]);
  const TASKS_PAGE_SIZE = 10;
  const [currentPage, setCurrentPage] = useState(1);
  const [filterStatuses, setFilterStatuses] = useState<AssignedTaskStatus[]>([]);
  const [filterAccounts, setFilterAccounts] = useState<string[]>([]);
  const [filterTaskNames, setFilterTaskNames] = useState<string[]>([]);
  const [filterObjectives, setFilterObjectives] = useState<string[]>([]);
  const [filterSubmittedBy, setFilterSubmittedBy] = useState<string[]>([]);
  const [filterDueStart, setFilterDueStart] = useState("");
  const [filterDueEnd, setFilterDueEnd] = useState("");
  const [filterStartStart, setFilterStartStart] = useState("");
  const [filterStartEnd, setFilterStartEnd] = useState("");
  // Independent of the range above — filter for tasks that have (or lack) any
  // value in the field at all, regardless of what that value is.
  const [filterDueDateMode, setFilterDueDateMode] = useState<"any" | "has" | "none">("any");
  const [filterStartDateMode, setFilterStartDateMode] = useState<"any" | "has" | "none">("any");
  const [filterCreatedStart, setFilterCreatedStart] = useState("");
  const [filterCreatedEnd, setFilterCreatedEnd] = useState("");
  const [filterAssignedBy, setFilterAssignedBy] = useState<string[]>([]);
  const [filterProjects, setFilterProjects] = useState<string[]>([]);
  const [filterOverdue, setFilterOverdue] = useState(false);
  const [taskNameSearch, setTaskNameSearch] = useState("");

  const [formAccounts, setFormAccounts] = useState<string[]>([]);
  const [formProjects, setFormProjects] = useState<FormObjective[]>([]);
  const [formTasksByProject, setFormTasksByProject] = useState<Record<number, FormTask[]>>({});
  const [currentRole, setCurrentRole] = useState<string | null>(null);
  const [currentPosition, setCurrentPosition] = useState<string | null>(null);
  const [currentPayRateType, setCurrentPayRateType] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  // Gates panelCanEditFields so an admin can't get stuck on the read-only
  // fallback just because fetchCurrentUser's profile lookup hasn't resolved
  // yet — isAdmin defaults false while loading, which used to be
  // indistinguishable from "confirmed not an admin".
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileLoadError, setProfileLoadError] = useState(false);
  const { widths: columnWidths, hidden: hiddenColumns, setColumnWidth, toggleColumnVisible } = useColumnPrefs(
    "task-list-va",
    currentUserId,
    TABLE_COLUMNS
  );
  const [currentUserProfile, setCurrentUserProfile] = useState<ProfileOption | null>(null);
  const [assignedByProfiles, setAssignedByProfiles] = useState<ProfileOption[]>([]);
  const [assignedByProfilesLoaded, setAssignedByProfilesLoaded] = useState(false);
  const [canSeeAvailableTasks, setCanSeeAvailableTasks] = useState(false);
  const [activeView, setActiveView] = useUrlTab<"my_tasks" | "submitted" | "available_tasks" | "recurring" | "team" | "objective">(
    "view",
    "my_tasks",
    ["my_tasks", "submitted", "available_tasks", "recurring", "team", "objective"]
  );
  const [objectiveProjectIds, setObjectiveProjectIds] = useState<Set<string>>(new Set());
  const [objectiveSubView, setObjectiveSubView] = useUrlTab<"list" | "progress">("objView", "list", ["list", "progress"]);
  const [hourlyPoolTasks, setHourlyPoolTasks] = useState<HourlyPoolTask[]>([]);
  const [hourlyPoolLoading, setHourlyPoolLoading] = useState(true);
  const [hourlyPoolError, setHourlyPoolError] = useState<string | null>(null);
  const [hourlyGrabbingId, setHourlyGrabbingId] = useState<number | null>(null);
  const [hourlyExpandedIds, setHourlyExpandedIds] = useState<number[]>([]);
  const [hourlyPoolCollapsed, setHourlyPoolCollapsed] = useState(true);
  const [availableRefreshKey, setAvailableRefreshKey] = useState(0);
  const [recurringTemplates, setRecurringTemplates] = useState<RecurringTaskTemplate[]>([]);
  const [recurringLoading, setRecurringLoading] = useState(false);
  // Recurring VA view (admin only): "mine" | "all" | a specific VA id.
  const [recurringScope, setRecurringScope] = useState<string>("mine");
  // Every active team member (not just staff) — used to populate the Recurring
  // VA-view picker. Kept separate from assignedByProfiles (task-recipient list).
  const [allTeamMembers, setAllTeamMembers] = useState<ProfileOption[]>([]);
  const [selectedVaId, setSelectedVaId] = useState<string | null>(null);
  const [selectedVaName, setSelectedVaName] = useState<string | null>(null);
  const [inlineEdit, setInlineEdit] = useState<InlineEditState | null>(null);
  const [inlineSaving, setInlineSaving] = useState(false);

  const [isCreating, setIsCreating] = useState(false);

  const [selectedTask, setSelectedTask] = useState<VATaskRow | null>(null);
  // Same Details-first pattern as the Calendar's task modal: clicking a row
  // opens on a read-only summary, and "Edit Task" is one click away rather
  // than the full form appearing immediately.
  const [panelTab, setPanelTab] = useState<"details" | "edit">("details");
  const [panelStatus, setPanelStatus] = useState<AssignedTaskStatus>("pending");
  const [panelReviewRequired, setPanelReviewRequired] = useState(false);
  const [panelSaving, setPanelSaving] = useState(false);
  const [panelMsg, setPanelMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [projectModalId, setProjectModalId] = useState<string | null>(null);
  const [panelScreenshots, setPanelScreenshots] = useState<TaskScreenshot[]>([]);
  const [panelSignedUrls, setPanelSignedUrls] = useState<Record<number, string>>({});
  const [panelScreenshotsLoading, setPanelScreenshotsLoading] = useState(false);
  const [lightboxUrls, setLightboxUrls] = useState<string[] | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [createTaskMode, setCreateTaskMode] = useState<"time_based" | "output_based">("time_based");
  const activeLogIdRef = useRef<number | null>(null);
  const taskEditorRef = useRef<TaskEditorHandle | null>(null);
  const captureWorkerRef = useRef<Worker | null>(null);
  const silentCaptureRef = useRef<((logId: number, screenshotType: "start" | "progress") => Promise<boolean>) | null>(
    null
  );
  // Trash is no longer admin-only. A VA who mis-creates a task needs a way to
  // get rid of it, and needs to see where it went — it's the same deleted_at
  // column the admin trash reads, so both views show the same rows. Restore is
  // open too, since trashing by accident deserves an undo. Permanent delete
  // stays admin-only.
  const taskViewOptions = ["active", "archived", "trash"] as const;

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
            : selectedVaId
            ? `/api/assigned-tasks?viewAsVa=${selectedVaId}&view=${taskView}`
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
              accuracy_score: assignee.accuracy_score ?? null,
              assigned_at: assignee.assigned_at,
              updated_at: assignee.updated_at,
              is_collaborative: false,
              collaborator_name: null,
              profiles: assignee.profiles ?? null,
              assigned_tasks: {
                id: task.id,
                account: task.account,
                project: task.project,
                project_id: task.project_id,
                category: task.category,
                task_name: task.task_name,
                task_detail: task.task_detail,
                task_notes: task.task_notes,
                due_date: task.due_date,
                start_date: task.start_date,
                start_time: task.start_time,
                end_time: task.end_time,
                assigned_by: task.assigned_by ?? null,
                assigned_by_profile: task.assigned_by_profile ?? null,
                instructions: task.instructions ?? null,
                instructions_locked: Boolean(task.instructions_locked),
                review_required: Boolean(task.review_required),
                review_required_locked: Boolean(task.review_required_locked),
                revision_count: task.revision_count ?? 0,
                recurring_template_id: task.recurring_template_id ?? null,
                spawned_template_id: task.spawned_template_id ?? null,
                fixed_pay_task_id: task.fixed_pay_task_id ?? null,
                fixed_pay_tasks: task.fixed_pay_tasks ?? null,
                projects: task.projects ?? null,
                created_by: task.created_by,
                created_by_profile: task.created_by_profile ?? null,
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

        // Collapse a recurring series to its one current occurrence, same as
        // the Operation Subtasks card — but only on the live "active" list of
        // my own work, not the reviewer queue (each submission there needs
        // its own review) and not Archived/Trash (history views, where every
        // past occurrence individually is correct).
        const collapsed =
          mode === "submitted" || taskView !== "active"
            ? normalized
            : collapseRecurringSeriesBy(normalized, (row) => ({
                recurring_template_id: row.assigned_tasks?.recurring_template_id,
                due_date: row.assigned_tasks?.due_date,
                status: row.status,
              }));

        const sorted = sortTasks(collapsed);
        setTasks(sorted);
        return sorted;
      } catch {
        setError("Unable to load assigned tasks right now.");
        return [];
      } finally {
        setLoading(false);
      }
    },
    [activeView, taskView, selectedVaId]
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
    // Non-admins always see only their own. Admins can pick a VA ("viewAsVa"),
    // everyone ("all" → no scope param), or their own ("mine").
    const scope = hasBroadAdminAccess({ role: currentRole }) ? recurringScope : "mine";
    const qs = scope === "mine" ? "?mine=true" : scope === "all" ? "" : `?viewAsVa=${scope}`;
    try {
      const res = await fetch(`/api/recurring-task-templates${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setRecurringTemplates((d.templates ?? []) as RecurringTaskTemplate[]);
    } catch {
      setRecurringTemplates([]);
    } finally {
      setRecurringLoading(false);
    }
  }, [currentUserId, currentRole, recurringScope]);

  // Refetch when the admin changes the VA scope while on the Recurring tab.
  useEffect(() => {
    if (activeView === "recurring") void fetchRecurringTemplates();
  }, [recurringScope, activeView, fetchRecurringTemplates]);

  // Load every active team member for the Recurring VA-view picker.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/team-members?all=true", { cache: "no-store" });
        const d = await res.json();
        if (!cancelled && Array.isArray(d.members)) setAllTeamMembers(d.members as ProfileOption[]);
      } catch {
        // leave empty; picker falls back to the recipient list
      }
    })();
    return () => { cancelled = true; };
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

      const { data: profile, error } = await supabase
        .from("profiles")
        .select("id, role, position, pay_rate_type, can_see_available_tasks, full_name, username")
        .eq("id", data.user.id)
        .single();

      if (error) throw error;

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
      // Surfaced via profileLoadError rather than left silent — a failed
      // lookup here used to leave currentRole permanently null, stranding a
      // real admin on the read-only task-detail fallback for the whole
      // session with no indication why.
      setProfileLoadError(true);
    } finally {
      setProfileLoading(false);
    }
  }, [supabase]);

  const isSubmittedView = activeView === "submitted";
  const isAdmin = hasBroadAdminAccess({ role: currentRole });
  const isPerTaskVa = normalizePosition(currentPosition) === "Output Based";
  const canShowAvailableTasks = isPerTaskVa || canSeeAvailableTasks;
  const canShowHourlyPool = isAdmin || (currentRole === "va" && !isPerTaskVa);


  const fetchPanelScreenshots = useCallback(async (taskId: number, taskName: string) => {
    setPanelScreenshotsLoading(true);
    setPanelScreenshots([]);
    setPanelSignedUrls({});
    try {
      const { data: assigneeRows } = await supabase
        .from("assigned_task_assignees")
        .select("log_id, va_id, assigned_at")
        .eq("assigned_task_id", taskId);

      // Collect log_ids that are already linked (new tasks post-fix)
      const linkedLogIds = Array.from(
        new Set(
          (assigneeRows ?? [])
            .map((row) => row.log_id)
            .filter((logId): logId is number => typeof logId === "number")
        )
      );

      // Name-matching is only for assignees with no log_id link; anyone with a real
      // link is already covered above and must not be name-matched on top of it.
      const linkedVaIds = new Set(
        (assigneeRows ?? [])
          .filter((row) => typeof row.log_id === "number")
          .map((row) => row.va_id)
      );
      const unlinkedVaIds = Array.from(
        new Set(
          (assigneeRows ?? [])
            .map((row) => row.va_id)
            .filter((id): id is string => typeof id === "string")
        )
      ).filter((id) => !linkedVaIds.has(id));

      let fallbackLogIds: number[] = [];
      if (unlinkedVaIds.length > 0 && taskName) {
        // Work logged before the task existed can never belong to it; work after it
        // can, right up until the task is finished. See assignedTaskWindow.
        const { data: taskRow } = await supabase
          .from("assigned_tasks")
          .select("status, start_date, end_date, due_date, created_at, updated_at, archived_at")
          .eq("id", taskId)
          .single();
        const { from, to } = assignedTaskWindow(taskRow);

        let query = supabase
          .from("time_logs")
          .select("id")
          .in("user_id", unlinkedVaIds)
          .eq("task_name", taskName);
        if (from) query = query.gte("session_date", from);
        if (to) query = query.lte("session_date", to);

        const { data: timeLogs } = await query;
        fallbackLogIds = (timeLogs ?? []).map((row) => row.id as number);
      }

      const allLogIds = Array.from(new Set([...linkedLogIds, ...fallbackLogIds]));

      if (allLogIds.length === 0) return;

      const { data: screenshotRows } = await supabase
        .from("task_screenshots")
        .select("*")
        .in("log_id", allLogIds);

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
    fetch("/api/projects?mine=true&kind=objective", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setObjectiveProjectIds(new Set((d.projects ?? []).map((p: { id: string }) => p.id))))
      .catch(() => {});
  }, []);

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

  // Fixed-rate-only VAs have no tab bar — the fixed-pay box is the only view.
  useEffect(() => {
    if (isPerTaskVa) {
      setActiveView("available_tasks");
    }
  }, [isPerTaskVa]);

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
          role: member.role,
          position: member.position,
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
    // taskNameSearch (the typed title text) intentionally survives a tab
    // switch — clearing it made re-selecting the same title across tabs
    // confusing, since it vanished even when nothing else was picked.
  }, [taskView]);

  useEffect(() => {
    if (activeView !== "my_tasks") {
      setSelectedVaId(null);
      setSelectedVaName(null);
    }
  }, [activeView]);

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

  // No longer admin-only. A VA can edit the metadata of a task they're on, so
  // gating the whole form on isAdmin left them staring at a read-only panel and
  // sent them to the Calendar to change a due date. The real boundary is the
  // API, which checks assignee membership and refuses instructions and a locked
  // review answer from a VA — the form doesn't need to guess at it.
  const panelCanEditFields = Boolean(selectedTask) && !profileLoading;

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
  const submittedByFilterOptions = useMemo(
    () =>
      Array.from(
        new Set(
          tasks
            .map((task) => task.profiles?.full_name || task.profiles?.username || "")
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b)),
    [tasks]
  );
  const assignedByFilterOptions = useMemo(
    () =>
      Array.from(
        new Set(
          tasks
            .map((task) => {
              const profile = task.assigned_tasks.assigned_by_profile;
              return profile?.full_name || profile?.username || "";
            })
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b)),
    [tasks]
  );
  const projectFilterOptions = useMemo(
    () =>
      Array.from(
        new Set(tasks.map((task) => task.assigned_tasks.projects?.name ?? "").filter(Boolean))
      ).sort((a, b) => a.localeCompare(b)),
    [tasks]
  );

  useEffect(() => {
    if (typeof window === "undefined" || tasks.length === 0) return;
    const wanted = new URLSearchParams(window.location.search).get("task");
    if (!wanted || openedFromUrlRef.current === wanted) return;
    const match = tasks.find((t) => String(t.assigned_tasks?.id ?? t.id) === wanted);
    if (!match) return;
    openedFromUrlRef.current = wanted;
    setSelectedTask(match);
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    const start = filterDueStart ? parseDueDateSafe(filterDueStart) : null;
    const end = filterDueEnd ? new Date(filterDueEnd.slice(0, 10) + "T23:59:59Z") : null;
    const startFrom = filterStartStart ? parseDueDateSafe(filterStartStart) : null;
    const startTo = filterStartEnd ? new Date(filterStartEnd.slice(0, 10) + "T23:59:59Z") : null;
    const createdFrom = filterCreatedStart ? new Date(filterCreatedStart.slice(0, 10) + "T00:00:00Z") : null;
    const createdTo = filterCreatedEnd ? new Date(filterCreatedEnd.slice(0, 10) + "T23:59:59Z") : null;
    const taskNameSearchLower = taskNameSearch.trim().toLowerCase();
    // A task counts as overdue when its due date is in the past and it hasn't
    // reached a terminal state (completed/paid/cancelled) — those are done, not
    // late.
    const now = Date.now();
    const terminalStatuses = new Set(["completed", "paid", "cancelled"]);

    return tasks.filter((task) => {
      const detail = task.assigned_tasks;
      const dueDate = detail.due_date ? parseDueDateSafe(detail.due_date) : null;
      const dueTime = dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate.getTime() : null;

      if (activeView === "objective" && !objectiveProjectIds.has(detail.project_id ?? "")) return false;
      if (filterStatuses.length > 0 && !filterStatuses.includes(task.status)) return false;
      if (filterAccounts.length > 0 && !filterAccounts.includes(detail.account ?? "")) return false;
      if (filterTaskNames.length > 0 && !filterTaskNames.includes(detail.task_name)) return false;
      if (filterObjectives.length > 0 && !filterObjectives.includes(detail.project ?? "")) return false;
      if (filterProjects.length > 0 && !filterProjects.includes(detail.projects?.name ?? "")) return false;
      if (filterAssignedBy.length > 0) {
        const assignedByName = detail.assigned_by_profile?.full_name || detail.assigned_by_profile?.username || "";
        if (!filterAssignedBy.includes(assignedByName)) return false;
      }
      if (filterSubmittedBy.length > 0) {
        const vaName = task.profiles?.full_name || task.profiles?.username || "";
        if (!filterSubmittedBy.includes(vaName)) return false;
      }
      if (taskNameSearchLower && !detail.task_name.toLowerCase().includes(taskNameSearchLower)) return false;
      if (filterDueDateMode === "has" && !dueTime) return false;
      if (filterDueDateMode === "none" && dueTime) return false;
      if (start && (!dueTime || dueTime < start.getTime())) return false;
      if (end && (!dueTime || dueTime > end.getTime())) return false;

      const sd = detail.start_date ? parseDueDateSafe(detail.start_date) : null;
      const sdTime = sd && !Number.isNaN(sd.getTime()) ? sd.getTime() : null;
      if (filterStartDateMode === "has" && !sdTime) return false;
      if (filterStartDateMode === "none" && sdTime) return false;
      if (startFrom || startTo) {
        if (startFrom && (!sdTime || sdTime < startFrom.getTime())) return false;
        if (startTo && (!sdTime || sdTime > startTo.getTime())) return false;
      }
      if (createdFrom || createdTo) {
        const cd = detail.created_at ? new Date(detail.created_at) : null;
        const cdTime = cd && !Number.isNaN(cd.getTime()) ? cd.getTime() : null;
        if (createdFrom && (!cdTime || cdTime < createdFrom.getTime())) return false;
        if (createdTo && (!cdTime || cdTime > createdTo.getTime())) return false;
      }
      if (filterOverdue) {
        if (!dueTime || dueTime >= now || terminalStatuses.has(task.status)) return false;
      }
      return true;
    });
  }, [filterAccounts, filterDueEnd, filterDueStart, filterDueDateMode, filterStartStart, filterStartEnd, filterStartDateMode, filterCreatedStart, filterCreatedEnd, filterAssignedBy, filterProjects, filterOverdue, filterObjectives, filterStatuses, filterSubmittedBy, filterTaskNames, taskNameSearch, tasks, activeView, objectiveProjectIds]);

  // Pagination over the already-filtered list — everything's fetched into
  // `tasks` up front, so this is just slicing an array already in memory, not
  // a separate fetch. currentPage clamps against totalPages at render time
  // (via pageCount below) rather than resetting via effect, so an in-place
  // edit that refetches the same data doesn't jump you back to page 1 — only
  // an actual change in how many tasks match does.
  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / TASKS_PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pageTasks = useMemo(
    () => filteredTasks.slice((safePage - 1) * TASKS_PAGE_SIZE, safePage * TASKS_PAGE_SIZE),
    [filteredTasks, safePage]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [filteredTasks.length]);

  const avgAccuracy = useMemo(() => {
    const rows = filteredTasks.filter((t) => typeof t.accuracy_score === "number");
    if (rows.length === 0) return null;
    return Math.round(rows.reduce((sum, t) => sum + t.accuracy_score, 0) / rows.length * 10) / 10;
  }, [filteredTasks]);

  const selectedTaskIdSet = useMemo(() => new Set(selectedTaskIds), [selectedTaskIds]);
  // Scoped to the current page, not every filtered task — matches its own
  // "Select all visible tasks" label once there's more than one page; a VA
  // shouldn't have off-screen rows silently selected by this checkbox.
  const allFilteredTasksSelected = pageTasks.length > 0 && pageTasks.every((task) => selectedTaskIdSet.has(task.id));

  const toggleTaskSelection = useCallback((taskId: number) => {
    setSelectedTaskIds((prev) => (prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]));
  }, []);

  const toggleAllFilteredTasks = useCallback(() => {
    setSelectedTaskIds((prev) => {
      if (pageTasks.length === 0) return prev;
      const pageIds = pageTasks.map((task) => task.id);
      const pageIdSet = new Set(pageIds);
      const allSelected = pageIds.every((id) => prev.includes(id));
      if (allSelected) {
        return prev.filter((id) => !pageIdSet.has(id));
      }
      return Array.from(new Set([...prev, ...pageIds]));
    });
  }, [pageTasks]);

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
          case "start_date":
            return formatDateInputValue(task.assigned_tasks.start_date);
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

  function DateModeToggle({ mode, setMode }: { mode: "any" | "has" | "none"; setMode: (m: "any" | "has" | "none") => void }) {
    return (
      <div>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Date</label>
        <div className="inline-flex w-full rounded-lg border border-sand bg-parchment/40 p-1 text-[11px] font-semibold">
          {(["any", "none", "has"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 rounded-md px-2 py-1 transition-colors ${mode === m ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"}`}
            >
              {m === "any" ? "All" : m === "none" ? "Empty" : "Filled"}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function DueDateRangeFilter({ close }: { close: () => void }) {
    const noDate = filterDueDateMode === "none";
    return (
      <div className="space-y-3">
        <DateModeToggle mode={filterDueDateMode} setMode={setFilterDueDateMode} />
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">From</label>
          <input
            type="date"
            value={filterDueStart}
            onChange={(e) => setFilterDueStart(e.target.value)}
            disabled={noDate}
            className="w-full rounded-lg border border-sand px-2.5 py-1.5 text-[13px] outline-none focus:border-terracotta disabled:opacity-40"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">To</label>
          <input
            type="date"
            value={filterDueEnd}
            onChange={(e) => setFilterDueEnd(e.target.value)}
            disabled={noDate}
            className="w-full rounded-lg border border-sand px-2.5 py-1.5 text-[13px] outline-none focus:border-terracotta disabled:opacity-40"
          />
        </div>
        <label className={`flex items-center gap-2 border-t border-sand pt-2 text-[12px] text-espresso ${noDate ? "opacity-40" : "cursor-pointer"}`}>
          <input
            type="checkbox"
            checked={filterOverdue}
            disabled={noDate}
            onChange={(e) => setFilterOverdue(e.target.checked)}
            className="accent-terracotta"
          />
          Overdue only
        </label>
        <div className="flex items-center justify-between border-t border-sand pt-2">
          <button type="button" onClick={() => { setFilterDueStart(""); setFilterDueEnd(""); setFilterOverdue(false); setFilterDueDateMode("any"); }} className="cursor-pointer text-[11px] text-stone hover:underline">
            Clear
          </button>
          <button type="button" onClick={close} className="cursor-pointer text-[11px] font-semibold text-terracotta hover:underline">
            Done
          </button>
        </div>
      </div>
    );
  }

  function DateRangeFilter({ from, to, setFrom, setTo, mode, setMode, close }: {
    from: string;
    to: string;
    setFrom: (v: string) => void;
    setTo: (v: string) => void;
    mode?: "any" | "has" | "none";
    setMode?: (m: "any" | "has" | "none") => void;
    close: () => void;
  }) {
    const noDate = mode === "none";
    return (
      <div className="space-y-3">
        {setMode && <DateModeToggle mode={mode ?? "any"} setMode={setMode} />}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            disabled={noDate}
            className="w-full rounded-lg border border-sand px-2.5 py-1.5 text-[13px] outline-none focus:border-terracotta disabled:opacity-40"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            disabled={noDate}
            className="w-full rounded-lg border border-sand px-2.5 py-1.5 text-[13px] outline-none focus:border-terracotta disabled:opacity-40"
          />
        </div>
        <div className="flex items-center justify-between border-t border-sand pt-2">
          <button type="button" onClick={() => { setFrom(""); setTo(""); setMode?.("any"); }} className="cursor-pointer text-[11px] text-stone hover:underline">
            Clear
          </button>
          <button type="button" onClick={close} className="cursor-pointer text-[11px] font-semibold text-terracotta hover:underline">
            Done
          </button>
        </div>
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
              {STATUS_FILTERS.filter((option) => {
                if (option.value === "all") return false;
                if (!isAdmin && task.assigned_tasks.review_required) {
                  return (["pending", "on_queue", "in_progress", "submitted"] as string[]).includes(option.value);
                }
                return true;
              }).map((option) => (
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
            case "start_date":
              return formatDateInputValue(task.assigned_tasks.start_date);
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
    setPanelSaving(false);
    setPanelMsg(null);
    setIsCreating(true);
    setCreateTaskMode("time_based");
  }, []);

  const closeCreate = useCallback(() => {
    setIsCreating(false);
  }, []);

  const openPanel = useCallback(
    async (task: VATaskRow) => {
      closeCreate();
      setSelectedTask(task);
      setPanelTab("details");
      setPanelStatus(task.status);
      setPanelReviewRequired(Boolean(task.assigned_tasks.review_required));
      setPanelMsg(null);
      setPanelScreenshots([]);
      setPanelSignedUrls({});
      setPanelScreenshotsLoading(true);
      await fetchPanelScreenshots(task.assigned_tasks.id, task.assigned_tasks.task_name ?? "");
    },
    [closeCreate, fetchPanelScreenshots]
  );

  // Refreshes the task list and re-syncs the open panel after TaskEditor
  // saves metadata changes.
  const handleMetadataSaved = useCallback(async () => {
    const freshTasks = await fetchTasks();
    setSelectedTask((current) => {
      if (!current) return current;
      const fresh = freshTasks.find((t) => t.id === current.id);
      return fresh ?? current;
    });
    showToast("success", "Task updated");
  }, [fetchTasks, showToast]);

  const closePanel = useCallback(() => {
    setSelectedTask(null);
    setPanelStatus("pending");
    setPanelSaving(false);
    setPanelMsg(null);
    setPanelScreenshots([]);
    setPanelSignedUrls({});
    setPanelScreenshotsLoading(false);
    setLightboxUrls(null);
    setLightboxIndex(0);
  }, []);

  // TaskEditor's onSaved callback for the Create Task panel. Attachments are
  // TaskEditor's own business now, so this only handles the transition.
  const handleTaskCreated = useCallback(
    async (task: { id: number; [key: string]: unknown }) => {
      const newTaskId = task.id;

      // Output Based tasks live in fixed_pay_tasks, not this page's
      // assigned_tasks-scoped list — nothing to look up or open here, the
      // toggle exists purely so creating one doesn't require leaving the panel.
      if (createTaskMode === "output_based") {
        closeCreate();
        return;
      }

      const freshTasks = await fetchTasks();
      const newTask = freshTasks.find((t) => t.assigned_tasks?.id === newTaskId);
      if (newTask) {
        openPanel(newTask);
      } else {
        closeCreate();
      }
      showToast("success", "Task created");
    },
    [closeCreate, fetchTasks, openPanel, createTaskMode, showToast]
  );

  const handleClaimedTaskRefresh = useCallback(async () => {
    await Promise.all([fetchTasks(), canShowHourlyPool ? fetchHourlyPool() : Promise.resolve()]);
    setAvailableRefreshKey((key) => key + 1);
    if (!isPerTaskVa) setActiveView("my_tasks");
  }, [canShowHourlyPool, fetchHourlyPool, fetchTasks, isPerTaskVa]);

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

  // Saves status + private notes + (VA-only) review_required — metadata
  // fields (account/project/task name/category/dates/schedule/detail/notes/
  // assigned by/instructions) now save independently through TaskEditor,
  // since status changes trigger live screen-capture start/stop that must
  // stay isolated from a generic metadata form.
  const handleSavePanel = useCallback(async () => {
    if (!selectedTask) return;

    const taskId = selectedTask.assigned_tasks.id;
    const taskLogId = selectedTask.log_id;
    const previousStatus = selectedTask.status;
    const nextStatus = panelStatus;
    const statusChanged = nextStatus !== previousStatus;
    const nextReviewRequired = panelReviewRequired;
    const reviewRequiredChanged = !isAdmin && nextReviewRequired !== Boolean(selectedTask.assigned_tasks.review_required);

    if (!statusChanged && !reviewRequiredChanged) return;

    const body: Record<string, unknown> = {};
    if (statusChanged) {
      body.status = nextStatus;
      if (isSubmittedView && selectedTask?.va_id) {
        // Admin reviewing submitted work: target the specific VA's assignee row
        body.va_id = selectedTask.va_id;
      } else if (currentUserId) {
        // VA updating their own submission
        body.va_id = currentUserId;
      }
    }

    if (Object.keys(body).length > 0) {
      const saveRes = await fetch(`/api/assigned-tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!saveRes.ok) throw new Error(`HTTP ${saveRes.status}`);
    }

    // VAs can check (not uncheck) review_required — send as standalone PATCH
    if (reviewRequiredChanged && nextReviewRequired) {
      const rrRes = await fetch(`/api/assigned-tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ review_required: true }),
      });
      if (!rrRes.ok) throw new Error(`HTTP ${rrRes.status}`);
    }

    const updatedAt = new Date().toISOString();
    setTasks((prev) =>
      sortTasks(
        prev.map((row) => {
          if (row.id !== selectedTask.id) return row;

          return {
            ...row,
            status: statusChanged ? nextStatus : row.status,
            updated_at: statusChanged ? updatedAt : row.updated_at,
            assigned_tasks: {
              ...row.assigned_tasks,
              review_required: reviewRequiredChanged ? nextReviewRequired : row.assigned_tasks.review_required,
              updated_at: reviewRequiredChanged ? updatedAt : row.assigned_tasks.updated_at,
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
            updated_at: statusChanged ? updatedAt : current.updated_at,
            assigned_tasks: {
              ...current.assigned_tasks,
              review_required: reviewRequiredChanged ? nextReviewRequired : current.assigned_tasks.review_required,
              updated_at: reviewRequiredChanged ? updatedAt : current.assigned_tasks.updated_at,
            },
          }
        : current
    );
    void fetchTasks();
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
  }, [
    fetchTasks,
    panelReviewRequired,
    panelStatus,
    selectedTask,
    currentUserId,
    isAdmin,
    isSubmittedView,
    requestStream,
    captureTaskScreenshot,
  ]);

  // Single combined Save Changes action for the detail panel — submits
  // TaskEditor's metadata form (when the viewer can edit it) and the
  // status/review-required save together, so the panel reads as one form
  // with one save button instead of two separate ones.
  const handleSaveAll = useCallback(async () => {
    setPanelMsg(null);
    setPanelSaving(true);
    try {
      if (panelCanEditFields && taskEditorRef.current) {
        await taskEditorRef.current.submit();
      }
      await handleSavePanel();
      setPanelMsg({ type: "ok", text: "Changes saved." });
      window.setTimeout(() => closePanel(), 800);
    } catch {
      setPanelMsg({ type: "err", text: "Unable to save changes right now." });
    } finally {
      setPanelSaving(false);
    }
  }, [panelCanEditFields, handleSavePanel, closePanel]);


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
    showToast("success", `${taskIds.length} task${taskIds.length === 1 ? "" : "s"} moved to Trash`);
  }, [assigneeIdsToTaskIds, closePanel, fetchTasks, patchTaskVisibility, selectedTask, selectedTaskIds, showToast]);

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
    showToast("success", `${taskIds.length} task${taskIds.length === 1 ? "" : "s"} deleted`);
  }, [assigneeIdsToTaskIds, closePanel, fetchTasks, selectedTask, selectedTaskIds, showToast]);

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
    showToast("success", "Task deleted");
  }, [closePanel, fetchTasks, selectedTask, showToast]);

  // Confirmation gate for both delete paths above — see pendingDelete's
  // declaration near the top of the component.
  const handleConfirmDelete = useCallback(async () => {
    if (pendingDelete === null) return;
    setDeleting(true);
    try {
      if (pendingDelete.kind === "bulk-permanent") {
        await handleBulkPermanentDelete();
      } else if (pendingDelete.kind === "bulk-trash") {
        await handleBulkTrash();
      } else {
        await handlePermanentDeleteTask(pendingDelete.taskId);
      }
      setPendingDelete(null);
    } catch {
      showToast("error", "Failed to delete. Please try again.");
    } finally {
      setDeleting(false);
    }
  }, [pendingDelete, handleBulkPermanentDelete, handleBulkTrash, handlePermanentDeleteTask, showToast]);

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
              {/* Fixed-rate-only VAs see only the fixed-pay box — no tab bar. */}
              {!isPerTaskVa && (
              <div className="inline-flex rounded-lg border border-sand bg-parchment/40 p-1 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => { setActiveView("my_tasks"); if (canShowHourlyPool) void fetchHourlyPool(); }}
                  className={`rounded-md px-3 py-1.5 transition-colors ${activeView === "my_tasks" ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"}`}
                >
                  Time-based Task
                </button>
                {canShowAvailableTasks && (
                  <button
                    type="button"
                    onClick={() => setActiveView("available_tasks")}
                    className={`rounded-md px-3 py-1.5 transition-colors ${activeView === "available_tasks" ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"}`}
                  >
                    Output Based Tasks
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
                <button
                  type="button"
                  onClick={() => { setActiveView("objective"); void fetchTasks(); }}
                  className={`rounded-md px-3 py-1.5 transition-colors ${activeView === "objective" ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"}`}
                >
                  Objective
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setActiveView("team")}
                    className={`rounded-md px-3 py-1.5 transition-colors ${activeView === "team" ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"}`}
                  >
                    Team
                  </button>
                )}
              </div>
              )}

              {isAdmin && activeView === "objective" && (
                <div className="inline-flex rounded-lg border border-sand bg-parchment/40 p-1 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setObjectiveSubView("list")}
                    className={`rounded-md px-3 py-1.5 transition-colors ${objectiveSubView === "list" ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"}`}
                  >
                    List
                  </button>
                  <button
                    type="button"
                    onClick={() => setObjectiveSubView("progress")}
                    className={`rounded-md px-3 py-1.5 transition-colors ${objectiveSubView === "progress" ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"}`}
                  >
                    Progress
                  </button>
                </div>
              )}

              {isAdmin && assignedByProfilesLoaded && (activeView === "my_tasks" || (activeView === "objective" && objectiveSubView === "list")) && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-stone whitespace-nowrap">View as VA:</span>
                  <select
                    value={selectedVaId ?? ""}
                    onChange={(e) => {
                      const id = e.target.value;
                      const profile = assignedByProfiles.find((p) => p.id === id);
                      setSelectedVaId(id || null);
                      setSelectedVaName(profile?.full_name ?? null);
                    }}
                    className="rounded-lg border border-sand px-2 py-1 text-[11px] text-espresso outline-none bg-white"
                  >
                    <option value="">My View</option>
                    {assignedByProfiles
                      .filter((p) => p.id !== currentUserId)
                      .slice()
                      .sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""))
                      .map((p) => (
                        <option key={p.id} value={p.id}>{p.full_name}</option>
                      ))}
                  </select>
                  {selectedVaName && (
                    <span className="text-[11px] font-semibold text-walnut">Viewing: {selectedVaName}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {currentUserId && (
          <div className="px-5 pt-4">
            <JobOrdersSection currentUserId={currentUserId} currentRole={currentRole} teamMembers={allTeamMembers} accounts={accountOptions} />
          </div>
        )}

        {canShowHourlyPool && activeView === "my_tasks" && (
          <div className="px-5 pt-4">
            <div className="rounded-xl border border-amber/30 bg-white p-3 space-y-2">
              <button
                type="button"
                onClick={() => setHourlyPoolCollapsed((prev) => !prev)}
                className="flex w-full cursor-pointer items-center gap-1.5 rounded-lg border border-amber/30 bg-amber-soft px-3 py-2.5 text-left transition-colors hover:bg-amber-soft/70"
              >
                <svg className="h-3.5 w-3.5 shrink-0 text-amber-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
                <h3 className="text-xs font-bold text-amber-700 uppercase tracking-wide">
                  Unassigned Tasks{" "}
                  <span className={hourlyPoolTasks.length > 0 ? "font-extrabold text-amber-700" : "font-normal normal-case text-stone"}>
                    ({hourlyPoolTasks.length}{hourlyPoolTasks.length > 0 ? " unclaimed" : ""})
                  </span>
                </h3>
                <span className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-amber/40 bg-white text-amber-700 transition-colors hover:bg-amber-100">
                  <svg className={`h-4 w-4 transition-transform ${hourlyPoolCollapsed ? "" : "rotate-180"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </span>
              </button>

              {!hourlyPoolCollapsed && (
                <>
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
                        const due = formatDueDate(task.due_date, task.status);
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
                                    className="flex h-6 w-6 items-center justify-center rounded-full border border-sand bg-white text-stone transition-colors hover:bg-parchment"
                                    aria-label={isExpanded ? "Collapse task details" : "Expand task details"}
                                  >
                                    <svg className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
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
                </>
              )}
            </div>
          </div>
        )}

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

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-stone">Use the ▾ on a column heading to filter it.</p>
                <div className="flex items-center gap-2">
                  <ToolbarFilterDropdown label="Project" options={projectFilterOptions} selected={filterProjects} onChange={setFilterProjects} />
                  {(filterStatuses.length > 0 || filterAccounts.length > 0 || filterTaskNames.length > 0 || filterObjectives.length > 0 || filterSubmittedBy.length > 0 || filterAssignedBy.length > 0 || filterProjects.length > 0 || filterDueStart || filterDueEnd || filterDueDateMode !== "any" || filterStartStart || filterStartEnd || filterStartDateMode !== "any" || filterCreatedStart || filterCreatedEnd || filterOverdue || taskNameSearch) && (
                    <button
                      type="button"
                      onClick={() => {
                        setFilterStatuses([]);
                        setFilterAccounts([]);
                        setFilterTaskNames([]);
                        setFilterObjectives([]);
                        setFilterSubmittedBy([]);
                        setFilterAssignedBy([]);
                        setFilterProjects([]);
                        setFilterDueStart("");
                        setFilterDueEnd("");
                        setFilterDueDateMode("any");
                        setFilterStartStart("");
                        setFilterStartEnd("");
                        setFilterStartDateMode("any");
                        setFilterCreatedStart("");
                        setFilterCreatedEnd("");
                        setFilterOverdue(false);
                        setTaskNameSearch("");
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
          </div>
        )}
        <div className="px-5 py-4">
          {canShowAvailableTasks && activeView === "available_tasks" ? (
            <div className="space-y-4">
              <AvailableTasksWidget onClaimed={handleClaimedTaskRefresh} canSeeFixedPay={isPerTaskVa || canSeeAvailableTasks} fixedPayOnly={true} currentUserId={currentUserId ?? undefined} refreshKey={availableRefreshKey} startCollapsed={true} />
              <FixedPayTasksPanel refreshKey={availableRefreshKey} />
            </div>
          ) : activeView === "recurring" ? (
            <div className="p-4 space-y-3">
              <RecurringTemplatesManager
                // Sits in the table toolbar next to the Columns picker.
                columnRowControls={
                  isAdmin ? (
                    <span className="flex items-center gap-1.5">
                      <label className="text-[11px] font-semibold uppercase tracking-wider text-walnut">Team view</label>
                      <select
                        value={recurringScope}
                        onChange={(e) => setRecurringScope(e.target.value)}
                        className="rounded-lg border border-sand px-2 py-1 text-[12px] text-espresso outline-none bg-white"
                      >
                        <option value="mine">Mine</option>
                        <option value="all">All team members</option>
                        {(allTeamMembers.length > 0 ? allTeamMembers : assignedByProfiles).map((p) => (
                          <option key={p.id} value={p.id}>{p.full_name || p.username}</option>
                        ))}
                      </select>
                    </span>
                  ) : null
                }
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
          ) : activeView === "team" ? (
            <div className="p-4">
              <TeamWorkloadView currentUserId={currentUserId ?? ""} teamMembers={assignedByProfiles} />
            </div>
          ) : activeView === "objective" && objectiveSubView === "progress" ? (
            <div className="p-4">
              <ObjectiveProgressView currentUserId={currentUserId ?? ""} teamMembers={assignedByProfiles} />
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
                    {/* Open to VAs now. Trashing is reversible — it sets
                        deleted_at, and Restore in the Trash view undoes it — so
                        it's the safe half of deleting. Permanent delete is still
                        admin-only. */}
                    <button
                      type="button"
                      onClick={() => setPendingDelete({ kind: "bulk-trash" })}
                      className="rounded-lg border border-terracotta bg-terracotta px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#a85840]"
                    >
                      Trash
                    </button>
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
                    onClick={() => setPendingDelete({ kind: "bulk-permanent" })}
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
                {avgAccuracy !== null && (
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${avgAccuracy >= 90 ? "bg-sage-soft text-sage" : avgAccuracy >= 70 ? "bg-amber-50 text-amber-600" : "bg-terracotta-soft text-terracotta"}`}>
                    Accuracy: {avgAccuracy}%
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
                <>
                <div className="overflow-x-auto rounded-xl border border-sand bg-white shadow-sm">
                  <table className="w-max min-w-full table-fixed">
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
                        {!hiddenColumns.has("task_name") && (
                          <ColumnHeader
                            label="Task Name"
                            width={columnWidths.task_name}
                            onResize={(w) => setColumnWidth("task_name", w)}
                            filterOptions={taskNameFilterOptions.map((v) => ({ value: v, label: v }))}
                            selected={filterTaskNames}
                            onFilterChange={setFilterTaskNames}
                            searchable
                            searchValue={taskNameSearch}
                            onSearchChange={setTaskNameSearch}
                            searchPlaceholder="Search task names..."
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
                        {!hiddenColumns.has("objective") && (
                          <ColumnHeader
                            label="Project"
                            width={columnWidths.objective}
                            onResize={(w) => setColumnWidth("objective", w)}
                            filterOptions={objectiveFilterOptions.map((v) => ({ value: v, label: v }))}
                            selected={filterObjectives}
                            onFilterChange={setFilterObjectives}
                          />
                        )}
                        {!hiddenColumns.has("detail") && (
                          <ColumnHeader label="Client Detail" width={columnWidths.detail} onResize={(w) => setColumnWidth("detail", w)} />
                        )}
                        {!hiddenColumns.has("status") && (
                          <ColumnHeader
                            label="Status"
                            width={columnWidths.status}
                            onResize={(w) => setColumnWidth("status", w)}
                            filterOptions={STATUS_FILTERS.filter((option) => option.value !== "all")}
                            selected={filterStatuses.map((status) => status)}
                            onFilterChange={(values) => setFilterStatuses(values as AssignedTaskStatus[])}
                          />
                        )}
                        {!hiddenColumns.has("accuracy") && (
                          <ColumnHeader label="Accuracy" width={columnWidths.accuracy} onResize={(w) => setColumnWidth("accuracy", w)} />
                        )}
                        {isSubmittedView && !hiddenColumns.has("submitted_by") && (
                          <ColumnHeader
                            label="Submitted By"
                            width={columnWidths.submitted_by}
                            onResize={(w) => setColumnWidth("submitted_by", w)}
                            filterOptions={submittedByFilterOptions.map((name) => ({ value: name, label: name }))}
                            selected={filterSubmittedBy}
                            onFilterChange={setFilterSubmittedBy}
                          />
                        )}
                        {!hiddenColumns.has("start_date") && (
                          <ColumnHeader
                            label="Start Date"
                            width={columnWidths.start_date}
                            onResize={(w) => setColumnWidth("start_date", w)}
                            isFiltered={Boolean(filterStartStart || filterStartEnd || filterStartDateMode !== "any")}
                            customFilter={(close) => (
                              <DateRangeFilter from={filterStartStart} to={filterStartEnd} setFrom={setFilterStartStart} setTo={setFilterStartEnd} mode={filterStartDateMode} setMode={setFilterStartDateMode} close={close} />
                            )}
                          />
                        )}
                        {!hiddenColumns.has("due_date") && (
                          <ColumnHeader
                            label="Due Date"
                            width={columnWidths.due_date}
                            onResize={(w) => setColumnWidth("due_date", w)}
                            isFiltered={Boolean(filterDueStart || filterDueEnd || filterOverdue || filterDueDateMode !== "any")}
                            customFilter={(close) => <DueDateRangeFilter close={close} />}
                          />
                        )}
                        {!hiddenColumns.has("created") && (
                          <ColumnHeader
                            label="Created"
                            width={columnWidths.created}
                            onResize={(w) => setColumnWidth("created", w)}
                            isFiltered={Boolean(filterCreatedStart || filterCreatedEnd)}
                            customFilter={(close) => (
                              <DateRangeFilter from={filterCreatedStart} to={filterCreatedEnd} setFrom={setFilterCreatedStart} setTo={setFilterCreatedEnd} close={close} />
                            )}
                          />
                        )}
                        {(taskView === "archived" || taskView === "trash") && (
                          <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut">Actions</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {pageTasks.map((task) => {
                        const detail = task.assigned_tasks;
                        const due = formatDueDate(detail.due_date, task.status);
                        const start = formatDueDate(detail.start_date, task.status);
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

                            {!hiddenColumns.has("task_name") && (
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
                            )}
                            {!hiddenColumns.has("account") && (
                              <InlineCell
                                task={task}
                                field="account"
                                className="px-3 py-3 text-[13px] text-walnut"
                                disabled={taskView !== "active"}
                                display={detail.account || <span className="text-stone/60">—</span>}
                              />
                            )}

                            {!hiddenColumns.has("assigned_by") && (
                              <td className="px-3 py-3 text-[13px] text-walnut truncate">
                                {detail.assigned_by_profile?.full_name ?? detail.assigned_by_profile?.username ?? <span className="text-stone/30">—</span>}
                              </td>
                            )}

                            {!hiddenColumns.has("objective") && (
                              <InlineCell
                                task={task}
                                field="project"
                                className="px-3 py-3 text-[13px] text-walnut"
                                disabled={taskView !== "active"}
                                display={detail.project || <span className="text-stone/60">—</span>}
                              />
                            )}

                            {!hiddenColumns.has("detail") && (
                              <td className="truncate px-3 py-3 text-[13px] text-walnut" onClick={(e) => e.stopPropagation()}>
                                {detail.task_detail ? (
                                  <span className="block truncate text-stone/70" title={detail.task_detail}>
                                    {detail.task_detail.length > 45 ? `${detail.task_detail.slice(0, 45)}…` : detail.task_detail}
                                  </span>
                                ) : (
                                  <span className="text-stone/30">—</span>
                                )}
                              </td>
                            )}

                            {!hiddenColumns.has("status") && (
                              <InlineCell
                                task={task}
                                field="status"
                                className="px-3 py-3 text-[13px]"
                                disabled={taskView !== "active"}
                                display={
                                  <span className="flex items-center gap-1.5">
                                    <RevisionBadge count={task.assigned_tasks.revision_count ?? 0} />
                                    <RecurringBadge
                                      fromTemplateId={task.assigned_tasks.recurring_template_id}
                                    />
                                    <StatusBadge status={task.status} />
                                  </span>
                                }
                              />
                            )}

                            {!hiddenColumns.has("accuracy") && (
                              <td className="px-3 py-3 text-[13px]">
                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${task.accuracy_score >= 90 ? "bg-sage-soft text-sage" : task.accuracy_score >= 70 ? "bg-amber-50 text-amber-600" : "bg-terracotta-soft text-terracotta"}`}>
                                  {task.accuracy_score ?? 100}%
                                </span>
                              </td>
                            )}

                            {activeView === "submitted" && !hiddenColumns.has("submitted_by") && (
                              <td className="px-3 py-3 text-[13px] text-walnut truncate">
                                {task.profiles?.full_name ?? <span className="text-stone/30">—</span>}
                              </td>
                            )}

                            {!hiddenColumns.has("start_date") && (
                              <InlineCell
                                task={task}
                                field="start_date"
                                className="px-3 py-3 text-[13px] font-medium text-walnut"
                                disabled={taskView !== "active"}
                                display={
                                  detail.start_date ? start.label : <span className="text-stone/30">—</span>
                                }
                              />
                            )}
                            {!hiddenColumns.has("due_date") && (
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
                            )}
                            {!hiddenColumns.has("created") && (
                              <td className="px-3 py-3 text-[13px] text-walnut truncate">
                                <div className="space-y-0.5 truncate">
                                  <div className="truncate">
                                    {detail.created_by_profile?.full_name || detail.created_by_profile?.username || "—"}
                                  </div>
                                  <div className="text-[11px] text-stone/70">{formatCreatedAt(detail.created_at)}</div>
                                </div>
                              </td>
                            )}
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
                                      onClick={() => setPendingDelete({ kind: "single-permanent", taskId: task.assigned_tasks.id })}
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
                {totalPages > 1 && (
                  <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-stone">
                    <span>
                      Showing {(safePage - 1) * TASKS_PAGE_SIZE + 1}–{Math.min(safePage * TASKS_PAGE_SIZE, filteredTasks.length)} of {filteredTasks.length}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={safePage <= 1}
                        className="rounded-lg bg-stone/10 px-3 py-1 font-semibold text-stone transition-colors hover:bg-stone/20 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Prev
                      </button>
                      <span className="font-semibold text-espresso">
                        Page {safePage} of {totalPages}
                      </span>
                      <button
                        type="button"
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={safePage >= totalPages}
                        className="rounded-lg bg-stone/10 px-3 py-1 font-semibold text-stone transition-colors hover:bg-stone/20 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
                </>
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

    {pendingDelete !== null && (
      <ConfirmModal
        title={
          pendingDelete.kind === "bulk-trash"
            ? "Move selected tasks to Trash?"
            : pendingDelete.kind === "bulk-permanent"
            ? "Delete selected tasks?"
            : "Delete this task?"
        }
        message={
          pendingDelete.kind === "bulk-trash"
            ? `Moves ${selectedTaskIds.length} task${selectedTaskIds.length === 1 ? "" : "s"} to Trash. You can restore ${selectedTaskIds.length === 1 ? "it" : "them"} from there.`
            : pendingDelete.kind === "bulk-permanent"
            ? `This permanently deletes ${selectedTaskIds.length} task${selectedTaskIds.length === 1 ? "" : "s"}. This cannot be undone.`
            : "This permanently deletes the task. This cannot be undone."
        }
        confirmLabel={pendingDelete.kind === "bulk-trash" ? "Move to Trash" : "Delete Forever"}
        danger={pendingDelete.kind !== "bulk-trash"}
        confirming={deleting}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setPendingDelete(null)}
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
              <div className="flex rounded-lg border border-sand overflow-hidden text-[12px] font-semibold">
                <button
                  type="button"
                  onClick={() => setCreateTaskMode("time_based")}
                  className={`flex-1 px-3 py-1.5 transition-colors ${createTaskMode === "time_based" ? "bg-terracotta text-white" : "bg-white text-stone hover:bg-cream"}`}
                >
                  Time-based Task
                </button>
                <button
                  type="button"
                  onClick={() => setCreateTaskMode("output_based")}
                  className={`flex-1 px-3 py-1.5 transition-colors ${createTaskMode === "output_based" ? "bg-terracotta text-white" : "bg-white text-stone hover:bg-cream"}`}
                >
                  Output Based Task
                </button>
              </div>

              <TaskEditor
                key={createTaskMode}
                mode={createTaskMode}
                currentUserId={currentUserId ?? ""}
                isAdminOrManager={isAdmin}
                teamMembers={panelAssignedByOptions}
                onCancel={closeCreate}
                onSaved={(task) => void handleTaskCreated(task)}
              />
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
              {profileLoading ? (
                <div className="flex items-center gap-2 py-6 text-[13px] text-stone">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  Loading...
                </div>
              ) : (
                <>
                  <div className="flex rounded-lg border border-sand overflow-hidden text-[12px] font-semibold">
                    {([
                      ["details", "Details"],
                      ["edit", "Edit Task"],
                    ] as const).map(([tab, label]) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setPanelTab(tab)}
                        className={`flex-1 px-3 py-1.5 transition-colors cursor-pointer ${
                          panelTab === tab ? "bg-terracotta text-white" : "bg-white text-stone hover:bg-cream"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {panelTab === "details" ? (
                    <TaskDetailsView
                      task={selectedTask.assigned_tasks as unknown as TaskEditorInitialTask}
                      onEdit={() => setPanelTab("edit")}
                    />
                  ) : (
                    <TaskEditor
                      // Keyed on the task id: TaskEditor seeds its fields with
                      // useState, which only runs on mount, so without this the
                      // panel kept the previously-selected task's form state and a
                      // save wrote those values over the task now open.
                      key={selectedTask.assigned_tasks.id}
                      ref={taskEditorRef}
                      mode="time_based"
                      editingTaskId={selectedTask.assigned_tasks.id}
                      initialTask={selectedTask.assigned_tasks}
                      currentUserId={currentUserId ?? ""}
                      isAdminOrManager={isAdmin}
                      teamMembers={panelAssignedByOptions}
                      // selectedTask.assigned_tasks (VATaskRow's embedded shape)
                      // has no assigned_task_assignees array, unlike Calendar's
                      // dedicated GET — without this, TaskEditor's va_id fallback
                      // defaults to "" and its PUT wipes the task's assignee.
                      defaultVaId={selectedTask.va_id}
                      readOnly={!panelCanEditFields}
                      hideFooter
                      onCancel={closePanel}
                      onSaved={() => void handleMetadataSaved()}
                    />
                  )}
                </>
              )}

              {/* Status & Files, Submitted By, and Review Required are edit-mode
                  only — Details is meant to read as a plain summary, not mixed
                  with actionable controls. */}
              {panelTab === "edit" && (
                <>
              {isSubmittedView && (
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Submitted By</label>
                  <div className="rounded-lg border border-sand bg-parchment/40 px-3 py-2 text-[13px] text-espresso">
                    {selectedTask.profiles?.full_name || selectedTask.profiles?.username || <span className="text-stone/60">—</span>}
                  </div>
                </div>
              )}

              {!panelCanEditFields && (
                <div>
                  <label className="flex items-center gap-2 cursor-pointer w-fit">
                    <input
                      type="checkbox"
                      checked={panelReviewRequired}
                      disabled={panelReviewRequired}
                      onChange={(e) => setPanelReviewRequired(e.target.checked)}
                      className="h-4 w-4 rounded border-sand text-terracotta focus:ring-terracotta disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-stone">Review Required</span>
                  </label>
                </div>
              )}

              <Section title="Status & Files" defaultOpen>
              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-stone">Status</label>
                {selectedTask.is_collaborative ? (
                  <div className="space-y-3 rounded-xl border border-slate-blue/20 bg-slate-blue-soft px-3 py-3 text-sm text-slate-blue">
                    <div className="flex items-center gap-1.5">
                      <RevisionBadge count={selectedTask.assigned_tasks.revision_count ?? 0} />
                      <StatusBadge status={selectedTask.status} />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">Update Status</label>
                      <select
                        value={panelStatus}
                        onChange={(e) => setPanelStatus(e.target.value as AssignedTaskStatus)}
                        className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                      >
                        {STATUS_FILTERS.filter((option): option is { value: AssignedTaskStatus; label: string } => {
                          if (option.value === "all") return false;
                          if (!isAdmin && selectedTask.assigned_tasks.review_required) {
                            return (["on_queue", "pending", "in_progress", "submitted"] as AssignedTaskStatus[]).includes(option.value as AssignedTaskStatus);
                          }
                          return true;
                        }).map((option) => (
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
                    <div className="flex items-center gap-1.5">
                      <RevisionBadge count={selectedTask.assigned_tasks.revision_count ?? 0} />
                      <StatusBadge status={selectedTask.status} />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">
                        Update Status
                      </label>
                      <select
                        value={panelStatus}
                        onChange={(e) => setPanelStatus(e.target.value as AssignedTaskStatus)}
                        className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-colors focus:border-terracotta"
                      >
                        {STATUS_FILTERS.filter((option): option is { value: AssignedTaskStatus; label: string } => {
                          if (option.value === "all") return false;
                          if (!isAdmin && selectedTask.assigned_tasks.review_required) {
                            return (["on_queue", "pending", "in_progress", "submitted"] as AssignedTaskStatus[]).includes(option.value as AssignedTaskStatus);
                          }
                          return true;
                        }).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              </Section>
                </>
              )}

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
                  onClick={() => void handleSaveAll()}
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
