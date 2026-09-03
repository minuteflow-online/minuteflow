"use client";

// Extracted from the Calendar's task modal so the Assignment page (and
// anywhere else) can open the same read-only "what is this?" view before
// jumping into the full edit form, instead of every surface reinventing its
// own summary. What was actually entered on a task, read-only — opening a
// task asks "what is this?" far more often than "let me change it", and a
// form full of inputs answers that badly: every value sits in a box that
// invites editing, and the empty ones take up as much room as the filled
// ones.
//
// Only fields with a value are rendered, so a sparse task stays short.

import { useEffect, useState } from "react";
import type { TaskEditorInitialTask } from "@/components/TaskEditor";
import { timeOfDay, formatMinutesInput, formatDueTime, statusLabel } from "@/lib/taskSchedule";

const RECURRENCE_LABEL: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  every_2_months: "Every 2 months",
  every_3_months: "Every 3 months",
};
const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayLabel = (d: unknown) => (typeof d === "number" ? (DAY_ABBR[d] ?? String(d)) : String(d).slice(0, 3));

export default function TaskDetailsView({
  task,
  onEdit,
}: {
  task: TaskEditorInitialTask;
  onEdit: () => void;
}) {
  const str = (k: string) => {
    const v = task[k];
    if (v === null || v === undefined) return null;
    const text = String(v).trim();
    return text.length > 0 ? text : null;
  };
  const time = (k: string) => {
    const v = str(k);
    return v ? timeOfDay(v).slice(0, 5) : null;
  };

  const plannedMinutes = task.planned_minutes as number | null | undefined;
  const start = time("start_time");
  const end = time("end_time");
  const todos = (task.task_todos ?? []) as Array<{ id: number; text: string; sort_order: number }>;

  // A recurring task only carries the template id; fetch the template so the
  // view can say *how* it recurs (Daily / Weekly · Mon,Wed / Monthly · day 15),
  // not just that it does.
  const templateId = task.recurring_template_id as string | number | null | undefined;
  const [recurrence, setRecurrence] = useState<string | null>(null);
  useEffect(() => {
    if (templateId == null) { setRecurrence(null); return; }
    let cancelled = false;
    fetch(`/api/recurring-task-templates?id=${templateId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d?.template) return;
        const t = d.template as { recurrence_type?: string; recurrence_days?: unknown[]; recurrence_day_of_month?: number | null };
        let label = RECURRENCE_LABEL[t.recurrence_type ?? ""] ?? t.recurrence_type ?? "Recurring";
        if ((t.recurrence_type === "weekly" || t.recurrence_type === "biweekly") && Array.isArray(t.recurrence_days) && t.recurrence_days.length) {
          label += ` · ${t.recurrence_days.map(dayLabel).join(", ")}`;
        } else if (t.recurrence_type?.includes("month") && t.recurrence_day_of_month) {
          label += ` · day ${t.recurrence_day_of_month}`;
        }
        setRecurrence(label);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [templateId]);

  const rows: Array<[string, string | null]> = [
    ["Account", str("account")],
    ["Objective", str("project")],
    ["Category", str("category")],
    ["Recurs", templateId != null ? (recurrence ?? "Recurring") : null],
    ["Status", str("status") ? statusLabel(str("status") as string) : null],
    ["Client Detail", str("task_detail")],
    ["Notes", str("task_notes")],
    ["Instructions", str("instructions")],
    ["Link", str("link")],
    ["Start Date", str("start_date")],
    ["End Date", str("end_date")],
    ["Due", [str("due_date"), str("due_time") ? formatDueTime(str("due_time") as string) : null].filter(Boolean).join(" ") || null],
    ["Time Block", start && end ? `${start} – ${end}` : null],
    ["Duration", plannedMinutes != null && plannedMinutes > 0 ? formatMinutesInput(plannedMinutes) : null],
    ["Rate", task.rate != null ? `${task.rate}` : null],
    ["Review Required", task.review_required == null ? null : task.review_required ? "Yes" : "No"],
  ];


  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <h4 className="text-[15px] font-bold leading-tight text-espresso">{str("task_name") ?? "Untitled task"}</h4>
        {task.recurring_template_id != null && (
          <span
            title="Repeats — generated from a recurring template"
            className="shrink-0 rounded-full border border-amber/30 bg-amber-soft px-2 py-[1px] text-[10px] font-semibold text-amber"
          >
            ↻ Recurring
          </span>
        )}
      </div>

      <dl className="divide-y divide-sand rounded-lg border border-sand overflow-hidden">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-3 px-3 py-1.5">
            <dt className="w-28 shrink-0 text-[10px] font-bold uppercase tracking-wide text-walnut">{label}</dt>
            <dd className={`min-w-0 flex-1 whitespace-pre-wrap break-words text-[12px] ${value ? "text-espresso" : "text-stone/50"}`}>
              {value ?? "--"}
            </dd>
          </div>
        ))}
      </dl>

      <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-walnut">
            To-Do ({todos.length})
          </p>
          {todos.length === 0 && (
            <p className="rounded-lg border border-sand p-2 text-[12px] text-stone/50">--</p>
          )}
          {todos.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-sand p-2">
            {todos
              .slice()
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((t) => (
                <li key={t.id} className="flex gap-2 text-[12px] text-espresso">
                  <span className="text-stone">·</span>
                  <span className="min-w-0 break-words">{t.text}</span>
                </li>
              ))}
          </ul>
          )}
        </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onEdit}
          className="px-4 py-2 rounded-lg bg-sage text-white text-[13px] font-semibold hover:bg-sage/90 transition-colors cursor-pointer"
        >
          Edit Task
        </button>
      </div>
    </div>
  );
}
