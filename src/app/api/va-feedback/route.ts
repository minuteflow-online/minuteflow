import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET: All feedback (admin) or own feedback (VA) */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single();

  let query = supabase
    .from("va_feedback")
    .select("*")
    .order("created_at", { ascending: false });

  if (profile?.role !== "admin") {
    query = query.eq("user_id", user.id);
  }

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Enrich with names if admin
  if (profile?.role === "admin" && data && data.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name");
    const profileMap: Record<string, string> = {};
    (profiles || []).forEach((p: { id: string; full_name: string }) => {
      profileMap[p.id] = p.full_name;
    });
    const enriched = data.map((f) => ({
      ...f,
      submitter_name: profileMap[f.user_id] || "Unknown",
    }));
    return Response.json({ feedback: enriched });
  }

  return Response.json({ feedback: data ?? [] });
}

/** POST: Submit feedback (any authenticated user) */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { subject, message, category } = body;

  if (!subject?.trim() || !message?.trim()) {
    return Response.json({ error: "subject and message are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("va_feedback")
    .insert({
      user_id: user.id,
      subject: subject.trim(),
      message: message.trim(),
      category: category || "general",
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ feedback: data }, { status: 201 });
}

/** PATCH: Admin review/update feedback */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const body = await request.json();
  const { status, admin_notes } = body;

  const { data, error } = await supabase
    .from("va_feedback")
    .update({
      status: status || "reviewed",
      admin_notes: admin_notes || null,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ feedback: data });
}
