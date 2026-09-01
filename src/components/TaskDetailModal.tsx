"use client";

import { useEffect, useState } from "react";
import { ORG_TIMEZONE } from "@/lib/taskSchedule";

type Person = { id: string; full_name: string | null; username: string | null } | null;

type TaskDetail = {
  id: number;
  task_name: string | null;
  task_detail: string | null;
  task_notes: string | null;
  instructions: string | null;
  instructions_locked: boolean | null;
  link: string | null;
  account: string | null;
  project: string | null;
  project_id: string | null;
  projects?: { id: string; name: string } | null;
  parent_task_id: number | null;
  category: string | null;
  pay_type: string | null;
  status: string | null;
  due_date: string | null;
  due_time: string | null;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  planned_minutes: number | null;
  review_required: boolean | null;
  review_required_locked: boolean | null;
  revision_count: number | null;
  recurring_template_id: string | null;
  spawned_template_id: string | null;
  fixed_pay_task_id: number | null;
  created_at: string | null;
  updated_at: string | null;
  archived_at: string | null;
  deleted_at: string | null;
  assigned_by_profile?: Person;
  created_by_profile?: Person;
  assigned_task_assignees?: Array<{ id: number; va_id: string | null; status: string | null; profiles?: Person }>;
  task_todos?: Array<{ id: number; text: string; sort_order: number }>;
};

function personName(p: Person): string | null {
  if (!p) return null;
  return p.full_name || p.username || null;
}

