"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import RecurringScopeDialog from "@/components/ui/RecurringScopeDialog";
import { countWords } from "@/lib/utils";
import { canChangeLockedReview } from "@/lib/financialAccess";
import { createClient } from "@/lib/supabase/client";
import { autoCategoryForTask, orgDateOf, orgWallClockToUtc, timeOfDay, parseDurationToMinutes, formatMinutesInput, RECURRENCE_OPTIONS, type RecurrenceType } from "@/lib/taskSchedule";
import { useToast } from "@/contexts/ToastProvider";
import ConfirmModal from "@/components/ConfirmModal";
import Section from "@/components/ui/Section";
import { fetchTodos, addTodo, updateTodo, deleteTodo, todoLabel, type TaskTodo } from "@/lib/taskTodos";
import ScreenshotLightbox from "@/components/ScreenshotLightbox";
import {
  screenshotCaptureTime,
  formatTimeTZ,
  formatDateTimeTZ,
  formatDateFullTZ,
  formatDateLocalTZ,
} from "@/lib/utils";
import { useOrgTimezone } from "@/hooks/useOrgTimezone";
import { SubmissionFiles, SubmissionLinks, SubmissionNotes } from "@/components/SubmissionLines";
import { fetchSubmissions, type TaskSubmission } from "@/lib/submissions";
import type { Project } from "@/types/database";

const CLIENT_MEMO_WORD_LIMIT = 15;

const TIME_BASED_STATUS_OPTIONS: { value: string; label: string }[] = [
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

const OUTPUT_BASED_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "pending", label: "Pending" },
  { value: "on_queue", label: "On Queue" },
  { value: "in_progress", label: "In Progress" },
  { value: "submitted", label: "Submitted" },
  { value: "revision_needed", label: "Revision Needed" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "paid", label: "Paid" },
];

function limitToWords(text: string, limit: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= limit) return text;
  return words.slice(0, limit).join(" ");
}

function computeHourlyEquivalent(durationValue: string, unit: "hours" | "minutes", hourlyRate: number | null): number | null {
  const raw = Number(durationValue);
  if (!Number.isFinite(raw) || raw <= 0 || hourlyRate == null) return null;
  const hours = unit === "hours" ? raw : raw / 60;
  return hours * hourlyRate;
}


type TaskAttachment = {
  id: number;
  filename: string;
  file_size: number | null;
  url: string | null;
};

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function computeQuantityTotal(unitRate: string, quantity: string): number | null {
  const rate = Number(unitRate);
  const qty = Number(quantity);
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(qty) || qty <= 0) return null;
  return rate * qty;
}

type FormObjective = { id: number; account: string; project_name: string; sort_order: number };
type FormTask = { id: number; task_name: string; billing_type: string; task_rate: number | null };
export type TeamMemberOption = { id: string; full_name: string; username: string };

// Loosely-typed prefill — callers pass whatever task row they already have
// loaded (from assigned_tasks or fixed_pay_tasks) rather than TaskEditor
// re-fetching it, since every call site already holds the row in state.
export type TaskEditorInitialTask = Record<string, unknown> & {
  id?: number;
  assigned_task_assignees?: Array<{ va_id: string }>;
};

export interface TaskEditorProps {
  mode: "time_based" | "output_based";
  editingTaskId?: number | null;
  /** Saves to recurring_task_templates instead of a task. The form is
   *  otherwise identical — that is the point: the recurring panel used to be a
   *  hand-written copy of this one, so every field added here had to be typed
   *  in there too, and in practice never was. */
  templateMode?: boolean;
  /** Template being edited (uuid). Separate from editingTaskId, which is a
   *  numeric task id. */
  editingTemplateId?: string | null;
  /** Repeat cadence, owned by the caller since only templates have one. */
  recurrenceControl?: ReactNode;
  /** Merged into the template payload — recurrence_type and is_active, which
   *  belong to the caller’s controls rather than to the shared form. */
  templateExtra?: Record<string, unknown>;
  initialTask?: TaskEditorInitialTask | null;
  currentUserId: string;
  isAdminOrManager: boolean;
  teamMembers: TeamMemberOption[];
  defaultVaId?: string;
  defaultDate?: string;
  defaultStartTime?: string;
  defaultEndTime?: string;
  defaultLinkedProjectId?: string;
  /** Fixes project_id to this value and hides the "Link to Project" field entirely — for callers where the task is inherently scoped to one project (e.g. adding a subtask from within that project's page) and letting it drift to another project, or to none, would be a bug, not a choice. */
  lockedProjectId?: string;
  /** VA's own hourly rate — feeds the Rate section's Duration × Rate helper. */
  currentPayRate?: number;
  /** Hides the built-in Save/Cancel footer — use with a ref to trigger submit() from a parent-owned footer instead. */
  hideFooter?: boolean;
  /** Renders every field disabled and swaps the footer to a single Close button — for viewers who can't edit this task. Submit is blocked even via the ref. */
  readOnly?: boolean;
  /** Extra content rendered inside the "Attachments & Screenshots" section, below the screenshot grid — for callers with their own Attachments UI (upload/list/remove), so both live together in one place instead of split across the form. */
  attachmentsExtra?: ReactNode;
  /** Set false to hide the Assign To field and never touch va_ids — for callers with their own multi-assignee UI (assigned_tasks supports several assignees; this form's Assign To is single-select). Default true. */
  manageAssignment?: boolean;
  /** Org timezone for screenshot capture times. Optional — resolved from
   *  organization_settings when not supplied. */
  timezone?: string;
  onCancel: () => void;
  onSaved: (task: { id: number; [key: string]: unknown }) => void;
}

export interface TaskEditorHandle {
  submit: () => Promise<void>;
}

const inputClass = "w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white disabled:bg-parchment/40 disabled:text-stone";
const labelClass = "mb-1 block text-[11px] font-bold uppercase tracking-wider text-amber";

/**
 * Hours and minutes as two plain number boxes. Stores the same shorthand string
 * the free-text field used ("1h 30m"), so nothing downstream changes.
 *
 * Was a dropdown of preset lengths, which quietly decided that a task takes 30
 * or 45 minutes and nothing in between. Anything is expressible now — 1h 05m,
 * 20m, 7h — without having to know that "1h 30m" is the phrasing the parser
 * accepts.
 *
 * Minutes are clamped to 0-59 and hours to a sane ceiling; a blank pair reads
 * as "not set" rather than zero, which is what the caller checks for.
 */
function DurationFields({
  value,
  onChange,
  disabled,
  invalid,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const total = parseDurationToMinutes(value);
  const hours = total != null ? Math.floor(total / 60) : null;
  const minutes = total != null ? total % 60 : null;

  const emit = (nextHours: number | null, nextMinutes: number | null) => {
    const h = Math.min(Math.max(nextHours ?? 0, 0), 99);
    const m = Math.min(Math.max(nextMinutes ?? 0, 0), 59);
    const sum = h * 60 + m;
    onChange(sum > 0 ? formatMinutesInput(sum) : "");
  };

  const boxClass = `${invalid ? `${inputClass} border-terracotta bg-terracotta-soft/40` : inputClass} text-center`;
  const readNumber = (raw: string) => (raw.trim() === "" ? null : Number(raw));

  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <label className="mb-1 block text-[10px] font-semibold text-walnut">Hours</label>
        <input
          type="number"
          min={0}
          max={99}
          inputMode="numeric"
          value={hours ?? ""}
          onChange={(e) => emit(readNumber(e.target.value), minutes)}
          disabled={disabled}
          placeholder="0"
          className={boxClass}
        />
      </div>
      <div className="flex-1">
        <label className="mb-1 block text-[10px] font-semibold text-walnut">Minutes</label>
        <input
          type="number"
          min={0}
          max={59}
          step={1}
          inputMode="numeric"
          value={minutes ?? ""}
          onChange={(e) => emit(hours, readNumber(e.target.value))}
          disabled={disabled}
          placeholder="0"
          className={boxClass}
        />
      </div>
    </div>
  );
}

/**
 * Explanation on demand, next to the label it explains.
 *
 * The form used to carry this as a paragraph under every field. Read once, it
 * is noise on every visit after — and a form that is mostly grey prose is hard
 * to scan for the bit you actually came to change. Rules that are genuinely
 * non-obvious live here; anything self-evident was dropped rather than moved.
 */
function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <span className="cursor-help text-[11px] text-stone/60">ⓘ</span>
      <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-sand bg-white px-3 py-2 text-[10px] leading-snug text-espresso opacity-0 shadow-md transition-opacity group-hover:opacity-100">
        {text}
      </span>
    </span>
  );
}

/**
 * When a screenshot was taken: the client stamp if present, else the time baked
 * into the Drive filename, else the row's insert time. Mirrors the admin view so
 * the same shot reads the same in both places.
 */
function shotTakenAt(ss: { captured_at?: string | null; filename?: string; created_at: string }): string {
  return ss.captured_at ?? screenshotCaptureTime(ss.filename) ?? ss.created_at;
}

function ClientMemoFormatTooltip() {
  return (
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
  );
}

