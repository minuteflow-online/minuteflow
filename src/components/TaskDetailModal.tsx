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
}: {
  taskId: number;
  onClose: () => void;
}) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [error, setError] = useState("");

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
        if (!cancelled) setTask(data.task ?? null);
      } catch {
        if (!cancelled) setError("Couldn't load this task.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

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

  // Only rows with something in them — an empty field says nothing and a
  // column of dashes buries the ones that matter.
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
            <p className="mt-0.5 truncate text-[13px] font-semibold text-espresso">
              {task?.task_name ?? (error || "Loading...")}
            </p>
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
              {rows
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label}>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-walnut">
                      {label}
                    </p>
                    <p className="text-[12px] text-espresso">{value}</p>
                  </div>
                ))}
            </div>

            {blocks
              .filter(([, value]) => value?.trim())
              .map(([label, value]) => (
                <div key={label}>
                  <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-walnut">
                    {label}
                  </p>
                  <p className="whitespace-pre-wrap rounded-lg border border-sand bg-cream/40 px-2 py-1.5 text-[12px] leading-snug text-espresso">
                    {value}
                  </p>
                </div>
              ))}

            {task.link && (
              <div>
                <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-walnut">
                  Link
                </p>
                <a
                  href={task.link}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-[12px] text-terracotta hover:underline"
                >
                  {task.link}
                </a>
              </div>
            )}

            {todos.length > 0 && (
              <div>
                <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-walnut">
                  To-dos
                </p>
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
