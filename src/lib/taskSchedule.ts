// Shared helpers for reading/rendering scheduled assigned_tasks (start_time/end_time)
// across the Calendar and Assignment "Team" workload view.

// A normalized assigned_tasks row, regardless of which shape the API returned it in.
export type RawTask = {
  id: number;
  task_name: string;
  account: string | null;
  due_date: string | null;
  start_date: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string;
  category: string | null;
  projectId: string | null;
  isRecurring: boolean;
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

// The 6 real categories, sourced from TaskEntryForm.tsx's CATEGORIES list — the
// single source of truth for every task-creation form on the site.
export const CATEGORY_OPTIONS = ["Task", "Communication", "Planning", "Collaboration", "Personal", "Break"];

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

// Full block styling (border + solid background + text) for Calendar hour
// blocks — same hues as the dot, with a slightly darker border for
// definition. Fully opaque: any transparency blends toward the white page
// background, which is the "white overlay" look this deliberately avoids.
const CATEGORY_BLOCK_CLASSES: Record<string, string> = {
  Task: "border-[#3a8f5f] bg-[#4fb37a] text-white",
  Communication: "border-[#cc8a1f] bg-[#f0ad3f] text-white",
  Planning: "border-[#8a5cc0] bg-[#a878d6] text-white",
  Collaboration: "border-[#d97830] bg-[#f2954a] text-white",
  Personal: "border-[#2fa595] bg-[#3fc0b0] text-white",
  Break: "border-[#3a80cc] bg-[#4f9fea] text-white",
};

export function categoryBlockClasses(category: string | null | undefined): string {
  // Neutral gray, not sage — sage sits in the same green hue as the "Task"
  // category and was getting mistaken for it when category is unset.
  return (category && CATEGORY_BLOCK_CLASSES[category]) || "border-stone-400 bg-stone-300 text-stone-800";
}

export function formatTimeRange(task: Pick<RawTask, "start_time" | "end_time">): string {
  const start = new Date(task.start_time!);
  const end = new Date(task.end_time!);
  const fmt = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${fmt(start)} – ${fmt(end)}`;
}

// /api/assigned-tasks returns two different shapes depending on the query:
// - admin/flat (bare ?view=, or ?view=&vaId=): task fields on the row itself,
//   with an assigned_task_assignees[] array.
// - VA/nested (?selfOnly=true, or ?viewAsVa=): the row is an assignee record
//   with the task fields nested under assigned_tasks.
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
          start_date: (nested.start_date as string | null) ?? null,
          start_time: (nested.start_time as string | null) ?? null,
          end_time: (nested.end_time as string | null) ?? null,
          status: row.status as string,
          category: (nested.category as string | null) ?? null,
          projectId: (nested.project_id as string | null) ?? null,
          isRecurring: Boolean(nested.recurring_template_id),
        };
      }
      const assignees = (row.assigned_task_assignees ?? []) as Array<{ va_id: string; status: string }>;
      const mine = assignees.find((a) => a.va_id === currentUserId);
      return {
        id: row.id as number,
        task_name: row.task_name as string,
        account: (row.account as string | null) ?? null,
        due_date: (row.due_date as string | null) ?? null,
        start_date: (row.start_date as string | null) ?? null,
        start_time: (row.start_time as string | null) ?? null,
        end_time: (row.end_time as string | null) ?? null,
        status: mine?.status || assignees[0]?.status || "on_queue",
        category: (row.category as string | null) ?? null,
        projectId: (row.project_id as string | null) ?? null,
        isRecurring: Boolean(row.recurring_template_id),
      };
    })
    .filter((t): t is RawTask => Boolean(t.id && t.task_name));
}
