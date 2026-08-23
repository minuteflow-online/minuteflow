import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { hasBroadAdminAccess } from "@/lib/financialAccess";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Which Telegram chat the bot should use to reach each person.
 *
 * Telegram never tells us who a chat belongs to in MinuteFlow terms — only a
 * display name someone chose themselves. So the match is made by hand here
 * rather than guessed, and stored on the profile.
 *
 * Admin-only: pointing someone's chat id at the wrong profile would send that
 * person's private notices to somebody else.
 */

/** GET — every profile with its current link, for the setup screen. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department")
    .eq("id", user.id)
    .single();
  if (!hasBroadAdminAccess(profile)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, username, telegram_chat_id")
    .eq("is_active", true)
    .order("full_name");

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ profiles: data ?? [] });
}

/** POST { user_id, chat_id } — link a chat to a profile, or clear it with null. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department")
    .eq("id", user.id)
    .single();
  if (!hasBroadAdminAccess(profile)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const userId = String(body.user_id ?? "").trim();
  const rawChatId = body.chat_id;
  if (!userId) return Response.json({ error: "user_id is required" }, { status: 400 });

  const chatId =
    rawChatId === null || rawChatId === "" ? null : Number(rawChatId);
  if (chatId !== null && !Number.isFinite(chatId)) {
    return Response.json({ error: "chat_id must be a number" }, { status: 400 });
  }

  // Service key: profiles is guarded by RLS that lets a person write only their
  // own row, and this is an admin writing someone else's.
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // One chat cannot belong to two people. Clearing it elsewhere first means a
  // re-link moves the chat rather than silently sending to both.
  if (chatId !== null) {
    await admin
      .from("profiles")
      .update({ telegram_chat_id: null })
      .eq("telegram_chat_id", chatId)
      .neq("id", userId);
  }

  const { error } = await admin
    .from("profiles")
    .update({ telegram_chat_id: chatId })
    .eq("id", userId);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, user_id: userId, chat_id: chatId });
}
