import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET: Reviews for current user (VA) or all reviews (admin) */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const isAdmin = profile?.role === "admin";

  let query = supabase.from("va_reviews").select("*").order("created_at", { ascending: false });
  if (!isAdmin) {
    query = query.eq("user_id", user.id).eq("is_visible_to_va", true);
  }

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Enrich with VA names if admin
  if (isAdmin && data && data.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name");
    const profileMap: Record<string, string> = {};
    (profiles || []).forEach((p: { id: string; full_name: string }) => {
      profileMap[p.id] = p.full_name;
    });
    return Response.json({
      reviews: data.map((r) => ({ ...r, va_name: profileMap[r.user_id] || "Unknown" })),
    });
  }

  return Response.json({ reviews: data ?? [] });
}

/** POST: Create review (admin only) */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const { user_id, title, period, overall_rating, strengths, improvements, comments, is_visible_to_va } = body;

  if (!user_id || !title?.trim() || !period?.trim()) {
    return Response.json({ error: "user_id, title, and period are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("va_reviews")
    .insert({
      user_id,
      title: title.trim(),
      period: period.trim(),
      overall_rating: overall_rating || null,
      strengths: strengths?.trim() || null,
      improvements: improvements?.trim() || null,
      comments: comments?.trim() || null,
      is_visible_to_va: is_visible_to_va ?? false,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ review: data }, { status: 201 });
}

/** PATCH: Update review (admin only) */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const body = await request.json();
  const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const allowed = ["title", "period", "overall_rating", "strengths", "improvements", "comments", "is_visible_to_va"];
  for (const key of allowed) {
    if (body[key] !== undefined) fields[key] = body[key];
  }

  const { data, error } = await supabase.from("va_reviews").update(fields).eq("id", id).select().single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ review: data });
}

/** DELETE: Delete review (admin only) */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const { error } = await supabase.from("va_reviews").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
