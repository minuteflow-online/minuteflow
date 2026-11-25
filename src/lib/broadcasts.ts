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

/**
 * Whether a broadcast is actually waiting on this member: targeted by its
 * recipient rows and not its author. Whoever wrote it never needs to
 * acknowledge it or be reminded about it (Toni's call, 2026-11-05).
 */
export function isAudience(
  rows: RecipientRow[],
  member: BroadcastMember,
  authorId: string | null | undefined
): boolean {
  return member.id !== authorId && isRecipient(rows, member);
}

/**
 * Title for a follow-up posted on an earlier broadcast. Notifications and the
 * admin list use it, so it always names the broadcast it follows.
 */
export function followUpTitle(parentTitle: string): string {
  return `Follow-up: ${parentTitle}`;
}

// Portal tab that lists each broadcast category. Announcements are listed on the Memos tab.
export const PORTAL_TAB_BY_CATEGORY: Record<string, string> = {
  memo: "memos",
  announcement: "memos",
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

/**
 * Coaching notes are private among admins: only the admin who wrote one, and the
 * admins they share it with, see it in the admin list (Toni's call, 2026-11-20).
 * The person it's addressed to still sees it in their portal.
 */
export function isPrivateCategory(category: string | null | undefined): boolean {
  return category === "coaching_notes";
}

/** Whether an admin may see a broadcast in the admin list. */
export function adminCanSee(
  broadcast: { category: string; created_by?: string | null; shared_with?: string[] | null },
  userId: string
): boolean {
  if (!isPrivateCategory(broadcast.category)) return true;
  return broadcast.created_by === userId || (broadcast.shared_with ?? []).includes(userId);
}

/** Pinned first, then the admin's sort order (lower first), then newest first. */
export function compareBroadcastOrder(
  a: { pinned?: boolean | null; sort_order?: number | null; created_at: string },
  b: { pinned?: boolean | null; sort_order?: number | null; created_at: string }
): number {
  if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
  const so = (a.sort_order ?? 0) - (b.sort_order ?? 0);
  if (so !== 0) return so;
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

/** Whether a broadcast is out (published, or scheduled and its time has come). */
export function isBroadcastLive(
  b: { status: string; scheduled_at?: string | null },
  now: Date = new Date()
): boolean {
  if (b.status === "published") return true;
  return b.status === "scheduled" && !!b.scheduled_at && new Date(b.scheduled_at) <= now;
}

/**
 * Whether someone may read a broadcast (and so its comments). Its audience sees
 * it once it's out; admins see what the admin list shows them, private notes
 * included only for their author and whoever they're shared with.
 */
export function canReadBroadcast(
  b: { status: string; scheduled_at?: string | null; category: string; created_by?: string | null; shared_with?: string[] | null },
  rows: RecipientRow[],
  member: BroadcastMember,
  isAdmin: boolean,
  now: Date = new Date()
): boolean {
  if (isAdmin && adminCanSee(b, member.id)) return true;
  return isBroadcastLive(b, now) && isRecipient(rows, member);
}