/** Timestamps are stored UTC; everyone here reads them in org time. */
function fmtStamp(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-US", {
    timeZone: ORG_TIMEZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The whole task, without leaving the page you were reviewing from.
 *
 * Reviewing a submission means checking the work against what was asked for,
 * and the link out to Assignment dropped you into a list to search by name —
 * which is the one thing you already know. This shows the brief itself.
 *
 * Every field is listed, filled or not: a blank is information. It says this
 * task went out with no due date, or no instructions, which is exactly what a
 * reviewer needs to see. Editing stays in Assignment — the due date is the
 * one exception, because it is what the calendar measures late against.
 */
export default function TaskDetailModal({
  taskId,
  onClose,
  canSetDue = false,
}: {
  taskId: number;
  onClose: () => void;
  /** Reviewers can set the deadline from here; everyone else reads it. */
  canSetDue?: boolean;
}) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [error, setError] = useState("");
  const [dueOpen, setDueOpen] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [savingDue, setSavingDue] = useState(false);
  const [dueError, setDueError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/assigned-tasks/${taskId}`, { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) setError("Couldn't load this task.");
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setTask(data.task ?? null);
        setDueDate(data.task?.due_date ?? "");
        setDueTime((data.task?.due_time ?? "").slice(0, 5));
      } catch {
        if (!cancelled) setError("Couldn't load this task.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  async function saveDue() {
    if (!dueDate) {
      setDueError("Pick a date first.");
      return;
    }
    setSavingDue(true);
    setDueError("");
    try {
      const res = await fetch(`/api/assigned-tasks/${taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ due_date: dueDate, due_time: dueTime || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setDueError(body.error || "Couldn't save that due date.");
        return;
      }
      setTask((prev) => (prev ? { ...prev, due_date: dueDate, due_time: dueTime || null } : prev));
      setDueOpen(false);
    } catch {
      setDueError("Couldn't save that due date.");
    } finally {
      setSavingDue(false);
    }
  }

  const assignees = (task?.assigned_task_assignees ?? [])
    .map((a) => {
      const name = personName(a.profiles ?? null) ?? "Unknown";
      const status = statusLabel(a.status);
      return status ? `${name} — ${status}` : name;
    })
    .join(", ");

  const due = task?.due_date
    ? `${task.due_date}${task.due_time ? ` at ${task.due_time.slice(0, 5)}` : ""}`
    : null;

  const recurring =
    task?.recurring_template_id || task?.spawned_template_id ? "Yes" : task ? "No" : null;

  // Every field on the task, in the order a reviewer reads them: who and what
  // first, then the schedule, then the review and bookkeeping flags.
  const rows: Array<[string, string | null]> = [
    ["Assigned to", assignees || null],
    ["Assigned by", personName(task?.assigned_by_profile ?? null)],
    ["Created by", personName(task?.created_by_profile ?? null)],
    ["Status", statusLabel(task?.status)],
    ["Account", task?.account ?? null],
    ["Project", task?.projects?.name ?? task?.project ?? null],
    ["Category", task?.category ?? null],
    ["Pay type", task?.pay_type ?? null],
    ["Due", due],
    ["Planned", task?.planned_minutes ? `${task.planned_minutes} min` : null],
    ["Start date", task?.start_date ?? null],
    ["End date", task?.end_date ?? null],
    ["Start time", fmtStamp(task?.start_time)],
    ["End time", fmtStamp(task?.end_time)],
    ["Review required", task ? (task.review_required ? "Yes" : "No") : null],
    ["Review locked", task ? (task.review_required_locked ? "Yes" : "No") : null],
    ["Instructions locked", task ? (task.instructions_locked ? "Yes" : "No") : null],
    ["Revisions", task ? String(task.revision_count ?? 0) : null],
    ["Recurring", recurring],
    ["Parent task", task?.parent_task_id ? `#${task.parent_task_id}` : null],
    ["Fixed pay task", task?.fixed_pay_task_id ? `#${task.fixed_pay_task_id}` : null],
    ["Task ID", task ? `#${task.id}` : null],
    ["Created", fmtStamp(task?.created_at)],
    ["Updated", fmtStamp(task?.updated_at)],
    ["Archived", fmtStamp(task?.archived_at)],
    ["Deleted", fmtStamp(task?.deleted_at)],
  ];

  const blocks: Array<[string, string | null]> = [
    ["Client detail", task?.task_detail ?? null],
    ["Instructions", task?.instructions ?? null],
    ["Notes", task?.task_notes ?? null],
  ];

  const todos = (task?.task_todos ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mx-4 max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-sand bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-sand px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-xs font-bold uppercase tracking-wide text-espresso">Task</h3>
            {/* The client memo is what the work is actually about; the task
                name is often the same word on dozens of cards. */}
            <p className="text-[13px] font-semibold leading-snug text-espresso">
              {task?.task_detail?.trim() || task?.task_name || (error || "Loading...")}
            </p>
            {task?.task_detail?.trim() && task.task_name && (
              <p className="mt-0.5 truncate text-[11px] text-stone">{task.task_name}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-stone hover:text-espresso"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {task && (
          <div className="space-y-3 p-4">
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {rows.map(([label, value]) => (
                <div key={label}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-walnut">
                    {label}
                  </p>
                  <p
                    className={`text-[12px] ${value ? "text-espresso" : "italic text-stone/60"}`}
                  >
                    {value || "Not set"}
                  </p>
                </div>
              ))}
            </div>

            {/* The due date is the one field a reviewer routinely needs to
                change while looking at the work — it's what the calendar
                measures late against. Everything else still edits in
                Assignment. */}
            {canSetDue &&
              (dueOpen ? (
                <div className="rounded-lg border border-sand bg-cream/40 p-2">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-walnut">
                    Due date
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="rounded-lg border border-sand bg-white px-2 py-1 text-[11px] text-espresso outline-none"
                    />
                    <input
                      type="time"
                      value={dueTime}
                      onChange={(e) => setDueTime(e.target.value)}
                      className="rounded-lg border border-sand bg-white px-2 py-1 text-[11px] text-espresso outline-none"
                    />
                    <button
                      onClick={saveDue}
                      disabled={savingDue}
                      className="rounded-lg bg-sage px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-sage/90 disabled:opacity-50"
                    >
                      {savingDue ? "Saving..." : "Save"}
                    </button>
                    <button
                      onClick={() => {
                        setDueOpen(false);
                        setDueError("");
                        setDueDate(task.due_date ?? "");
                        setDueTime((task.due_time ?? "").slice(0, 5));
                      }}
                      disabled={savingDue}
                      className="rounded-lg bg-stone/10 px-3 py-1 text-[10px] font-semibold text-stone transition-colors hover:bg-stone/20 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] text-stone">
                    Leaving the time blank means the whole day counts as on time.
                  </p>
                  {dueError && <p className="mt-1 text-[10px] text-terracotta">{dueError}</p>}
                </div>
              ) : (
                <button
                  onClick={() => setDueOpen(true)}
                  className="rounded-lg bg-stone/10 px-3 py-1 text-[10px] font-semibold text-stone transition-colors hover:bg-stone/20"
                >
                  Add due date
                </button>
              ))}

            {blocks.map(([label, value]) => (
              <div key={label}>
                <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-walnut">
                  {label}
                </p>
                <p
                  className={`whitespace-pre-wrap rounded-lg border border-sand bg-cream/40 px-2 py-1.5 text-[12px] leading-snug ${
                    value?.trim() ? "text-espresso" : "italic text-stone/60"
                  }`}
                >
                  {value?.trim() || "Not set"}
                </p>
              </div>
            ))}

            <div>
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-walnut">
                Link
              </p>
              {task.link ? (
                <a
                  href={task.link}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-[12px] text-terracotta hover:underline"
                >
                  {task.link}
                </a>
              ) : (
                <p className="text-[12px] italic text-stone/60">Not set</p>
              )}
            </div>

            <div>
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-walnut">
                To-dos
              </p>
              {todos.length === 0 && <p className="text-[12px] italic text-stone/60">None</p>}
              <div className="space-y-1">
                {todos.map((todo, i) => (
                  <div
                    key={todo.id}
                    className="flex items-start gap-2 rounded-lg border border-sand bg-cream/40 px-2 py-1"
                  >
                    <span className="shrink-0 rounded bg-sage-soft px-1 py-[1px] text-[9px] font-semibold text-sage">
                      TD{i + 1}
                    </span>
                    <span className="text-[12px] leading-snug text-espresso">{todo.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-sand px-4 py-3">
          <a
            href={`/productivity/assignment?task=${taskId}`}
            className="rounded-lg bg-stone/10 px-3 py-1 text-[10px] font-semibold text-stone transition-colors hover:bg-stone/20"
          >
            Edit in Assignment
          </a>
          <button
            onClick={onClose}
            className="rounded-lg bg-sage px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-sage/90"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
