// The team's General message board — read/post topics and replies. Mirrors
// the "General" tab of DashboardMessagePanel.tsx (src/components/
// DashboardMessagePanel.tsx), scoped down to general topics only
// (project_id null — the team-wide board, not a per-project one).
//
// Goes through /api/project-messages and its /comments sub-route rather
// than direct table access: those routes also run notifyMentions() (bell +
// Telegram notifications for anyone @mentioned), which a raw table insert
// would silently skip. Both routes needed the same bearer-token fallback
// PATCH /api/assigned-tasks/[id] already has — see that route's comment and
// this app's README.
//
// Personal DMs live in conversations.ts, the Comments feed in
// notifications.ts. Deliberately out of scope here: Admin oversight,
// per-project boards, attachments, @mention autocomplete, editing,
// delete/pin/archive. See the desktop README.
import { ensureAuth } from "./db";
import { API_BASE } from "./config";

export interface MessageAuthor {
  id: string;
  full_name: string | null;
  username: string | null;
}

export interface TopicComment {
  id: number;
  body: string;
  author_id: string | null;
  created_at: string;
  author: MessageAuthor | null;
}

export interface Topic {
  id: number;
  title: string;
  body: string;
  author_id: string | null;
  created_at: string;
  author: MessageAuthor | null;
  project_message_comments: TopicComment[];
}

async function authHeaders(): Promise<Record<string, string> | null> {
  const session = await ensureAuth();
  if (!session) return null;
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.access_token}`,
  };
}

/** General (team-wide) topics, newest first, each with its replies. */
export async function fetchGeneralTopics(): Promise<Topic[]> {
  const headers = await authHeaders();
  if (!headers) return [];
  try {
    const res = await fetch(`${API_BASE}/api/project-messages?general=1`, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.messages ?? []) as Topic[];
  } catch {
    return [];
  }
}

/** Starts a new general topic (no project_id — that's what makes it general). */
export async function postTopic(title: string, body: string): Promise<Topic | null> {
  const headers = await authHeaders();
  if (!headers) return null;
  try {
    const res = await fetch(`${API_BASE}/api/project-messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title, body }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.message ?? null) as Topic | null;
  } catch {
    return null;
  }
}

/** Replies to an existing topic. */
export async function postReply(topicId: number, body: string): Promise<TopicComment | null> {
  const headers = await authHeaders();
  if (!headers) return null;
  try {
    const res = await fetch(`${API_BASE}/api/project-messages/${topicId}/comments`, {
      method: "POST",
      headers,
      body: JSON.stringify({ body }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.comment ?? null) as TopicComment | null;
  } catch {
    return null;
  }
}
