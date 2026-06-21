import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function serviceClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  return { user };
}

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  return { user };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  const auth = id ? await requireUser() : await requireAdmin();
  if ("error" in auth) return auth.error;

  const supabase = serviceClient();

  if (id) {
    const { data, error } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    if (!data) return Response.json({ error: "Project not found" }, { status: 404 });
    return Response.json({ project: data });
  }

  const { data, error } = await supabase.from("projects").select("*").order("created_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ projects: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { user } = auth;
  const body = (await request.json()) as { name?: string; description?: string };
  if (!body.name?.trim()) return Response.json({ error: "name is required" }, { status: 400 });
  const supabase = serviceClient();
  const { data, error } = await supabase.from("projects").insert({
    name: body.name.trim(),
    description: body.description?.trim() || null,
    created_by: user.id,
    is_active: true,
  }).select("*").single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ project: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  const body = (await request.json()) as { name?: string; description?: string; is_active?: boolean };
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.description !== undefined) updates.description = body.description?.trim() || null;
  if (body.is_active !== undefined) updates.is_active = Boolean(body.is_active);
  const supabase = serviceClient();
  const { data, error } = await supabase.from("projects").update(updates).eq("id", id).select("*").single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ project: data });
}

export async function DELETE(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  const supabase = serviceClient();
  await supabase.from("assigned_tasks").update({ project_id: null }).eq("project_id", id);
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ success: true });
}
