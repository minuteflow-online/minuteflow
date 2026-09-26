// Ported from src/components/RevisionBadge.tsx. One revision reads "R",
// further ones "R2", "R3" — the count follows the R, matching how the team
// says it out loud ("that's on R2").
export default function RevisionBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  const label = count === 1 ? "R" : `R${count}`;
  return (
    <span
      className="text-[10px] font-bold px-1.5 py-[2px] rounded-full bg-terracotta text-white"
      title={`Revision ${count}`}
    >
      {label}
    </span>
  );
}
