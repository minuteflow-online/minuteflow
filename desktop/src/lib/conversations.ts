// Personal — direct messages and group chats. Mirrors the "Personal" tab of
// DashboardMessagePanel.tsx: conversation list (unread counts, last message
// preview), open one, send a message, start a new 1:1 by picking a
// teammate. Goes through /api/conversations (+ its /messages sub-route) and
// /api/team-members rather than direct table access, so notifyOne() (bell +
// Telegram for the other members) still fires on send — same reasoning as
// messageBoard.ts. All three needed the bearer-token fallback these desktop
// routes share; see that file's comment and PR #167.
import { ensureAuth } from "./db";
import { API_BASE } from "./config";

export interface ConversationMember {
  id: string;
  name: string;
}

export interface Conversation {
  id: string;
  is_group: boolean;
  title: string;
  members: ConversationMember[];
  last_message: { body: string; created_at: string; mine: boolean } | null;
  unread: number;
  updated_at: string;
}

export interface DirectMessage {
  id: number;
  body: string;
  created_at: string;
  edited_at: string | null;
  mine: boolean;
  sender_id: string;
  sender_name: string;
}

export interface TeamMember {
  id: string;
  full_name: string | null;
  username: string | null;
}

async function authHeaders(): Promise<Record<string, string> | null> {
  const session = await ensureAuth();
  if (!session) return null;
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.access_token}`,
  };
}

export async function fetchConversations(): Promise<Conversation[]> {
  const headers = await authHeaders();
  if (!headers) return [];
  try {
    const res = await fetch(`${API_BASE}/api/conversations`, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.conversations ?? []) as Conversation[];
  } catch {
    return [];
  }
}

export async function fetchTeamMembers(): Promise<TeamMember[]> {
  const headers = await authHeaders();
  if (!headers) return [];
  try {
    const res = await fetch(`${API_BASE}/api/team-members`, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.members ?? []) as TeamMember[];
  } catch {
    return [];
  }
}

export async function fetchMessages(conversationId: string): Promise<DirectMessage[]> {
  const headers = await authHeaders();
  if (!headers) return [];
  try {
    const res = await fetch(`${API_BASE}/api/conversations/${conversationId}/messages`, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.messages ?? []) as DirectMessage[];
  } catch {
    return [];
  }
}

export async function sendMessage(conversationId: string, body: string): Promise<DirectMessage | null> {
  const headers = await authHeaders();
  if (!headers) return null;
  try {
    const res = await fetch(`${API_BASE}/api/conversations/${conversationId}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ body }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.message ?? null) as DirectMessage | null;
  } catch {
    return null;
  }
}

/** Starts (or, for a 1:1, reuses) a conversation with one or more teammates,
 *  returns its id. `title` only applies to a real group (more than one
 *  other member). */
export async function startConversation(memberIds: string[], title?: string): Promise<string | null> {
  const headers = await authHeaders();
  if (!headers) return null;
  try {
    const res = await fetch(`${API_BASE}/api/conversations`, {
      method: "POST",
      headers,
      body: JSON.stringify({ member_ids: memberIds, title: title || null, is_group: memberIds.length > 1 }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.conversation_id ?? null) as string | null;
  } catch {
    return null;
  }
}
