// Turning a recurring_task_templates row into real assigned_tasks rows.
//
// This used to live entirely inside the nightly cron, which meant a template
// only ever had ONE occurrence in existence — created at 00:00 UTC for the
// next day, and nothing else. Two consequences people hit constantly:
//
//   1. Saving a template produced nothing at all. Set one up at noon with a
//      start date of today and your list stayed empty until the robot ran that
//      night — and the day you actually picked never got a task.
//   2. The Calendar could not show recurring work beyond tomorrow, because the
//      rows for those days did not exist yet. Paging forward showed a blank
//      week for a daily task.
//
// So generation is a shared function now, run over a WINDOW of days rather
// than a single day, and called from both the cron and the template save.
// It is idempotent — an occurrence is keyed by (template, due_date), so
// re-running over an overlapping window creates nothing new.

import type { SupabaseClient } from "@supabase/supabase-js";
import { orgWallClockToUtc } from "@/lib/taskSchedule";

export type RecurrenceType =
  | "daily"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "every_2_months"
  | "every_3_months";

export type GeneratableTemplate = {
  id: string;
  title: string;
  description: string | null;
  task_detail?: string | null;
  task_notes?: string | null;
  instructions?: string | null;
  instructions_locked?: boolean;
  planned_minutes?: number | null;
  start_date?: string | null;
  assigned_to: string | null;
  assigned_to_ids?: string[] | null;
  assigned_by: string | null;
  account: string | null;
  project: string | null;
  project_id: string | null;
  category: string | null;
  recurrence_type: RecurrenceType;
  recurrence_day_of_month: number | null;
  link?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  due_time?: string | null;
  review_required?: boolean | null;
  is_active: boolean;
};

// How many OCCURRENCES of a template exist ahead of time — not how many days.
//
// This distinction is the whole point. A fixed window of days cannot serve both
// kinds of template: seven days keeps a weekly template visible but buries a
// VA under seven identical copies of a daily one, and two days keeps the daily
// list clean but leaves a weekly template showing nothing at all the day you
// create it — which was the original complaint.
//
// Counting occurrences instead gives every recurrence type the same behaviour:
// the current one and the one after it. A daily template holds two rows; a
// weekly one reaches a fortnight out; a monthly one reaches next month.
export const OCCURRENCES_AHEAD = 2;

// How far forward to look while collecting those occurrences. Has to clear two
// cycles of the longest recurrence (every 3 months), with room for month-length
// drift. Only bounds the scan — it is not a horizon anyone sees.
const MAX_LOOKAHEAD_DAYS = 200;

function partsInTz(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const mapped = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: mapped.year || "0000",
    month: mapped.month || "01",
    day: mapped.day || "01",
  };
}

