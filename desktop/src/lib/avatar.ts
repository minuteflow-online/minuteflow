// Ported verbatim from src/lib/utils.ts — same initials-circle avatar used
// throughout the web app, so the same person reads as the same color in
// both places.
export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

const AVATAR_COLORS = [
  "var(--color-terracotta)",
  "var(--color-sage)",
  "var(--color-clay-rose)",
  "var(--color-slate-blue)",
  "var(--color-walnut)",
];

export function getAvatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
