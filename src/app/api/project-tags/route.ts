import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET: List all project tags (optionally filter by account) */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const account = searchParams.get("account");

  let query = supabase
    .from("project_tags")
    .select("*")
    .order("account")
    .order("sort_order");

  if (account) {
    query = query.eq("account", account);
  }

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ projects: data ?? [] });
}

/** POST: Create project tag(s) - supports bulk via `names` array */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check admin role
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { account, project_name, names } = body;

  if (!account?.trim()) {
    return Response.json({ error: "Account is required" }, { status: 400 });
  }

  // Bulk insert
  if (Array.isArray(names) && names.length > 0) {
    // Get current max sort_order for this account
    const { data: existing } = await supabase
      .from("project_tags")
      .select("sort_order")
      .eq("account", account.trim())
      .order("sort_order", { ascending: false })
      .limit(1);

    let nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

    const rows = names
      .map((n: string) => n.trim())
      .filter(Boolean)
      .map((name: string) => ({
        account: account.trim(),
        project_name: name,
        sort_order: nextOrder++,
        created_by: user.id,
      }));

    const { data, error } = await supabase
      .from("project_tags")
      .insert(rows)
      .select();

    if (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    return Response.json({ projects: data }, { status: 201 });
  }

  // Single insert
  if (!project_name?.trim()) {
    return Response.json({ error: "project_name is required" }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from("project_tags")
    .select("sort_order")
    .eq("account", account.trim())
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("project_tags")
    .insert({
      account: account.trim(),
      project_name: project_name.trim(),
      sort_order: nextOrder,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ project: data }, { status: 201 });
}

/** PATCH: Update a project tag (name, active status, sort_order) */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();

  // Bulk reorder
  if (Array.isArray(body.reorder)) {
    for (const item of body.reorder) {
      await supabase
        .from("project_tags")
        .update({ sort_order: item.sort_order })
        .eq("id", item.id);
    }
    return Response.json({ success: true });
  }

  const { id, project_name, is_active } = body;

  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (project_name !== undefined) updates.project_name = project_name.trim();
  if (is_active !== undefined) updates.is_active = is_active;

  const { error } = await supabase
    .from("project_tags")
    .update(updates)
    .eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ success: true });
}

/** DELETE: Hard delete a project tag */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const { error } = await supabase.from("project_tags").delete().eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ success: true });
}
