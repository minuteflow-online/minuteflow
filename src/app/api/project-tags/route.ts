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

  // Bulk insert
  if (Array.isArray(names) && names.length > 0) {
    // Get current max sort_order
    const { data: existing } = await supabase
      .from("project_tags")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1);

    let nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

    const rows = names
      .map((n: string) => n.trim())
      .filter(Boolean)
      .map((name: string) => ({
        ...(account?.trim() ? { account: account.trim() } : {}),
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
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("project_tags")
    .insert({
      ...(account?.trim() ? { account: account.trim() } : {}),
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

  const { id, project_name, is_active, account: newAccount, bulk_assign_account, project_ids } = body;

  // Bulk assign projects to an account
  if (bulk_assign_account !== undefined && Array.isArray(project_ids)) {
    for (const pid of project_ids) {
      await supabase
        .from("project_tags")
        .update({ account: bulk_assign_account || null })
        .eq("id", pid);
    }
    return Response.json({ success: true });
  }

  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (project_name !== undefined) updates.project_name = project_name.trim();
  if (is_active !== undefined) updates.is_active = is_active;
  if (newAccount !== undefined) updates.account = newAccount || null;

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
  const ids = searchParams.get("ids"); // comma-separated for bulk delete

  if (!id && !ids) {
    return Response.json({ error: "id or ids is required" }, { status: 400 });
  }

  if (ids) {
    // Bulk delete
    const idList = ids.split(",").map((i) => parseInt(i.trim())).filter((i) => !isNaN(i));
    if (idList.length === 0) {
      return Response.json({ error: "No valid ids provided" }, { status: 400 });
    }
    const { error } = await supabase.from("project_tags").delete().in("id", idList);
    if (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ success: true, deleted: idList.length });
  }

  const { error } = await supabase.from("project_tags").delete().eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ success: true });
}
