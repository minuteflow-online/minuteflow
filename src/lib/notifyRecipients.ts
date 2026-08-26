import { createClient as createAdminClient } from "@supabase/supabase-js";
import { notifyVaPrivately } from "./vaNotify";

function serviceClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * Notify every active member matching any of the given roles or departments,
 * both in-app (a `messages` row → the top-nav bell) and via a private Telegram
 * DM. Used for role-based routing of bug/idea/submission events — recipients
 * are resolved by role/department, not hardcoded names (e.g. IT dept = Neil,
 * role "founder" = Toni). The actor is never notified about their own action.
 */
export async function notifyRecipients(opts: {
  roles?: string[];
  departments?: string[];
  actorId: string;
  content: string;
  /** Only sent as a Telegram DM when `telegram` is true — otherwise bell-only.
   *  Bugs/ideas/submissions stay bell-only here because a shared group-chat
   *  Telegram alert already covers them; enabling both would double-ping. */
  telegramMessage?: string;
  topic?: string;
  telegram?: boolean;
}): Promise<void> {
  const { roles = [], departments = [], actorId, content, telegramMessage, topic = "mention", telegram = false } = opts;
  if (roles.length === 0 && departments.length === 0) return;

  const supabase = serviceClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, username, role, department, telegram_chat_id")
    .eq("is_active", true);
  const rows = (data ?? []) as Array<{ id: string; full_name: string | null; username: string | null; role: string | null; department: string | null; telegram_chat_id: number | string | null }>;

  const recipients = rows.filter(
    (p) => (p.role && roles.includes(p.role)) || (p.department && departments.includes(p.department))
  );

  const seen = new Set<string>();
  for (const p of recipients) {
    if (p.id === actorId || seen.has(p.id)) continue;
    seen.add(p.id);
    try {
      await supabase.from("messages").insert({ target_user_id: p.id, sender_id: actorId, content, read: false });
    } catch { /* ignore */ }
    if (telegram && telegramMessage) {
      try {
        await notifyVaPrivately({
          chatId: p.telegram_chat_id,
          vaName: p.full_name || p.username || "there",
          topic,
          userId: p.id,
          message: telegramMessage,
        });
      } catch { /* ignore */ }
    }
  }
}