const TaskEditor = forwardRef<TaskEditorHandle, TaskEditorProps>(function TaskEditor({
  mode,
  editingTaskId = null,
  templateMode = false,
  editingTemplateId = null,
  recurrenceControl,
  templateExtra,
  initialTask = null,
  currentUserId,
  isAdminOrManager,
  teamMembers,
  defaultVaId,
  defaultDate,
  defaultStartTime,
  defaultEndTime,
  defaultLinkedProjectId,
  lockedProjectId,
  currentPayRate,
  hideFooter = false,
  readOnly = false,
  attachmentsExtra,
  timezone: timezoneProp,
  manageAssignment = true,
  onCancel,
  onSaved,
}: TaskEditorProps, ref) {
  const isEditing = Boolean(templateMode ? editingTemplateId : editingTaskId);
  const { showToast } = useToast();

  // Basics
  const [account, setAccount] = useState((initialTask?.account as string) ?? "");
  const [project, setProject] = useState((initialTask?.project as string) ?? "");
  const [taskName, setTaskName] = useState((initialTask?.task_name as string) ?? "");
  const [category, setCategory] = useState<string>((initialTask?.category as string) ?? "Task");
  // Tracks whether the current category value came from autoCategoryForTask
  // rather than a deliberate user pick — so switching Account/Objective away
  // from a matching combo resets it instead of leaving a stale auto-set
  // category (e.g. "Planning" from Virtual Concierge/Organizing) stuck after
  // switching to an account the rule doesn't apply to. Manually picking a
  // category clears the flag so it's never silently overwritten again.
  const [categoryAutoSet, setCategoryAutoSet] = useState(false);
  const applyAutoCategory = useCallback((nextAccount: string, nextProject: string, nextTaskName: string) => {
    const auto = autoCategoryForTask(nextAccount, nextProject, nextTaskName);
    if (auto) {
      setCategory(auto);
      setCategoryAutoSet(true);
    } else {
      setCategoryAutoSet((wasAuto) => {
        if (wasAuto) setCategory("Task");
        return false;
      });
    }
  }, []);

  // Schedule
  //
  // The saved hours have to be read back out of initialTask, not just defaulted.
  // Only the Calendar passes defaultStartTime/defaultEndTime; every other call
  // site (Assignment panel, admin Task Assignments, VA Projects) passes neither,
  // so the inputs opened on 09:00–10:00 for a task that already had hours — and
  // because the Add-to-Calendar box was still ticked, saving any unrelated field
  // wrote those defaults straight over the real times.
  //
  // Read on the ORG (Eastern) wall clock, matching the save path below. Both
  // directions must use the same clock or the form drifts — reading locally
  // while writing org time would show a Manila VA an hour she never picked.
  // It also matches what the Calendar grid renders, so the block and the form
  // agree. Round trip is exact: open a task, save without touching the hours,
  // and the stored instant is unchanged, for every viewer.
  const initialStartTime = initialTask?.start_time as string | null | undefined;
  const initialEndTime = initialTask?.end_time as string | null | undefined;
  const [startDate, setStartDate] = useState(
    (initialTask?.start_date as string) ||
      (initialStartTime ? orgDateOf(initialStartTime) : "") ||
      defaultDate ||
      ""
  );
  const [dueDate, setDueDate] = useState((initialTask?.due_date as string) ?? "");
  const [dueTime, setDueTime] = useState((initialTask?.due_time as string) ?? "");
  const [endDate, setEndDate] = useState((initialTask?.end_date as string) ?? "");
  // How long the task takes when it doesn't need a particular slot — the
  // alternative to specific hours, not an addition to them.
  const initialPlannedMinutes = initialTask?.planned_minutes as number | null | undefined;
  const [plannedDuration, setPlannedDuration] = useState(
    initialPlannedMinutes != null ? formatMinutesInput(Number(initialPlannedMinutes)) : ""
  );
  // A task that already has an answer keeps it. This used to be
  // `initialStartTime || defaultStartTime`, which let the CALLER's default win:
  // openScheduleExisting passes defaultStartTime="09:00", so opening a
  // duration-only task from the Hours tab or the Unscheduled list landed on the
  // hours tab with the duration hidden — and saving then ran
  // `planned_minutes = hasSchedule ? null : …` and wiped it. Editing a duration
  // appeared to do nothing because the save was clearing it and booking 9-10am
  // instead. defaultStartTime now only decides for a task with neither.
  const [hasSchedule, setHasSchedule] = useState(
    initialStartTime ? true : initialPlannedMinutes != null ? false : Boolean(defaultStartTime)
  );
  const parsedPlannedMinutes = parseDurationToMinutes(plannedDuration);
  const [startTime, setStartTime] = useState(
    initialStartTime ? timeOfDay(initialStartTime).slice(0, 5) : defaultStartTime ?? "09:00"
  );
  const [endTime, setEndTime] = useState(
    initialEndTime ? timeOfDay(initialEndTime).slice(0, 5) : defaultEndTime ?? "10:00"
  );
  // "Also save as a recurring template" — time-based only (per Toni: Output
  // Based needs its own cron work first, see docs). existingTemplateId is the
  // persisted link (assigned_tasks.spawned_template_id) — its presence is what
  // makes the checkbox remember state across reopens, rather than resetting to
  // unchecked every time like a fire-and-forget action would.
  const initialSpawnedTemplateId = (initialTask?.spawned_template_id as string) ?? null;
  const [existingTemplateId, setExistingTemplateId] = useState<string | null>(initialSpawnedTemplateId);
  const [alsoSaveAsTemplate, setAlsoSaveAsTemplate] = useState(Boolean(initialSpawnedTemplateId));
  const [templateRecurrenceType, setTemplateRecurrenceType] = useState<RecurrenceType>("daily");
  // Blank means indefinite. Seeded from the linked template so editing a task
  // that already repeats shows the limit it actually has.
  const [templateRepeatUntil, setTemplateRepeatUntil] = useState("");
  const [pendingUnlinkTemplate, setPendingUnlinkTemplate] = useState(false);
  const [unlinkingTemplate, setUnlinkingTemplate] = useState(false);

  // Pre-fills the Repeat dropdown to match the already-linked template's own
  // recurrence, rather than defaulting to Daily regardless of what it's
  // actually set to. Only fires once, for the template this task loaded with —
  // not on every keystroke, since nothing here changes after mount.
  useEffect(() => {
    if (!initialSpawnedTemplateId) return;
    fetch(`/api/recurring-task-templates?id=${initialSpawnedTemplateId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.template?.recurrence_type) setTemplateRecurrenceType(d.template.recurrence_type);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Details
  const [taskDetail, setTaskDetail] = useState((initialTask?.task_detail as string) ?? "");
  const [taskNotes, setTaskNotes] = useState((initialTask?.task_notes as string) ?? "");
  const [link, setLink] = useState((initialTask?.link as string) ?? "");
  const [instructions, setInstructions] = useState((initialTask?.instructions as string) ?? "");
  const [instructionsLocked, setInstructionsLocked] = useState(Boolean(initialTask?.instructions_locked));
  // The lock as it was when the form opened. A lock that can be switched off
  // again protects nothing, so once it is saved on, the checkbox is fixed and
  // the wording is append-only from then on — for admins too.
  const instructionsLockedAtLoad = Boolean(initialTask?.instructions_locked);
  const instructionsEditable = !instructionsLockedAtLoad && isAdminOrManager;
  const [showInstructionAdd, setShowInstructionAdd] = useState(false);
  // A VA can add to instructions but not rewrite them — the server rejects
  // `instructions` from a non-admin outright and only accepts this append.
  const [instructionsAppend, setInstructionsAppend] = useState("");
  const [todos, setTodos] = useState<TaskTodo[]>([]);
  const [todosLoading, setTodosLoading] = useState(false);
  const [newTodoText, setNewTodoText] = useState("");
  const [todoBusyId, setTodoBusyId] = useState<number | null>(null);
  // Org time, never the viewer's local time — matches what the admin screenshot
  // view shows for the same capture. A caller that already has it can pass it in.
  const timezone = useOrgTimezone(timezoneProp);
  const [screenshots, setScreenshots] = useState<
    Array<{
      id: number;
      url: string | null;
      screenshot_type: string | null;
      filename: string;
      captured_at: string | null;
      created_at: string;
      failure_reason: string | null;
    }>
  >([]);
  // Only shots with an image can be opened; markers ("Computer idle") have none.
  const viewableShots = useMemo(() => screenshots.filter((s) => Boolean(s.url)), [screenshots]);
  const [screenshotsLoading, setScreenshotsLoading] = useState(false);
  const [submissions, setSubmissions] = useState<TaskSubmission[]>([]);

  // Attachments live in the editor rather than being handed in by each caller.
  // As a prop, only the Assignment panel ever supplied them, so the Calendar,
  // the admin Task Assignments tab, VA Projects and the Fixed Pay panels had no
  // way to attach a file at all — the same form, missing a field, depending on
  // where you opened it from.
  const attachmentsBase = templateMode
    ? "/api/recurring-task-templates"
    : mode === "time_based"
    ? "/api/assigned-tasks"
    : "/api/fixed-pay-tasks";
  // Templates key attachments by uuid; tasks by numeric id.
  const attachmentOwnerId: string | number | null = templateMode ? editingTemplateId : editingTaskId;
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const loadAttachments = useCallback(
    async (taskId: string | number) => {
      setAttachmentsLoading(true);
      try {
        const res = await fetch(`${attachmentsBase}/${taskId}/attachments`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const raw = Array.isArray(json) ? json : json.attachments ?? [];
        setAttachments(
          raw.map((r: Partial<TaskAttachment> & { id: number; filename: string }) => ({
            id: r.id,
            filename: r.filename,
            file_size: r.file_size ?? null,
            url: r.url ?? null,
          }))
        );
      } catch {
        setAttachments([]);
      } finally {
        setAttachmentsLoading(false);
      }
    },
    [attachmentsBase]
  );

  useEffect(() => {
    if (attachmentOwnerId == null) return;
    void loadAttachments(attachmentOwnerId);
  }, [attachmentOwnerId, loadAttachments]);

  /** Upload straight away when the task exists; hold otherwise (see handleSubmit). */
  const handleFilesPicked = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      if (attachmentOwnerId == null) {
        setPendingFiles((prev) => [...prev, ...files]);
        return;
      }
      setUploading(true);
      try {
        for (const file of files) {
          const form = new FormData();
          form.append("file", file);
          await fetch(`${attachmentsBase}/${attachmentOwnerId}/attachments`, { method: "POST", body: form });
        }
        await loadAttachments(attachmentOwnerId);
      } finally {
        setUploading(false);
      }
    },
    [attachmentOwnerId, attachmentsBase, loadAttachments]
  );

  /** Files picked before the task existed, uploaded once it does. */
  const flushPendingFiles = useCallback(
    async (taskId: string | number) => {
      if (pendingFiles.length === 0) return;
      setUploading(true);
      try {
        for (const file of pendingFiles) {
          const form = new FormData();
          form.append("file", file);
          await fetch(`${attachmentsBase}/${taskId}/attachments`, { method: "POST", body: form });
        }
        setPendingFiles([]);
      } finally {
        setUploading(false);
      }
    },
    [pendingFiles, attachmentsBase]
  );

  const handleDeleteAttachment = useCallback(
    async (attachmentId: number) => {
      if (attachmentOwnerId == null) return;
      if (!confirm("Delete this attachment? This cannot be undone.")) return;
      await fetch(`${attachmentsBase}/${attachmentOwnerId}/attachments?attachmentId=${attachmentId}`, {
        method: "DELETE",
      });
      await loadAttachments(attachmentOwnerId);
    },
    [attachmentOwnerId, attachmentsBase, loadAttachments]
  );
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Accordion behavior for the Basics/Details/Attachments/Assignment/Rate/
  // Schedule/Screenshots Sections below — opening one closes whichever was
  // open, so only one is expanded at a time. Keyed by a stable id passed
  // separately from each Section's `title` (its display label) — a shared or
  // renamed title can't silently merge or break two Sections' open state,
  // since the id and the label are never the same value.
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);
  const accordionProps = (id: string) => ({
    open: openSectionId === id,
    onToggle: () => setOpenSectionId((prev) => (prev === id ? null : id)),
  });

  // Assignment
  // Initial status — create-only, admin/manager-only (matches the pre-consolidation
  // forms: TaskAssignmentsAdminTab's Status select and FixedPayTasksTab's Status
  // select both let the creator pick a starting status other than the default).
  const [initialStatus, setInitialStatus] = useState(mode === "time_based" ? "pending" : "open");
  const [assignedBy, setAssignedBy] = useState((initialTask?.assigned_by as string) ?? currentUserId);
  // Several assignees, not one. assigned_tasks has always supported a set of
  // them via assigned_task_assignees — the form just offered a single select, so
  // a meeting for four people had to be created four times. Every assignee sees
  // the task on their own calendar, so assigning IS the invitation: give it
  // hours and the block appears for all of them.
  //
  // Seeded from every existing assignee, which is what makes it safe to send
  // va_ids on an edit. The single select could not, since it only knew about
  // the first one and saving would have dropped the rest.
  const initialVaIds: string[] = (() => {
    const fromAssignees = (initialTask?.assigned_task_assignees ?? [])
      .map((a) => a.va_id)
      .filter(Boolean);
    if (fromAssignees.length > 0) return fromAssignees;
    const single = (initialTask?.assigned_to as string) ?? defaultVaId ?? (isAdminOrManager ? "" : currentUserId);
    return single ? [single] : [];
  })();
  const [vaIds, setVaIds] = useState<string[]>(initialVaIds);
  const toggleVaId = (id: string) =>
    setVaIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  const [linkedProjectIdState, setLinkedProjectId] = useState((initialTask?.project_id as string) ?? defaultLinkedProjectId ?? "");
  const linkedProjectId = lockedProjectId ?? linkedProjectIdState;
  const [parentTaskId, setParentTaskId] = useState(initialTask?.parent_task_id != null ? String(initialTask.parent_task_id) : "");
  // Review Required is a required Yes/No, not a checkbox — "" means nobody has
  // answered yet.
  //
  // Only YES locks. Saying a task needs review is the commitment worth
  // protecting: a VA shouldn't be able to quietly take it back and skip the
  // review. NO is not a commitment — it stays freely changeable, so anyone can
  // still escalate a task to Yes later. The lock is deliberately one-way, and
  // `&& review_required` keeps that true even for a row locked at No by the
  // earlier version of this rule.
  const reviewLocked =
    Boolean(initialTask?.review_required_locked) && Boolean(initialTask?.review_required);
  const [reviewRequired, setReviewRequired] = useState<"" | "yes" | "no">(
    isEditing ? (initialTask?.review_required ? "yes" : "no") : ""
  );
  // Only the Admin/Manager/CEO/Founder tier may undo a locked Yes. The server
  // enforces the same rule — this just avoids offering a control that would be
  // rejected.
  const [viewerRole, setViewerRole] = useState<string | null>(null);
  const reviewEditable = !reviewLocked || canChangeLockedReview({ role: viewerRole });
  // Pay type is no longer a field — time-based and output-based tasks have
  // separate forms, so `mode` already settles it. Existing rows keep whatever
  // they were created with rather than getting silently rewritten on edit.
  const payType = (initialTask?.pay_type as string) ?? "hourly";

  // Rate (output_based only)
  const [unitRate, setUnitRate] = useState("");
  const [quantity, setQuantity] = useState("");
  const [durationValue, setDurationValue] = useState("");
  const [durationUnit, setDurationUnit] = useState<"hours" | "minutes">("hours");
  const [rate, setRate] = useState(initialTask?.rate != null ? String(initialTask.rate) : "");

  const [linkedProjects, setLinkedProjects] = useState<Project[]>([]);
  const [parentTaskOptions, setParentTaskOptions] = useState<Array<{ id: number; task_name: string }>>([]);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [formProjects, setFormProjects] = useState<FormObjective[]>([]);
  const [tasksByProject, setTasksByProject] = useState<Record<number, FormTask[]>>({});

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/task-form-options", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setAccounts(d.accounts ?? []);
        setFormProjects(d.projects ?? []);
        setTasksByProject(d.tasksByProject ?? {});
      })
      .catch(() => {});
  }, []);

  // The viewer's own role, for the locked-Review-Required check. Fetched here
  // rather than threaded down as a prop because TaskEditor has eight call
  // sites and only three of them already hold the role.
  // Keyed off the authenticated session rather than the currentUserId prop:
  // several call sites pass `currentUserId ?? ""`, and an empty id skipped the
  // fetch entirely, leaving viewerRole null — which read as "not in the tier"
  // and disabled the control for everyone, founders included. That is why a
  // locked task appeared unchangeable by anyone at all.
  useEffect(() => {
    const supabase = createClient();
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      setViewerRole((data?.role as string) ?? null);
    })();
  }, []);

  useEffect(() => {
    fetch("/api/projects?mine=true", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setLinkedProjects(d.projects ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!linkedProjectId) {
      setParentTaskOptions([]);
      return;
    }
    fetch(`/api/assigned-tasks?projectId=${linkedProjectId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setParentTaskOptions((d.tasks ?? []).map((t: { id: number; task_name: string }) => ({ id: t.id, task_name: t.task_name }))))
      .catch(() => setParentTaskOptions([]));
  }, [linkedProjectId]);

  // To-do checklist only exists for assigned_tasks (task_todos FKs to
  // assigned_tasks.id, not fixed_pay_tasks.id) — output_based tasks don't get
  // one. It's purely internal record-keeping (per-item time tracking, shows
  // in internal reports) and coexists with Client Detail rather than
  // replacing it — Client Detail alone is what carries over to the client
  // memo/invoice. Available on create too, held as local pendingTodoTexts
  // until the task actually has an id, then flushed to real rows right
  // after creation (see handleSubmit).
  const supportsTodos = mode === "time_based" && !templateMode;
  const [pendingTodoTexts, setPendingTodoTexts] = useState<string[]>([]);

  useEffect(() => {
    if (!supportsTodos || !editingTaskId) return;
    setTodosLoading(true);
    fetchTodos(editingTaskId)
      .then((loaded) => setTodos(loaded))
      .finally(() => setTodosLoading(false));
  }, [supportsTodos, editingTaskId]);

  // Screenshots are captured during clocking (time_logs), so they only ever
  // exist for time-based tasks that have actually been worked on — same
  // gating as the to-do checklist.
  useEffect(() => {
    if (!supportsTodos || !editingTaskId) return;
    setScreenshotsLoading(true);
    fetch(`/api/assigned-tasks/${editingTaskId}/screenshots`)
      .then((res) => res.json())
      .then((data) =>
        setScreenshots(
          [...(data.screenshots ?? [])].sort(
            (a, b) =>
              new Date(shotTakenAt(a)).getTime() - new Date(shotTakenAt(b)).getTime()
          )
        )
      )
      .catch(() => setScreenshots([]))
      .finally(() => setScreenshotsLoading(false));
  }, [supportsTodos, editingTaskId]);

  // Submissions exist for any assigned task that's been turned in — output-based
  // included — so unlike screenshots these aren't gated on supportsTodos.
  useEffect(() => {
    if (!editingTaskId) return;
    void fetchSubmissions(editingTaskId).then(setSubmissions);
  }, [editingTaskId]);

  const handleAddTodo = useCallback(async () => {
    const text = newTodoText.trim();
    if (!text) return;
    if (!editingTaskId) {
      // No task saved yet — hold locally, flushed to real rows in handleSubmit.
      setPendingTodoTexts((prev) => [...prev, text]);
      setNewTodoText("");
      return;
    }
    const created = await addTodo(editingTaskId, text);
    if (created) {
      setTodos((prev) => [...prev, created]);
      setNewTodoText("");
    }
  }, [newTodoText, editingTaskId]);

  const handleUpdatePendingTodo = useCallback((index: number, text: string) => {
    setPendingTodoTexts((prev) => prev.map((t, i) => (i === index ? text : t)));
  }, []);

  const handleRemovePendingTodo = useCallback((index: number) => {
    setPendingTodoTexts((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleUpdateTodo = useCallback(async (todoId: number, text: string) => {
    if (!editingTaskId) return;
    setTodoBusyId(todoId);
    const updated = await updateTodo(editingTaskId, todoId, text);
    if (updated) {
      setTodos((prev) => prev.map((t) => (t.id === todoId ? updated : t)));
    }
    setTodoBusyId(null);
  }, [editingTaskId]);

  const handleDeleteTodo = useCallback(async (todoId: number) => {
    if (!editingTaskId) return;
    setTodoBusyId(todoId);
    const ok = await deleteTodo(editingTaskId, todoId);
    if (ok) {
      setTodos((prev) => prev.filter((t) => t.id !== todoId));
    }
    setTodoBusyId(null);
  }, [editingTaskId]);

  const objectiveOptionsForAccount = useMemo(
    () => formProjects.filter((p) => p.account === account).sort((a, b) => a.sort_order - b.sort_order),
    [formProjects, account]
  );
  const selectedObjectiveId = useMemo(
    () => objectiveOptionsForAccount.find((p) => p.project_name === project)?.id,
    [objectiveOptionsForAccount, project]
  );
  const taskOptionsForObjective = useMemo(
    () => (selectedObjectiveId ? tasksByProject[selectedObjectiveId] ?? [] : []),
    [tasksByProject, selectedObjectiveId]
  );

  // An existing task keeps its name as-is when the current objective’s task
  // list doesn’t contain it — there is nothing safe to preselect, and picking
  // something else from the list would silently retarget the task.
  const taskNameLocked =
    isEditing && Boolean(taskName) && !taskOptionsForObjective.some((t) => t.task_name === taskName);
  const linkedObjectives = useMemo(() => linkedProjects.filter((p) => p.kind === "objective"), [linkedProjects]);
  const linkedOperations = useMemo(() => linkedProjects.filter((p) => p.kind === "operation"), [linkedProjects]);
  // Parents first with their children indented beneath, so the dropdown shows
  // the shape of the tree rather than a flat alphabetical list where a sub and
  // its parent sit unrelated. Orphans (a parent that isn’t in this list) are
  // treated as top level so nothing silently disappears.
  const asTree = useCallback((items: Project[]) => {
    const byParent = new Map<string, Project[]>();
    const ids = new Set(items.map((p) => p.id));
    const roots: Project[] = [];
    for (const p of items) {
      const parent = p.parent_project_id;
      if (parent && ids.has(parent)) {
        byParent.set(parent, [...(byParent.get(parent) ?? []), p]);
      } else {
        roots.push(p);
      }
    }
    const out: { id: string; label: string }[] = [];
    for (const root of roots) {
      const children = byParent.get(root.id) ?? [];
      out.push({ id: root.id, label: children.length > 0 ? `${root.name} (parent)` : root.name });
      for (const child of children) out.push({ id: child.id, label: `— ${child.name} (sub)` });
    }
    return out;
  }, []);

  const objectiveTree = useMemo(() => asTree(linkedObjectives), [asTree, linkedObjectives]);
  const operationTree = useMemo(() => asTree(linkedOperations), [asTree, linkedOperations]);

  // "Link to Objective" and "Link to Operations" are two fields over one
  // `project_id` column, so they're mutually exclusive: whichever you pick
  // becomes the link and the other select falls back to "— None —". Until
  // /api/projects resolves, both read empty while linkedProjectId still holds
  // the saved value — so a save mid-load re-sends the existing link untouched
  // rather than clearing it.
  const linkedObjectiveId = useMemo(
    () => (linkedObjectives.some((p) => p.id === linkedProjectId) ? linkedProjectId : ""),
    [linkedObjectives, linkedProjectId]
  );
  const linkedOperationId = useMemo(
    () => (linkedOperations.some((p) => p.id === linkedProjectId) ? linkedProjectId : ""),
    [linkedOperations, linkedProjectId]
  );

  // Submission notes live under Attachments & Files, not beside the editable
  // internal Notes box — the emptiness check has to sit out here so the
  // "Submission Notes" label disappears along with the (null-rendering) list.
  const hasSubmissionNotes = useMemo(
    () => submissions.some((s) => s.submission_comment?.trim()),
    [submissions]
  );

  const hourlyEquivalentTotal = computeHourlyEquivalent(durationValue, durationUnit, currentPayRate ?? null);
  const quantityTotal = computeQuantityTotal(unitRate, quantity);

  const scheduleHelperText = useMemo(() => {
    if (!hasSchedule || !startTime || !endTime) return null;
    if (!endDate || endDate === startDate) return null;
    const fmt = (t: string) => {
      const [h, m] = t.split(":").map(Number);
      const period = h >= 12 ? "PM" : "AM";
      const hour12 = h % 12 === 0 ? 12 : h % 12;
      return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
    };
    return `Applies daily, ${fmt(startTime)}–${fmt(endTime)}, ${startDate || "?"}–${endDate}`;
  }, [hasSchedule, startTime, endTime, startDate, endDate]);

  const submitWithScope = useCallback(async (scope?: "this" | "future") => {
    if (readOnly) return;
    if (!taskName.trim()) {
      setError("Task name is required.");
      throw new Error("Task name is required.");
    }
    // Client Detail is what carries over to the client memo/invoice, so a task
    // can't be saved without one — including edits to older tasks that predate
    // the rule, which have to be filled in before any other change will save.
    if (!taskDetail.trim()) {
      setError("Client Detail is required.");
      throw new Error("Client Detail is required.");
    }
    // Required on create only. Existing tasks predate the rule and keep the
    // value they were saved with, so forcing an answer on them would block
    // every unrelated edit — they lock when someone answers, not before.
    if (mode === "time_based" && !isEditing && !reviewRequired) {
      setError("Answer Review Required (Yes or No).");
      throw new Error("Answer Review Required (Yes or No).");
    }
    // Same create-only rule as Review Required — every new task needs a due
    // date on the Calendar, but existing tasks that predate this aren't
    // retroactively blocked. A recurring template — whether this whole form
    // IS one (templateMode, the Recurring tab) or it's riding along with a
    // regular task (alsoSaveAsTemplate) — has no single due date, since each
    // occurrence gets its own. It anchors on Start Date instead, which is
    // what the template itself generates from (recurringOccurrences.ts's
    // fallsOn() refuses to generate anything for a template with no
    // start_date — that was silently breaking every template created here,
    // since Start Date was never required and Due Date was blocking the save
    // instead).
    const isRecurringFlow = templateMode || alsoSaveAsTemplate;
    if (!isEditing && !isRecurringFlow && !dueDate) {
      setError("Due Date is required.");
      throw new Error("Due Date is required.");
    }
    // NOT create-only, unlike the rules above. Clearing Start Date on an
    // EXISTING template is just as fatal as never setting one — the template
    // goes on looking fine and quietly stops generating anything from that
    // point on, which is exactly what "predates the rule" is supposed to
    // protect against, not cause.
    if (isRecurringFlow && !startDate) {
      setError("Start Date is required for a recurring task.");
      throw new Error("Start Date is required for a recurring task.");
    }
    // Computed from the primitives rather than reading the derived
    // needsSchedule, which is declared further down the component body — this
    // closure would then depend on a binding that isn't in its dependency list.
    // Shared by both branches: time-based writes a set of assignees, output-based
    // has one column and takes the first.
    const effectiveVaIds = isAdminOrManager ? vaIds : [currentUserId].filter(Boolean);

    if (mode === "time_based") {
      const rangeGiven = hasSchedule && Boolean(startDate) && Boolean(startTime) && Boolean(endTime);
      if (!rangeGiven && parsedPlannedMinutes == null) {
        setError("Set a time range or a duration.");
        throw new Error("Set a time range or a duration.");
      }
    } else if (!startDate || !endDate) {
      // Output Based work has no time slot to fill, so Start Date + End Date
      // on the Calendar is the schedule commitment — not a duration.
      setError("Set a Start Date and End Date.");
      throw new Error("Set a Start Date and End Date.");
    }
    if (mode === "output_based" && (!rate.trim() || !Number.isFinite(Number(rate)))) {
      setError("Final Rate is required.");
      throw new Error("Final Rate is required.");
    }

    setSaving(true);
    setError(null);
    try {
      // Recurring template: same form, different table. Kept as its own branch
      // rather than another `mode` so every mode check below stays about
      // time-based vs output-based, which is what they actually mean.
      if (templateMode) {
        const payload: Record<string, unknown> = {
          title: taskName.trim(),
          task_name: taskName.trim(),
          account: account || null,
          project: project || null,
          category: category || null,
          description: taskDetail.trim() || null,
          task_detail: taskDetail.trim() || null,
          task_notes: taskNotes.trim() || null,
          link: link.trim() || null,
          ...(instructionsEditable
            ? { instructions: instructions.trim() || null }
            : instructionsAppend.trim()
            ? { instructions_append: instructionsAppend.trim() }
            : {}),
          ...(instructionsLockedAtLoad ? {} : { instructions_locked: instructionsLocked }),
          review_required: reviewRequired === "yes",
          start_date: startDate || null,
          end_date: endDate || null,
          due_time: dueTime || null,
          // Clock times, not instants — each occurrence supplies its own date.
          start_time: hasSchedule && startTime ? startTime : null,
          end_time: hasSchedule && endTime ? endTime : null,
          planned_minutes: hasSchedule ? null : parsedPlannedMinutes,
          project_id: linkedProjectId || null,
          assigned_to_ids: isAdminOrManager ? vaIds : [currentUserId].filter(Boolean),
          assigned_by: assignedBy || currentUserId || null,
          pay_type: null,
          ...templateExtra,
        };

        const res = await fetch(
          editingTemplateId
            ? `/api/recurring-task-templates?id=${editingTemplateId}`
            : "/api/recurring-task-templates",
          {
            method: editingTemplateId ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(editingTemplateId ? { id: editingTemplateId, ...payload } : payload),
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        const saved = data.template ?? {};
        if (!editingTemplateId && saved.id) await flushPendingFiles(saved.id);
        onSaved({ id: saved.id ?? 0, ...saved });
        return;
      }

      let task: { id: number; [key: string]: unknown };

      if (mode === "time_based") {
        // Companion template create/update happens BEFORE the main task save,
        // so a newly-created template's id can ride along in the same save
        // request as every other field below — that request always changes
        // task_name/account/etc. too, which is what reliably reaches this
        // route's metadata-update path. Sending spawned_template_id alone, in
        // a separate follow-up call, would hit none of assigned-tasks/[id]'s
        // hasCoreMetadataUpdate/hasScheduleUpdate/etc. branches and could be
        // silently dropped — this avoids ever constructing that request.
        let templateIdToLink: string | null = existingTemplateId;
        if (alsoSaveAsTemplate) {
          try {
            const templatePayload: Record<string, unknown> = {
              title: taskName.trim(),
              task_name: taskName.trim(),
              account: account || null,
              project: project || null,
              category: category || null,
              description: taskDetail.trim() || null,
              task_detail: taskDetail.trim() || null,
              task_notes: taskNotes.trim() || null,
              link: link.trim() || null,
              instructions: instructions.trim() || null,
              review_required: reviewRequired === "yes",
              start_date: startDate || null,
              end_date: endDate || null,
              due_time: dueTime || null,
              // Clock times, not instants — same reasoning as templateMode's
              // own save branch: each occurrence supplies its own date.
              start_time: hasSchedule && startTime ? startTime : null,
              end_time: hasSchedule && endTime ? endTime : null,
              planned_minutes: hasSchedule ? null : parsedPlannedMinutes,
              project_id: linkedProjectId || null,
              assigned_to_ids: effectiveVaIds,
              assigned_by: assignedBy || currentUserId || null,
              pay_type: null,
              recurrence_type: templateRecurrenceType,
              repeat_until: templateRepeatUntil || null,
              is_active: true,
            };
            if (existingTemplateId) {
              const res = await fetch(`/api/recurring-task-templates?id=${existingTemplateId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: existingTemplateId, ...templatePayload }),
              });
              if (res.ok) showToast("success", "Recurring template updated");
              else showToast("error", "Task saved, but the recurring template failed to update.");
            } else {
              const res = await fetch("/api/recurring-task-templates", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(templatePayload),
              });
              const data = await res.json().catch(() => ({}));
              if (res.ok && data.template?.id) {
                templateIdToLink = data.template.id;
                setExistingTemplateId(data.template.id);
                showToast("success", "Recurring template created");
              } else {
                showToast("error", "Task saved, but the recurring template failed to save.");
              }
            }
          } catch {
            showToast("error", "Task saved, but the recurring template failed to save.");
          }
        }

        const body: Record<string, unknown> = {
          account: account || null,
          project: project || null,
          task_name: taskName.trim(),
          category,
          task_detail: taskDetail.trim() || null,
          task_notes: taskNotes.trim() || null,
          link: link.trim() || null,
          due_date: dueDate || null,
          due_time: dueDate ? dueTime || null : null,
          start_date: startDate || null,
          end_date: endDate || null,
          assigned_by: assignedBy || currentUserId || null,
          pay_type: payType,
          project_id: linkedProjectId || null,
          parent_task_id: parentTaskId ? Number(parentTaskId) : null,
          spawned_template_id: templateIdToLink,
        };

        // Instructions are the assigner's. Sending them from a VA is a hard 403
        // server-side, and it would take the whole save down with it — so they
        // go in only for admins/managers, and a VA's contribution rides along
        // as an append instead.
        if (instructionsEditable) {
          body.instructions = instructions.trim() || null;
        } else if (instructionsAppend.trim()) {
          body.instructions_append = instructionsAppend.trim();
        }
        // The lock itself is always sent: it is the one part a VA can set, and
        // it only ever moves from off to on.
        if (!instructionsLockedAtLoad) body.instructions_locked = instructionsLocked;

        // Only sent when there's an actual answer, and only when the viewer is
        // allowed to give one — omitting it leaves the stored value and its
        // lock untouched, so an unrelated metadata save can't silently lock a
        // legacy task or overwrite an answer the viewer can't change.
        if (reviewRequired && reviewEditable) {
          body.review_required = reviewRequired === "yes";
        }

        // Work-span hours only ever anchor to startDate — due_date has its own
        // independent due_time field (below), so it never borrows this pair.
        //
        // The times are read as ORG (Eastern) wall clock, not the browser's:
        // the Calendar grid these are entered on is an Eastern grid, so "11:00"
        // means 11am Eastern for a Manila VA exactly as it does for an Eastern
        // admin. Parsing them browser-locally is what shifted VA blocks by
        // their UTC offset and pushed them off the visible grid.
        if (hasSchedule && startDate && startTime && endTime) {
          body.start_time = orgWallClockToUtc(startDate, startTime);
          body.end_time = orgWallClockToUtc(startDate, endTime);
        } else if (hasSchedule === false) {
          body.start_time = null;
          body.end_time = null;
        }

        // Specific hours and a bare duration are alternatives — with hours set,
        // the block's own length is the duration, so storing one alongside it
        // would double-count in the Hours tab's total.
        body.planned_minutes = hasSchedule ? null : parsedPlannedMinutes;


        if (isEditing && editingTaskId) {
          // va_ids rides along with the edit now. It used to be omitted
          // because the single select only knew the first assignee, so a
          // metadata save would have dropped the rest. The picker is seeded
          // from all of them, so what it sends is the whole set.
          if (isAdminOrManager && manageAssignment) body.va_ids = effectiveVaIds;
          // Only sent when the user was asked and chose to change the series.
          if (scope) body.scope = scope;
          if (isAdminOrManager) {
            const res = await fetch(`/api/assigned-tasks/${editingTaskId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            task = data.task;
          } else {
            const res = await fetch(`/api/assigned-tasks/${editingTaskId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            task = data.task ?? { id: editingTaskId };
          }
        } else {
          body.initial_status = isAdminOrManager ? initialStatus : "pending";
          if (manageAssignment && effectiveVaIds.length > 0) body.va_ids = effectiveVaIds;
          const res = await fetch("/api/assigned-tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
          task = data.task;

          if (pendingTodoTexts.length > 0) {
            for (const text of pendingTodoTexts) {
              await addTodo(task.id, text);
            }
          }
          await flushPendingFiles(task.id);
        }
      } else {
        const body: Record<string, unknown> = {
          task_name: taskName.trim(),
          account: account || null,
          project: project || null,
          category: category || null,
          rate: Number(rate),
          start_date: startDate || null,
          due_date: dueDate || null,
          end_date: endDate || null,
          task_detail: taskDetail.trim() || null,
          task_notes: taskNotes.trim() || null,
          link: link.trim() || null,
          instructions: instructions.trim() || null,
          project_id: linkedProjectId || null,
          // No duration field for Output Based tasks — Start Date/End Date is
          // their schedule instead, so there's nothing to send here.
          planned_minutes: null,
        };
        if (isAdminOrManager) {
          // fixed_pay_tasks has a single assigned_to column rather than a
          // join table, so an output-based task takes the first pick.
          body.assigned_to = effectiveVaIds[0] || null;
          body.assigned_by = assignedBy || null;
          if (!isEditing) body.status = initialStatus;
        }
        if (!isEditing) body.instructions_locked = instructionsLocked;

        const res = await fetch(
          isEditing && editingTaskId ? `/api/fixed-pay-tasks/${editingTaskId}` : "/api/fixed-pay-tasks",
          {
            method: isEditing ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        task = data.task;
      }

      onSaved(task);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save task.");
      throw e;
    } finally {
      setSaving(false);
    }
  }, [
    mode, taskName, account, project, category, taskDetail, taskNotes, link, dueDate, dueTime, startDate, endDate,
    templateMode, editingTemplateId, templateExtra, flushPendingFiles, instructionsEditable, instructionsLockedAtLoad,
    assignedBy, currentUserId, instructions, instructionsLocked, instructionsAppend, reviewRequired, reviewEditable, payType, linkedProjectId,
    parentTaskId, isAdminOrManager, vaIds, hasSchedule, startTime, endTime, rate, isEditing, editingTaskId, onSaved,
    // Without this the callback keeps the duration from the render it was built
    // in, so typing a duration and saving immediately wrote the previous value
    // (usually null) — the field looked filled in and still saved empty.
    parsedPlannedMinutes,
    pendingTodoTexts, readOnly, alsoSaveAsTemplate, templateRecurrenceType, templateRepeatUntil, existingTemplateId, showToast,
  ]);


  // A task generated from a recurring template belongs to a series, so saving
  // it raises the question the calendar apps all ask: this one, or all of them?
  // Asked only when it applies — a one-off saves straight through.
  const belongsToSeries = Boolean(initialTask?.recurring_template_id) && isEditing;
  const [scopeAsk, setScopeAsk] = useState<null | { resolve: (s: "this" | "future" | null) => void }>(null);

  const handleSubmit = useCallback(async () => {
    if (!belongsToSeries || readOnly) return submitWithScope();
    const choice = await new Promise<"this" | "future" | null>((resolve) => setScopeAsk({ resolve }));
    setScopeAsk(null);
    if (choice === null) return; // cancelled — nothing saved
    return submitWithScope(choice);
  }, [belongsToSeries, readOnly, submitWithScope]);
  useImperativeHandle(ref, () => ({ submit: handleSubmit }), [handleSubmit]);

  // Unchecking "Also save as a recurring template" on a task that already has
  // one deletes it — the template row itself, not the task. Deletion cascades
  // (recurring_task_templates → assigned_tasks.spawned_template_id, via
  // ON DELETE SET NULL) clear the link on the DB side automatically; this just
  // keeps local state in sync with that. Gated behind ConfirmModal since it's
  // a real, hard-to-reverse delete — same rule as everywhere else it's used.
  const handleUnlinkTemplate = useCallback(async () => {
    if (!existingTemplateId) return;
    setUnlinkingTemplate(true);
    try {
      const res = await fetch(`/api/recurring-task-templates?id=${existingTemplateId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setExistingTemplateId(null);
      setAlsoSaveAsTemplate(false);
      setPendingUnlinkTemplate(false);
      showToast("success", "Recurring template removed");
    } catch {
      showToast("error", "Failed to remove the recurring template. Please try again.");
    } finally {
      setUnlinkingTemplate(false);
    }
  }, [existingTemplateId, showToast]);

  // What's still required, per section. These sections start collapsed, so an
  // empty required field was invisible and the only symptom was a Save button
  // that refused to work with no explanation. Each section names its own gap in
  // its header, and the footer lists them together.
  const needsTaskName = !taskName.trim();
  const needsClientDetail = !taskDetail.trim();
  const needsReviewAnswer = mode === "time_based" && !isEditing && !reviewRequired;
  const needsRate = mode === "output_based" && (!rate.trim() || !Number.isFinite(Number(rate)));
  // templateMode (the Recurring tab) IS a template; alsoSaveAsTemplate rides
  // one along with a regular task. Either way there's no single due date.
  const isRecurringFlow = templateMode || alsoSaveAsTemplate;
  const needsDueDate = !isEditing && !isRecurringFlow && !dueDate;
  // A recurring task has no single due date — each generated occurrence gets
  // its own — so Start Date takes over as the required anchor instead.
  // Not create-only (see the matching handleSubmit check) — editing an
  // existing template's Start Date away is exactly as fatal as never having
  // set one.
  const needsStartDateForRecurring = isRecurringFlow && !startDate;
  // Time-based: a time range OR a duration, either one satisfies it — they're
  // alternatives, not both. Output Based has no time range or duration to
  // offer — Start Date + End Date on the Calendar is its schedule instead.
  const hasTimeRange = hasSchedule && Boolean(startDate) && Boolean(startTime) && Boolean(endTime);
  const hasDuration = parsedPlannedMinutes != null;
  const hasDateRange = Boolean(startDate) && Boolean(endDate);
  const needsSchedule = mode === "time_based" ? !hasTimeRange && !hasDuration : !hasDateRange;

  // Section badges say what kind of gap it is, not which field — the field
  // itself goes amber, so naming it twice was redundant. Basics is entirely
  // required, so it says so outright.
  const missingBasics = needsTaskName ? "Required block" : null;
  const missingDetails = needsClientDetail ? "Required field/s inside" : null;
  const missingAssignment = needsReviewAnswer ? "Required field/s inside" : null;
  const missingRate = needsRate ? "Required field/s inside" : null;
  const missingSchedule = needsSchedule || needsDueDate || needsStartDateForRecurring ? "Required field/s inside" : null;

  // The footer still names them, since that's the "why won't this save" spot.
  const missingRequired = [
    needsTaskName ? "Task Name" : null,
    needsClientDetail ? "Client Detail" : null,
    needsReviewAnswer ? "Review Required" : null,
    needsRate ? "Final Rate" : null,
    needsSchedule ? (mode === "time_based" ? "Time range or Duration" : "Start Date and End Date") : null,
    needsDueDate ? "Due Date" : null,
    needsStartDateForRecurring ? "Start Date" : null,
  ].filter((m): m is string => Boolean(m));

  // An unfilled required input reads amber — a prompt, not an error. Terracotta
  // is kept for the things that have actually gone wrong.
  const requiredInputClass = (filled: boolean) =>
    filled ? inputClass : `${inputClass} border-terracotta bg-terracotta-soft/40`;

  const assignToOptions = teamMembers;
  const assignByOptions = teamMembers;

  return (
    <div className="space-y-3">
      <Section title="Basics" {...accordionProps("basics")} warning={missingBasics}>
        <div>
          <label className={labelClass}>Account</label>
          <select
            value={account}
            onChange={(e) => {
              const value = e.target.value;
              setAccount(value);
              setProject("");
              if (!isEditing) setTaskName("");
              applyAutoCategory(value, "", isEditing ? taskName : "");
            }}
            disabled={readOnly}
            className={inputClass}
          >
            <option value="">Select account...</option>
            {accounts.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>Project</label>
          <select
            value={project}
            onChange={(e) => {
              const value = e.target.value;
              setProject(value);
              if (!isEditing) setTaskName("");
              applyAutoCategory(account, value, isEditing ? taskName : "");
            }}
            disabled={!account || readOnly}
            className={inputClass}
          >
            <option value="">{account ? "Select project..." : "Select account first..."}</option>
            {objectiveOptionsForAccount.map((p) => (
              <option key={p.id} value={p.project_name}>{p.project_name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>Task Name</label>
          {/* Never free text. A task name typed by hand doesn't exist in the
              task library, so it can't carry a billing type or rate and won't
              match anything in reporting — the dropdown is the only source.
              Objectives with no tasks configured (Projects & Tasks in the admin
              panel) offer nothing to pick, and the field says so rather than
              inviting one to be invented. */}
          {taskNameLocked ? (
            <input value={taskName} readOnly disabled className={inputClass} />
          ) : (
            <select
              value={taskName}
              onChange={(e) => {
                const value = e.target.value;
                setTaskName(value);
                applyAutoCategory(account, project, value);
              }}
              disabled={readOnly || taskOptionsForObjective.length === 0}
              className={requiredInputClass(!needsTaskName)}
            >
              <option value="">
                {!project
                  ? "Select a project first..."
                  : taskOptionsForObjective.length === 0
                  ? "No tasks set up for this project"
                  : "Select task..."}
              </option>
              {taskOptionsForObjective.map((t) => (
                <option key={t.id} value={t.task_name}>{t.task_name}</option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label className={`${labelClass} flex items-center gap-1.5`}>Category<InfoTip text="Set automatically from Account, Project and Task Name." /></label>
          {/* Derived, not chosen — autoCategoryForTask sets it from Account,
              Project and Task Name, and every task-creation surface applies
              the same rule. Leaving it editable meant a hand-picked value could
              silently disagree with the rule, and get overwritten anyway the
              next time any of the three inputs changed. */}
          <input value={category} readOnly disabled className={inputClass} />
        </div>
      </Section>

      <Section title="Details" {...accordionProps("details")} warning={missingDetails}>
        <div>
          <div className="mb-1 flex items-center gap-1.5">
            <label className="block text-[11px] font-bold uppercase tracking-wide text-amber">
              Client Detail <span className="text-terracotta">*</span>
            </label>
            <ClientMemoFormatTooltip />
          </div>
          <textarea
            value={taskDetail}
            onChange={(e) => setTaskDetail(limitToWords(e.target.value, CLIENT_MEMO_WORD_LIMIT))}
            rows={2}
            disabled={readOnly}
            placeholder="Client-visible memo"
            className={`${requiredInputClass(!needsClientDetail)} resize-none`}
          />
          <p className="mt-1 text-[10px] text-stone">
            {Math.max(0, CLIENT_MEMO_WORD_LIMIT - countWords(taskDetail))} words remaining — this is what carries over to the client invoice/report.
          </p>
        </div>

        {supportsTodos && (
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-amber">To-Do List<InfoTip text="Internal only — tracks sub-steps and time per item, and shows in internal reports. Doesn't affect the client memo." /></label>
            {!isEditing && (
              <p className="mb-1.5 text-[10px] text-stone">These save with the task once you click Create Task.</p>
            )}
            {todosLoading ? (
              <p className="text-[12px] text-stone">Loading...</p>
            ) : (
              <div className="space-y-1.5">
                {(isEditing ? todos : pendingTodoTexts).map((t, i) => {
                  const text = typeof t === "string" ? t : t.text;
                  const key = typeof t === "string" ? i : t.id;
                  return (
                    <div key={key} className="flex items-center gap-2 rounded-lg border border-sand bg-white px-2.5 py-1.5">
                      <span className="shrink-0 rounded bg-stone/10 px-1.5 py-0.5 text-[10px] font-bold text-stone">{todoLabel(i)}</span>
                      <input
                        defaultValue={text}
                        disabled={readOnly || (typeof t !== "string" && todoBusyId === t.id)}
                        onBlur={(e) => {
                          const value = e.target.value.trim();
                          if (!value || value === text) return;
                          if (typeof t === "string") handleUpdatePendingTodo(i, value);
                          else void handleUpdateTodo(t.id, value);
                        }}
                        className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[13px] outline-none focus:border-sand"
                      />
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => (typeof t === "string" ? handleRemovePendingTodo(i) : void handleDeleteTodo(t.id))}
                          disabled={typeof t !== "string" && todoBusyId === t.id}
                          className="shrink-0 text-[11px] font-semibold text-terracotta hover:underline disabled:opacity-50"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  );
                })}
                {!readOnly && (
                  <div className="flex gap-2">
                    <input
                      value={newTodoText}
                      onChange={(e) => setNewTodoText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleAddTodo(); } }}
                      placeholder="Add a to-do item..."
                      className={`${inputClass} flex-1`}
                    />
                    <button
                      type="button"
                      onClick={() => void handleAddTodo()}
                      disabled={!newTodoText.trim()}
                      className="shrink-0 rounded-lg bg-sage px-3 py-1 text-[11px] font-semibold text-white hover:bg-sage/90 disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div>
          <label className={labelClass}>Notes</label>
          <textarea value={taskNotes} onChange={(e) => setTaskNotes(e.target.value)} rows={2} disabled={readOnly} placeholder="Internal notes" className={`${inputClass} resize-none`} />
        </div>

        <div>
          <label className={`${labelClass} flex items-center gap-1.5`}>
            Instructions
            <InfoTip text="Locking is one-way. Once locked the wording can't be edited or unlocked by anyone — notes get added on top instead, so nothing already agreed is rewritten." />
          </label>
          {instructionsEditable ? (
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={2}
              disabled={readOnly}
              className={`${inputClass} resize-none`}
            />
          ) : instructions.trim() ? (
            <p className="whitespace-pre-wrap rounded-lg border border-sand bg-parchment/40 px-3 py-2 text-[13px] text-espresso">
              {instructions}
            </p>
          ) : (
            <p className="text-[12px] text-stone/50">No instructions yet.</p>
          )}

          {/* Everyone sees the lock, VAs included, and it only goes one way:
              once saved locked it can't be cleared by anyone. That is what makes
              it worth trusting — otherwise "locked" is just a checkbox. */}
          <label className="mt-1 flex items-center gap-1.5 text-[11px] text-espresso">
            <input
              type="checkbox"
              checked={instructionsLocked}
              onChange={(e) => setInstructionsLocked(e.target.checked)}
              disabled={readOnly || instructionsLockedAtLoad}
            />
            Locked
            {instructionsLockedAtLoad && <span className="text-[10px] text-stone">— can&apos;t be undone</span>}
          </label>

          {!readOnly && !instructionsEditable && (
            <div className="mt-1">
              {!showInstructionAdd ? (
                <button
                  type="button"
                  onClick={() => setShowInstructionAdd(true)}
                  className="text-[11px] font-semibold text-terracotta hover:underline"
                >
                  + Instruction
                </button>
              ) : (
                <div>
                  <textarea
                    value={instructionsAppend}
                    onChange={(e) => setInstructionsAppend(e.target.value)}
                    rows={2}
                    autoFocus
                    placeholder="Add a note — it goes to the top, nothing below it changes."
                    className={`${inputClass} resize-none`}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setShowInstructionAdd(false);
                      setInstructionsAppend("");
                    }}
                    className="mt-1 text-[11px] font-semibold text-stone hover:underline"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {!templateMode && !isEditing && isAdminOrManager && (
          <div>
            <label className={labelClass}>Status</label>
            <select value={initialStatus} onChange={(e) => setInitialStatus(e.target.value)} disabled={readOnly} className={inputClass}>
              {(mode === "time_based" ? TIME_BASED_STATUS_OPTIONS : OUTPUT_BASED_STATUS_OPTIONS).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        )}
      </Section>

      <Section title="Attachments & Files" {...accordionProps("attachments")}>
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <label className={`${labelClass} mb-0`}>Attachments</label>
            {!readOnly && (
              <button
                type="button"
                onClick={() => attachmentInputRef.current?.click()}
                disabled={uploading}
                className="rounded-lg border border-sand bg-white px-3 py-1 text-[11px] font-semibold text-espresso transition-colors hover:bg-parchment disabled:opacity-50"
              >
                {uploading ? "Uploading..." : "Attach File"}
              </button>
            )}
            <input
              ref={attachmentInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                e.target.value = "";
                void handleFilesPicked(picked);
              }}
            />
          </div>

          {attachmentsLoading ? (
            <p className="text-[12px] text-stone">Loading...</p>
          ) : attachments.length === 0 && pendingFiles.length === 0 ? (
            <p className="text-[12px] text-stone/50">No attachments.</p>
          ) : (
            <div className="space-y-1.5">
              {attachments.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-sand bg-white px-2.5 py-1.5">
                  <span className="min-w-0">
                    {a.url ? (
                      <a href={a.url} target="_blank" rel="noreferrer" className="block truncate text-[12px] text-terracotta hover:underline">
                        {a.filename}
                      </a>
                    ) : (
                      <span className="block truncate text-[12px] text-espresso">{a.filename}</span>
                    )}
                    {a.file_size != null && <span className="text-[10px] text-stone">{formatFileSize(a.file_size)}</span>}
                  </span>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => void handleDeleteAttachment(a.id)}
                      className="shrink-0 text-[11px] font-semibold text-terracotta hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              {/* Held until the task exists — uploaded by handleSubmit. */}
              {pendingFiles.map((file, i) => (
                <div key={`${file.name}-${i}`} className="flex items-center justify-between gap-2 rounded-lg border border-sand bg-parchment/40 px-2.5 py-1.5">
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] text-walnut">{file.name}</span>
                    <span className="text-[10px] text-stone">{formatFileSize(file.size)} · uploads when you create the task</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
                    className="shrink-0 text-[11px] font-semibold text-terracotta hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {attachmentsExtra}

        <div>
          <label className={labelClass}>Link</label>
          <input value={link} onChange={(e) => setLink(e.target.value)} disabled={readOnly} placeholder="https://..." className={inputClass} />
          <SubmissionLinks submissions={submissions} />
        </div>

        <SubmissionFiles submissions={submissions} />

        {hasSubmissionNotes && (
          <div>
            <label className={labelClass}>Submission Notes</label>
            <SubmissionNotes submissions={submissions} />
          </div>
        )}
      </Section>

      <Section title="Assignment" {...accordionProps("assignment")} warning={missingAssignment}>
        {manageAssignment && (
          <div>
            <label className={`${labelClass} flex items-center gap-1.5`}>
              Assign To
              <InfoTip text="Pick everyone involved. Each of them gets the task on their own calendar, so a task with hours blocks the time for all of them." />
            </label>
            {!isAdminOrManager ? (
              // A VA only ever assigns to themselves, so there's no list to offer.
              <input value="You" readOnly disabled className={inputClass} />
            ) : assignToOptions.length === 0 ? (
              <p className="text-[12px] text-stone/60">No team members to assign.</p>
            ) : (
              <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-sand bg-white p-1.5">
                {assignToOptions.map((m) => (
                  <label
                    key={m.id}
                    className={`flex items-center gap-2 rounded px-1.5 py-1 text-[12px] transition-colors ${
                      readOnly ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-cream"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={vaIds.includes(m.id)}
                      onChange={() => toggleVaId(m.id)}
                      disabled={readOnly}
                      className="accent-terracotta"
                    />
                    <span className="truncate text-espresso">{m.full_name || m.username}</span>
                  </label>
                ))}
              </div>
            )}
            {isAdminOrManager && (
              <p className="mt-1 text-[10px] text-stone">
                {vaIds.length === 0
                  ? "Unassigned"
                  : `${vaIds.length} assigned${
                      mode === "output_based" && vaIds.length > 1 ? " — output-based keeps the first only" : ""
                    }`}
              </p>
            )}
          </div>
        )}

        <div>
          <label className={labelClass}>Assigned By</label>
          <select value={assignedBy} onChange={(e) => setAssignedBy(e.target.value)} disabled={readOnly} className={inputClass}>
            {assignByOptions.map((m) => (
              <option key={m.id} value={m.id}>{m.full_name || m.username}</option>
            ))}
          </select>
        </div>

        <div className="rounded-lg border border-sand bg-cream/40 p-3 space-y-2">
          {lockedProjectId ? (
            <p className="text-[11px] text-stone">Scoped to this project — added here, so it can&apos;t be linked elsewhere.</p>
          ) : (
            <>
              <div>
                <label className={`${labelClass} flex items-center gap-1.5`}>Link to Objective<InfoTip text="A task links to an Objective or an Operation, not both — picking one clears the other." /></label>
                <select
                  value={linkedObjectiveId}
                  onChange={(e) => setLinkedProjectId(e.target.value)}
                  disabled={readOnly}
                  className={inputClass}
                >
                  <option value="">— None —</option>
                  {objectiveTree.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelClass}>Link to Operations</label>
                <select
                  value={linkedOperationId}
                  onChange={(e) => setLinkedProjectId(e.target.value)}
                  disabled={readOnly}
                  className={inputClass}
                >
                  <option value="">— None —</option>
                  {operationTree.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>
            </>
          )}
          {mode === "time_based" && linkedProjectId && parentTaskOptions.length > 0 && (
            <select value={parentTaskId} onChange={(e) => setParentTaskId(e.target.value)} disabled={readOnly} className={inputClass}>
              <option value="">Top-level task in this project</option>
              {parentTaskOptions.map((t) => (
                <option key={t.id} value={t.id}>Subtask of: {t.task_name}</option>
              ))}
            </select>
          )}
        </div>

        {mode === "time_based" && (
          <div>
            <label className={`${labelClass} flex items-center gap-1.5`}>
              Review Required {!isEditing && <span className="text-terracotta">*</span>}
              <InfoTip text="Yes locks — only Admin, Manager, CEO, or Founder can undo it. No stays changeable." />
            </label>
            <div className="flex gap-2">
              {([["yes", "Yes"], ["no", "No"]] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setReviewRequired(value)}
                  disabled={readOnly || !reviewEditable}
                  className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                    reviewRequired === value
                      ? "bg-sage text-white"
                      : needsReviewAnswer
                      ? // Unanswered and required — amber, like the other
                        // required fields waiting on input.
                        "border border-terracotta bg-terracotta-soft/40 text-terracotta hover:bg-terracotta-soft"
                      : "bg-stone/10 text-stone hover:bg-stone/20"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {reviewLocked && !reviewEditable && (
              <p className="mt-1 text-[10px] text-stone">Locked at Yes.</p>
            )}
          </div>
        )}

        {mode === "output_based" && (
          <div>
            <label className={`${labelClass} flex items-center gap-1.5`}>
              Review Required
              <InfoTip text="Always Yes for Output Based tasks — pay only counts once the submission is approved." />
            </label>
            <span className="inline-block rounded-lg bg-sage px-3 py-1 text-[11px] font-semibold text-white">Yes</span>
          </div>
        )}
      </Section>

      {mode === "output_based" && (
        <Section title="Rate" {...accordionProps("rate")} warning={missingRate}>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className={labelClass}>Unit Rate</label>
              <input
                value={unitRate}
                onChange={(e) => {
                  const value = e.target.value;
                  const total = computeQuantityTotal(value, quantity);
                  setUnitRate(value);
                  if (total != null) setRate(total.toFixed(2));
                }}
                disabled={readOnly}
                placeholder="0.00"
                className={inputClass}
              />
            </div>
            <div className="flex-1">
              <label className={labelClass}>Quantity</label>
              <input
                value={quantity}
                onChange={(e) => {
                  const value = e.target.value;
                  const total = computeQuantityTotal(unitRate, value);
                  setQuantity(value);
                  if (total != null) setRate(total.toFixed(2));
                }}
                disabled={readOnly}
                placeholder="0"
                className={inputClass}
              />
            </div>
          </div>
          {(unitRate.trim() !== "" || quantity.trim() !== "") && (
            <p className="text-[11px] text-stone">
              {quantityTotal != null ? (
                <>{unitRate} × {quantity} = <span className="font-semibold text-espresso">${quantityTotal.toFixed(2)}</span></>
              ) : (
                "Enter both a rate and a quantity to auto-fill Final Rate."
              )}
            </p>
          )}

          <div className="flex gap-3">
            <div className="flex-1">
              <label className={labelClass}>Duration</label>
              <input
                value={durationValue}
                onChange={(e) => {
                  const value = e.target.value;
                  const equivalent = computeHourlyEquivalent(value, durationUnit, currentPayRate ?? null);
                  setDurationValue(value);
                  if (equivalent != null) setRate(equivalent.toFixed(2));
                }}
                disabled={readOnly}
                placeholder="0"
                className={inputClass}
              />
            </div>
            <div className="flex-1">
              <label className={labelClass}>Unit</label>
              <select
                value={durationUnit}
                onChange={(e) => {
                  const unit = e.target.value as "hours" | "minutes";
                  const equivalent = computeHourlyEquivalent(durationValue, unit, currentPayRate ?? null);
                  setDurationUnit(unit);
                  if (equivalent != null) setRate(equivalent.toFixed(2));
                }}
                disabled={readOnly}
                className={inputClass}
              >
                <option value="hours">Hours</option>
                <option value="minutes">Minutes</option>
              </select>
            </div>
          </div>
          {hourlyEquivalentTotal != null ? (
            <p className="text-[11px] text-stone">
              At your hourly rate, that&apos;s worth <span className="font-semibold text-espresso">${hourlyEquivalentTotal.toFixed(2)}</span>
            </p>
          ) : currentPayRate == null ? (
            <p className="text-[11px] text-stone">No hourly rate is set for your profile, so we can&apos;t fill in a rate for you — enter one manually.</p>
          ) : null}

          <div>
            <label className={labelClass}>Final Rate</label>
            <input value={rate} onChange={(e) => setRate(e.target.value)} disabled={readOnly} placeholder="0.00" className={requiredInputClass(!needsRate)} />
          </div>
        </Section>
      )}

      <Section title="Schedule" {...accordionProps("schedule")} warning={missingSchedule}>
        {/* Repeat + Active — the one thing a template has that a task doesn’t. */}
        {recurrenceControl}
        <div className="rounded-lg border border-sand bg-cream/40 p-3 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-stone">
            {/* Tooltip rather than prose, per the form's new pattern — but the
                text still has to split by mode: Output Based work has no hours
                to land on the grid, so promising a "daily block" would be a lie
                on that half of the form. */}
            <span className="flex items-center gap-1.5">
              {mode === "time_based" ? "Work span (optional)" : (
                <>Work span {!isEditing && <span className="text-terracotta">*</span>}</>
              )}
              <InfoTip
                text={
                  mode === "time_based"
                    ? "The days this task runs across. Below, choose whether it takes specific hours on the Calendar or just a duration."
                    : "The days this task runs across on the Calendar — Output Based work is paid per output and has no duration, so Start Date and End Date are its schedule."
                }
              />
            </span>
          </p>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className={labelClass}>
                Start Date {needsStartDateForRecurring && <span className="text-terracotta">*</span>}
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={readOnly}
                className={
                  mode === "output_based" || isRecurringFlow ? requiredInputClass(Boolean(startDate)) : inputClass
                }
              />
              {isRecurringFlow && !startDate && (
                <p className="mt-1 text-[11px] text-stone">Required — this is the date the recurring template starts generating from.</p>
              )}
            </div>
            <div className="flex-1">
              <label className={labelClass}>End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={readOnly}
                className={mode === "output_based" ? requiredInputClass(Boolean(endDate)) : inputClass}
              />
            </div>
          </div>

          {/* Specific hours are a time-based-only field: output-based tasks are
              stored in fixed_pay_tasks, which has start_date/due_date/end_date
              but no start_time/end_time columns, so the output-based save path
              has nowhere to put them. Offering the inputs anyway meant an admin
              could set 11am–12pm on a Per Task VA's block and watch the hours
              vanish — the task came back as an untimed pill instead. */}
          {mode === "time_based" ? (
            <>
              {/* Two named tabs rather than a checkbox. As a checkbox, the
                  duration option only existed in the UNCHECKED state, so nobody
                  who left it checked ever discovered it — the choice between
                  "a slot on the calendar" and "just how long it takes" was
                  invisible. Both are named now, so it reads as the either/or it
                  actually is. hasSchedule is still the underlying state, so the
                  save path is unchanged: true writes start_time/end_time, false
                  writes planned_minutes. */}
              <div className="flex rounded-lg border border-sand overflow-hidden text-[12px] font-semibold">
                {([
                  [true, "Add hours to calendar"],
                  [false, "Add duration"],
                ] as const).map(([wantsHours, label]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      setHasSchedule(wantsHours);
                      // The two are alternatives, not extras: specific hours
                      // already say how long the task takes, so keeping a
                      // separate duration around would let the Hours tab count
                      // it twice.
                      if (wantsHours) setPlannedDuration("");
                    }}
                    disabled={readOnly}
                    className={`flex-1 px-3 py-1.5 transition-colors disabled:opacity-50 ${
                      hasSchedule === wantsHours ? "bg-terracotta text-white" : "bg-white text-stone hover:bg-cream"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {!hasSchedule && (
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-walnut">Duration</label>
                  <DurationFields value={plannedDuration} onChange={setPlannedDuration} disabled={readOnly} invalid={needsSchedule} />
                  <p className="mt-1 text-[10px] text-stone">
                    {parsedPlannedMinutes != null
                      ? `Counts toward the day's total on the Calendar's Hours tab, without taking a slot on the grid.`
                      : "How long this takes, when it doesn't need a particular time. Leave empty if it doesn't matter."}
                  </p>
                </div>
              )}
              {hasSchedule && (
                <>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="mb-1 block text-[10px] font-semibold text-walnut">Start Time</label>
                      <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={readOnly} className={inputClass} />
                    </div>
                    <div className="flex-1">
                      <label className="mb-1 block text-[10px] font-semibold text-walnut">End Time</label>
                      <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={readOnly} className={inputClass} />
                    </div>
                  </div>
                  {scheduleHelperText && <p className="text-[11px] text-stone">{scheduleHelperText}</p>}
                  {!startDate && <p className="text-[11px] text-terracotta">Set a Start Date above so these hours have a day to block.</p>}
                </>
              )}
            </>
          ) : (
            // Output Based work has no duration field — it's paid per output,
            // not per hour, so Start Date + End Date above is the whole
            // schedule commitment. No tabs, no duration input.
            <p className="text-[11px] text-stone">
              Paid per output, so this doesn&apos;t take a time slot or a duration — the Start Date and End Date above put it on the Calendar.
            </p>
          )}
        </div>

        <div className="rounded-lg border border-sand bg-cream/40 p-3 space-y-2">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone">Deadline<InfoTip text="Separate from the work span above — a single moment, not a range." /></p>
          <div>
            <label className={labelClass}>
              Due Date {!isEditing && !isRecurringFlow && <span className="text-terracotta">*</span>}
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={readOnly}
              className={requiredInputClass(Boolean(dueDate) || isRecurringFlow)}
            />
            {isRecurringFlow && (
              <p className="mt-1 text-[11px] text-stone">
                Optional here — a recurring task has no single due date, since each occurrence gets its own.
              </p>
            )}
          </div>
          {dueDate && (
            <div>
              <label className="mb-1 block text-[10px] font-semibold text-walnut">Due Time (optional)</label>
              <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} disabled={readOnly} className={inputClass} />
            </div>
          )}
        </div>

        {!templateMode && mode === "time_based" && (
          /* Highlighted rather than another grey box — this one turns a one-off
             into a repeating commitment, which is worth noticing before you save. */
          <div className={`rounded-lg border-2 p-3 space-y-2 ${
            alsoSaveAsTemplate ? "border-terracotta bg-terracotta-soft/50" : "border-amber bg-amber-soft/40"
          }`}>
            <label className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide text-espresso">
              <input
                type="checkbox"
                checked={alsoSaveAsTemplate}
                onChange={(e) => {
                  const checked = e.target.checked;
                  if (!checked && existingTemplateId) {
                    // Unchecking an existing link is a real delete — confirm
                    // first rather than applying it immediately.
                    setPendingUnlinkTemplate(true);
                    return;
                  }
                  setAlsoSaveAsTemplate(checked);
                }}
                disabled={readOnly}
              />
              Save as a recurring template
            </label>
            {alsoSaveAsTemplate && (
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-walnut">Repeat</label>
                <select
                  value={templateRecurrenceType}
                  onChange={(e) => setTemplateRecurrenceType(e.target.value as RecurrenceType)}
                  disabled={readOnly}
                  className={inputClass}
                >
                  {RECURRENCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <div className="mt-2">
                  <label className="mb-1 block text-[10px] font-semibold text-walnut">Repeat until (optional)</label>
                  <input
                    type="date"
                    value={templateRepeatUntil}
                    onChange={(e) => setTemplateRepeatUntil(e.target.value)}
                    disabled={readOnly}
                    className={inputClass}
                  />
                  <p className="mt-1 text-[10px] text-stone">
                    {templateRepeatUntil
                      ? `Stops after ${templateRepeatUntil}.`
                      : "Leave blank to repeat indefinitely."}
                  </p>
                </div>
                <p className="mt-1 text-[10px] text-stone">
                  {existingTemplateId
                    ? "Linked to a recurring template — saving updates it to match this task's details."
                    : "Creates a separate recurring template from this task's details — the task itself saves normally either way."}
                </p>
              </div>
            )}
          </div>
        )}
      </Section>

      {pendingUnlinkTemplate && (
        <ConfirmModal
          title="Remove this recurring template?"
          message="Unchecking this deletes the recurring template created from this task. The task itself is not affected. This cannot be undone."
          confirmLabel="Delete Template"
          confirming={unlinkingTemplate}
          onConfirm={() => void handleUnlinkTemplate()}
          onCancel={() => setPendingUnlinkTemplate(false)}
        />
      )}

      {supportsTodos && (
        <Section title="Screenshots" {...accordionProps("screenshots")}>
          {!editingTaskId ? (
            <p className="text-[12px] text-stone/50">Screenshots are captured while working on the task — none yet.</p>
          ) : screenshotsLoading ? (
            <p className="text-[12px] text-stone">Loading screenshots...</p>
          ) : screenshots.length === 0 ? (
            <p className="text-[12px] text-stone/50">No screenshots.</p>
          ) : (
            <div className="space-y-3">
              {/* Grouped by day: a task put on hold and resumed spans dates, so a
                  bare time would be ambiguous about which day it belongs to. */}
              {Object.entries(
                screenshots.reduce<Record<string, typeof screenshots>>((byDay, ss) => {
                  const key = formatDateLocalTZ(shotTakenAt(ss), timezone);
                  (byDay[key] ||= []).push(ss);
                  return byDay;
                }, {})
              ).map(([dayKey, dayShots]) => (
                <div key={dayKey}>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-walnut">
                    {formatDateFullTZ(dayShots[0] ? shotTakenAt(dayShots[0]) : dayKey, timezone)}
                    <span className="ml-1.5 font-normal normal-case tracking-normal text-stone">
                      {dayShots.length} shot{dayShots.length !== 1 ? "s" : ""}
                    </span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {dayShots.map((ss) => {
                      const takenAt = shotTakenAt(ss);
                      // Index into viewableShots, not screenshots: markers carry no
                      // image and are left out of the lightbox, so using the full-list
                      // index would open the wrong picture whenever one precedes it.
                      const lightboxIdx = viewableShots.findIndex((s) => s.id === ss.id);
                      // A row with no image is a recorded reason there is no screenshot
                      // (idle, locked, capture failed) — show the reason, not a dead tile.
                      const isMarker = ss.screenshot_type === "failed" || !ss.url;
                      return (
                        <div key={ss.id} className="flex w-[64px] shrink-0 flex-col gap-0.5">
                          <button
                            type="button"
                            onClick={() => ss.url && setLightboxIndex(lightboxIdx)}
                            disabled={!ss.url}
                            className="relative h-[48px] w-[64px] cursor-pointer overflow-hidden rounded border border-sand bg-parchment transition-all hover:scale-105 hover:border-terracotta disabled:cursor-not-allowed disabled:hover:scale-100"
                            title={
                              isMarker
                                ? ss.failure_reason || "No screenshot"
                                : `${ss.screenshot_type || "manual"} — taken ${formatDateTimeTZ(takenAt, timezone)}`
                            }
                          >
                            {isMarker ? (
                              <div className="flex h-full w-full items-center justify-center px-1 text-center text-[7px] leading-tight text-bark">
                                {ss.failure_reason || "No screenshot"}
                              </div>
                            ) : (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={ss.url as string} alt="" loading="lazy" className="h-full w-full object-cover" />
                            )}
                          </button>
                          <span className="text-center text-[9px] leading-none text-stone">
                            {formatTimeTZ(takenAt, timezone)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          {lightboxIndex !== null && (
            <ScreenshotLightbox
              urls={viewableShots.map((s) => s.url as string)}
              captions={viewableShots.map((s) => formatDateTimeTZ(shotTakenAt(s), timezone))}
              initialIndex={lightboxIndex}
              onClose={() => setLightboxIndex(null)}
            />
          )}
        </Section>
      )}

      {scopeAsk && (
        <RecurringScopeDialog
          action="edit"
          taskName={taskName || "This task"}
          onChoose={(choice) => scopeAsk.resolve(choice)}
          onCancel={() => scopeAsk.resolve(null)}
        />
      )}
      {error && <p className="text-[12px] text-red-600">{error}</p>}

      {!hideFooter && (
        <div className="flex items-center gap-2 pt-1">
          {readOnly ? (
            <button onClick={onCancel} className="px-4 py-2 rounded-lg text-[13px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors">
              Close
            </button>
          ) : (
            <>
              <button
                onClick={() => void handleSubmit().catch(() => {})}
                disabled={saving || !taskName.trim() || !taskDetail.trim()}
                className="px-4 py-2 rounded-lg bg-sage text-white text-[13px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
              >
                {saving ? "Saving..." : isEditing ? "Save Changes" : "Create Task"}
              </button>
              {/* Only when the button is actually blocked. The sections already
                  flag themselves and the fields go terracotta, so this is the
                  last resort for "why won't this save", not a running notice. */}
              {missingRequired.length > 0 && (
                <InfoTip text={`Still needed: ${missingRequired.join(", ")}. The section holding each one is marked.`} />
              )}
              <button onClick={onCancel} className="px-4 py-2 rounded-lg text-[13px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors">
                Cancel
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
});

export default TaskEditor;
