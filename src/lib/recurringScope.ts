// Applying a change to one occurrence or to the whole series.
//
// A task generated from a recurring template is a real row, so editing or
// deleting it only ever touched that one date. That is right about half the
// time — "the 9am standup moves to 10am" almost never means only Tuesday. The
// caller now says which it meant, and this applies it.

export type RecurringScope = "this" | "future";

type MinimalClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

/** Statuses whose work has already begun — never rewritten or removed by a
 *  series-wide change, because someone has put time into them. */
const UNTOUCHABLE = ["in_progress", "submitted", "reviewing", "approved", "completed", "paid"];

/**
 * Sibling occurrences of the same template that fall after this one and have
 * not been started. Ordered so the caller can report what it touched.
 */
export async function futureSiblings(
  supabase: MinimalClient,
  templateId: string,
  afterDueDate: string,
  excludeTaskId: string | number
): Promise<{ id: number; due_date: string }[]> {
  const { data } = await supabase
    .from("assigned_tasks")
    .select("id, due_date, status")
    .eq("recurring_template_id", templateId)
    .is("deleted_at", null)
    .gt("due_date", afterDueDate)
    .order("due_date", { ascending: true });

  return ((data ?? []) as { id: number; due_date: string; status: string }[])
    .filter((t) => String(t.id) !== String(excludeTaskId))
    .filter((t) => !UNTOUCHABLE.includes(t.status))
    .map(({ id, due_date }) => ({ id, due_date }));
}

/**
 * Fields worth carrying across a series. Deliberately not everything: status,
 * assignees and anything about an individual occurrence's progress belong to
 * the one date they happened on.
 */
const SERIES_FIELDS = [
  "account",
  "project",
  "project_id",
  "category",
  "task_name",
  "task_detail",
  "task_notes",
  "link",
  "instructions",
  "instructions_locked",
  "review_required",
  "review_required_locked",
  "planned_minutes",
  "due_time",
  "end_date",
] as const;

export function seriesFieldsFrom(updatePayload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SERIES_FIELDS) {
    if (key in updatePayload) out[key] = updatePayload[key];
  }
  return out;
}

/**
 * Push an edit onto every future unstarted occurrence, and onto the template so
 * dates not yet generated match too. Times are left alone here: start_time and
 * end_time are per-date instants, and the template's clock times are what
 * future generation reads.
 */
export async function applyEditToFuture(
  supabase: MinimalClient,
  templateId: string,
  afterDueDate: string,
  excludeTaskId: string | number,
  updatePayload: Record<string, unknown>,
  clockTimes: { start_time?: string | null; end_time?: string | null }
): Promise<number> {
  const fields = seriesFieldsFrom(updatePayload);
  if (Object.keys(fields).length === 0 && clockTimes.start_time === undefined) return 0;

  const siblings = await futureSiblings(supabase, templateId, afterDueDate, excludeTaskId);

  for (const sibling of siblings) {
    const row: Record<string, unknown> = { ...fields, updated_at: new Date().toISOString() };
    // Re-anchor the hours onto that occurrence's own date rather than copying
    // this one's instant, which would collapse the series onto a single day.
    if (clockTimes.start_time !== undefined) {
      row.start_time = clockTimes.start_time;
      row.end_time = clockTimes.end_time ?? null;
      row.start_date = clockTimes.start_time ? sibling.due_date : null;
    }
    await supabase.from("assigned_tasks").update(row).eq("id", sibling.id);
  }

  // The template carries the same edit so occurrences generated later agree
  // with the ones that already exist.
  const templateUpdate: Record<string, unknown> = { ...fields };
  if ("task_name" in fields) templateUpdate.title = fields.task_name;
  if ("task_detail" in fields) templateUpdate.description = fields.task_detail;
  delete templateUpdate.review_required_locked;
  if (Object.keys(templateUpdate).length > 0) {
    await supabase.from("recurring_task_templates").update(templateUpdate).eq("id", templateId);
  }

  return siblings.length;
}

/**
 * Remove this occurrence and every later unstarted one.
 *
 * Removal is per-date and never touches the template: the schedule keeps
 * running, it just has holes where someone decided the work was not needed.
 * The removed rows stay as tombstones, which is what stops the generator
 * putting those dates back (see generateOccurrences).
 */
export async function removeOccurrences(
  supabase: MinimalClient,
  templateId: string,
  fromDueDate: string,
  excludeTaskId: string | number
): Promise<number> {
  const siblings = await futureSiblings(supabase, templateId, fromDueDate, excludeTaskId);
  const now = new Date().toISOString();

  for (const sibling of siblings) {
    await supabase.from("assigned_tasks").update({ deleted_at: now, updated_at: now }).eq("id", sibling.id);
  }

  return siblings.length;
}

/**
 * Clear the occurrences a pause covers.
 *
 * Pre-generating the calendar means a pause that only stops future generation
 * changes nothing you can see — the next two months are already sitting there.
 * So pausing takes them back out, from today through the end of the pause
 * (everything from today on, if the pause is open-ended).
 *
 * These are hard deletes, deliberately. A soft delete is a tombstone and the
 * generator treats those dates as taken forever, so pressing Resume early would
 * come back to a schedule full of holes. A pause is meant to be reversible;
 * removing a single date is the decision that sticks.
 *
 * Dates already worked on are left alone, same as every other series-wide
 * change.
 */
export async function clearPausedWindow(
  supabase: MinimalClient,
  templateId: string,
  fromDate: string,
  until: string | null
): Promise<number> {
  let query = supabase
    .from("assigned_tasks")
    .select("id, status")
    .eq("recurring_template_id", templateId)
    .is("deleted_at", null)
    .gte("due_date", fromDate);
  if (until) query = query.lte("due_date", until);

  const { data } = await query;
  const clearable = ((data ?? []) as { id: number; status: string }[]).filter(
    (task) => !UNTOUCHABLE.includes(task.status)
  );

  for (const task of clearable) {
    await supabase.from("assigned_task_assignees").delete().eq("assigned_task_id", task.id);
    await supabase.from("assigned_tasks").delete().eq("id", task.id);
  }

  return clearable.length;
}
