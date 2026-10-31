// "Your Team" admin monitoring — ported from src/components/TeamSidebar.tsx
// and the dashboard's own team-members/time-logs fetch (src/app/(app)/dashboard/page.tsx).
// Admin-only: gated in App.tsx on profile.role !== "va", same condition web
// uses to show/hide this widget. Both reads below are table-wide (every
// profile/session/time_log, not just the signed-in user's own), which is
// safe for this app's direct-PostgREST-with-the-VA's-own-JWT pattern only
// because the RLS policies on all three tables already carve out the same
// admin-equivalent role list this app gates the tab on (confirmed live via
// pg_policies before building this — sessions_read/logs_read both allow
// admin/manager/coordinator/specialist/ceo/founder to read every row, and
// profiles_read_authenticated allows any signed-in user to read every
// profile). A VA could still query these tables directly and get the same
// data RLS already allows them — this app just doesn't show them the tab.
import { query } from "./db";

export interface TeamProfile {
  id: string;
  full_name: string;
  is_active: boolean | null;
}

export interface TeamSessionActiveTask {
  task_name?: string;
  account?: string;
  project?: string;
  category?: string;
  isBreak?: boolean;
  isPause?: boolean;
}

export interface TeamSession {
  user_id: string;
  clocked_in: boolean;
  active_task: TeamSessionActiveTask | null;
}

export interface TeamTimeLog {
  id: number;
  user_id: string;
  task_name: string;
  category: string;
  start_time: string;
  end_time: string | null;
  duration_ms: number;
}

// Named TeamRosterMember/fetchTeamRoster, not TeamMember/fetchTeamMembers —
// conversations.ts already exports a same-named pair for a different
// purpose (picking a DM recipient, just id + name), and the two would be
// easy to mix up on a glance given how similar they sound.
export interface TeamRosterMember {
  profile: TeamProfile;
  session: TeamSession | null;
}

// Same window the dashboard's activityLogFloorIso() uses — a member's
// expanded task list shows their last 14 days, not just today.
const ACTIVITY_LOOKBACK_DAYS = 14;

/** Every active profile, each paired with its current session (or null if
 *  never clocked in). Mirrors the dashboard's own team-members fetch:
 *  table-wide reads of profiles + sessions, joined client-side by user id. */
export async function fetchTeamRoster(): Promise<TeamRosterMember[]> {
  const [profiles, sessions] = await Promise.all([
    query<TeamProfile[]>("profiles", {
      filters: "select=id,full_name,is_active",
    }),
    query<TeamSession[]>("sessions", {
      filters: "select=user_id,clocked_in,active_task",
    }),
  ]);

  const sessionsByUser = new Map<string, TeamSession>();
  for (const s of sessions) sessionsByUser.set(s.user_id, s);

  return profiles
    .filter((p) => p.is_active !== false)
    .map((p) => ({ profile: p, session: sessionsByUser.get(p.id) ?? null }));
}

/** Org-wide time_logs from the last 14 days, newest first — backs each
 *  member's expandable "Show tasks" list. */
export async function fetchTeamTimeLogs(): Promise<TeamTimeLog[]> {
  const since = new Date(Date.now() - ACTIVITY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return query<TeamTimeLog[]>("time_logs", {
    filters: `start_time=gte.${since}&select=id,user_id,task_name,category,start_time,end_time,duration_ms&order=start_time.desc`,
  });
}

export type MemberStatus = "working" | "personal" | "resting" | "paused" | "away";

export function getMemberStatus(session: TeamSession | null): MemberStatus {
  if (!session || !session.clocked_in) return "away";
  const task = session.active_task;
  if (task?.isPause || task?.category === "Pause") return "paused";
  if (task?.isBreak || task?.category === "Break") return "resting";
  if (task?.category === "Personal") return "personal";
  return "working";
}

export function getStatusLabel(status: MemberStatus): string {
  switch (status) {
    case "working":
      return "Working";
    case "personal":
      return "Personal";
    case "resting":
      return "On Break";
    case "paused":
      return "Paused";
    default:
      return "Offline";
  }
}

export function getStatusBadgeClass(status: MemberStatus): string {
  switch (status) {
    case "working":
      return "bg-sage-soft text-sage";
    case "personal":
      return "bg-clay-rose-soft text-clay-rose";
    case "resting":
      return "bg-amber-soft text-amber";
    case "paused":
      return "bg-slate-blue-soft text-slate-blue";
    default:
      return "bg-parchment text-stone";
  }
}

const AVATAR_COLORS = [
  "var(--color-terracotta)",
  "var(--color-sage)",
  "var(--color-clay-rose)",
  "var(--color-slate-blue)",
  "var(--color-walnut)",
  "var(--color-stone)",
  "var(--color-amber)",
];

export function getAvatarColor(index: number): string {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalMinutes = Math.floor(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  return `${m}m`;
}
