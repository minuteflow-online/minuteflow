// Shared broadcast rules: who a broadcast is for, and where it lives in the portal.

import { normalizePosition } from "@/types/database";

export type RecipientRow = { type: string; value: string };

export type BroadcastMember = {
  id: string;
  role: string;
  employment_type: string | null;
  position?: string | null;
  pay_rate_type?: string | null;
  is_active: boolean;
};

/** Profile columns isRecipient needs — select these wherever recipients are resolved. */
export const RECIPIENT_PROFILE_COLUMNS = "id, role, employment_type, position, pay_rate_type, is_active";

/**
 * The employment types (full_time, part_time, hourly, per_task) a member counts as.
 *
 * profiles.employment_type is only ever set from an invitation, so most of the
 * team has none. What the Team page actually maintains is position (Full Time,
 * Part Time, Output Based, …) and pay_rate_type (hourly, per_task, …), so those
 * decide it, with the invitation's value still honoured where it exists.
 */
export function memberEmploymentTypes(member: BroadcastMember): Set<string> {
  const types = new Set<string>();
  if (member.employment_type) types.add(member.employment_type);
  const position = normalizePosition(member.position);
  if (position === "Full Time") types.add("full_time");
  if (position === "Part Time") types.add("part_time");
  if (position === "Output Based") types.add("per_task");
  if (member.pay_rate_type === "hourly") types.add("hourly");
  if (member.pay_rate_type === "per_task") types.add("per_task");
  return types;
}

/**
 * Whether a member is targeted by a broadcast's recipient rows.
 * "Everyone" means the active team only; individual picks are honoured as chosen.
 */
export function isRecipient(rows: RecipientRow[], member: BroadcastMember): boolean {
  return rows.some((r) => {
    if (r.type === "all") return member.is_active;
    if (r.type === "individual") return r.value === member.id;
    if (r.type === "role") return r.value === member.role;
    if (r.type === "employment_type") return memberEmploymentTypes(member).has(r.value);
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