/** Today in `timeZone`, as "YYYY-MM-DD". */
export function orgToday(timeZone: string): string {
  const p = partsInTz(new Date(), timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The next `count` dates this template lands on, at or after `from`.
 *
 * Counting from TODAY rather than tomorrow is what makes a template saved this
 * afternoon produce this afternoon's task — the old cron only ever built the
 * next day, so the start date you actually picked was skipped whenever you
 * saved after that night's run.
 */
export function nextOccurrences(
  template: GeneratableTemplate,
  from: string,
  count = OCCURRENCES_AHEAD
): string[] {
  const dates: string[] = [];
  for (let i = 0; i <= MAX_LOOKAHEAD_DAYS && dates.length < count; i++) {
    const date = addDays(from, i);
    if (isTemplateDueOn(template, date)) dates.push(date);
  }
  return dates;
}

function daysBetween(startDateStr: string, targetStr: string): number {
  const start = new Date(startDateStr + "T00:00:00Z");
  const end = new Date(targetStr + "T00:00:00Z");
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

function monthsBetween(startDateStr: string, targetStr: string): number {
  const start = new Date(startDateStr + "T00:00:00Z");
  const end = new Date(targetStr + "T00:00:00Z");
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
}

/** Does this template land on `date` ("YYYY-MM-DD")? */
export function isTemplateDueOn(template: GeneratableTemplate, date: string): boolean {
  if (!template.is_active) return false;
  if (!template.start_date || date < template.start_date) return false;

  const dayOfMonth = Number(date.slice(8, 10));
  const daysSince = daysBetween(template.start_date, date);
  const monthsSince = monthsBetween(template.start_date, date);

  switch (template.recurrence_type) {
    case "daily":
      return true;
    case "weekly":
      return daysSince % 7 === 0;
    case "biweekly":
      return daysSince % 14 === 0;
    case "monthly":
      return template.recurrence_day_of_month === dayOfMonth;
    case "every_2_months":
      return template.recurrence_day_of_month === dayOfMonth && monthsSince >= 0 && monthsSince % 2 === 0;
    case "every_3_months":
      return template.recurrence_day_of_month === dayOfMonth && monthsSince >= 0 && monthsSince % 3 === 0;
    default:
      return false;
  }
}

export function assigneeIdsFor(template: GeneratableTemplate): string[] {
  const ids = template.assigned_to_ids?.filter(Boolean) ?? [];
  if (ids.length > 0) return ids;
  return template.assigned_to ? [template.assigned_to] : [];
}

export type GenerationResult = {
  created: number;
  skipped: number;
  dates: string[];
  createdTaskIds: number[];
};

/**
 * Creates the next OCCURRENCES_AHEAD occurrences of each template, counting
 * from `from` ("YYYY-MM-DD" in org time).
 *
 * Requires a service-role client — it writes assigned_tasks and
 * assigned_task_assignees on behalf of whoever the template assigns to.
 */
export async function generateOccurrences(
  supabase: SupabaseClient,
  templates: GeneratableTemplate[],
  from: string
): Promise<GenerationResult> {
  const result: GenerationResult = { created: 0, skipped: 0, dates: [], createdTaskIds: [] };
  if (templates.length === 0) return result;

  // Every (template, date) pair the schedule calls for. Each template gets its
  // own dates, so a daily and a monthly template in the same run reach as far
  // forward as their own cycles require and no further.
  const wanted: { template: GeneratableTemplate; date: string }[] = [];
  for (const template of templates) {
    for (const date of nextOccurrences(template, from)) wanted.push({ template, date });
  }
  if (wanted.length === 0) return result;

  const dates = [...new Set(wanted.map((w) => w.date))];
  result.dates = dates;

  // Which of those already exist. Deliberately ignores archived_at/deleted_at:
  // a completed or deleted occurrence still counts as created, so the nightly
  // run does not resurrect work someone already dealt with.
  const { data: existing, error: existingError } = await supabase
    .from("assigned_tasks")
    .select("recurring_template_id, due_date")
    .in("recurring_template_id", [...new Set(wanted.map((w) => w.template.id))])
    .in("due_date", dates);

  if (existingError) throw new Error(existingError.message);

  const already = new Set(
    (existing ?? []).map((row) => `${row.recurring_template_id}|${row.due_date}`)
  );

  // Attachments are per-template and copied onto every occurrence, so fetch
  // them once per template rather than once per day.
  const attachmentsByTemplate = new Map<
    string,
    { filename: string; storage_path: string; file_size: number | null; mime_type: string | null; uploaded_by: string | null }[]
  >();

  for (const { template, date } of wanted) {
    if (already.has(`${template.id}|${date}`)) {
      result.skipped++;
      continue;
    }

    const assigneeIds = assigneeIdsFor(template);
    if (assigneeIds.length === 0) {
      result.skipped++;
      continue;
    }

    const { data: task, error: taskError } = await supabase
      .from("assigned_tasks")
      .insert({
        account: template.account,
        project: template.project,
        project_id: template.project_id ?? null,
        task_name: template.title,
        category: template.category,
        task_detail: template.task_detail ?? template.description,
        task_notes: template.task_notes,
        // Carried onto every generated task, so a recurring job says how long
        // it takes the same way a one-off does. Without it, anything spawned
        // from a template arrived with no duration no matter who it went to.
        planned_minutes: template.planned_minutes ?? null,
        link: template.link ?? null,
        due_date: date,
        due_time: template.due_time ?? null,
        review_required: Boolean(template.review_required),
        review_required_locked: Boolean(template.review_required),
        // An occurrence is one day: the day it is due. The template's own
        // start_date is the RECURRENCE ANCHOR — the day the repeat begins —
        // and copying it here made every occurrence a work span running from
        // that anchor to its due date. A daily template anchored in June was
        // painting ~60 span dots per task across the Calendar. Same reason
        // end_date is not copied: a fixed end date cannot mean anything
        // sensible on an occurrence that repeats.
        start_date: date,
        end_date: null,
        // The template holds clock times; each occurrence pairs them with its
        // own date so the generated task lands on the calendar as a real block,
        // read on the org clock like every other schedule write.
        start_time: template.start_time ? orgWallClockToUtc(date, template.start_time.slice(0, 5)) : null,
        end_time: template.end_time ? orgWallClockToUtc(date, template.end_time.slice(0, 5)) : null,
        assigned_by: template.assigned_by,
        instructions: template.instructions,
        instructions_locked: Boolean(template.instructions_locked),
        recurring_template_id: template.id,
        created_by: template.assigned_by,
        status: "pending",
      })
      .select("id")
      .single();

    if (taskError || !task) {
      result.skipped++;
      continue;
    }

    const { error: assigneeError } = await supabase.from("assigned_task_assignees").insert(
      assigneeIds.map((va_id) => ({ assigned_task_id: task.id, va_id, status: "pending" }))
    );

    if (assigneeError) {
      await supabase.from("assigned_tasks").delete().eq("id", task.id);
      result.skipped++;
      continue;
    }

    if (!attachmentsByTemplate.has(template.id)) {
      const { data: templateAttachments, error: attachmentFetchError } = await supabase
        .from("recurring_template_attachments")
        .select("filename, storage_path, file_size, mime_type, uploaded_by")
        .eq("template_id", template.id)
        .order("uploaded_at", { ascending: true });

      if (attachmentFetchError) {
        await supabase.from("assigned_task_assignees").delete().eq("assigned_task_id", task.id);
        await supabase.from("assigned_tasks").delete().eq("id", task.id);
        result.skipped++;
        continue;
      }
      attachmentsByTemplate.set(template.id, templateAttachments ?? []);
    }

    const attachments = attachmentsByTemplate.get(template.id) ?? [];
    if (attachments.length > 0) {
      const { error: attachmentInsertError } = await supabase.from("assigned_task_attachments").insert(
        attachments.map((attachment) => ({
          assigned_task_id: task.id,
          filename: attachment.filename,
          storage_path: attachment.storage_path,
          file_size: attachment.file_size,
          mime_type: attachment.mime_type,
          uploaded_by: attachment.uploaded_by ?? template.assigned_by,
        }))
      );

      if (attachmentInsertError) {
        await supabase.from("assigned_task_assignees").delete().eq("assigned_task_id", task.id);
        await supabase.from("assigned_tasks").delete().eq("id", task.id);
        result.skipped++;
        continue;
      }
    }

    result.created++;
    result.createdTaskIds.push(task.id as number);
  }

  return result;
}

/** The org's configured timezone, falling back to UTC. */
export async function orgTimezone(supabase: SupabaseClient): Promise<string> {
  const { data } = await supabase
    .from("organization_settings")
    .select("timezone")
    .limit(1)
    .single();
  return data?.timezone || "UTC";
}

/**
 * Fill in a single template's upcoming occurrences. Called right after a
 * template is saved so the work shows up immediately instead of waiting for
 * the next nightly run.
 */
export async function generateForTemplate(
  supabase: SupabaseClient,
  template: GeneratableTemplate
): Promise<GenerationResult> {
  const tz = await orgTimezone(supabase);
  return generateOccurrences(supabase, [template], orgToday(tz));
}
