import { createClient } from "@/lib/supabase/server";

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
    .select("id, magic_word, require_word, status")
    .eq("id", broadcast_id)
    .single();

  if (fetchError || !broadcast) {
    return Response.json({ error: "Broadcast not found" }, { status: 404 });
  }

  if (broadcast.status !== "published") {
    return Response.json({ error: "Broadcast is not published" }, { status: 400 });
  }

  // If magic word is required, validate it server-side
  if (broadcast.require_word && broadcast.magic_word) {
    const entered = (word_entered || "").trim().toLowerCase();
    const expected = broadcast.magic_word.toLowerCase();
    if (entered !== expected) {
      return Response.json({ error: "Incorrect magic word" }, { status: 422 });
    }
  }

  const confirmed =
    !broadcast.magic_word ||
    (word_entered || "").trim().toLowerCase() === (broadcast.magic_word || "").toLowerCase();

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

  return Response.json({ success: true, confirmed });
}
