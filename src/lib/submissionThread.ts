/**
 * How the entries of one task's submission thread relate to each other.
 *
 * A thread mixes the VA's submissions with everything said about them —
 * revision requests, approvals, notes. Those replies belong with the
 * submission they answer (Toni's call, 2026-11-13): a revision request written
 * days after the work was done still reads under that work, not on a day the
 * task has no card for.
 */

type ThreadEntry = { id: number; message_type: string; created_at: string };

/**
 * The submission a reply answers: the newest one handed in at or before it.
 * A reply that predates every submission (rare — a note on a task before any
 * work came in) attaches to the first one. Null when the thread has no
 * submission at all. A submission answers for itself.
 */
export function answeredSubmission<T extends ThreadEntry>(items: T[], item: T): T | null {
  if (item.message_type === "submission") return item;
  const submissions = items
    .filter((i) => i.message_type === "submission")
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
  if (submissions.length === 0) return null;
  let answered: T | null = null;
  for (const s of submissions) {
    if (s.created_at <= item.created_at) answered = s;
    else break;
  }
  return answered ?? submissions[0];
}
