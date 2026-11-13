import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { notifyOne } from "@/lib/notifyOne";
import { esc } from "@/lib/telegram";
import { magicWordsMatch } from "@/lib/magicWords";

export const dynamic = "force-dynamic";

/** POST: Record that the current user has read (and optionally confirmed) a broadcast */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { broadcast_id, word_entered } = body;

  if (!broadcast_id) {
    return Response.json({ error: "broadcast_id is required" }, { status: 400 });
  }

  // Verify broadcast exists and is published
  const { data: broadcast, error: fetchError } = await supabase
    .from("broadcasts")
    .select("id, title, created_by, magic_word, require_word, status")
    .eq("id", broadcast_id)
    .single();

  if (fetchError || !broadcast) {
    return Response.json({ error: "Broadcast not found" }, { status: 404 });
  }

  if (broadcast.status !== "published") {
    return Response.json({ error: "Broadcast is not published" }, { status: 400 });
  }

  // If magic words are required, validate server-side: every word must be entered.
  if (broadcast.require_word && broadcast.magic_word && !magicWordsMatch(broadcast.magic_word, word_entered)) {
    return Response.json({ error: "Incorrect magic word" }, { status: 422 });
  }

  const confirmed = magicWordsMatch(broadcast.magic_word, word_entered);

  // Only the first acknowledgement notifies the author, not a repeat click
  const { data: priorRead } = await supabase
    .from("broadcast_reads")
    .select("confirmed")
    .eq("broadcast_id", broadcast_id)
    .eq("user_id", user.id)
    .maybeSingle();

  // Upsert read record
  const { error } = await supabase
    .from("broadcast_reads")
    .upsert(
      {
        broadcast_id,
        user_id: user.id,
        word_entered: word_entered?.trim() || null,
        confirmed,
        read_at: new Date().toISOString(),
      },
      { onConflict: "broadcast_id,user_id" }
    );

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Tell whoever published the broadcast — bell notification plus Telegram DM.
  const authorId = broadcast.created_by as string | null;
  if (confirmed && !priorRead?.confirmed && authorId && authorId !== user.id) {
    after(async () => {
      const admin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      );
      const { data: me } = await admin
        .from("profiles")
        .select("full_name, username")
        .eq("id", user.id)
        .single();
      const name = me?.full_name || me?.username || "Someone";
      const title = broadcast.title || "a broadcast";
      await notifyOne(admin, {
        targetUserId: authorId,
        senderId: user.id,
        content: `${name} acknowledged “${title}”`,
        telegram: `✅ <b>${esc(name)}</b> acknowledged <b>${esc(title)}</b>`,
        topic: "broadcast",
      });
    });
  }

  return Response.json({ success: true, confirmed });
}
