import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** POST: Mark memo as read */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { memo_id } = body;
  if (!memo_id) return Response.json({ error: "memo_id required" }, { status: 400 });

  // Upsert — safe to call multiple times
  const { error } = await supabase
    .from("va_memo_reads")
    .upsert({ memo_id, user_id: user.id }, { onConflict: "memo_id,user_id" });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
