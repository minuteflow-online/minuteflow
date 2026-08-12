"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { countWords } from "@/lib/utils";
import { CATEGORY_OPTIONS } from "@/lib/taskSchedule";
import type { Project } from "@/types/database";

const CLIENT_MEMO_WORD_LIMIT = 15;

function limitToWords(text: string, limit: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= limit) return text;
  return words.slice(0, limit).join(" ");
}

type FormObjective = { id: number; account: string; project_name: string; sort_order: number };
type FormTask = { id: number; task_name: string; billing_type: string; task_rate: number | null };
type TeamMemberOption = { id: string; full_name: string; username: string };

interface TaskFormProps {
  currentUserId: string;
  isAdminOrManager: boolean;
  teamMembers: TeamMemberOption[];
  /** Locks "Assign To" to this VA — used when creating from a specific person's Calendar day. */
  defaultVaId?: string;
  /** YYYY-MM-DD, prefills Start Date and (with the time fields) start_time/end_time. */
  defaultDate?: string;
  /** "HH:MM" — shows the schedule row and prefills Start/End time. */
  defaultStartTime?: string;
  defaultEndTime?: string;
  /** Whether to show the Start/End Time scheduling row at all. */
  showSchedule?: boolean;
  /** Pre-select a Objective/Operation project (e.g. adding a task from within a project page). */
  defaultLinkedProjectId?: string;
  onCancel: () => void;
  onCreated: (task: { id: number; [key: string]: unknown }) => void;
}

