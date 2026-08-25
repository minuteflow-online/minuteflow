// Turning a recurring template into real tasks.
//
// This used to live only in the nightly cron, which generated exactly one day
// ahead. That meant a template you set up today showed nothing on the calendar
// until the night before each occurrence — useless for planning a week, and it
// made a template feel like it hadn't worked.
//
// Generation happens on save now, and the cron tops the window back up. Both
// call the same function, so "when does it appear" has one answer.

import { orgWallClockToUtc } from "@/lib/taskSchedule";

/** How far ahead an open-ended template is filled in, and re-filled nightly. */
export const OPEN_ENDED_HORIZON_DAYS = 60;

/** Ceiling for a template with an end date, so one with a distant limit can't
 *  insert thousands of rows in a single save. The cron extends it over time. */
export const MAX_HORIZON_DAYS = 365;

export type RecurrenceType =
  | "daily"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "every_2_months"
  | "every_3_months";

export type OccurrenceTemplate = {
  id: string;
  is_active: boolean;
  /** A pause with an end date. Dates up to and including this one are skipped;
   *  after it the schedule resumes on its own. Null while paused means paused
   *  indefinitely, which is what an is_active=false template used to mean. */
  paused_until?: string | null;
  start_date?: string | null;
  repeat_until?: string | null;
  recurrence_type: RecurrenceType | string;
  recurrence_day_of_month?: number | null;
};

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400000
  );
}

function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

/** Whether a template lands on a given date. */
export function fallsOn(template: OccurrenceTemplate, date: string): boolean {
  // Paused. With an end date the pause is a window rather than a stop, so
  // dates past it still land — the schedule restarts itself and nobody has to
  // remember to press Resume.
  if (!template.is_active && (!template.paused_until || date <= template.paused_until)) {
    return false;
  }
  if (!template.start_date || date < template.start_date) return false;
  if (template.repeat_until && date > template.repeat_until) return false;

  const days = daysBetween(template.start_date, date);
  const months = monthsBetween(template.start_date, date);
  const dayOfMonth = Number(date.slice(8, 10));

  switch (template.recurrence_type) {
    case "daily":
      return true;
    case "weekly":
      return days % 7 === 0;
    case "biweekly":
      return days % 14 === 0;
    case "monthly":
      return template.recurrence_day_of_month === dayOfMonth;
    case "every_2_months":
      return template.recurrence_day_of_month === dayOfMonth && months >= 0 && months % 2 === 0;
    case "every_3_months":
      return template.recurrence_day_of_month === dayOfMonth && months >= 0 && months % 3 === 0;
    default:
      return false;
  }
}

/**
 * Every date this template should produce a task for, between `from` and the
 * horizon. Starts at `from` (today) rather than tomorrow: a template whose
 * start date is today should show up today, not after the next cron run.
 */
export function occurrenceDates(template: OccurrenceTemplate, from: string): string[] {
  const horizonDays = template.repeat_until ? MAX_HORIZON_DAYS : OPEN_ENDED_HORIZON_DAYS;
  const lastPossible = addDays(from, horizonDays);
  const end = template.repeat_until && template.repeat_until < lastPossible ? template.repeat_until : lastPossible;

  const dates: string[] = [];
  for (let d = from; d <= end; d = addDays(d, 1)) {
    if (fallsOn(template, d)) dates.push(d);
  }
  return dates;
}

/** The task row a template produces for one date. */
export function taskRowFor(
  template: Record<string, unknown>,
  date: string
): Record<string, unknown> {
  const startClock = template.start_time as string | null | undefined;
  const endClock = template.end_time as string | null | undefined;
  return {
    account: template.account ?? null,
    project: template.project ?? null,
    project_id: template.project_id ?? null,
    task_name: template.title ?? template.task_name ?? "",
    category: template.category ?? null,
    task_detail: template.task_detail ?? template.description ?? null,
    task_notes: template.task_notes ?? null,
    link: template.link ?? null,
    planned_minutes: template.planned_minutes ?? null,
    due_date: date,
    due_time: template.due_time ?? null,
    end_date: template.end_date ?? null,
    review_required: Boolean(template.review_required),
    review_required_locked: Boolean(template.review_required),
    // Clock times on the template become a real block on that date, read on the
    // org clock like every other schedule write. Bare Start Date (no clock
    // time) must NOT fall back to the template's own start_date — that field
    // is the SAME fixed date on every occurrence the template ever produces,
    // so every occurrence after the first was landing on the template's
    // original start date in addition to its own due_date, showing up as a
    // phantom duplicate stacked on day one of the series.
    start_date: startClock ? date : null,
    start_time: startClock ? orgWallClockToUtc(date, startClock.slice(0, 5)) : null,
    end_time: endClock ? orgWallClockToUtc(date, endClock.slice(0, 5)) : null,
    assigned_by: template.assigned_by ?? null,
    instructions: template.instructions ?? null,
    instructions_locked: Boolean(template.instructions_locked),
    recurring_template_id: template.id,
    created_by: template.assigned_by ?? null,
    status: "pending",
  };
}

export function assigneeIdsOf(template: Record<string, unknown>): string[] {
  const ids = ((template.assigned_to_ids as string[] | null) ?? []).filter(Boolean);
  if (ids.length > 0) return ids;
  const single = template.assigned_to as string | null;
  return single ? [single] : [];
}

type MinimalClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

/**
 * Creates any missing tasks for this template between `from` and the horizon.
 * Existing dates are skipped, so calling it repeatedly — on every save and
 * again nightly — converges rather than duplicating.
 */
export async function generateOccurrences(
  supabase: MinimalClient,
  template: Record<string, unknown> & OccurrenceTemplate,
  from: string
): Promise<{ created: number; dates: string[] }> {
  const assigneeIds = assigneeIdsOf(template);
  if (assigneeIds.length === 0) return { created: 0, dates: [] };

  const wanted = occurrenceDates(template, from);
  if (wanted.length === 0) return { created: 0, dates: [] };

  // Removed dates count as taken. A soft-deleted occurrence is a decision —
  // "not this week" — so filtering it out here would have the generator
  // helpfully put it back on the next run.
  const { data: existing } = await supabase
    .from("assigned_tasks")
    .select("due_date")
    .eq("recurring_template_id", template.id)
    .in("due_date", wanted);

  const already = new Set((existing ?? []).map((r: { due_date: string }) => r.due_date));
  const missing = wanted.filter((d) => !already.has(d));

  const createdDates: string[] = [];
  for (const date of missing) {
    const { data: task, error } = await supabase
      .from("assigned_tasks")
      .insert(taskRowFor(template, date))
      .select("id")
      .single();
    if (error || !task) continue;

    const { error: assigneeError } = await supabase
      .from("assigned_task_assignees")
      .insert(assigneeIds.map((va_id) => ({ assigned_task_id: task.id, va_id, status: "pending" })));
    if (assigneeError) {
      await supabase.from("assigned_tasks").delete().eq("id", task.id);
      continue;
    }
    createdDates.push(date);
  }

  return { created: createdDates.length, dates: createdDates };
}
