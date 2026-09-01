"use client";

import { useEffect, useState } from "react";

type TaskDetail = {
  id: number;
  task_name: string | null;
  task_detail: string | null;
  task_notes: string | null;
  instructions: string | null;
  link: string | null;
  account: string | null;
  project: string | null;
  category: string | null;
  pay_type: string | null;
  due_date: string | null;
  due_time: string | null;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  planned_minutes: number | null;
  review_required: boolean | null;
  task_todos?: Array<{ id: number; text: string; sort_order: number }>;
};

/**
 * The whole task, read-only, without leaving the page you were reviewing from.
 *
 * Reviewing a submission means checking the work against what was asked for,
 * and the link out to Assignment dropped you into a list to search by name —
 * which is the one thing you already know. This shows the brief itself.
 *
 * Read-only on purpose: this is the reviewer's reference, and a stray edit
 * while reading is not something to make easy. Editing stays in Assignment.
 */
export default function TaskDetailModal({
  taskId,
  onClose,
  canSetDue = false,
}: {
  taskId: number;
  onClose: () => void;
  /** Reviewers can move the deadline from here; everyone else reads it. */
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
      setTask((prev) =>
        prev ? { ...prev, due_date: dueDate, due_time: dueTime || null } : prev
      );
      setDueOpen(false);
    } catch {
      setDueError("Couldn't save that due date.");
    } finally {
      setSavingDue(false);
    }
  }

  const schedule = [
    task?.start_date && `from ${task.start_date}`,
    task?.end_date && `to ${task.end_date}`,
    task?.planned_minutes ? `${task.planned_minutes} min planned` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const due = task?.due_date
    ? `${task.due_date}${task.due_time ? ` at ${task.due_time}` : ""}`
    : null;

  // Every field shows, filled or not. A blank here is information: it says
  // this task went out without a due date, or without a category, which is
  // exactly what a reviewer needs to notice.
  const rows: Array<[string, string | null]> = [
    ["Account", task?.account ?? null],
    ["Project", task?.project ?? null],
    ["Category", task?.category ?? null],
    ["Pay type", task?.pay_type ?? null],
    ["Due", due],
    ["Schedule", schedule || null],
    ["Review required", task ? (task.review_required ? "Yes" : "No") : null],
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
                      className={`text-[12px] ${
                        value ? "text-espresso" : "italic text-stone/60"
                      }`}
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
                  {task.due_date ? "Change due date" : "Add due date"}
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

            {(
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
            )}

            {(
              <div>
                <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-walnut">
                  To-dos
                </p>
                {todos.length === 0 && (
                  <p className="text-[12px] italic text-stone/60">None</p>
                )}
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
            )}
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
