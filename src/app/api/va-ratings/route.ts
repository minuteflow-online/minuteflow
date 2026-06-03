import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET: Ratings for current VA or all ratings (admin) */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const isAdmin = profile?.role === "admin";

  const { searchParams } = new URL(request.url);
  const targetUserId = searchParams.get("user_id");

  let query = supabase
    .from("va_daily_ratings")
    .select("*")
    .order("rating_date", { ascending: false });

  if (isAdmin && targetUserId) {
    query = query.eq("va_id", targetUserId);
  } else if (!isAdmin) {
    query = query.eq("va_id", user.id);
  }

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  if (isAdmin && !targetUserId && data && data.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name");
    const profileMap: Record<string, string> = {};
    (profiles || []).forEach((p: { id: string; full_name: string }) => {
      profileMap[p.id] = p.full_name;
    });
    return Response.json({
      ratings: data.map((r) => ({ ...r, va_name: profileMap[r.va_id] || "Unknown" })),
    });
  }

  return Response.json({ ratings: data ?? [] });
}

/** POST: Add daily rating (admin only) */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const { va_id, rating_date, score, notes } = body;

  if (!va_id || !score) {
    return Response.json({ error: "va_id and score are required" }, { status: 400 });
  }

  if (score < 1 || score > 5) {
    return Response.json({ error: "score must be between 1 and 5" }, { status: 400 });
  }

  const date = rating_date || new Date().toISOString().split("T")[0];

  // Upsert by va_id + rating_date
  const { data, error } = await supabase
    .from("va_daily_ratings")
    .upsert(
      {
        va_id,
        rated_by: user.id,
        rating_date: date,
        score,
        notes: notes?.trim() || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "va_id,rating_date" }
    )
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ rating: data }, { status: 201 });
}

/** DELETE: Delete rating (admin only) */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const { error } = await supabase.from("va_daily_ratings").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
