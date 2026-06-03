import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET: Tokens for current user (VA) or all tokens (admin) */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const isAdmin = profile?.role === "admin";

  const { searchParams } = new URL(request.url);
  const targetUserId = searchParams.get("user_id");

  let query = supabase.from("va_tokens").select("*").order("awarded_at", { ascending: false });

  if (isAdmin && targetUserId) {
    query = query.eq("user_id", targetUserId);
  } else if (!isAdmin) {
    query = query.eq("user_id", user.id);
  }

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Enrich with VA names if admin (no filter)
  if (isAdmin && !targetUserId && data && data.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name");
    const profileMap: Record<string, string> = {};
    (profiles || []).forEach((p: { id: string; full_name: string }) => {
      profileMap[p.id] = p.full_name;
    });
    return Response.json({
      tokens: data.map((t) => ({ ...t, va_name: profileMap[t.user_id] || "Unknown" })),
    });
  }

  return Response.json({ tokens: data ?? [] });
}

/** POST: Award token (admin only) */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const { user_id, amount, reason } = body;

  if (!user_id || !reason?.trim()) {
    return Response.json({ error: "user_id and reason are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("va_tokens")
    .insert({
      user_id,
      amount: amount || 1,
      reason: reason.trim(),
      awarded_by: user.id,
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ token: data }, { status: 201 });
}

/** DELETE: Remove token award (admin only) */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const { error } = await supabase.from("va_tokens").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
