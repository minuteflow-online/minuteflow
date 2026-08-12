"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { countWords } from "@/lib/utils";
import { CATEGORY_OPTIONS } from "@/lib/taskSchedule";
import Section from "@/components/ui/Section";
import { fetchTodos, addTodo, updateTodo, deleteTodo, todoLabel, type TaskTodo } from "@/lib/taskTodos";
import type { Project } from "@/types/database";

const CLIENT_MEMO_WORD_LIMIT = 15;

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
  initialTask?: TaskEditorInitialTask | null;
  currentUserId: string;
  isAdminOrManager: boolean;
  teamMembers: TeamMemberOption[];
  defaultVaId?: string;
  defaultDate?: string;
  defaultStartTime?: string;
  defaultEndTime?: string;
  defaultLinkedProjectId?: string;
  /** VA's own hourly rate — feeds the Rate section's Duration × Rate helper. */
  currentPayRate?: number;
  /** Hides the built-in Save/Cancel footer — use with a ref to trigger submit() from a parent-owned footer instead. */
  hideFooter?: boolean;
  /** Set false to hide the Assign To field and never touch va_ids — for callers with their own multi-assignee UI (assigned_tasks supports several assignees; this form's Assign To is single-select). Default true. */
  manageAssignment?: boolean;
  onCancel: () => void;
  onSaved: (task: { id: number; [key: string]: unknown }) => void;
}

export interface TaskEditorHandle {
  submit: () => Promise<void>;
}

const inputClass = "w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white disabled:bg-parchment/40 disabled:text-stone";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut";

