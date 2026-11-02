import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { hasBroadAdminAccess } from "@/lib/financialAccess";
import { isRecipient, broadcastPortalPath } from "@/lib/broadcasts";
import { notifyOne } from "@/lib/notifyOne";
import { esc } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/**
 * POST: Remind everyone a published broadcast is for who hasn't acknowledged it
 * yet — bell notification plus a private Telegram DM, each linking to the broadcast.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department")
    .eq("id", user.id)
    .single();
  if (!hasBroadAdminAccess(profile)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { broadcast_id } = await request.json();
  if (!broadcast_id) return Response.json({ error: "broadcast_id is required" }, { status: 400 });

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: broadcast } = await admin
    .from("broadcasts")
    .select("id, title, category, status, require_word")
    .eq("id", broadcast_id)
    .single();
  if (!broadcast) return Response.json({ error: "Broadcast not found" }, { status: 404 });
  if (broadcast.status !== "published") {
    return Response.json({ error: "Only published broadcasts can be reminded" }, { status: 400 });
  }

  const [{ data: recipientRows }, { data: reads }, { data: members }] = await Promise.all([
    admin.from("broadcast_recipients").select("recipient_type, recipient_value").eq("broadcast_id", broadcast_id),
    admin.from("broadcast_reads").select("user_id").eq("broadcast_id", broadcast_id).eq("confirmed", true),
    admin.from("profiles").select("id, role, employment_type, is_active").eq("is_active", true),
  ]);

  const rows = (recipientRows || []).map((r) => ({ type: r.recipient_type, value: r.recipient_value }));
  const done = new Set((reads || []).map((r) => r.user_id));
  const pending = (members || []).filter((m) => isRecipient(rows, m) && !done.has(m.id));

  const link = `https://minuteflow.click${broadcastPortalPath(broadcast.category, broadcast.id) ?? "/portal"}`;
  const ask = broadcast.require_word
    ? "Please read it and enter the magic word to acknowledge it."
    : "Please read it and acknowledge it.";

  for (const m of pending) {
    await notifyOne(admin, {
      targetUserId: m.id,
      senderId: user.id,
      content: `Reminder: please acknowledge “${broadcast.title}”`,
      telegram: `⏰ <b>Reminder: ${esc(broadcast.title)}</b>\n\n${ask}\n${link}`,
      topic: "broadcast",
    });
  }

  return Response.json({ reminded: pending.length });
}
