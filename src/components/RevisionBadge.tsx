/**
 * The revision marker shown next to a task that has been sent back for rework.
 *
 * One revision reads "R", further ones read "R2", "R3", and so on — the count
 * follows the R, matching how the team says it out loud ("that's on R2").
 *
 * This lives in its own file because the badge appears across the Dashboard,
 * Assignment, admin Task Assignments, Activity Log, Time Log, and Team views.
 * It previously existed as three byte-identical copies, which is how the label
 * format drifted from what was intended in the first place.
 */
export default function RevisionBadge({
  count,
  late = false,
}: {
  count: number;
  /**
   * Prefixes an "L" for work handed in after its deadline, giving "L", "LR",
   * "LR2". Only meaningful where a submission is shown — a time-log row is
   * work time, not a hand-in, so it has no deadline of its own to miss.
   */
  late?: boolean;
}) {
  if (count <= 0 && !late) return null;
  const revision = count <= 0 ? "" : count === 1 ? "R" : `R${count}`;
  return (
    <span
      className="text-[10px] font-bold px-1.5 py-[2px] rounded-full bg-terracotta text-white"
      title={
        [late ? "Submitted late" : null, count > 0 ? `Revision ${count}` : null]
          .filter(Boolean)
          .join(" · ") || undefined
      }
    >
      {late ? `L${revision}` : revision}
    </span>
  );
}
