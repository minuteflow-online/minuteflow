/**
 * The marker shown next to a task that is part of a recurring series.
 *
 * Recurrence was only visible inside the Recurring table itself, so a task
 * looked one-off everywhere else it appeared — you could not tell, from the
 * Assignment table, that editing a row was touching something that regenerates.
 *
 * Two different links both mean "recurring", and the badge says which:
 *   - fromTemplateId  — this task was spawned BY a template (part of a series)
 *   - spawnsTemplateId — this task spawns a template (it is the seed)
 *
 * Lives in its own file, like RevisionBadge, because it belongs anywhere a task
 * is listed: Assignment, admin Task Assignments, Dashboard, Calendar.
 */
export default function RecurringBadge({
  fromTemplateId,
  spawnsTemplateId,
}: {
  fromTemplateId?: string | null;
  spawnsTemplateId?: string | null;
}) {
  if (!fromTemplateId && !spawnsTemplateId) return null;

  return (
    <span
      title={
        fromTemplateId
          ? "Part of a recurring series"
          : "Recurring — this task generates a series"
      }
      className="ml-1.5 shrink-0 text-[10px] font-semibold px-1.5 py-[2px] rounded-full bg-slate-blue-soft text-slate-blue border border-slate-blue/20"
    >
      ↻
    </span>
  );
}
