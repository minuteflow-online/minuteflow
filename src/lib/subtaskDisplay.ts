// Shared subtask display formatting — used by both VAProjectsTab.tsx's List
// View and SubtaskBoardView.tsx's Board View, so the two views can't quietly
// disagree about what a subtask's assignee names are.
import type { Profile } from "@/types/database";

interface AssigneeLike {
  va_id: string;
  profiles?: { id: string; full_name: string; username: string } | null;
}

/**
 * Resolves each assignee to a display name: the embedded profile join first,
 * then a lookup in `activeProfiles` (the full team roster, when passed) for
 * the case where that join is missing, then the raw va_id as a last resort
 * so something is always shown instead of a blank.
 */
export function assigneeNames(
  assignees: AssigneeLike[] | null | undefined,
  activeProfiles?: Pick<Profile, "id" | "full_name" | "username">[]
): string {
  return (assignees ?? [])
    .map((a) => {
      if (a.profiles?.full_name || a.profiles?.username) {
        return a.profiles.full_name || a.profiles.username;
      }
      const fallback = activeProfiles?.find((p) => p.id === a.va_id);
      return fallback?.full_name || fallback?.username || a.va_id;
    })
    .join(", ");
}
