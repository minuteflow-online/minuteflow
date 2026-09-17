// Comments — the in-app notification feed (submission comments, @mentions,
// job orders, new DMs). Mirrors DashboardMessagePanel.tsx's Comments tab,
// which reads the `messages` table directly rather than through a Next.js
// API route — same RLS-scoped PostgREST read this app already uses for
// tasks/sessions (see db.ts), so no bearer-token/CORS route work was needed
// for this one. Read-only: no mark-as-read here yet.
import { query } from "./db";

export interface Notification {
  id: number;
  content: string;
  read: boolean;
  created_at: string;
  kind: string | null;
}

/** Mirrors the web widget's exact filter: everything except a plain DM
 *  notification, which belongs in Personal instead. */
export async function fetchNotifications(userId: string): Promise<Notification[]> {
  try {
    return await query<Notification[]>("messages", {
      filters:
        `target_user_id=eq.${userId}&select=id,content,read,created_at,kind` +
        `&or=(kind.is.null,kind.neq.message)&order=created_at.desc&limit=30`,
    });
  } catch {
    return [];
  }
}
