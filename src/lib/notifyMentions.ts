import { createClient as createAdminClient } from "@supabase/supabase-js";
import { notifyVaPrivately } from "./vaNotify";
import { esc } from "./telegram";

function serviceClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function escapeRegex(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/**
 * Parse @mentions of active team members out of `text` and notify each one,
 * both in-app (a row in `messages`, which drives the top-nav bell) and via a
 * private Telegram DM (when they have a linked chat). The sender is never
 * notified about their own mention. Failures are swallowed so a post/reply
 * never fails just because a notification could not be delivered.
 */
export async function notifyMentions(opts: {
  text: string;
  senderId: string;
  senderName: string;
  context: string;
}): Promise<void> {
  const { text, senderId, senderName, context } = opts;
  if (!text?.trim()) return;

  const supabase = serviceClient();
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, username, telegram_chat_id")
    .eq("is_active", true);
  const members = (profiles ?? []) as Array<{ id: string; full_name: string | null; username: string | null; telegram_chat_id: number | string | null }>;
  if (members.length === 0) return;

  const byName = new Map<string, (typeof members)[number]>();
  const names: string[] = [];
  for (const p of members) {
    if (p.full_name) { byName.set(p.full_name.toLowerCase(), p); names.push(p.full_name); }
    if (p.username) { byName.set(p.username.toLowerCase(), p); names.push(p.username); }
  }
  if (names.length === 0) return;

  const pattern = names.slice().sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
  const re = new RegExp(`@(${pattern})`, "gi");
  const mentioned = new Map<string, (typeof members)[number]>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const prof = byName.get(m[1].toLowerCase());
    if (prof && prof.id !== senderId) mentioned.set(prof.id, prof);
  }
  if (mentioned.size === 0) return;

  const snippet = text.length > 160 ? `${text.slice(0, 160)}…` : text;

  for (const prof of mentioned.values()) {
    try {
      await supabase.from("messages").insert({
        target_user_id: prof.id,
        sender_id: senderId,
        content: `${senderName} mentioned you in ${context}: ${snippet}`,
        read: false,
      });
    } catch { /* ignore */ }
    try {
      await notifyVaPrivately({
        chatId: prof.telegram_chat_id,
        vaName: prof.full_name || prof.username || "there",
        topic: "mention",
        userId: prof.id,
        message: `💬 <b>${esc(senderName)}</b> mentioned you in <b>${esc(context)}</b>:\n\n${esc(snippet)}`,
      });
    } catch { /* ignore */ }
  }
}
