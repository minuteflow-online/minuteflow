import { createClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const isAdmin = profile?.role === "admin";

  let query = supabase
    .from("bug_reports")
    .select("*")
    .order("created_at", { ascending: false });

  if (!isAdmin) {
    query = query.eq("user_id", user.id);
  }

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ reports: data || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, full_name")
    .eq("id", user.id)
    .single();

  const body = await request.json();
  const { title, description, report_date, drive_file_ids } = body;

  if (!title?.trim() || !description?.trim()) {
    return Response.json({ error: "title and description are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("bug_reports")
    .insert({
      user_id: user.id,
      username: profile?.username || "",
      full_name: profile?.full_name || "",
      title: title.trim(),
      description: description.trim(),
      report_date: report_date || new Date().toISOString().split("T")[0],
      status: "submitted",
      drive_file_ids: drive_file_ids || [],
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ report: data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const body = await request.json();
  const { status, admin_notes } = body;

  const updates: Record<string, unknown> = {};
  if (status) updates.status = status;
  if (admin_notes !== undefined) updates.admin_notes = admin_notes;
  if (status === "fixed") updates.reviewed_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("bug_reports")
    .update(updates)
    .eq("id", Number(id))
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ report: data });
}
