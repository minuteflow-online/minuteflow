/**
 * Whether an Output Based task belongs on a given person's Calendar.
 *
 * A task is claimed_by someone once they grab it from the pool, or at once when
 * a VA creates it for themselves. A task an admin creates and assigns is
 * different: it carries assigned_to but stays unclaimed until the assignee
 * accepts it. Filtering on claimed_by alone hid every such task from the
 * Calendar, so an output task created for someone never showed up there.
 */
export function fixedTaskBelongsTo(
  task: { claimed_by: string | null; assigned_to?: string | null },
  vaId: string
): boolean {
  if (task.claimed_by) return task.claimed_by === vaId;
  return task.assigned_to === vaId;
}