const TaskEditor = forwardRef<TaskEditorHandle, TaskEditorProps>(function TaskEditor({
  mode,
  editingTaskId = null,
  initialTask = null,
  currentUserId,
  isAdminOrManager,
  teamMembers,
  defaultVaId,
  defaultDate,
  defaultStartTime,
  defaultEndTime,
  defaultLinkedProjectId,
  currentPayRate,
  hideFooter = false,
  manageAssignment = true,
  onCancel,
  onSaved,
}: TaskEditorProps, ref) {
  const isEditing = Boolean(editingTaskId);

  // Basics
  const [account, setAccount] = useState((initialTask?.account as string) ?? "");
  const [project, setProject] = useState((initialTask?.project as string) ?? "");
  const [taskName, setTaskName] = useState((initialTask?.task_name as string) ?? "");
  const [category, setCategory] = useState<string>((initialTask?.category as string) ?? "Task");

  // Schedule
  const [startDate, setStartDate] = useState((initialTask?.start_date as string) ?? defaultDate ?? "");
  const [dueDate, setDueDate] = useState((initialTask?.due_date as string) ?? "");
  const [endDate, setEndDate] = useState((initialTask?.end_date as string) ?? "");
  const [hasSchedule, setHasSchedule] = useState(Boolean(initialTask?.start_time) || Boolean(defaultStartTime));
  const [startTime, setStartTime] = useState(defaultStartTime ?? "09:00");
  const [endTime, setEndTime] = useState(defaultEndTime ?? "10:00");

  // Details
  const [taskDetail, setTaskDetail] = useState((initialTask?.task_detail as string) ?? "");
  const [taskNotes, setTaskNotes] = useState((initialTask?.task_notes as string) ?? "");
  const [link, setLink] = useState((initialTask?.link as string) ?? "");
  const [instructions, setInstructions] = useState((initialTask?.instructions as string) ?? "");
  const [instructionsLocked, setInstructionsLocked] = useState(Boolean(initialTask?.instructions_locked));
  const [todos, setTodos] = useState<TaskTodo[]>([]);
  const [todosLoading, setTodosLoading] = useState(false);
  const [newTodoText, setNewTodoText] = useState("");
  const [todoBusyId, setTodoBusyId] = useState<number | null>(null);

  // Assignment
  const [assignedBy, setAssignedBy] = useState((initialTask?.assigned_by as string) ?? currentUserId);
  const initialVaId = initialTask?.assigned_task_assignees?.[0]?.va_id ?? (initialTask?.assigned_to as string) ?? defaultVaId ?? (isAdminOrManager ? "" : currentUserId);
  const [vaId, setVaId] = useState(initialVaId);
  const [linkedProjectId, setLinkedProjectId] = useState((initialTask?.project_id as string) ?? defaultLinkedProjectId ?? "");
  const [parentTaskId, setParentTaskId] = useState(initialTask?.parent_task_id != null ? String(initialTask.parent_task_id) : "");
  const [reviewRequired, setReviewRequired] = useState(Boolean(initialTask?.review_required));
  const [payType, setPayType] = useState<"hourly" | "fixed">((initialTask?.pay_type as "hourly" | "fixed") ?? "hourly");

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
  // assigned_tasks.id, not fixed_pay_tasks.id) — output_based tasks keep the
  // plain Client Detail textarea instead.
  const supportsTodos = mode === "time_based" && isEditing && Boolean(editingTaskId);
  // Existing tasks with no to-do items yet keep showing the plain free-text
  // Client Detail (which may hold real legacy text) instead of an empty
  // checklist — checklistMode flips on once todos load with items, or the
  // user explicitly starts one via "Switch to a to-do checklist".
  const [checklistMode, setChecklistMode] = useState(false);

  useEffect(() => {
    if (!supportsTodos || !editingTaskId) return;
    setTodosLoading(true);
    fetchTodos(editingTaskId)
      .then((loaded) => {
        setTodos(loaded);
        if (loaded.length > 0) setChecklistMode(true);
      })
      .finally(() => setTodosLoading(false));
  }, [supportsTodos, editingTaskId]);

  const handleAddTodo = useCallback(async () => {
    const text = newTodoText.trim();
    if (!text || !editingTaskId) return;
    const created = await addTodo(editingTaskId, text);
    if (created) {
      setTodos((prev) => [...prev, created]);
      setNewTodoText("");
    }
  }, [newTodoText, editingTaskId]);

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
  const linkedObjectives = useMemo(() => linkedProjects.filter((p) => p.kind === "objective"), [linkedProjects]);
  const linkedOperations = useMemo(() => linkedProjects.filter((p) => p.kind === "operation"), [linkedProjects]);

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

  const handleSubmit = useCallback(async () => {
    if (!taskName.trim()) {
      setError("Task name is required.");
      throw new Error("Task name is required.");
    }
    if (mode === "output_based" && (!rate.trim() || !Number.isFinite(Number(rate)))) {
      setError("Final Rate is required.");
      throw new Error("Final Rate is required.");
    }

    setSaving(true);
    setError(null);
    try {
      let task: { id: number; [key: string]: unknown };

      if (mode === "time_based") {
        const body: Record<string, unknown> = {
          account: account || null,
          project: project || null,
          task_name: taskName.trim(),
          category,
          task_detail: taskDetail.trim() || null,
          task_notes: taskNotes.trim() || null,
          due_date: dueDate || null,
          start_date: startDate || null,
          end_date: endDate || null,
          assigned_by: assignedBy || currentUserId || null,
          instructions: instructions.trim() || null,
          instructions_locked: instructionsLocked,
          review_required: reviewRequired,
          pay_type: payType,
          project_id: linkedProjectId || null,
          parent_task_id: parentTaskId ? Number(parentTaskId) : null,
        };

        const scheduleDate = startDate || dueDate;
        if (hasSchedule && scheduleDate && startTime && endTime) {
          body.start_time = new Date(`${scheduleDate}T${startTime}:00`).toISOString();
          body.end_time = new Date(`${scheduleDate}T${endTime}:00`).toISOString();
        } else if (hasSchedule === false) {
          body.start_time = null;
          body.end_time = null;
        }

        const effectiveVaId = isAdminOrManager ? vaId : currentUserId;

        if (isEditing && editingTaskId) {
          // va_ids intentionally omitted here — assigned_tasks supports
          // multiple assignees (collaborative tasks) but this form's Assign
          // To is a single-select, so reconciling va_ids on every metadata
          // save would silently drop collaborators (or unassign entirely).
          // Reassignment stays disabled during edit; see the Assign To field.
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
          body.initial_status = "pending";
          if (manageAssignment && effectiveVaId) body.va_ids = [effectiveVaId];
          const res = await fetch("/api/assigned-tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
          task = data.task;
        }
      } else {
        const body: Record<string, unknown> = {
          task_name: taskName.trim(),
          account: account || null,
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
        };
        if (isAdminOrManager) {
          body.assigned_to = vaId || null;
          body.assigned_by = assignedBy || null;
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
    mode, taskName, account, project, category, taskDetail, taskNotes, link, dueDate, startDate, endDate,
    assignedBy, currentUserId, instructions, instructionsLocked, reviewRequired, payType, linkedProjectId,
    parentTaskId, isAdminOrManager, vaId, hasSchedule, startTime, endTime, rate, isEditing, editingTaskId, onSaved,
  ]);

  useImperativeHandle(ref, () => ({ submit: handleSubmit }), [handleSubmit]);

  const assignToOptions = teamMembers;
  const assignByOptions = teamMembers;

  return (
    <div className="space-y-3">
      <Section title="Basics" defaultOpen>
        <div>
          <label className={labelClass}>Account</label>
          <select
            value={account}
            onChange={(e) => { setAccount(e.target.value); setProject(""); if (!isEditing) setTaskName(""); }}
            className={inputClass}
          >
            <option value="">Select account...</option>
            {accounts.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>Objective</label>
          <select
            value={project}
            onChange={(e) => { setProject(e.target.value); if (!isEditing) setTaskName(""); }}
            disabled={!account}
            className={inputClass}
          >
            <option value="">{account ? "Select objective..." : "Select account first..."}</option>
            {objectiveOptionsForAccount.map((p) => (
              <option key={p.id} value={p.project_name}>{p.project_name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>Task Name</label>
          {!isEditing && taskOptionsForObjective.length > 0 ? (
            <select value={taskName} onChange={(e) => setTaskName(e.target.value)} className={inputClass}>
              <option value="">Select task...</option>
              {taskOptionsForObjective.map((t) => (
                <option key={t.id} value={t.task_name}>{t.task_name}</option>
              ))}
            </select>
          ) : (
            <input value={taskName} onChange={(e) => setTaskName(e.target.value)} placeholder="Task name" className={inputClass} />
          )}
        </div>

        <div>
          <label className={labelClass}>Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </Section>

      <Section title="Schedule" defaultOpen={Boolean(startDate || dueDate || endDate || hasSchedule)}>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className={labelClass}>Start Date</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} />
          </div>
          <div className="flex-1">
            <label className={labelClass}>End Date</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputClass} />
          </div>
        </div>

        <div>
          <label className={labelClass}>Due Date</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
        </div>

        <div className="rounded-lg border border-sand bg-cream/40 p-3 space-y-2">
          <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-walnut">
            <input type="checkbox" checked={hasSchedule} onChange={(e) => setHasSchedule(e.target.checked)} />
            Add to Calendar (specific hours)
          </label>
          {hasSchedule && (
            <>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-[10px] font-semibold text-walnut">Start Time</label>
                  <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={inputClass} />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-[10px] font-semibold text-walnut">End Time</label>
                  <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={inputClass} />
                </div>
              </div>
              {scheduleHelperText && <p className="text-[11px] text-stone">{scheduleHelperText}</p>}
            </>
          )}
        </div>
      </Section>

      <Section title="Details" defaultOpen={Boolean(taskDetail || taskNotes || instructions)}>
        {supportsTodos && checklistMode ? (
          <div>
            <label className={labelClass}>To-Do List</label>
            {todosLoading ? (
              <p className="text-[12px] text-stone">Loading...</p>
            ) : (
              <div className="space-y-1.5">
                {todos.map((t, i) => (
                  <div key={t.id} className="flex items-center gap-2 rounded-lg border border-sand bg-white px-2.5 py-1.5">
                    <span className="shrink-0 rounded bg-stone/10 px-1.5 py-0.5 text-[10px] font-bold text-stone">{todoLabel(i)}</span>
                    <input
                      defaultValue={t.text}
                      disabled={todoBusyId === t.id}
                      onBlur={(e) => {
                        const text = e.target.value.trim();
                        if (text && text !== t.text) void handleUpdateTodo(t.id, text);
                      }}
                      className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[13px] outline-none focus:border-sand"
                    />
                    <button
                      type="button"
                      onClick={() => void handleDeleteTodo(t.id)}
                      disabled={todoBusyId === t.id}
                      className="shrink-0 text-[11px] font-semibold text-terracotta hover:underline disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                ))}
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
              </div>
            )}
          </div>
        ) : (
          <div>
            <label className={labelClass}>Client Detail</label>
            <textarea
              value={taskDetail}
              onChange={(e) => setTaskDetail(limitToWords(e.target.value, CLIENT_MEMO_WORD_LIMIT))}
              rows={2}
              placeholder="Client-visible memo"
              className={`${inputClass} resize-none`}
            />
            <p className="mt-1 text-[10px] text-stone">
              {Math.max(0, CLIENT_MEMO_WORD_LIMIT - countWords(taskDetail))} words remaining
              {mode === "time_based" && !isEditing && " — save the task to add a to-do checklist instead"}
            </p>
            {supportsTodos && (
              <button
                type="button"
                onClick={() => setChecklistMode(true)}
                className="mt-1 text-[11px] font-semibold text-terracotta hover:underline"
              >
                Switch to a to-do checklist
              </button>
            )}
          </div>
        )}

        <div>
          <label className={labelClass}>Notes</label>
          <textarea value={taskNotes} onChange={(e) => setTaskNotes(e.target.value)} rows={2} placeholder="Internal notes" className={`${inputClass} resize-none`} />
        </div>

        {mode === "output_based" && (
          <div>
            <label className={labelClass}>Link</label>
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://..." className={inputClass} />
          </div>
        )}

        <div>
          <label className={labelClass}>Instructions</label>
          <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2} className={`${inputClass} resize-none`} />
          <label className="mt-1 flex items-center gap-1.5 text-[11px] text-espresso">
            <input type="checkbox" checked={instructionsLocked} onChange={(e) => setInstructionsLocked(e.target.checked)} />
            Locked
          </label>
        </div>
      </Section>

      <Section title="Assignment" defaultOpen={Boolean(vaId || linkedProjectId)}>
        {manageAssignment && (
          <div>
            <label className={labelClass}>Assign To</label>
            <select
              value={isAdminOrManager ? vaId : currentUserId}
              onChange={(e) => setVaId(e.target.value)}
              disabled={!isAdminOrManager || isEditing}
              className={inputClass}
            >
              <option value="">Unassigned</option>
              {assignToOptions.map((m) => (
                <option key={m.id} value={m.id}>{m.full_name || m.username}</option>
              ))}
            </select>
            {isEditing && isAdminOrManager && (
              <p className="mt-1 text-[10px] text-stone">Reassign this task from Assignment's task list — a task can have more than one assignee.</p>
            )}
          </div>
        )}

        <div>
          <label className={labelClass}>Assigned By</label>
          <select value={assignedBy} onChange={(e) => setAssignedBy(e.target.value)} className={inputClass}>
            {assignByOptions.map((m) => (
              <option key={m.id} value={m.id}>{m.full_name || m.username}</option>
            ))}
          </select>
        </div>

        <div className="rounded-lg border border-sand bg-cream/40 p-3 space-y-2">
          <label className={labelClass}>Link to Project</label>
          <select value={linkedProjectId} onChange={(e) => setLinkedProjectId(e.target.value)} className={inputClass}>
            <option value="">— None —</option>
            {linkedObjectives.length > 0 && (
              <optgroup label="Objectives">
                {linkedObjectives.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
            )}
            {linkedOperations.length > 0 && (
              <optgroup label="Operations">
                {linkedOperations.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
            )}
          </select>
          {mode === "time_based" && linkedProjectId && parentTaskOptions.length > 0 && (
            <select value={parentTaskId} onChange={(e) => setParentTaskId(e.target.value)} className={inputClass}>
              <option value="">Top-level task in this project</option>
              {parentTaskOptions.map((t) => (
                <option key={t.id} value={t.id}>Subtask of: {t.task_name}</option>
              ))}
            </select>
          )}
        </div>

        {mode === "time_based" && (
          <div className="flex items-center gap-4">
            <div>
              <label className={labelClass}>Pay Type</label>
              <select value={payType} onChange={(e) => setPayType(e.target.value as "hourly" | "fixed")} className={inputClass}>
                <option value="hourly">Time-based</option>
                <option value="fixed">Output Based</option>
              </select>
            </div>
            <label className="mt-5 flex items-center gap-1.5 text-[11px] font-semibold text-espresso">
              <input type="checkbox" checked={reviewRequired} onChange={(e) => setReviewRequired(e.target.checked)} />
              Review Required
            </label>
          </div>
        )}
      </Section>

      {mode === "output_based" && (
        <Section title="Rate" defaultOpen>
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
            <input value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0.00" className={inputClass} />
          </div>
        </Section>
      )}

      {error && <p className="text-[12px] text-red-600">{error}</p>}

      {!hideFooter && (
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => void handleSubmit().catch(() => {})}
            disabled={saving || !taskName.trim()}
            className="px-4 py-2 rounded-lg bg-sage text-white text-[13px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : isEditing ? "Save Changes" : "Create Task"}
          </button>
          <button onClick={onCancel} className="px-4 py-2 rounded-lg text-[13px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
});

export default TaskEditor;
