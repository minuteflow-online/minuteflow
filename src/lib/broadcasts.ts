// Shared broadcast rules: who a broadcast is for, and where it lives in the portal.

export type RecipientRow = { type: string; value: string };

/**
 * Whether a member is targeted by a broadcast's recipient rows.
 * "Everyone" means the active team only; individual picks are honoured as chosen.
 */
export function isRecipient(
  rows: RecipientRow[],
  member: { id: string; role: string; employment_type: string | null; is_active: boolean }
): boolean {
  return rows.some((r) => {
    if (r.type === "all") return member.is_active;
    if (r.type === "individual") return r.value === member.id;
    if (r.type === "role") return r.value === member.role;
    if (r.type === "employment_type") return r.value === member.employment_type;
    return false;
  });
}

// Portal tab that lists each broadcast category. Announcements have no portal tab, so no link.
export const PORTAL_TAB_BY_CATEGORY: Record<string, string> = {
  memo: "memos",
  training: "trainings",
  coaching_notes: "coaching_notes",
  onboarding: "onboarding",
  job_posting: "jobs",
};

/** Portal path that opens on this broadcast, scrolled to and highlighted. Null for categories with no tab. */
export function broadcastPortalPath(category: string, id: string): string | null {
  const tab = PORTAL_TAB_BY_CATEGORY[category];
  if (!tab) return null;
  return `/portal?tab=${tab}&broadcast=${encodeURIComponent(id)}`;
}
