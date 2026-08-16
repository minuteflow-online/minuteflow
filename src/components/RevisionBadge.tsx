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
export default function RevisionBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  const label = count === 1 ? "R" : `R${count}`;
  return (
    <span className="text-[10px] font-bold px-1.5 py-[2px] rounded-full bg-terracotta text-white">
      {label}
    </span>
  );
}
