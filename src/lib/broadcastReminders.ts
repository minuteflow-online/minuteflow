import type { SupabaseClient } from "@supabase/supabase-js";
import { isAudience, broadcastPortalPath, RECIPIENT_PROFILE_COLUMNS } from "@/lib/broadcasts";
import { notifyOne } from "@/lib/notifyOne";
import { esc } from "@/lib/telegram";
import { sendResendEmail } from "@/lib/sendEmail";

/** One reminder email to one person, so recipients never see each other's addresses. */
async function emailReminder(to: string, title: string, ask: string, link: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  const safeTitle = esc(title);
  await sendResendEmail({
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Toni Colina <noreply@minuteflow.click>",
      to: [to],
      subject: `Reminder: ${title}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; background: #faf9f7; padding: 32px 24px;">
          <div style="background: white; border-radius: 12px; border: 1px solid #e8e0d5; padding: 32px;">
            <h1 style="font-size: 20px; font-weight: 700; color: #2d1f14; margin: 0 0 12px;">Reminder: ${safeTitle}</h1>
            <p style="font-size: 14px; color: #4a3728; line-height: 1.7; margin: 0 0 20px;">You haven't acknowledged this yet. ${esc(ask)}</p>
            <a href="${link}" style="display: inline-block; background: #c2694f; color: white; font-size: 13px; font-weight: 600; text-decoration: none; padding: 10px 18px; border-radius: 8px;">Open it in MinuteFlow</a>
            <p style="font-size: 11px; color: #9e9080; margin: 28px 0 0;">MinuteFlow · noreply@minuteflow.click</p>
          </div>
        </div>`,
    }),
  });
}

/**
 * Remind everyone a published broadcast is for who hasn't acknowledged it yet,
 * on every channel: bell notification, private Telegram DM and email, each
 * linking to the broadcast.
 * Used by the admin's Send reminder button and the automatic reminder cron.
 * Returns how many people were reminded.
 */
export async function remindPendingBroadcast(
  admin: SupabaseClient,
  broadcast: {
    id: string;
    title: string;
    category: string;
    require_word?: boolean | null;
    created_by?: string | null;
  },
  senderId: string
): Promise<number> {
  const [{ data: recipientRows }, { data: reads }, { data: members }] = await Promise.all([
    admin.from("broadcast_recipients").select("recipient_type, recipient_value").eq("broadcast_id", broadcast.id),
    admin.from("broadcast_reads").select("user_id").eq("broadcast_id", broadcast.id).eq("confirmed", true),
    admin.from("profiles").select(RECIPIENT_PROFILE_COLUMNS).eq("is_active", true),
  ]);

  const rows = (recipientRows || []).map((r) => ({ type: r.recipient_type, value: r.recipient_value }));
  const done = new Set((reads || []).map((r) => r.user_id));
  const pending = (members || []).filter((m) => isAudience(rows, m, broadcast.created_by) && !done.has(m.id));

  const link = `https://minuteflow.click${broadcastPortalPath(broadcast.category, broadcast.id) ?? "/portal"}`;
  const ask = broadcast.require_word
    ? "Please read it and enter the magic word to acknowledge it."
    : "Please read it and acknowledge it.";

  for (const m of pending) {
    await notifyOne(admin, {
      targetUserId: m.id,
      senderId,
      content: `Reminder: please acknowledge “${broadcast.title}”`,
      telegram: `⏰ <b>Reminder: ${esc(broadcast.title)}</b>\n\n${ask}\n${link}`,
      topic: "broadcast",
      // Broadcasts reach people on a break too — Toni's call.
      evenOnBreak: true,
    });
    try {
      const { data } = await admin.auth.admin.getUserById(m.id);
      if (data?.user?.email) await emailReminder(data.user.email, broadcast.title, ask, link);
    } catch { /* one failed email must not stop the rest */ }
  }

  return pending.length;
}

/** First automatic reminder this long after publishing, then one every REPEAT_HOURS. */
export const FIRST_REMINDER_HOURS = 12;
export const REPEAT_HOURS = 24;

/**
 * Whether an automatic reminder is due in the hour starting `hoursSincePublish`
 * hours after publishing: at 12h, 36h, 60h, … The cron runs hourly, so each
 * reminder falls in exactly one run.
 */
export function reminderDue(hoursSincePublish: number): boolean {
  if (hoursSincePublish < FIRST_REMINDER_HOURS) return false;
  return (hoursSincePublish - FIRST_REMINDER_HOURS) % REPEAT_HOURS < 1;
}
