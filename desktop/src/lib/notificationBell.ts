// The full notification center — mirrors src/components/NotificationBell.tsx
// (the web app's top-nav bell), not the simplified read-only feed in
// notifications.ts (which is Comments tab's — DashboardMessagePanel's own
// narrower "excludes DMs" list). This one matches the bell exactly: every
// notification including DMs, grouped runs of the same sender+kind
// collapsed into one line, mark-read.
//
// Direct RLS-scoped table read/write (same pattern as tasks/sessions) —
// no API route involved, so no bearer-token/CORS work was needed here.
import { query } from "./db";

export interface BellNotification {
  id: number;
  content: string;
  read: boolean;
  created_at: string;
  assigned_task_id: number | null;
  sender_id: string | null;
}

export async function fetchNotifications(userId: string): Promise<BellNotification[]> {
  try {
    return await query<BellNotification[]>("messages", {
      filters:
        `target_user_id=eq.${userId}&select=id,content,read,created_at,assigned_task_id,sender_id` +
        `&order=created_at.desc&limit=20`,
    });
  } catch {
    return [];
  }
}

export async function markNotificationRead(id: number): Promise<void> {
  try {
    await query("messages", { method: "PATCH", filters: `id=eq.${id}`, body: { read: true } });
  } catch {
    // Non-critical — the badge just stays a beat longer if this fails.
  }
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  try {
    await query("messages", {
      method: "PATCH",
      filters: `target_user_id=eq.${userId}&read=eq.false`,
      body: { read: true },
    });
  } catch {
    // Non-critical.
  }
}

// ── Grouping — ported verbatim from NotificationBell.tsx ──────────────────
// Same regexes, same bucket logic, so a run of ten submissions from one VA
// collapses into one summary line here exactly as it does on web.
const ACTION_PATTERNS: Array<{ bucket: string; re: RegExp; noun: (n: number) => string }> = [
  { bucket: "bug", re: /^(.+?) submitted a bug/, noun: (n) => `${n} bug report${n === 1 ? "" : "s"}` },
  { bucket: "idea", re: /^(.+?) submitted a idea/, noun: (n) => `${n} idea${n === 1 ? "" : "s"}` },
  { bucket: "submission", re: /^(.+?) submitted: /, noun: (n) => `${n} task${n === 1 ? "" : "s"}` },
  { bucket: "comment", re: /^(.+?) commented on /, noun: (n) => `${n} comment${n === 1 ? "" : "s"}` },
  { bucket: "mention", re: /^(.+?) mentioned you in /, noun: (n) => `${n} place${n === 1 ? "" : "s"}` },
  { bucket: "dm", re: /^(.+?) sent you a message/, noun: (n) => `${n} message${n === 1 ? "" : "s"}` },
  {
    bucket: "joborder",
    re: /^(.+?) (?:reopened|declined|accepted|offered you) (?:a |the )?job order/,
    noun: (n) => `${n} job order update${n === 1 ? "" : "s"}`,
  },
];

export function classify(content: string): { bucket: string; actor: string; noun: (n: number) => string } | null {
  for (const p of ACTION_PATTERNS) {
    const m = content.match(p.re);
    if (m) return { bucket: p.bucket, actor: m[1], noun: p.noun };
  }
  return null;
}

export interface NotificationGroup {
  key: string;
  items: BellNotification[];
  summary: string | null;
}

export function groupNotifications(items: BellNotification[]): NotificationGroup[] {
  const groups: NotificationGroup[] = [];
  for (const item of items) {
    const info = item.sender_id ? classify(item.content) : null;
    const last = groups[groups.length - 1];
    const lastInfo = last && last.items[0].sender_id ? classify(last.items[0].content) : null;
    if (info && last && last.items[0].sender_id === item.sender_id && lastInfo?.bucket === info.bucket) {
      last.items.push(item);
      last.summary = `${info.actor} — ${info.noun(last.items.length)}`;
      continue;
    }
    groups.push({ key: String(item.id), items: [item], summary: null });
  }
  return groups;
}

/** Only a DM notification is navigable here — a task/submission link needs a
 *  page this app doesn't have yet (see the desktop README). */
export function dmSenderFor(item: BellNotification): string | null {
  if (item.sender_id && classify(item.content)?.bucket === "dm") return item.sender_id;
  return null;
}
