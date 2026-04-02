import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET: List task templates (optionally filter by project_tag_id) */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const projectTagId = searchParams.get("project_tag_id");

  let query = supabase
    .from("task_templates")
    .select("*")
    .order("sort_order");

  if (projectTagId) {
    query = query.eq("project_tag_id", parseInt(projectTagId));
  }

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ tasks: data ?? [] });
}

/** POST: Create task template(s) - supports bulk via `names` array */
export async function POST(request: Request) {
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
  const { project_tag_id, task_name, names } = body;

  if (!project_tag_id) {
    return Response.json({ error: "project_tag_id is required" }, { status: 400 });
  }

  // Bulk insert
  if (Array.isArray(names) && names.length > 0) {
    const { data: existing } = await supabase
      .from("task_templates")
      .select("sort_order")
      .eq("project_tag_id", project_tag_id)
      .order("sort_order", { ascending: false })
      .limit(1);

    let nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

    const rows = names
      .map((n: string) => n.trim())
      .filter(Boolean)
      .map((name: string) => ({
        project_tag_id,
        task_name: name,
        sort_order: nextOrder++,
        created_by: user.id,
      }));

    const { data, error } = await supabase
      .from("task_templates")
      .insert(rows)
      .select();

    if (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    return Response.json({ tasks: data }, { status: 201 });
  }

  // Single insert
  if (!task_name?.trim()) {
    return Response.json({ error: "task_name is required" }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from("task_templates")
    .select("sort_order")
    .eq("project_tag_id", project_tag_id)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("task_templates")
    .insert({
      project_tag_id,
      task_name: task_name.trim(),
      sort_order: nextOrder,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ task: data }, { status: 201 });
}

/** PATCH: Update a task template (name, active status, sort_order) */
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
        .from("task_templates")
        .update({ sort_order: item.sort_order })
        .eq("id", item.id);
    }
    return Response.json({ success: true });
  }

  const { id, task_name, is_active } = body;

  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (task_name !== undefined) updates.task_name = task_name.trim();
  if (is_active !== undefined) updates.is_active = is_active;

  const { error } = await supabase
    .from("task_templates")
    .update(updates)
    .eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ success: true });
}

/** DELETE: Hard delete a task template */
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
    const { error } = await supabase.from("task_templates").delete().in("id", idList);
    if (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ success: true, deleted: idList.length });
  }

  const { error } = await supabase.from("task_templates").delete().eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ success: true });
}
