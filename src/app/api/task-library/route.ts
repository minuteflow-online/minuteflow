import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET: List all tasks in the global library */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search");

  let query = supabase
    .from("task_library")
    .select("*")
    .order("sort_order")
    .order("task_name");

  if (search) {
    query = query.ilike("task_name", `%${search}%`);
  }

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ tasks: data ?? [] });
}

/** POST: Create task(s) in the global library - supports bulk via `names` array */
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
  const { task_name, names, category_id, billing_type, default_rate } = body;

  // Get next sort_order
  const { data: existing } = await supabase
    .from("task_library")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);

  let nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

  // Bulk insert
  if (Array.isArray(names) && names.length > 0) {
    const rows = names
      .map((n: string) => n.trim())
      .filter(Boolean)
      .map((name: string) => ({
        task_name: name,
        sort_order: nextOrder++,
        created_by: user.id,
        ...(category_id ? { category_id } : {}),
        ...(billing_type ? { billing_type } : {}),
        ...(default_rate !== undefined && default_rate !== null ? { default_rate } : {}),
      }));

    const { data, error } = await supabase
      .from("task_library")
      .insert(rows)
      .select();

    if (error) {
      // Check for unique constraint violation
      if (error.code === "23505") {
        return Response.json(
          { error: "One or more task names already exist in the library" },
          { status: 409 }
        );
      }
      return Response.json({ error: error.message }, { status: 400 });
    }

    return Response.json({ tasks: data }, { status: 201 });
  }

  // Single insert
  if (!task_name?.trim()) {
    return Response.json({ error: "task_name is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("task_library")
    .insert({
      task_name: task_name.trim(),
      sort_order: nextOrder,
      created_by: user.id,
      ...(category_id ? { category_id } : {}),
      ...(billing_type ? { billing_type } : {}),
      ...(default_rate !== undefined && default_rate !== null ? { default_rate } : {}),
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return Response.json(
        { error: "A task with this name already exists" },
        { status: 409 }
      );
    }
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ task: data }, { status: 201 });
}

/** PATCH: Update a task in the library (name, active status, sort_order) or bulk reorder */
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
        .from("task_library")
        .update({ sort_order: item.sort_order })
        .eq("id", item.id);
    }
    return Response.json({ success: true });
  }

  const { id, task_name, is_active, category_id, billing_type, default_rate } = body;

  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (task_name !== undefined) updates.task_name = task_name.trim();
  if (is_active !== undefined) updates.is_active = is_active;
  if (category_id !== undefined) updates.category_id = category_id;
  if (billing_type !== undefined) updates.billing_type = billing_type;
  if (default_rate !== undefined) updates.default_rate = default_rate;

  const { error } = await supabase
    .from("task_library")
    .update(updates)
    .eq("id", id);

  if (error) {
    if (error.code === "23505") {
      return Response.json(
        { error: "A task with this name already exists" },
        { status: 409 }
      );
    }
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ success: true });
}

/** DELETE: Delete task(s) from the library */
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
  const ids = searchParams.get("ids");

  if (!id && !ids) {
    return Response.json({ error: "id or ids is required" }, { status: 400 });
  }

  if (ids) {
    const idList = ids
      .split(",")
      .map((i) => parseInt(i.trim()))
      .filter((i) => !isNaN(i));
    if (idList.length === 0) {
      return Response.json({ error: "No valid ids provided" }, { status: 400 });
    }
    // CASCADE will remove project_task_assignments automatically
    const { error } = await supabase.from("task_library").delete().in("id", idList);
    if (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ success: true, deleted: idList.length });
  }

  const { error } = await supabase.from("task_library").delete().eq("id", id);
  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ success: true });
}
