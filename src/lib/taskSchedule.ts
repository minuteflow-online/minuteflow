// Shared helpers for reading/rendering scheduled assigned_tasks (start_time/end_time)
// across the Calendar and Assignment "Team" workload view.

// A normalized assigned_tasks row, regardless of which shape the API returned it in.
export type RawTask = {
  id: number;
  task_name: string;
  account: string | null;
  due_date: string | null;
  due_time: string | null;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string;
  category: string | null;
  projectId: string | null;
  isRecurring: boolean;
  todos: { id: number; text: string; sort_order: number }[];
};

export function statusDotClass(status: string): string {
  switch (status) {
    case "in_progress":
    case "revision_needed":
      return "bg-amber";
    case "submitted":
      return "bg-sky-500";
    case "reviewing":
      return "bg-violet-500";
    case "approved":
      return "bg-emerald-500";
    case "completed":
      return "bg-sage";
    case "paid":
      return "bg-purple-500";
    case "cancelled":
      return "bg-terracotta";
    default:
      return "bg-stone"; // on_queue, pending, open, unassigned
  }
}

export function statusBadgeClasses(status: string): string {
  switch (status) {
    case "in_progress":
      return "bg-amber-50 text-amber-500 border-amber-200";
    case "submitted":
      return "bg-sky-50 text-sky-600 border-sky-200";
    case "reviewing":
      return "bg-violet-50 text-violet-600 border-violet-200";
    case "revision_needed":
      return "bg-amber-50 text-amber-600 border-amber-200";
    case "approved":
      return "bg-emerald-50 text-emerald-600 border-emerald-200";
    case "completed":
      return "bg-sage-soft text-sage border-sage/20";
    case "paid":
      return "bg-purple-50 text-purple-600 border-purple-200";
    case "cancelled":
      return "bg-red-50 text-red-500 border-red-200";
    default:
      return "bg-stone/10 text-stone border-stone/20";
  }
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getDateInTimezone(tz: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}

export function addDaysToDateStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// Local (browser) calendar date of a stored instant — matches how start/end times
// are constructed (see Calendar's saveBlock) so encode/decode stay consistent.
export function localDateOf(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// "HH:MM:SS" — always Eastern time, regardless of the viewer's browser
// timezone. Counterpart to localDateOf; used to re-anchor a multi-day span's
// time-of-day onto a different calendar day (see reanchorToDate below).
export function timeOfDay(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${hour}:${get("minute")}:${get("second")}`;
}

// Inclusive date-range membership. A missing/earlier endDate collapses the
// range to just startDate, so single-day tasks (no end_date) keep matching
// only their one day.
export function isDateInSpan(dateStr: string, startDate: string, endDate: string | null | undefined): boolean {
  const end = endDate && endDate > startDate ? endDate : startDate;
  return dateStr >= startDate && dateStr <= end;
}

// Re-anchors a task's start_time/end_time onto dateStr, keeping the original
// Eastern time-of-day — this is what turns a single start_time/end_time pair
// into a "daily window" applied across a multi-day span. Identity transform
// when dateStr already matches the task's own anchor day.
export function reanchorToDate(task: RawTask, dateStr: string): RawTask {
  if (!task.start_time || !task.end_time) return task;
  return {
    ...task,
    start_time: `${dateStr}T${timeOfDay(task.start_time)}`,
    end_time: `${dateStr}T${timeOfDay(task.end_time)}`,
  };
}

// Label for a Day/Week block within a multi-day span: which day of the span
// is this? No label at all for a plain single-day task.
export function spanLabel(task: RawTask, dateStr: string): "Start" | "In Progress" | "Due" | null {
  if (!task.end_date || task.end_date === task.start_date) return null;
  if (dateStr === task.start_date) return "Start";
  if (dateStr === task.due_date) return "Due";
  if (task.start_date && dateStr > task.start_date && dateStr < task.end_date) return "In Progress";
  return null;
}

// The 6 real categories, sourced from TaskEntryForm.tsx's CATEGORIES list — the
// single source of truth for every task-creation form on the site.
export const CATEGORY_OPTIONS = ["Task", "Communication", "Planning", "Collaboration", "Personal", "Break"];

// Auto-category rules — originally hand-coded in TaskEntryForm.tsx's "Log a
// Task" panel (Virtual Concierge only, keyed off the Objective/project name
// and, for "Operations & Admin Work", the task name). Extracted here so
// every task-creation surface (TaskEditor included) applies the same rule
// instead of drifting. Returns null when no rule matches — callers should
// leave the category as-is in that case, not clear it.
export function autoCategoryForTask(account: string, projectName: string, taskName: string): string | null {
  if (account !== "Virtual Concierge") return null;
  if (projectName === "Organizing") return "Planning";
  if (projectName === "Team Development" || projectName === "Personal Improvement") return "Collaboration";
  if (projectName === "Operations & Admin Work") {
    return taskName.toLowerCase().includes("meeting") ? "Collaboration" : "Task";
  }
  return null;
}

// Category color coding — hand-tuned medium hues (not raw Tailwind-500,
// which read as neon; not the brand `amber` token either, which is a dark
// goldenrod that reads as brown). Each is a clear, recognizable mid-tone
// version of its hue at moderate saturation.
const CATEGORY_DOT_CLASSES: Record<string, string> = {
  Task: "bg-[#4fb37a]",
  Communication: "bg-[#f0ad3f]",
  Planning: "bg-[#a878d6]",
  Collaboration: "bg-[#f2954a]",
  Personal: "bg-[#3fc0b0]",
  Break: "bg-[#4f9fea]",
};

export function categoryDotClass(category: string): string {
  return CATEGORY_DOT_CLASSES[category] ?? "bg-stone-300";
}

// Full block styling (border + background + text) for Calendar hour blocks.
// Start-date-driven blocks fill at 45% opacity — noticeably lighter than the
// due-date variant so the two are easy to tell apart at a glance; due-date-
// driven blocks are fully opaque (the established rule: due dates get 100%
// opacity, start dates stay lighter). Text uses a deep shade of the SAME
// hue (not white) — reads clearly against the lightened fill.
const CATEGORY_BLOCK_CLASSES: Record<string, string> = {
  Task: "border-[#3a8f5f] bg-[#4fb37a]/45 text-[#1f5c3a]",
  Communication: "border-[#cc8a1f] bg-[#f0ad3f]/45 text-[#7a5410]",
  Planning: "border-[#8a5cc0] bg-[#a878d6]/45 text-[#5c3a82]",
  Collaboration: "border-[#d97830] bg-[#f2954a]/45 text-[#8a4a1f]",
  Personal: "border-[#2fa595] bg-[#3fc0b0]/45 text-[#1f6b60]",
  Break: "border-[#3a80cc] bg-[#4f9fea]/45 text-[#1f4a82]",
};

// Due-date-driven blocks: fully opaque fill, white text (the solid color
// itself provides contrast, unlike the 70%-opacity variant above where
// white washed out against the page-blended fill).
const CATEGORY_BLOCK_CLASSES_SOLID: Record<string, string> = {
  Task: "border-[#3a8f5f] bg-[#4fb37a] text-white",
  Communication: "border-[#cc8a1f] bg-[#f0ad3f] text-white",
  Planning: "border-[#8a5cc0] bg-[#a878d6] text-white",
  Collaboration: "border-[#d97830] bg-[#f2954a] text-white",
  Personal: "border-[#2fa595] bg-[#3fc0b0] text-white",
  Break: "border-[#3a80cc] bg-[#4f9fea] text-white",
};

export function categoryBlockClasses(category: string | null | undefined, fullOpacity: boolean = false): string {
  // Neutral gray, not sage — sage sits in the same green hue as the "Task"
  // category and was getting mistaken for it when category is unset.
  const map = fullOpacity ? CATEGORY_BLOCK_CLASSES_SOLID : CATEGORY_BLOCK_CLASSES;
  const fallback = fullOpacity ? "border-stone-400 bg-stone-300 text-white" : "border-stone-400 bg-stone-300/70 text-stone-800";
  return (category && map[category]) || fallback;
}

export function formatTimeRange(task: Pick<RawTask, "start_time" | "end_time">): string {
  const start = new Date(task.start_time!);
  const end = new Date(task.end_time!);
  const fmt = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${fmt(start)} – ${fmt(end)}`;
}

// due_time is stored as a plain "HH:MM" (24h) string, independent of
// start_time/end_time — it marks a single deadline moment on due_date, not a
// work-span block. Formats it for display without going through Date/timezone
// conversion since it isn't a timestamp.
export function formatDueTime(dueTime: string): string {
  const [h, m] = dueTime.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

// /api/assigned-tasks returns two different shapes depending on the query:
// - admin/flat (bare ?view=, or ?view=&vaId=): task fields on the row itself,
//   with an assigned_task_assignees[] array.
// - VA/nested (?selfOnly=true, or ?viewAsVa=): the row is an assignee record
//   with the task fields nested under assigned_tasks.
function normalizeTodos(raw: unknown): { id: number; text: string; sort_order: number }[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Array<{ id: number; text: string; sort_order: number }>)
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);
}

export function normalizeAssignedRows(rawRows: Array<Record<string, unknown>>, currentUserId: string): RawTask[] {
  return rawRows
    .map((row) => {
      const nested = row.assigned_tasks as Record<string, unknown> | undefined;
      if (nested && typeof nested === "object") {
        return {
          id: nested.id as number,
          task_name: nested.task_name as string,
          account: (nested.account as string | null) ?? null,
          due_date: (nested.due_date as string | null) ?? null,
          due_time: (nested.due_time as string | null) ?? null,
          start_date: (nested.start_date as string | null) ?? null,
          end_date: (nested.end_date as string | null) ?? null,
          start_time: (nested.start_time as string | null) ?? null,
          end_time: (nested.end_time as string | null) ?? null,
          status: row.status as string,
          category: (nested.category as string | null) ?? null,
          projectId: (nested.project_id as string | null) ?? null,
          isRecurring: Boolean(nested.recurring_template_id),
          todos: normalizeTodos(nested.task_todos),
        };
      }
      const assignees = (row.assigned_task_assignees ?? []) as Array<{ va_id: string; status: string }>;
      const mine = assignees.find((a) => a.va_id === currentUserId);
      return {
        id: row.id as number,
        task_name: row.task_name as string,
        account: (row.account as string | null) ?? null,
        due_date: (row.due_date as string | null) ?? null,
        due_time: (row.due_time as string | null) ?? null,
        start_date: (row.start_date as string | null) ?? null,
        end_date: (row.end_date as string | null) ?? null,
        start_time: (row.start_time as string | null) ?? null,
        end_time: (row.end_time as string | null) ?? null,
        status: mine?.status || assignees[0]?.status || "on_queue",
        category: (row.category as string | null) ?? null,
        projectId: (row.project_id as string | null) ?? null,
        isRecurring: Boolean(row.recurring_template_id),
        todos: normalizeTodos(row.task_todos),
      };
    })
    .filter((t): t is RawTask => Boolean(t.id && t.task_name));
}