export default function TaskForm({
  currentUserId,
  isAdminOrManager,
  teamMembers,
  defaultVaId,
  defaultDate,
  defaultStartTime,
  defaultEndTime,
  showSchedule = false,
  defaultLinkedProjectId,
  onCancel,
  onCreated,
}: TaskFormProps) {
  const [account, setAccount] = useState("");
  const [project, setProject] = useState(""); // legacy cascading "Objective" (project_tags)
  const [taskName, setTaskName] = useState("");
  const [category, setCategory] = useState<string>("Task");
  const [taskDetail, setTaskDetail] = useState("");
  const [taskNotes, setTaskNotes] = useState("");
  const [startDate, setStartDate] = useState(defaultDate ?? "");
  const [dueDate, setDueDate] = useState("");
  const [hasSchedule, setHasSchedule] = useState(showSchedule && Boolean(defaultStartTime));
  const [startTime, setStartTime] = useState(defaultStartTime ?? "09:00");
  const [endTime, setEndTime] = useState(defaultEndTime ?? "10:00");
  const [instructions, setInstructions] = useState("");
  const [instructionsLocked, setInstructionsLocked] = useState(false);
  const [reviewRequired, setReviewRequired] = useState(false);
  const [assignedBy, setAssignedBy] = useState(currentUserId);
  const [vaId, setVaId] = useState(defaultVaId ?? (isAdminOrManager ? "" : currentUserId));
  const [payType, setPayType] = useState<"hourly" | "fixed">("hourly");

  // Link to Project (the new Objective/Operation tree)
  const [linkedProjects, setLinkedProjects] = useState<Project[]>([]);
  const [linkedProjectId, setLinkedProjectId] = useState(defaultLinkedProjectId ?? "");
  const [parentTaskOptions, setParentTaskOptions] = useState<Array<{ id: number; task_name: string }>>([]);
  const [parentTaskId, setParentTaskId] = useState("");

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
      setParentTaskId("");
      return;
    }
    fetch(`/api/assigned-tasks?projectId=${linkedProjectId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setParentTaskOptions((d.tasks ?? []).map((t: { id: number; task_name: string }) => ({ id: t.id, task_name: t.task_name }))))
      .catch(() => setParentTaskOptions([]));
  }, [linkedProjectId]);

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

  const assignByOptions = teamMembers;
  const assignToOptions = teamMembers;

  const handleSubmit = useCallback(async () => {
    if (!taskName.trim()) {
      setError("Task name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        account: account || null,
        project: project || null,
        task_name: taskName.trim(),
        category,
        task_detail: taskDetail.trim() || null,
        task_notes: taskNotes.trim() || null,
        due_date: dueDate || null,
        start_date: startDate || null,
        assigned_by: assignedBy || currentUserId || null,
        instructions: instructions.trim() || null,
        instructions_locked: instructionsLocked,
        review_required: reviewRequired,
        pay_type: payType,
        project_id: linkedProjectId || null,
        parent_task_id: parentTaskId ? Number(parentTaskId) : null,
        // Always start Pending, even when scheduled — VAs decide when to move
        // a task to On Queue themselves, scheduling it doesn't do that for them.
        initial_status: "pending",
      };
      const effectiveVaId = isAdminOrManager ? vaId : currentUserId;
      if (effectiveVaId) body.va_ids = [effectiveVaId];

      // Prefer Start Date for the schedule block, but fall back to Due Date
      // so a due-date-only task can still be scheduled instead of silently
      // dropping the time block.
      const scheduleDate = startDate || dueDate;
      if (hasSchedule && scheduleDate && startTime && endTime) {
        body.start_time = new Date(`${scheduleDate}T${startTime}:00`).toISOString();
        body.end_time = new Date(`${scheduleDate}T${endTime}:00`).toISOString();
      }

      const res = await fetch("/api/assigned-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onCreated(data.task);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create task.");
    } finally {
      setSaving(false);
    }
  }, [
    account, project, taskName, category, taskDetail, taskNotes, dueDate, startDate, assignedBy, currentUserId,
    instructions, instructionsLocked, reviewRequired, payType, linkedProjectId, parentTaskId, isAdminOrManager,
    vaId, hasSchedule, startTime, endTime, onCreated,
  ]);

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Account</label>
        <select
          value={account}
          onChange={(e) => { setAccount(e.target.value); setProject(""); setTaskName(""); }}
          className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
        >
          <option value="">Select account...</option>
          {accounts.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Objective</label>
        <select
          value={project}
          onChange={(e) => { setProject(e.target.value); setTaskName(""); }}
          disabled={!account}
          className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white disabled:bg-parchment/40 disabled:text-stone"
        >
          <option value="">{account ? "Select objective..." : "Select account first..."}</option>
          {objectiveOptionsForAccount.map((p) => (
            <option key={p.id} value={p.project_name}>{p.project_name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Task Name</label>
        {taskOptionsForObjective.length > 0 ? (
          <select
            value={taskName}
            onChange={(e) => setTaskName(e.target.value)}
            className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
          >
            <option value="">Select task...</option>
            {taskOptionsForObjective.map((t) => (
              <option key={t.id} value={t.task_name}>{t.task_name}</option>
            ))}
          </select>
        ) : (
          <input
            value={taskName}
            onChange={(e) => setTaskName(e.target.value)}
            placeholder="Task name"
            className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
          />
        )}
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Category</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
        >
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {/* Link to Project — the Objective/Operation goal tree */}
      <div className="rounded-lg border border-sand bg-cream/40 p-3 space-y-2">
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-walnut">Link to Project</label>
        <select
          value={linkedProjectId}
          onChange={(e) => setLinkedProjectId(e.target.value)}
          className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
        >
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
        {linkedProjectId && parentTaskOptions.length > 0 && (
          <select
            value={parentTaskId}
            onChange={(e) => setParentTaskId(e.target.value)}
            className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
          >
            <option value="">Top-level task in this project</option>
            {parentTaskOptions.map((t) => (
              <option key={t.id} value={t.id}>Subtask of: {t.task_name}</option>
            ))}
          </select>
        )}
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Start Date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
          />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Due Date</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
          />
        </div>
      </div>

      {showSchedule && (
        <div className="rounded-lg border border-sand bg-cream/40 p-3 space-y-2">
          <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-walnut">
            <input type="checkbox" checked={hasSchedule} onChange={(e) => setHasSchedule(e.target.checked)} />
            Add to Calendar (specific hours)
          </label>
          {hasSchedule && (
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="mb-1 block text-[10px] font-semibold text-walnut">Start Time</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
                />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-[10px] font-semibold text-walnut">End Time</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
                />
              </div>
            </div>
          )}
        </div>
      )}

      <div>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Client Detail</label>
        <textarea
          value={taskDetail}
          onChange={(e) => setTaskDetail(limitToWords(e.target.value, CLIENT_MEMO_WORD_LIMIT))}
          rows={2}
          placeholder="Client-visible memo"
          className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white resize-none"
        />
        <p className="mt-1 text-[10px] text-stone">{Math.max(0, CLIENT_MEMO_WORD_LIMIT - countWords(taskDetail))} words remaining</p>
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Notes</label>
        <textarea
          value={taskNotes}
          onChange={(e) => setTaskNotes(e.target.value)}
          rows={2}
          placeholder="Internal notes"
          className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white resize-none"
        />
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Assign To</label>
        <select
          value={isAdminOrManager ? vaId : currentUserId}
          onChange={(e) => setVaId(e.target.value)}
          disabled={!isAdminOrManager}
          className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white disabled:bg-parchment/40 disabled:text-stone"
        >
          <option value="">Unassigned</option>
          {assignToOptions.map((m) => (
            <option key={m.id} value={m.id}>{m.full_name || m.username}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Assigned By</label>
        <select
          value={assignedBy}
          onChange={(e) => setAssignedBy(e.target.value)}
          className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
        >
          {assignByOptions.map((m) => (
            <option key={m.id} value={m.id}>{m.full_name || m.username}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Instructions</label>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white resize-none"
        />
        <label className="mt-1 flex items-center gap-1.5 text-[11px] text-espresso">
          <input type="checkbox" checked={instructionsLocked} onChange={(e) => setInstructionsLocked(e.target.checked)} />
          Locked
        </label>
      </div>

      <div className="flex items-center gap-4">
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-walnut">Pay Type</label>
          <select
            value={payType}
            onChange={(e) => setPayType(e.target.value as "hourly" | "fixed")}
            className="rounded-lg border border-sand px-3 py-2 text-[13px] outline-none focus:border-terracotta bg-white"
          >
            <option value="hourly">Time-based</option>
            <option value="fixed">Output Based</option>
          </select>
        </div>
        <label className="mt-5 flex items-center gap-1.5 text-[11px] font-semibold text-espresso">
          <input type="checkbox" checked={reviewRequired} onChange={(e) => setReviewRequired(e.target.checked)} />
          Review Required
        </label>
      </div>

      {error && <p className="text-[12px] text-red-600">{error}</p>}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => void handleSubmit()}
          disabled={saving || !taskName.trim()}
          className="px-4 py-2 rounded-lg bg-sage text-white text-[13px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
        >
          {saving ? "Creating..." : "Create Task"}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-[13px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
